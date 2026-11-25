import hashlib
import hmac
import secrets
import time
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .database import (
    AccountSession, DrillShareLink, EmailConfirmation, LibraryRecord, PasswordResetRequest, PlanShare, PlanShareLink,
    PlatformDrill, RetiredUserId, User, UserAccess, UserEmail, UserMembership, UserPublicIdentity, lock_postgres,
)
from .models import AccountProfile, AccountTier, AccountUpdate, Credentials, Login, PasswordChange, UserProfile


SESSION_AGE = 7 * 24 * 60 * 60
ROUNDS = 600_000


class UsernameTaken(Exception):
    pass


class EmailTaken(Exception):
    pass


class IncorrectPassword(Exception):
    pass


class AccountNotFound(Exception):
    pass


class AdministrationDenied(Exception):
    pass


def profile(user: User, access: UserAccess | None) -> UserProfile:
    return UserProfile(
        id=user.id, public_id=user.public_identity.public_id, username=user.username,
        role=access.role if access else "user",
        enabled=access.enabled if access else True,
    )


def password_hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ROUNDS)


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode("ascii")).digest()


class Accounts:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

    def create(self, credentials: Credentials, *, email: str | None = None, tier: AccountTier = "free") -> int:
        salt = secrets.token_bytes(16)
        digest = password_hash(credentials.password, salt)
        with self.sessions.begin() as session:
            return self.create_user(session, credentials.username, salt, digest, email=email, tier=tier)

    @classmethod
    def create_user(
        cls, session: Session, username: str, salt: bytes, digest: bytes, *,
        email: str | None = None, tier: AccountTier = "free",
    ) -> int:
        # Never reuse deleted account IDs, including on databases created before account deletion existed.
        lock_postgres(session.connection(), 2)
        latest_user, latest_retired = session.execute(select(
            select(func.max(User.id)).scalar_subquery(),
            select(func.max(RetiredUserId.id)).scalar_subquery(),
        )).one()
        next_id = max(latest_user or 0, latest_retired or 0) + 1
        user = User(id=next_id, username=username, salt=salt, password_hash=digest, public_identity=UserPublicIdentity())
        session.add(user)
        try:
            session.flush()
        except IntegrityError as error:
            raise UsernameTaken from error
        if email:
            cls.save_email(session, user.id, email)
        first_account = session.scalar(select(User.id).where(User.id != user.id).limit(1)) is None
        session.add(UserMembership(user_id=user.id, tier="full" if first_account else tier))
        session.add(UserAccess(user_id=user.id, role="poweruser" if first_account else "user", enabled=True))
        if first_account:
            session.execute(update(LibraryRecord).where(LibraryRecord.owner_id == 0).values(owner_id=user.id))
        return user.id

    def select_free_tier(self, user_id: int, *, allow_downgrade: bool = False) -> bool:
        with self.sessions.begin() as session:
            eligible_tiers = ("pending", "full") if allow_downgrade else ("pending",)
            poweruser = select(UserAccess.user_id).where(
                UserAccess.user_id == user_id, UserAccess.role == "poweruser",
            ).exists()
            changed = session.execute(update(UserMembership).where(
                UserMembership.user_id == user_id,
                UserMembership.tier.in_(eligible_tiers),
                ~poweruser,
            ).values(tier="free"))
            if changed.rowcount:
                return True
            membership = session.get(UserMembership, user_id)
            return membership is None or membership.tier == "free"

    def authenticate(self, credentials: Login) -> User | None:
        with self.sessions() as session:
            query = select(User)
            if "@" in credentials.identifier:
                query = query.join(UserEmail, UserEmail.user_id == User.id).where(UserEmail.lookup_key == credentials.identifier)
            else:
                query = query.where(func.lower(User.username) == credentials.identifier.lower())
            user = session.scalar(query)
            salt, digest = (user.salt, user.password_hash) if user else (bytes(16), bytes(32))
            matched = hmac.compare_digest(password_hash(credentials.password, salt), digest)
            access = session.get(UserAccess, user.id) if user and matched else None
            return user if matched and (access is None or access.enabled) else None

    @staticmethod
    def replace_password(session: Session, user: User, salt: bytes, digest: bytes) -> None:
        user.salt = salt
        user.password_hash = digest
        session.execute(delete(AccountSession).where(AccountSession.user_id == user.id))
        session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.user_id == user.id))

    def change_password(self, user_id: int, changes: PasswordChange) -> str:
        token = secrets.token_urlsafe(32)
        salt = secrets.token_bytes(16)
        digest = password_hash(changes.new_password, salt)
        with self.sessions.begin() as session:
            user = session.get(User, user_id)
            if user is None or not hmac.compare_digest(password_hash(changes.current_password, user.salt), user.password_hash):
                raise IncorrectPassword
            self.replace_password(session, user, salt, digest)
            session.add(AccountSession(
                token_hash=token_hash(token), user_id=user_id, expires=int(time.time()) + SESSION_AGE,
            ))
        return token

    @staticmethod
    def save_email(session: Session, user_id: int, address: str) -> None:
        contact = session.get(UserEmail, user_id)
        if contact is None:
            contact = UserEmail(user_id=user_id)
            session.add(contact)
        contact.address = address
        contact.lookup_key = address.casefold()
        try:
            session.flush()
        except IntegrityError as error:
            raise EmailTaken from error

    def start_session(self, user_id: int, previous: str | None, expected_digest: bytes | None = None) -> str | None:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self.sessions.begin() as session:
            session.execute(delete(AccountSession).where(AccountSession.expires <= now))
            user = session.get(User, user_id)
            access = session.get(UserAccess, user_id)
            if user is None or (access and not access.enabled):
                return None
            if expected_digest is not None and not hmac.compare_digest(expected_digest, user.password_hash):
                return None
            if previous:
                session.execute(delete(AccountSession).where(AccountSession.token_hash == token_hash(previous)))
            session.add(AccountSession(token_hash=token_hash(token), user_id=user_id, expires=now + SESSION_AGE))
        return token

    def get_user(self, token: str | None) -> AccountProfile | None:
        if not token:
            return None
        with self.sessions() as session:
            row = session.execute(
                select(User, UserAccess, UserEmail.address, UserMembership.tier)
                .join(AccountSession, AccountSession.user_id == User.id)
                .outerjoin(UserAccess, UserAccess.user_id == User.id)
                .outerjoin(UserEmail, UserEmail.user_id == User.id)
                .outerjoin(UserMembership, UserMembership.user_id == User.id)
                .where(AccountSession.token_hash == token_hash(token), AccountSession.expires > int(time.time()))
            ).one_or_none()
            if row is None:
                return None
            user, access, email, tier = row
            account = profile(user, access)
            return AccountProfile(**account.model_dump(), email=email, tier=tier or "free") if account.enabled else None

    def list_users(self) -> list[AccountProfile]:
        with self.sessions() as session:
            rows = session.execute(
                select(User, UserAccess, UserEmail.address, UserMembership.tier)
                .options(selectinload(User.public_identity))
                .outerjoin(UserAccess, UserAccess.user_id == User.id)
                .outerjoin(UserEmail, UserEmail.user_id == User.id)
                .outerjoin(UserMembership, UserMembership.user_id == User.id)
                .order_by(User.username)
            )
            return [AccountProfile(**profile(user, access).model_dump(), email=email, tier=tier or "free") for user, access, email, tier in rows]

    def internal_id(self, public_id: UUID) -> int:
        with self.sessions() as session:
            user_id = session.scalar(select(UserPublicIdentity.user_id).where(UserPublicIdentity.public_id == public_id))
            if user_id is None:
                raise AccountNotFound
            return user_id

    @staticmethod
    def require_account_administrator(session: Session, actor_id: int, user_id: int) -> None:
        if actor_id == user_id:
            raise AdministrationDenied("You cannot change your own account here.")
        # Check authority inside the write transaction to make concurrent role changes safe.
        result = session.execute(update(UserAccess).where(
            UserAccess.user_id == actor_id,
            UserAccess.role == "poweruser",
            UserAccess.enabled.is_(True),
        ).values(role=UserAccess.role))
        if not result.rowcount:
            raise AdministrationDenied("Poweruser access is required.")

    def update_user(self, actor_id: int, user_id: int, changes: AccountUpdate) -> AccountProfile:
        with self.sessions.begin() as session:
            self.require_account_administrator(session, actor_id, user_id)
            user = session.get(User, user_id)
            if user is None:
                raise AccountNotFound
            access = session.get(UserAccess, user_id)
            if access is None:
                access = UserAccess(user_id=user_id)
                session.add(access)
            access.role = changes.role
            access.enabled = changes.enabled
            if changes.role != "poweruser" or not changes.enabled:
                session.execute(delete(PlatformDrill).where(PlatformDrill.owner_id == user_id))
            membership = session.get(UserMembership, user_id)
            tier = "full" if changes.role == "poweruser" else changes.tier
            if tier is not None:
                if membership is None:
                    membership = UserMembership(user_id=user_id)
                    session.add(membership)
                membership.tier = tier
            if changes.password is not None:
                salt = secrets.token_bytes(16)
                self.replace_password(session, user, salt, password_hash(changes.password, salt))
            elif not changes.enabled:
                session.execute(delete(AccountSession).where(AccountSession.user_id == user_id))
                session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.user_id == user_id))
            email = session.get(UserEmail, user_id)
            return AccountProfile(
                **profile(user, access).model_dump(),
                tier=membership.tier if membership else "free",
                email=email.address if email else None,
            )

    def delete_user(self, actor_id: int, user_id: int) -> None:
        with self.sessions.begin() as session:
            self.require_account_administrator(session, actor_id, user_id)
            user = session.get(User, user_id)
            if user is None:
                raise AccountNotFound

            self.purge_user(session, user)

    def delete_own_account(self, user_id: int, password: str) -> None:
        with self.sessions.begin() as session:
            # Lock before checking the password so a concurrent reset cannot race deletion.
            updated = session.execute(update(User).where(User.id == user_id).values(username=User.username))
            if not updated.rowcount:
                raise AccountNotFound
            user = session.get(User, user_id)
            if not hmac.compare_digest(password_hash(password, user.salt), user.password_hash):
                raise IncorrectPassword
            self.purge_user(session, user)

    @staticmethod
    def purge_user(session: Session, user: User) -> None:
        user_id = user.id
        session.execute(delete(PlatformDrill).where(PlatformDrill.owner_id == user_id))
        session.execute(delete(PlanShare).where(or_(
            PlanShare.owner_id == user_id, PlanShare.recipient_id == user_id,
        )))
        session.execute(delete(PlanShareLink).where(PlanShareLink.owner_id == user_id))
        session.execute(delete(DrillShareLink).where(DrillShareLink.owner_id == user_id))
        session.execute(delete(LibraryRecord).where(LibraryRecord.owner_id == user_id))
        session.execute(delete(EmailConfirmation).where(or_(
            EmailConfirmation.user_id == user_id,
            func.lower(EmailConfirmation.username) == user.username.lower(),
        )))
        for record in (AccountSession, PasswordResetRequest, UserEmail, UserMembership, UserAccess):
            session.execute(delete(record).where(record.user_id == user_id))
        session.add(RetiredUserId(id=user_id))
        session.delete(user)

    def end_session(self, token: str | None) -> None:
        if token:
            with self.sessions.begin() as session:
                session.execute(delete(AccountSession).where(AccountSession.token_hash == token_hash(token)))
