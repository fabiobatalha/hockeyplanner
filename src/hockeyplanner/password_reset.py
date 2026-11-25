import hmac
import logging
import secrets
import time
from collections.abc import Callable

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from flask_babel import gettext

from .accounts import Accounts, password_hash, token_hash
from .database import PasswordResetRequest, User, UserAccess, UserEmail, UserLocale
from .email_confirmation import public_email_link, send_email
from .email_tasks import EmailDeliveryError, EmailTasks
from .i18n import LANGUAGES, email_text
from .models import ResetPassword


RESET_AGE = 30 * 60
RESEND_INTERVAL = 60
logger = logging.getLogger(__name__)


class InvalidPasswordReset(Exception):
    pass


def smtp_password_reset(address: str, token: str, *, language: str = "en") -> None:
    link = public_email_link(f"reset-password/{token}")
    send_email(
        address,
        email_text(language, "Reset your Hockey Planner password"),
        email_text(language, "Open %(link)s to choose a new password.", link=link) + "\n\n"
        + email_text(language, "This link can only be used once and expires in 30 minutes. If you did not request a password reset, you can ignore this message.") + "\n",
    )


class PasswordResets:
    def __init__(self, sessions: sessionmaker[Session], send: Callable[[str, str], None], tasks: EmailTasks) -> None:
        self.sessions = sessions
        self.send = send
        self.tasks = tasks

    def request(self, email: str, language: str = "en") -> None:
        token = secrets.token_urlsafe(32)
        digest = token_hash(token)
        now = int(time.time())
        with self.sessions.begin() as session:
            session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.expires <= now))
            account = session.execute(
                select(User, UserEmail)
                .join(UserEmail, UserEmail.user_id == User.id)
                .outerjoin(UserAccess, UserAccess.user_id == User.id)
                .where(
                    UserEmail.lookup_key == email.casefold(),
                    or_(UserAccess.user_id.is_(None), UserAccess.enabled.is_(True)),
                )
                .with_for_update(of=User)
            ).one_or_none()
            if account is None:
                return
            user, verified_email = account
            pending = session.get(PasswordResetRequest, user.id)
            if pending is not None and pending.expires > now + RESET_AGE - RESEND_INTERVAL:
                return
            if pending is None:
                pending = PasswordResetRequest(user_id=user.id)
                session.add(pending)
            pending.token_hash = digest
            pending.email_key = verified_email.lookup_key
            pending.password_digest = user.password_hash
            pending.expires = now + RESET_AGE
            user_id = user.id
            address = verified_email.address
            preference = session.get(UserLocale, user_id)
            if preference and preference.language in LANGUAGES:
                language = preference.language

        try:
            self.tasks.submit(self._deliver, user_id, digest, address, token, language)
        except EmailDeliveryError:
            self._discard(digest)
            logger.warning("Password reset email could not be queued.")

    def _discard(self, digest: bytes) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.token_hash == digest))

    def _deliver(self, user_id: int, digest: bytes, address: str, token: str, language: str) -> None:
        try:
            with self.sessions() as session:
                pending = session.get(PasswordResetRequest, user_id)
                if pending is None or pending.token_hash != digest or pending.expires <= int(time.time()):
                    return
            if self.send is smtp_password_reset:
                smtp_password_reset(address, token, language=language)
            else:
                self.send(address, token)
        except Exception:
            self._discard(digest)
            raise

    def reset(self, change: ResetPassword) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.expires <= int(time.time())))
            digest = token_hash(change.token)
            user_id = session.scalar(select(PasswordResetRequest.user_id).where(PasswordResetRequest.token_hash == digest))
            user = session.get(User, user_id, with_for_update=True) if user_id is not None else None
            pending = session.get(PasswordResetRequest, user_id) if user is not None else None
            if pending is not None and pending.token_hash != digest:
                pending = None
            if pending is not None:
                access = session.get(UserAccess, pending.user_id)
                address = session.get(UserEmail, pending.user_id)
                if (
                    user is not None and (access is None or access.enabled)
                    and address is not None and address.lookup_key == pending.email_key
                    and hmac.compare_digest(user.password_hash, pending.password_digest)
                ):
                    salt = secrets.token_bytes(16)
                    Accounts.replace_password(session, user, salt, password_hash(change.new_password, salt))
                    return
                session.delete(pending)
        raise InvalidPasswordReset(gettext("This password reset link is invalid or expired. Request a new link."))
