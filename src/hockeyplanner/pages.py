import re
from os import getenv

from flask import Blueprint, abort, g, redirect, render_template, request, url_for

from .accounts import Accounts
from .api import session_token
from .library import FREE_LIMITS, Library
from .sharing import ShareNotFound, Sharing


TOKEN = r"[A-Za-z0-9_-]{43}"
UUID_PATH = r"[0-9a-fA-F-]{36}"
NEXT_PATH = re.compile(
    rf"/(?:editor(?:/{UUID_PATH}|/plan/{UUID_PATH}/{UUID_PATH})?|drills|plans|admin|account|membership"
    rf"|share/{TOKEN}(?:/present|/drill/{UUID_PATH})?)"
)


def create_pages(accounts: Accounts, library: Library, sharing: Sharing) -> Blueprint:
    pages = Blueprint("pages", __name__)
    tag_manager_id = getenv("HOCKEYPLANNER_GTM_CONTAINER_ID", "").strip()
    if not re.fullmatch(r"GTM-[A-Z0-9]{4,20}", tag_manager_id):
        tag_manager_id = ""
    measurement_id = getenv("HOCKEYPLANNER_GA_MEASUREMENT_ID", "").strip()
    if not re.fullmatch(r"G-[A-Z0-9]{4,20}", measurement_id):
        measurement_id = ""
    tracked_pages = {"welcome", "login", "register", "editor", "drills", "plans", "membership"}

    @pages.before_request
    def load_account():
        g.account = accounts.get_user(session_token())

    @pages.after_request
    def private_page(response):
        response.cache_control.no_store = True
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def render(page, title, **context):
        user = g.account
        context.setdefault("free_pdf", bool(user and user.tier == "free"))
        counts = library.counts(user.id) if user and user.email and user.tier != "pending" else {}
        tracked = page in tracked_pages and not request.query_string and not request.view_args
        return render_template(
            f"{page}.html", page=page, title=title, user=user, counts=counts,
            tag_manager_id=tag_manager_id if tracked else "",
            analytics_id=measurement_id if tracked and not tag_manager_id else "",
            **context,
        )

    def next_path():
        path = request.args.get("next", "")
        return path if NEXT_PATH.fullmatch(path) else ""

    def require_user(*, email=True, selected_plan=True):
        if g.account is None:
            abort(401)
        if email and not g.account.email:
            return redirect(url_for("pages.account"))
        if selected_plan and g.account.tier == "pending":
            return redirect(url_for("pages.membership", next=next_path() or request.path))
        return None

    @pages.get("/")
    def index():
        if g.account:
            return redirect(url_for("pages.editor"))
        return render("welcome", "Plan your next practice")

    @pages.get("/login")
    def login():
        return render("login", "Sign in", next_path=next_path())

    @pages.get("/register")
    def register():
        return render("register", "Create an account", next_path=next_path())

    @pages.get("/forgot-password")
    def forgot_password():
        return render("forgot_password", "Forgot your password?", next_path=next_path())

    @pages.get("/confirm-email/<token>")
    def confirm_email(token):
        if not re.fullmatch(TOKEN, token):
            abort(404)
        return render("confirm_email", "Confirm your email", token=token)

    @pages.get("/reset-password/<token>")
    def reset_password(token):
        if not re.fullmatch(TOKEN, token):
            abort(404)
        return render("reset_password", "Reset your password", token=token)

    @pages.get("/editor")
    @pages.get("/editor/<uuid:drill_id>")
    @pages.get("/editor/plan/<uuid:plan_id>/<uuid:drill_id>")
    def editor(drill_id=None, plan_id=None):
        denied = require_user()
        if denied is not None:
            return denied
        drill = None
        if plan_id is not None:
            plan = library.get(g.account.id, "plans", str(plan_id))
            snapshot = next((drill for drill in plan["activities"] if drill["id"] == str(drill_id)), None) if plan else None
            if snapshot is None:
                abort(404)
            if snapshot.get("platformSource"):
                abort(403)
            drill = library.get(g.account.id, "drills", str(drill_id)) or {**snapshot, "id": None}
        elif drill_id is not None:
            drill = library.get(g.account.id, "drills", str(drill_id))
            if drill is None:
                abort(404)
        published = bool(
            g.account.role == "poweruser" and drill and drill.get("id")
            and library.is_platform_drill(g.account.id, drill["id"])
        )
        return render("editor", "Drill Editor", drill=drill, published=published)

    @pages.get("/drills")
    def drills():
        return require_user() or render("drills", "Drill Library")

    @pages.get("/plans")
    def plans():
        return require_user() or render("plans", "Practice Plans")

    @pages.get("/account")
    def account():
        return require_user(email=False, selected_plan=False) or render(
            "account", "Account Profile", free_limits=FREE_LIMITS,
        )

    @pages.get("/membership")
    def membership():
        denied = require_user(selected_plan=False)
        if denied is not None:
            return denied
        return render("membership", "Choose your plan" if g.account.tier == "pending" else "Compare plans",
                      next_path=next_path(), free_limits=FREE_LIMITS)

    @pages.get("/admin")
    def admin():
        denied = require_user()
        if denied is not None:
            return denied
        if g.account.role != "poweruser":
            return render("error", "Access denied", error="Poweruser access is required.", status_code=403), 403
        return render("admin", "Account Administration")

    @pages.get("/share/<token>")
    @pages.get("/share/<token>/drill/<uuid:drill_id>")
    def share(token, drill_id=None):
        if not re.fullmatch(TOKEN, token):
            abort(404)
        title = "Shared Practice Plan"
        try:
            data = sharing.preview_link(token, str(drill_id) if drill_id else None, include_plan=True)
        except ShareNotFound as error:
            abort(404, str(error))
        if data.get("standalone"):
            title = "Shared Drill"
        owner_free = data.pop("owner_free")
        free_pdf = g.account.tier == "free" if g.account else owner_free
        return render("share", title, shared={**data, "token": token},
                      free_pdf=free_pdf,
                      print_drill=drill_id is not None,
                      guest_free=not g.account and owner_free,
                      signup_url=url_for("pages.register", next=None if data.get("standalone") else f"/share/{token}"),
                      login_url=url_for("pages.login", next=f"/share/{token}"))

    @pages.get("/share/<token>/present")
    def share_presentation(token):
        return share(token)

    return pages
