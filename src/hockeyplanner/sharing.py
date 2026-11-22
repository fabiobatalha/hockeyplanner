import json
import secrets
from uuid import uuid4

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session, sessionmaker

from .library import check_capacity, lock_library
from .database import LibraryRecord, PlanShare, PlanShareLink, User, UserAccess


class ShareNotFound(Exception):
    pass


def find_plan(session: Session, owner_id: int, plan_id: str) -> LibraryRecord:
    record = session.scalar(select(LibraryRecord).where(
        LibraryRecord.owner_id == owner_id,
        LibraryRecord.id == plan_id,
        LibraryRecord.collection == "plans",
        LibraryRecord.body.is_not(None),
    ))
    if record is None:
        raise ShareNotFound("Plan not found.")
    return record


def find_link(session: Session, token: str) -> PlanShareLink:
    link = session.scalar(select(PlanShareLink).where(PlanShareLink.token == token))
    if link is None:
        raise ShareNotFound("This share link is no longer available.")
    return link


def resolved_plan(session: Session, record: LibraryRecord) -> dict:
    plan = json.loads(record.body)
    saved = plan["activities"]
    current = session.scalars(select(LibraryRecord).where(
        LibraryRecord.owner_id == record.owner_id,
        LibraryRecord.collection == "drills",
        LibraryRecord.id.in_({drill["id"] for drill in saved}),
        LibraryRecord.body.is_not(None),
    ))
    replacements = {drill.id: json.loads(drill.body) for drill in current}
    plan["activities"] = [replacements.get(drill["id"], drill) for drill in saved]
    return plan


class Sharing:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

    def recipients(self, owner_id: int, plan_id: str) -> list[dict]:
        with self.sessions() as session:
            find_plan(session, owner_id, plan_id)
            rows = session.execute(
                select(User.id, User.username).join(PlanShare, PlanShare.recipient_id == User.id)
                .where(PlanShare.owner_id == owner_id, PlanShare.plan_id == plan_id)
                .order_by(User.username)
            )
            return [{"id": row.id, "username": row.username} for row in rows]

    def share(self, owner_id: int, plan_id: str, username: str) -> None:
        with self.sessions.begin() as session:
            find_plan(session, owner_id, plan_id)
            recipient_id = session.scalar(
                select(User.id).outerjoin(UserAccess, UserAccess.user_id == User.id)
                .where(User.username == username, or_(UserAccess.enabled.is_(True), UserAccess.user_id.is_(None)))
            )
            if recipient_id is None:
                raise ShareNotFound("No active account matches that username.")
            if recipient_id == owner_id:
                raise ValueError("You already own this plan.")
            session.execute(insert(PlanShare).values(
                owner_id=owner_id, plan_id=plan_id, recipient_id=recipient_id,
            ).on_conflict_do_nothing())

    def revoke(self, owner_id: int, plan_id: str, recipient_id: int) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(PlanShare).where(
                PlanShare.owner_id == owner_id, PlanShare.plan_id == plan_id, PlanShare.recipient_id == recipient_id,
            ))

    def get_link(self, owner_id: int, plan_id: str) -> str | None:
        with self.sessions() as session:
            find_plan(session, owner_id, plan_id)
            link = session.get(PlanShareLink, (owner_id, plan_id))
            return link.token if link else None

    def create_link(self, owner_id: int, plan_id: str) -> str:
        with self.sessions.begin() as session:
            find_plan(session, owner_id, plan_id)
            session.execute(insert(PlanShareLink).values(
                owner_id=owner_id, plan_id=plan_id, token=secrets.token_urlsafe(32),
            ).on_conflict_do_nothing(index_elements=["owner_id", "plan_id"]))
            return session.get(PlanShareLink, (owner_id, plan_id)).token

    def disable_link(self, owner_id: int, plan_id: str) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(PlanShareLink).where(
                PlanShareLink.owner_id == owner_id, PlanShareLink.plan_id == plan_id,
            ))

    def preview_link(self, token: str) -> dict:
        with self.sessions() as session:
            link = find_link(session, token)
            record = find_plan(session, link.owner_id, link.plan_id)
            owner = session.get(User, link.owner_id)
            plan = resolved_plan(session, record)
            activities = [
                {key: drill[key] for key in ("title", "description", "layout", "items") if key in drill}
                for drill in plan["activities"]
            ]
            return {"owner": owner.username, "plan": {"name": plan["name"], "activities": activities}}

    def claim_link(self, recipient_id: int, token: str) -> None:
        with self.sessions.begin() as session:
            lock_library(session, recipient_id)
            link = find_link(session, token)
            find_plan(session, link.owner_id, link.plan_id)
            if recipient_id != link.owner_id:
                session.execute(insert(PlanShare).values(
                    owner_id=link.owner_id, plan_id=link.plan_id, recipient_id=recipient_id,
                ).on_conflict_do_nothing())

    def incoming(self, recipient_id: int) -> list[dict]:
        with self.sessions() as session:
            matches = session.execute(
                select(LibraryRecord, User.username)
                .join(PlanShare, and_(PlanShare.owner_id == LibraryRecord.owner_id, PlanShare.plan_id == LibraryRecord.id))
                .join(User, User.id == PlanShare.owner_id)
                .where(PlanShare.recipient_id == recipient_id, LibraryRecord.collection == "plans", LibraryRecord.body.is_not(None))
                .order_by(LibraryRecord.revision.desc())
            )
            return [
                {"owner_id": record.owner_id, "owner": username, "plan": resolved_plan(session, record)}
                for record, username in matches
            ]

    def copy(self, recipient_id: int, owner_id: int, plan_id: str, copy_id: str) -> str:
        if copy_id == plan_id:
            raise ValueError("A copy requires a new plan ID.")
        with self.sessions.begin() as session:
            lock_library(session, recipient_id)
            share = session.get(PlanShare, (owner_id, plan_id, recipient_id))
            if share is None:
                raise ShareNotFound("Shared plan not found.")
            original = find_plan(session, owner_id, plan_id)
            existing = session.scalar(select(LibraryRecord.revision).where(
                LibraryRecord.owner_id == recipient_id,
                LibraryRecord.collection == "plans",
                LibraryRecord.id == copy_id,
            ))
            if existing is not None:
                return copy_id

            plan = resolved_plan(session, original)
            check_capacity(session, recipient_id, "plans", 1)
            check_capacity(session, recipient_id, "drills", len({drill["id"] for drill in plan["activities"]}))
            copied = {}
            activities = []
            for drill in plan["activities"]:
                source_id = drill["id"]
                if source_id not in copied:
                    new_drill = {**drill, "id": str(uuid4())}
                    copied[source_id] = new_drill
                    session.add(LibraryRecord(
                        owner_id=recipient_id, collection="drills", id=new_drill["id"], body=json.dumps(new_drill),
                    ))
                activities.append(copied[source_id])
            plan = {**plan, "id": copy_id, "activities": activities}
            session.add(LibraryRecord(owner_id=recipient_id, collection="plans", id=copy_id, body=json.dumps(plan)))
            return copy_id
