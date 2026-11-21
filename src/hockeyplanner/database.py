from pathlib import Path

from sqlalchemy import ForeignKey, MetaData, String, Table, UniqueConstraint, create_engine, insert, inspect, literal, select
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


class UserEmail(Base):
    __tablename__ = "user_emails"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    address: Mapped[str]
    lookup_key: Mapped[str] = mapped_column(unique=True)


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
