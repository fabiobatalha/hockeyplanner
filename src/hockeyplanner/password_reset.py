import hmac
import logging
import secrets
import time
from collections.abc import Callable

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, sessionmaker

from .accounts import Accounts, password_hash, token_hash
from .database import PasswordResetRequest, User, UserAccess, UserEmail
from .email_confirmation import EmailDeliveryError, public_email_link, send_email
from .models import ResetPassword


RESET_AGE = 30 * 60
RESEND_INTERVAL = 60
logger = logging.getLogger(__name__)


class InvalidPasswordReset(Exception):
    pass


def smtp_password_reset(address: str, token: str) -> None:
    link = public_email_link(f"reset-password/{token}")
    send_email(
        address,
        "Reset your Hockey Planner password",
        f"Open {link} to choose a new password.\n\n"
        "This link can only be used once and expires in 30 minutes. "
        "If you did not request a password reset, you can ignore this message.\n",
    )


class PasswordResets:
    def __init__(self, sessions: sessionmaker[Session], send: Callable[[str, str], None]) -> None:
        self.sessions = sessions
        self.send = send

    def request(self, email: str) -> None:
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
            address = verified_email.address

        try:
            self.send(address, token)
        except EmailDeliveryError:
            with self.sessions.begin() as session:
                session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.token_hash == digest))
            # Keep the HTTP response the same for unknown addresses and delivery failures.
            logger.warning("Password reset email could not be sent.")

    def reset(self, change: ResetPassword) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.expires <= int(time.time())))
            pending = session.scalar(select(PasswordResetRequest).where(
                PasswordResetRequest.token_hash == token_hash(change.token),
            ))
            if pending is not None:
                user = session.get(User, pending.user_id)
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
        raise InvalidPasswordReset("This password reset link is invalid or expired. Request a new link.")
