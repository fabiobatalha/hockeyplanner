from pathlib import Path

from sqlalchemy import ForeignKey, MetaData, String, Table, UniqueConstraint, create_engine, insert, inspect, literal, select, update
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(collation="NOCASE"), unique=True)
    salt: Mapped[bytes]
    password_hash: Mapped[bytes]


class RetiredUserId(Base):
    __tablename__ = "retired_user_ids"

    id: Mapped[int] = mapped_column(primary_key=True)


class UserEmail(Base):
    __tablename__ = "user_emails"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    address: Mapped[str]
    lookup_key: Mapped[str] = mapped_column(unique=True)


class EmailConfirmation(Base):
    __tablename__ = "email_confirmations"

    token_hash: Mapped[bytes] = mapped_column(primary_key=True)
    email: Mapped[str]
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    username: Mapped[str | None]
    password_salt: Mapped[bytes | None]
    password_digest: Mapped[bytes]
    code_salt: Mapped[bytes]
    code_digest: Mapped[bytes]
    expires: Mapped[int] = mapped_column(index=True)
    attempts_left: Mapped[int]
    return_to: Mapped[str]


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    token_hash: Mapped[bytes] = mapped_column(unique=True)
    email_key: Mapped[str]
    password_digest: Mapped[bytes]
    expires: Mapped[int] = mapped_column(index=True)


class UserMembership(Base):
    __tablename__ = "user_memberships"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    tier: Mapped[str]


class UserAccess(Base):
    __tablename__ = "user_access"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str]
    enabled: Mapped[bool]


class AccountSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[bytes] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires: Mapped[int]


class LibraryRecord(Base):
    __tablename__ = "library_records"
    __table_args__ = (
        UniqueConstraint("owner_id", "collection", "id"),
        {"sqlite_autoincrement": True},
    )

    revision: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int]
    collection: Mapped[str]
    id: Mapped[str]
    body: Mapped[str | None]


class PlanShare(Base):
    __tablename__ = "plan_shares"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    plan_id: Mapped[str] = mapped_column(primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)


class PlanShareLink(Base):
    __tablename__ = "plan_share_links"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    plan_id: Mapped[str] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(unique=True)


class DrillShareLink(Base):
    __tablename__ = "drill_share_links"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    drill_id: Mapped[str] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(unique=True)


def open_database(path: Path) -> sessionmaker[Session]:
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create("sqlite", database=str(path)), connect_args={"autocommit": False})
    with engine.begin() as connection:
        bootstrap_access = not inspect(connection).has_table("user_access")
        Base.metadata.create_all(connection)
        if bootstrap_access:
            first_user = select(User.id, literal("poweruser"), literal(True)).order_by(User.id).limit(1)
            connection.execute(insert(UserAccess.__table__).from_select(
                ["user_id", "role", "enabled"], first_user,
            ))
        powerusers = select(UserAccess.user_id).where(UserAccess.role == "poweruser")
        connection.execute(update(UserMembership).where(
            UserMembership.user_id.in_(powerusers), UserMembership.tier != "full",
        ).values(tier="full"))
        connection.execute(insert(UserMembership.__table__).from_select(
            ["user_id", "tier"],
            powerusers.add_columns(literal("full")).where(
                ~select(UserMembership.user_id).where(UserMembership.user_id == UserAccess.user_id).exists(),
            ),
        ))
        if inspect(connection).has_table("records"):
            previous = Table("records", MetaData(), autoload_with=connection)
            columns = previous.c
            owner = columns.owner_id if "owner_id" in columns else literal(0)
            connection.execute(insert(LibraryRecord.__table__).from_select(
                ["revision", "owner_id", "collection", "id", "body"],
                select(columns.revision, owner, columns.collection, columns.id, columns.body),
            ))
            previous.drop(connection)
    return sessionmaker(engine, expire_on_commit=False)
