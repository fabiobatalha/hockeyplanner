import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from .database import LibraryRecord, PlanShare, PlanShareLink
from .models import Drill, LibraryImport, PracticePlan


MODELS = {"drills": Drill, "plans": PracticePlan}


def valid_id(value: str) -> bool:
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


class Library:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

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

    def import_legacy(self, owner_id: int, data: LibraryImport) -> None:
        with self.sessions.begin() as session:
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
                    statement = insert(LibraryRecord).on_conflict_do_nothing(
                        index_elements=["owner_id", "collection", "id"],
                    )
                    session.execute(statement, rows)
