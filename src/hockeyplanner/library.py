import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from .accounts import AccountNotFound
from .database import DrillShareLink, LibraryRecord, PlanShare, PlanShareLink, User, UserMembership
from .models import Drill, LibraryImport, PracticePlan


MODELS = {"drills": Drill, "plans": PracticePlan}


FREE_LIMITS = {"drills": 10, "plans": 3}


class CapacityExceeded(Exception):
    def __init__(self, collection: str, limit: int, used: int, requested: int) -> None:
        self.collection = collection
        self.limit = limit
        self.used = used
        self.requested = requested
        label = "drills" if collection == "drills" else "practice plans"
        super().__init__(f"Free accounts can save up to {limit} {label}.")


def lock_library(session: Session, owner_id: int) -> None:
    # Acquire SQLite's write lock before checking capacity so simultaneous creates cannot exceed it.
    result = session.execute(update(User).where(User.id == owner_id).values(username=User.username))
    if not result.rowcount:
        raise AccountNotFound


def check_capacity(session: Session, owner_id: int, collection: str, additions: int) -> None:
    if additions <= 0:
        return
    membership = session.get(UserMembership, owner_id)
    if membership is not None and membership.tier == "full":
        return
    total = session.scalar(select(func.count()).select_from(LibraryRecord).where(
        LibraryRecord.owner_id == owner_id,
        LibraryRecord.collection == collection,
        LibraryRecord.body.is_not(None),
    ))
    limit = FREE_LIMITS[collection]
    if total + additions > limit:
        raise CapacityExceeded(collection, limit, total, additions)


def valid_id(value: str) -> bool:
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


class Library:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

    def drill_count(self, owner_id: int) -> int:
        with self.sessions() as session:
            return session.scalar(select(func.count()).select_from(LibraryRecord).where(
                LibraryRecord.owner_id == owner_id, LibraryRecord.collection == "drills",
                LibraryRecord.body.is_not(None),
            ))

    def get(self, owner_id: int, collection: str, record_id: str) -> dict | None:
        with self.sessions() as session:
            body = session.scalar(select(LibraryRecord.body).where(
                LibraryRecord.owner_id == owner_id, LibraryRecord.collection == collection,
                LibraryRecord.id == record_id,
            ))
            return json.loads(body) if body is not None else None

    def read(self, owner_id: int) -> dict:
        result = {collection: [] for collection in MODELS}
        with self.sessions() as session:
            records = session.scalars(
                select(LibraryRecord)
                .where(LibraryRecord.owner_id == owner_id, LibraryRecord.body.is_not(None))
                .order_by(LibraryRecord.revision.desc())
            )
            for record in records:
                result[record.collection].append(json.loads(record.body))
        return result

    def write(self, owner_id: int, collection: str, record_id: str, payload: Drill | PracticePlan | None) -> None:
        body = None
        if payload is not None:
            if str(payload.id) != record_id:
                raise ValueError("The record ID must match the requested ID.")
            body = payload.model_dump_json(exclude_unset=True, exclude_none=True)
        with self.sessions.begin() as session:
            lock_library(session, owner_id)
            if payload is not None:
                active = session.scalar(select(LibraryRecord.revision).where(
                    LibraryRecord.owner_id == owner_id,
                    LibraryRecord.collection == collection,
                    LibraryRecord.id == record_id,
                    LibraryRecord.body.is_not(None),
                ))
                check_capacity(session, owner_id, collection, int(active is None))
            # A new revision controls display order. Keep a null revision for deletions.
            session.execute(delete(LibraryRecord).where(
                LibraryRecord.owner_id == owner_id,
                LibraryRecord.collection == collection,
                LibraryRecord.id == record_id,
            ))
            session.add(LibraryRecord(owner_id=owner_id, collection=collection, id=record_id, body=body))
            if collection == "plans" and payload is None:
                for relation in (PlanShare, PlanShareLink):
                    session.execute(delete(relation).where(relation.owner_id == owner_id, relation.plan_id == record_id))
            if collection == "drills" and payload is None:
                session.execute(delete(DrillShareLink).where(
                    DrillShareLink.owner_id == owner_id, DrillShareLink.drill_id == record_id,
                ))

    def import_legacy(self, owner_id: int, data: LibraryImport) -> None:
        with self.sessions.begin() as session:
            lock_library(session, owner_id)
            for collection, model in MODELS.items():
                rows = []
                for candidate in reversed(getattr(data, collection)):
                    try:
                        payload = model.model_validate(candidate)
                    except ValidationError:
                        continue
                    rows.append({
                        "owner_id": owner_id,
                        "collection": collection,
                        "id": str(payload.id),
                        "body": payload.model_dump_json(exclude_unset=True, exclude_none=True),
                    })
                if rows:
                    existing = set(session.scalars(select(LibraryRecord.id).where(
                        LibraryRecord.owner_id == owner_id, LibraryRecord.collection == collection,
                    )))
                    check_capacity(session, owner_id, collection, len({row["id"] for row in rows} - existing))
                    statement = insert(LibraryRecord).on_conflict_do_nothing(
                        index_elements=["owner_id", "collection", "id"],
                    )
                    session.execute(statement, rows)
