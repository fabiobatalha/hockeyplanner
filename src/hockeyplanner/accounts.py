import hashlib
import hmac
import secrets
import time

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from .database import AccountSession, LibraryRecord, User, UserAccess, UserEmail
from .models import AccountProfile, AccountUpdate, Credentials, EmailUpdate, Login, PasswordChange, UserProfile


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
        id=user.id, username=user.username,
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

    def create(self, credentials: Credentials, *, email: str | None = None) -> int:
        salt = secrets.token_bytes(16)
        digest = password_hash(credentials.password, salt)
        with self.sessions.begin() as session:
            user = User(username=credentials.username, salt=salt, password_hash=digest)
            session.add(user)
            try:
                session.flush()
            except IntegrityError as error:
                raise UsernameTaken from error
            if email:
                self.save_email(session, user.id, email)
            session.add(UserAccess(user_id=user.id, role="poweruser" if user.id == 1 else "user", enabled=True))
            if user.id == 1:
                session.execute(update(LibraryRecord).where(LibraryRecord.owner_id == 0).values(owner_id=user.id))
            return user.id

    def authenticate(self, credentials: Login) -> User | None:
        with self.sessions() as session:
            query = select(User)
            if "@" in credentials.identifier:
                query = query.join(UserEmail, UserEmail.user_id == User.id).where(UserEmail.lookup_key == credentials.identifier)
            else:
                query = query.where(User.username == credentials.identifier)
            user = session.scalar(query)
            salt, digest = (user.salt, user.password_hash) if user else (bytes(16), bytes(32))
            matched = hmac.compare_digest(password_hash(credentials.password, salt), digest)
            access = session.get(UserAccess, user.id) if user and matched else None
            return user if matched and (access is None or access.enabled) else None

    def update_email(self, user_id: int, changes: EmailUpdate) -> str:
        with self.sessions.begin() as session:
            user = session.get(User, user_id)
            if user is None or not hmac.compare_digest(password_hash(changes.password, user.salt), user.password_hash):
                raise IncorrectPassword
            self.save_email(session, user_id, changes.email)
            return changes.email

    def change_password(self, user_id: int, changes: PasswordChange) -> str:
        token = secrets.token_urlsafe(32)
        salt = secrets.token_bytes(16)
        digest = password_hash(changes.new_password, salt)
        with self.sessions.begin() as session:
            user = session.get(User, user_id)
            if user is None or not hmac.compare_digest(password_hash(changes.current_password, user.salt), user.password_hash):
                raise IncorrectPassword
            user.salt = salt
            user.password_hash = digest
            session.execute(delete(AccountSession).where(AccountSession.user_id == user_id))
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
                select(User, UserAccess, UserEmail.address)
                .join(AccountSession, AccountSession.user_id == User.id)
                .outerjoin(UserAccess, UserAccess.user_id == User.id)
                .outerjoin(UserEmail, UserEmail.user_id == User.id)
                .where(AccountSession.token_hash == token_hash(token), AccountSession.expires > int(time.time()))
            ).one_or_none()
            if row is None:
                return None
            user, access, email = row
            account = profile(user, access)
            return AccountProfile(**account.model_dump(), email=email) if account.enabled else None

    def list_users(self) -> list[AccountProfile]:
        with self.sessions() as session:
            rows = session.execute(
                select(User, UserAccess, UserEmail.address)
                .outerjoin(UserAccess, UserAccess.user_id == User.id)
                .outerjoin(UserEmail, UserEmail.user_id == User.id)
                .order_by(User.username)
            )
            return [AccountProfile(**profile(user, access).model_dump(), email=email) for user, access, email in rows]

    def update_user(self, actor_id: int, user_id: int, changes: AccountUpdate) -> UserProfile:
        if actor_id == user_id:
            raise AdministrationDenied("You cannot change your own account here.")

        with self.sessions.begin() as session:
            # Check authority in the write transaction so concurrent changes cannot remove every administrator.
            result = session.execute(update(UserAccess).where(
                UserAccess.user_id == actor_id,
                UserAccess.role == "poweruser",
                UserAccess.enabled.is_(True),
            ).values(role=UserAccess.role))
            if not result.rowcount:
                raise AdministrationDenied("Poweruser access is required.")

            user = session.get(User, user_id)
            if user is None:
                raise AccountNotFound
            access = session.get(UserAccess, user_id)
            if access is None:
                access = UserAccess(user_id=user_id)
                session.add(access)
            access.role = changes.role
            access.enabled = changes.enabled
            if changes.password is not None:
                user.salt = secrets.token_bytes(16)
                user.password_hash = password_hash(changes.password, user.salt)
            if not changes.enabled or changes.password is not None:
                session.execute(delete(AccountSession).where(AccountSession.user_id == user_id))
            return profile(user, access)

    def end_session(self, token: str | None) -> None:
        if token:
            with self.sessions.begin() as session:
                session.execute(delete(AccountSession).where(AccountSession.token_hash == token_hash(token)))
