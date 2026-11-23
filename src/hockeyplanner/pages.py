import re

from flask import Blueprint, abort, g, redirect, render_template, request, url_for

from .accounts import Accounts
from .api import session_token
from .library import Library
from .sharing import ShareNotFound, Sharing


TOKEN = r"[A-Za-z0-9_-]{43}"
UUID_PATH = r"[0-9a-fA-F-]{36}"
NEXT_PATH = re.compile(
    rf"/(?:editor(?:/{UUID_PATH}|/plan/{UUID_PATH}/{UUID_PATH})?|drills|plans|admin|account|membership"
    rf"|share/{TOKEN}(?:/present|/drill/{UUID_PATH})?)"
)


def create_pages(accounts: Accounts, library: Library, sharing: Sharing) -> Blueprint:
    pages = Blueprint("pages", __name__)

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
        count = library.drill_count(user.id) if user and user.email and user.tier != "pending" else 0
        return render_template(
            f"{page}.html", page=page, title=title, user=user, drill_count=count, **context,
        )

    def next_path():
        path = request.args.get("next", "")
        return path if NEXT_PATH.fullmatch(path) else ""

    def require_user(*, email=True, selected_plan=True):
        if g.account is None:
            return redirect(url_for("pages.login", next=request.path))
        if email and not g.account.email:
            return redirect(url_for("pages.account"))
        if selected_plan and g.account.tier == "pending":
            return redirect(url_for("pages.membership", next=next_path() or request.path))
        return None

    @pages.get("/")
    def index():
        return redirect(url_for("pages.editor" if g.account else "pages.login"))

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
            drill = library.get(g.account.id, "drills", str(drill_id)) or {**snapshot, "id": None}
        elif drill_id is not None:
            drill = library.get(g.account.id, "drills", str(drill_id))
            if drill is None:
                abort(404)
        return render("editor", "Drill Editor", drill=drill)

    @pages.get("/drills")
    def drills():
        return require_user() or render("drills", "Drill Library")

    @pages.get("/plans")
    def plans():
        return require_user() or render("plans", "Practice Plans")

    @pages.get("/account")
    def account():
        return require_user(email=False, selected_plan=False) or render("account", "Account Profile")

    @pages.get("/membership")
    def membership():
        denied = require_user(selected_plan=False)
        if denied is not None:
            return denied
        return render("membership", "Choose your plan" if g.account.tier == "pending" else "Compare plans",
                      next_path=next_path())

    @pages.get("/admin")
    def admin():
        denied = require_user()
        if denied is not None:
            return denied
        if g.account.role != "poweruser":
            return render("error", "Access denied", error="Poweruser access is required."), 403
        return render("admin", "Account Administration")

    @pages.get("/share/<token>")
    @pages.get("/share/<token>/drill/<uuid:drill_id>")
    def share(token, present=False, drill_id=None):
        if not re.fullmatch(TOKEN, token):
            abort(404)
        title = "Shared Practice Plan"
        try:
            data = sharing.preview_link(token, str(drill_id) if drill_id else None, include_plan=True)
        except ShareNotFound as error:
            return render("share", title, shared=None, error=str(error)), 404
        if data.get("standalone"):
            title = "Shared Drill"
        owner_free = data.pop("owner_free")
        free_pdf = g.account.tier == "free" if g.account else owner_free
        return render("share", title, shared={**data, "token": token, "present": present or drill_id is not None},
                      free_pdf=free_pdf,
                      guest_free=not g.account and owner_free,
                      signup_url=url_for("pages.register", next=None if data.get("standalone") else f"/share/{token}"),
                      login_url=url_for("pages.login", next=f"/share/{token}"))

    @pages.get("/share/<token>/present")
    def share_presentation(token):
        return share(token, present=True)

    @pages.errorhandler(404)
    def missing_page(_error):
        return render("error", "Page not found", error="This page is no longer available."), 404

    return pages
