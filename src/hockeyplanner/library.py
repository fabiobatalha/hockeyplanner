import json
import secrets
from datetime import UTC, datetime
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from flask_babel import gettext

from .accounts import AccountNotFound, AdministrationDenied
from .database import DrillShareLink, LibraryRecord, PlatformDrill, PlanShare, PlanShareLink, User, UserAccess, UserMembership, UserPublicIdentity, conflict_insert
from .models import Drill, LibraryImport, PracticePlan


MODELS = {"drills": Drill, "plans": PracticePlan}
FREE_LIMITS = {"drills": 20, "plans": 3}


class PlatformDrillNotFound(Exception):
    pass


def platform_records(session: Session):
    rows = session.execute(
        select(UserPublicIdentity.public_id, PlatformDrill.drill_id, LibraryRecord.body)
        .select_from(PlatformDrill)
        .join(LibraryRecord, and_(LibraryRecord.owner_id == PlatformDrill.owner_id,
                                  LibraryRecord.id == PlatformDrill.drill_id))
        .join(UserPublicIdentity, UserPublicIdentity.user_id == PlatformDrill.owner_id)
        .where(LibraryRecord.collection == "drills", LibraryRecord.body.is_not(None))
        .order_by(LibraryRecord.revision.desc())
    )
    result = {(str(owner), drill_id): json.loads(body) for owner, drill_id, body in rows}
    public_drill_sources(session, list(result.values()))
    return result


def public_drill_sources(session: Session, drills: list[dict]) -> list[dict]:
    legacy_sources = [
        (drill, name, source)
        for drill in drills
        for name in ("platformSource", "sharedSource")
        if isinstance(source := drill.get(name), dict) and type(source.get("ownerId")) is int
    ]
    if legacy_sources:
        owners = {source["ownerId"] for _, _, source in legacy_sources}
        identities = dict(session.execute(select(UserPublicIdentity.user_id, UserPublicIdentity.public_id).where(
            UserPublicIdentity.user_id.in_(owners),
        )).all())
        for drill, name, source in legacy_sources:
            public_id = identities.get(source["ownerId"])
            drill[name] = {**source, "ownerId": str(public_id) if public_id else None}
    return drills


def resolve_platform_drills(drills: list[dict], platforms: dict) -> list[dict]:
    resolved = []
    for drill in drills:
        source = drill.get("platformSource")
        current = None
        if isinstance(source, dict):
            key = (source.get("ownerId"), source.get("drillId"))
            if isinstance(key[0], str) and isinstance(key[1], str):
                current = platforms.get(key)
        resolved.append({**current, "id": drill["id"], "platformSource": source} if current else drill)
    return resolved


def plan_body(plan: dict) -> str:
    updated_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return json.dumps({**plan, "updated_at": updated_at})


class CapacityExceeded(Exception):
    def __init__(self, collection: str, limit: int, used: int, requested: int) -> None:
        self.collection = collection
        self.limit = limit
        self.used = used
        self.requested = requested
        if collection == "drills":
            message = gettext("Free accounts can save up to %(limit)d drills.", limit=limit)
        else:
            message = gettext("Free accounts can save up to %(limit)d practice plans.", limit=limit)
        super().__init__(message)


