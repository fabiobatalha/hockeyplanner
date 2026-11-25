from os import getenv
from pathlib import Path
from time import sleep
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, MetaData, String, Table, UniqueConstraint, create_engine, func, insert, inspect, literal, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection, Engine, URL
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String().with_variant(String(collation="NOCASE"), "sqlite"), unique=True)
    salt: Mapped[bytes]
    password_hash: Mapped[bytes]
    public_identity: Mapped["UserPublicIdentity"] = relationship(cascade="all, delete-orphan")


Index("ix_users_username_lower", func.lower(User.username), unique=True).ddl_if(dialect="postgresql")


class UserPublicIdentity(Base):
    __tablename__ = "user_public_identities"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    public_id: Mapped[UUID] = mapped_column(unique=True, default=uuid4)


class UserLocale(Base):
    __tablename__ = "user_locales"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    language: Mapped[str]


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


class PlatformDrill(Base):
    __tablename__ = "platform_drills"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    drill_id: Mapped[str] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(unique=True)


def configured_database() -> URL | None:
    host = getenv("HOCKEYPLANNER_DB_HOST")
    if not host:
        return None
    password = getenv("HOCKEYPLANNER_DB_PASSWORD")
    if not password:
        raise ValueError("HOCKEYPLANNER_DB_PASSWORD is required for PostgreSQL.")
    return URL.create(
        "postgresql+psycopg",
        username=getenv("HOCKEYPLANNER_DB_USER", "hockeyplanner"),
        password=password,
        host=host,
        port=int(getenv("HOCKEYPLANNER_DB_PORT", "5432")),
        database=getenv("HOCKEYPLANNER_DB_NAME", "hockeyplanner"),
    )


def lock_postgres(connection: Connection, key: int) -> None:
    if connection.dialect.name == "postgresql":
        connection.execute(select(func.pg_advisory_xact_lock(1279345490, key)))


def conflict_insert(session: Session, model):
    dialect_insert = postgres_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    return dialect_insert(model)


def database_engine(target: Path | URL) -> Engine:
    if isinstance(target, Path):
        target.parent.mkdir(parents=True, exist_ok=True)
        return create_engine(URL.create("sqlite", database=str(target)), connect_args={"autocommit": False})
    return create_engine(target, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def open_database(target: Path | URL) -> sessionmaker[Session]:
    engine = database_engine(target)
    for attempt in range(20):
        try:
            connection = engine.connect()
            break
        except OperationalError:
            if engine.dialect.name != "postgresql" or attempt == 19:
                raise
            sleep(1)
    with connection, connection.begin():
        lock_postgres(connection, 1)
        bootstrap_access = not inspect(connection).has_table("user_access")
        Base.metadata.create_all(connection)
        missing_identities = connection.scalars(select(User.id).where(
            ~select(UserPublicIdentity.user_id).where(UserPublicIdentity.user_id == User.id).exists(),
        ))
        for batch in missing_identities.partitions(500):
            connection.execute(insert(UserPublicIdentity.__table__), [{"user_id": user_id} for user_id in batch])
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
        if connection.dialect.name == "sqlite" and inspect(connection).has_table("records"):
            previous = Table("records", MetaData(), autoload_with=connection)
            columns = previous.c
            owner = columns.owner_id if "owner_id" in columns else literal(0)
            connection.execute(insert(LibraryRecord.__table__).from_select(
                ["revision", "owner_id", "collection", "id", "body"],
                select(columns.revision, owner, columns.collection, columns.id, columns.body),
            ))
            previous.drop(connection)
    return sessionmaker(engine, expire_on_commit=False)
