import hashlib
import hmac
import os
import secrets
import smtplib
import ssl
import time
from collections.abc import Callable
from email.message import EmailMessage
from urllib.parse import urlsplit

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from .accounts import Accounts, EmailTaken, IncorrectPassword, UsernameTaken, password_hash, token_hash
from .database import EmailConfirmation, PasswordResetRequest, User, UserAccess, UserEmail
from .models import ConfirmEmail, EmailUpdate, Registration


CONFIRMATION_AGE = 30 * 60


class EmailDeliveryError(Exception):
    pass


class ConfirmationError(Exception):
    pass


def public_email_link(fragment: str) -> str:
    url = os.getenv("HOCKEYPLANNER_PUBLIC_URL", "").rstrip("/")
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
        raise EmailDeliveryError("Email delivery is not configured. Contact the site administrator.")
    return f"{url}/#{fragment}"


def smtp_confirmation(address: str, code: str, token: str) -> None:
    link = public_email_link(f"confirm-email/{token}")
    send_email(
        address,
        "Confirm your Hockey Planner email",
        f"Your Hockey Planner confirmation code is {code}.\n\n"
        f"Open {link} and enter the six-digit code.\n"
        "The request expires in 30 minutes. If you did not request this, you can ignore this message.\n",
    )


def send_email(address: str, subject: str, body: str) -> None:
    host = os.getenv("HOCKEYPLANNER_SMTP_HOST")
    sender = os.getenv("HOCKEYPLANNER_SMTP_FROM")
    if not host or not sender:
        raise EmailDeliveryError("Email delivery is not configured. Contact the site administrator.")
    try:
        mode = os.getenv("HOCKEYPLANNER_SMTP_SECURITY", "starttls")
        if mode not in ("starttls", "ssl"):
            raise ValueError("Invalid SMTP security mode")
        port = int(os.getenv("HOCKEYPLANNER_SMTP_PORT", "465" if mode == "ssl" else "587"))
        message = EmailMessage()
        message["From"] = sender
        message["To"] = address
        message["Subject"] = subject
        message.set_content(body)
        context = ssl.create_default_context()
        username = os.getenv("HOCKEYPLANNER_SMTP_USERNAME")
        password = os.getenv("HOCKEYPLANNER_SMTP_PASSWORD", "")
        for attempt in range(3):
            sending = False
            try:
                client = (smtplib.SMTP_SSL(host, port, timeout=6, context=context)
                          if mode == "ssl" else smtplib.SMTP(host, port, timeout=6))
                with client:
                    if mode == "starttls":
                        client.starttls(context=context)
                    if username:
                        client.login(username, password)
                    sending = True
                    client.send_message(message)
                return
            except (TimeoutError, smtplib.SMTPServerDisconnected):
                # A send attempt can have been accepted even if the reply was lost.
                if sending or attempt == 2:
                    raise
    except (OSError, ValueError, smtplib.SMTPException) as error:
        raise EmailDeliveryError("Could not send the email. Try again later.") from error


def code_hash(code: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", code.encode("ascii"), salt, 100_000)


class EmailConfirmations:
    def __init__(self, sessions: sessionmaker[Session], send: Callable[[str, str, str], None]) -> None:
        self.sessions = sessions
        self.send = send

    @staticmethod
    def remove_expired(session: Session) -> None:
        session.execute(delete(EmailConfirmation).where(EmailConfirmation.expires <= int(time.time())))

    def cleanup(self) -> None:
        with self.sessions.begin() as session:
            self.remove_expired(session)

    @staticmethod
    def request(email: str, *, password_digest: bytes, **fields) -> tuple[EmailConfirmation, str, str]:
        token = secrets.token_urlsafe(32)
        code = f"{secrets.randbelow(1_000_000):06d}"
        salt = secrets.token_bytes(16)
        pending = EmailConfirmation(
            token_hash=token_hash(token), email=email, code_salt=salt, code_digest=code_hash(code, salt),
            expires=int(time.time()) + CONFIRMATION_AGE, attempts_left=5,
            password_digest=password_digest, return_to="", **fields,
        )
        return pending, token, code

    def deliver(self, pending: EmailConfirmation, token: str, code: str) -> None:
        try:
            self.send(pending.email, code, token)
        except EmailDeliveryError:
            with self.sessions.begin() as session:
                session.execute(delete(EmailConfirmation).where(EmailConfirmation.token_hash == pending.token_hash))
            raise

    def start_registration(self, details: Registration) -> None:
        salt = secrets.token_bytes(16)
        pending, token, code = self.request(
            details.email, username=details.username, password_salt=salt,
            password_digest=password_hash(details.password, salt),
        )
        pending.return_to = details.return_to
        with self.sessions.begin() as session:
            self.remove_expired(session)
            if session.scalar(select(User.id).where(User.username == details.username)) is not None:
                raise UsernameTaken
            if session.scalar(select(UserEmail.user_id).where(UserEmail.lookup_key == details.email.casefold())) is not None:
                raise EmailTaken
            session.add(pending)
        self.deliver(pending, token, code)

    def start_change(self, user_id: int, changes: EmailUpdate) -> None:
        with self.sessions.begin() as session:
            self.remove_expired(session)
            user = session.get(User, user_id)
            if not user or not hmac.compare_digest(password_hash(changes.password, user.salt), user.password_hash):
                raise IncorrectPassword
            existing = session.scalar(select(UserEmail.user_id).where(UserEmail.lookup_key == changes.email.casefold()))
            if existing is not None and existing != user_id:
                raise EmailTaken
            pending, token, code = self.request(changes.email, user_id=user_id, password_digest=user.password_hash)
            session.execute(delete(EmailConfirmation).where(EmailConfirmation.user_id == user_id))
            session.add(pending)
        self.deliver(pending, token, code)

    def confirm(self, confirmation: ConfirmEmail) -> tuple[int | None, str]:
        failure = "This confirmation request is expired or no longer available. Start a new request."
        with self.sessions.begin() as session:
            self.remove_expired(session)
            pending = session.get(EmailConfirmation, token_hash(confirmation.token))
            if pending is not None:
                if not hmac.compare_digest(pending.code_digest, code_hash(confirmation.code, pending.code_salt)):
                    pending.attempts_left -= 1
                    if pending.attempts_left:
                        failure = "Incorrect code. Check the six digits in your email."
                    else:
                        session.delete(pending)
                elif pending.user_id is None:
                    new_user = Accounts.create_user(
                        session, pending.username, pending.password_salt, pending.password_digest,
                        email=pending.email, tier="pending",
                    )
                    session.delete(pending)
                    return new_user, pending.return_to
                else:
                    user = session.get(User, pending.user_id)
                    access = session.get(UserAccess, pending.user_id)
                    if user and (access is None or access.enabled) and hmac.compare_digest(user.password_hash, pending.password_digest):
                        Accounts.save_email(session, user.id, pending.email)
                        session.execute(delete(PasswordResetRequest).where(PasswordResetRequest.user_id == user.id))
                        session.delete(pending)
                        return None, ""
                    session.delete(pending)
        raise ConfirmationError(failure)