def lock_library(session: Session, owner_id: int) -> None:
    # Serialize library writes for this account before checking capacity.
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

    def counts(self, owner_id: int) -> dict[str, int]:
        with self.sessions() as session:
            rows = session.execute(select(LibraryRecord.collection, func.count()).where(
                LibraryRecord.owner_id == owner_id,
                LibraryRecord.body.is_not(None),
            ).group_by(LibraryRecord.collection))
            return {collection: count for collection, count in rows}

    def get(self, owner_id: int, collection: str, record_id: str) -> dict | None:
        with self.sessions() as session:
            body = session.scalar(select(LibraryRecord.body).where(
                LibraryRecord.owner_id == owner_id, LibraryRecord.collection == collection,
                LibraryRecord.id == record_id,
            ))
            if body is None:
                return None
            item = json.loads(body)
            public_drill_sources(session, item["activities"] if collection == "plans" else [item])
            return item

    def read(self, owner_id: int) -> dict:
        result = {collection: [] for collection in MODELS}
        with self.sessions() as session:
            records = session.scalars(
                select(LibraryRecord)
                .where(LibraryRecord.owner_id == owner_id, LibraryRecord.body.is_not(None))
                .order_by(LibraryRecord.revision.desc())
            )
            platforms = platform_records(session)
            result["platform_drills"] = [
                {**drill, "platformSource": {"ownerId": platform_owner, "drillId": drill_id}}
                for (platform_owner, drill_id), drill in platforms.items()
            ]
            for record in records:
                item = json.loads(record.body)
                if record.collection == "plans":
                    item["activities"] = resolve_platform_drills(public_drill_sources(session, item["activities"]), platforms)
                else:
                    public_drill_sources(session, [item])
                result[record.collection].append(item)
        return result

    def flag_platform_drill(self, owner_id: int, drill_id: str, enabled: bool) -> None:
        with self.sessions.begin() as session:
            lock_library(session, owner_id)
            access = session.get(UserAccess, owner_id)
            if not access or access.role != "poweruser" or not access.enabled:
                raise AdministrationDenied(gettext("Poweruser access is required."))
            if not self._drill_record(session, owner_id, drill_id):
                raise PlatformDrillNotFound
            if enabled:
                session.execute(conflict_insert(session, PlatformDrill).values(
                    owner_id=owner_id, drill_id=drill_id, token=secrets.token_urlsafe(32),
                ).on_conflict_do_nothing())
            else:
                session.execute(delete(PlatformDrill).where(
                    PlatformDrill.owner_id == owner_id, PlatformDrill.drill_id == drill_id,
                ))

    def is_platform_drill(self, owner_id: int, drill_id: str) -> bool:
        with self.sessions() as session:
            return session.get(PlatformDrill, (owner_id, drill_id)) is not None

    @staticmethod
    def _drill_record(session: Session, owner_id: int, drill_id: str) -> LibraryRecord | None:
        return session.scalar(select(LibraryRecord).where(
            LibraryRecord.owner_id == owner_id, LibraryRecord.id == drill_id,
            LibraryRecord.collection == "drills", LibraryRecord.body.is_not(None),
        ))

    def platform_link(self, owner_id: int, drill_id: str) -> str:
        with self.sessions() as session:
            flag = session.get(PlatformDrill, (owner_id, drill_id))
            if not flag or not self._drill_record(session, owner_id, drill_id):
                raise PlatformDrillNotFound
            return flag.token

    def copy_platform_drill(self, user_id: int, owner_id: int, drill_id: str, copy_id: str) -> str:
        with self.sessions.begin() as session:
            lock_library(session, user_id)
            source = self._drill_record(session, owner_id, drill_id)
            if not source or session.get(PlatformDrill, (owner_id, drill_id)) is None:
                raise PlatformDrillNotFound
            existing = session.scalar(select(LibraryRecord).where(
                LibraryRecord.owner_id == user_id, LibraryRecord.collection == "drills", LibraryRecord.id == copy_id,
            ))
            if existing is not None:
                if existing.body is not None and copy_id != drill_id:
                    return copy_id
                raise ValueError("Use a new drill ID for the copy.")
            if copy_id == drill_id:
                raise ValueError("Use a new drill ID for the copy.")
            check_capacity(session, user_id, "drills", 1)
            drill = json.loads(source.body)
            drill.pop("platformSource", None)
            drill["id"] = copy_id
            session.add(LibraryRecord(owner_id=user_id, collection="drills", id=copy_id, body=json.dumps(drill)))
            return copy_id

    def write(self, owner_id: int, collection: str, record_id: str, payload: Drill | PracticePlan | None) -> str | None:
        body = None
        if payload is not None and str(payload.id) != record_id:
            raise ValueError("The record ID must match the requested ID.")
        with self.sessions.begin() as session:
            lock_library(session, owner_id)
            if collection == "drills" and not self._drill_record(session, owner_id, record_id):
                published = session.scalar(select(PlatformDrill.owner_id).where(
                    PlatformDrill.drill_id == record_id, PlatformDrill.owner_id != owner_id,
                ).limit(1))
                if published is not None:
                    raise AdministrationDenied(gettext("Copy the platform drill before editing it."))
            if payload is not None:
                active = session.scalar(select(LibraryRecord.revision).where(
                    LibraryRecord.owner_id == owner_id,
                    LibraryRecord.collection == collection,
                    LibraryRecord.id == record_id,
                    LibraryRecord.body.is_not(None),
                ))
                check_capacity(session, owner_id, collection, int(active is None))
                if isinstance(payload, PracticePlan):
                    plan = payload.model_dump(mode="json", exclude_unset=True, exclude_none=True)
                    public_drill_sources(session, plan["activities"])
                    if any(drill.get("platformSource") for drill in plan["activities"]):
                        plan["activities"] = resolve_platform_drills(plan["activities"], platform_records(session))
                    body = plan_body(plan)
                else:
                    body = payload.model_dump_json(
                        exclude_unset=True, exclude_none=True, exclude={"platformSource", "sharedSource"},
                    )
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
                session.execute(delete(PlatformDrill).where(
                    PlatformDrill.owner_id == owner_id, PlatformDrill.drill_id == record_id,
                ))
        return body

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
                        "body": payload.model_dump_json(
                            exclude_unset=True, exclude_none=True,
                            exclude={"platformSource", "sharedSource"} if collection == "drills" else None,
                        ),
                    })
                if rows:
                    existing = set(session.scalars(select(LibraryRecord.id).where(
                        LibraryRecord.owner_id == owner_id, LibraryRecord.collection == collection,
                    )))
                    check_capacity(session, owner_id, collection, len({row["id"] for row in rows} - existing))
                    statement = conflict_insert(session, LibraryRecord).on_conflict_do_nothing(
                        index_elements=["owner_id", "collection", "id"],
                    )
                    session.execute(statement, rows)
