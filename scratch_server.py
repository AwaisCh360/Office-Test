"""Local HTTP server that serves the viewer SPA and a run's data from disk.

Design notes:
- Uses only the standard library (no new runtime dependency). The workload is
  serving static files plus a handful of JSON reads off disk, so an async stack
  buys nothing here.
- The browser polls the JSON endpoints (~1s) rather than using SSE: a finished
  run stops polling, and short-lived polls survive sleep/network blips without
  server-side connection state, which suits a stdlib ThreadingHTTPServer.
- All reads happen per-request straight from disk, so the same server serves a
  live in-progress run and a finished one identically; the SPA distinguishes
  them via the ``finished`` flag on /api/run.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import secrets
import threading
import uuid
import webbrowser
import bcrypt
import jwt
import time
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from strix.core.paths import run_record_path
from strix.interface.viewer import auth
from strix.interface.viewer.db import init_db, get_db, User
from strix.interface.viewer.transcript import (
    build_run_state,
    primary_target,
    read_report_markdown,
    read_run_summary,
    read_vulnerabilities,
    severity_counts,
)


if TYPE_CHECKING:
    from collections.abc import Callable


logger = logging.getLogger(__name__)

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "admin")
JWT_SECRET = os.environ.get("JWT_SECRET", "super-secret-strix-key-12345")
valid_sessions = {} # map token to email (deprecated in favor of JWT but kept for backward compatibility if needed)
rate_limits = {} # map IP to (count, last_reset_time)


def bundle_dir() -> Path:
    """Directory holding the committed, prebuilt SPA (index.html + assets)."""
    return Path(__file__).resolve().parent / "static"


def bundle_is_built() -> bool:
    return (bundle_dir() / "index.html").is_file()


def _iter_run_dirs(base_dir: Path) -> list[Path]:
    """Every run directory under ``base_dir``, newest first by record mtime."""
    if not base_dir.is_dir():
        return []
    run_dirs = [child for child in base_dir.iterdir() if run_record_path(child).is_file()]
    run_dirs.sort(key=lambda child: run_record_path(child).stat().st_mtime, reverse=True)
    return run_dirs


def run_list_entry(run_dir: Path) -> dict[str, Any]:
    """Compact summary of a single run for the history list."""
    record = read_run_summary(run_dir)
    return {
        "name": record.get("run_name") or run_dir.name,
        "target": primary_target(record),
        "scan_mode": record.get("scan_mode"),
        "status": record.get("status"),
        "start_time": record.get("start_time"),
        "end_time": record.get("end_time"),
        "finished": bool(record.get("finished")),
        "severity_counts": severity_counts(read_vulnerabilities(run_dir)),
    }


def build_runs_payload(base_dir: Path, *, verified: bool, company: str | None = None) -> dict[str, Any]:
    """The /api/runs payload. Gates the run list behind email verification.

    The count is always advertised so the UI can tease the history, but the
    entries only appear once the viewer is verified.
    """
    if not verified:
        return {"locked": True, "count": 0, "runs": []}
        
    from strix.interface.viewer.db import get_db, Run
    db = get_db()
    
    if company:
        db_runs = db.query(Run).filter(Run.company == company).all()
    else:
        db_runs = db.query(Run).all()
        
    run_names = {r.run_name for r in db_runs}
    
    # Filter physical directories by what exists in DB
    run_dirs = _iter_run_dirs(base_dir)
    filtered = [d for d in run_dirs if d.name in run_names]

    count = len(filtered)
    return {"locked": False, "count": count, "runs": [run_list_entry(d) for d in filtered]}


def resolve_run_dir(base_dir: Path, run_param: str | None, default_run_dir: Path) -> Path | None:
    """Resolve a ``?run=`` value to a real run directory under ``base_dir``.

    Returns ``default_run_dir`` when no run is requested. Rejects traversal and
    unknown runs (returns None) so the caller can answer 404.
    """
    if not run_param:
        return default_run_dir
    base = base_dir.resolve()
    candidate = (base / run_param).resolve()
    # Only direct children of the runs base that actually hold a run record.
    if candidate.parent != base or not run_record_path(candidate).is_file():
        return None
    return candidate


# Prefix of the cookie carrying the per-process session capability. The bound
# port is appended (``strix_viewer_session_<port>``) because browsers scope
# cookies by host only, never by port: concurrent viewers on 127.0.0.1 would
# otherwise share one cookie slot and clobber each other's session.
SESSION_COOKIE_PREFIX = "strix_viewer_session"


class _ViewerState:
    def __init__(
        self,
        run_dir: Path,
        assets_dir: Path,
        steer_handler: Callable[[str, str], bool] | None = None,
    ) -> None:
        self.run_dir = run_dir
        self.assets_dir = assets_dir
        # The strix_runs directory that holds the launched run; used to
        # enumerate and resolve other runs for the history list.
        self.base_dir = run_dir.parent
        # Set only when the viewer runs inside a live scan process (the TUI
        # launcher), which can deliver a message to a running agent. Absent for
        # standalone ``strix view`` / finished runs, so steering is unavailable.
        self.steer_handler = steer_handler
        # Unguessable per-process capability. It is minted here, printed/opened
        # for the operator who started the server (see ``authorized_url``), and
        # exchanged for a session cookie only when presented on the initial page
        # load. It is the request-level authorization the review asked for:
        # reachability of the port (e.g. when bound with ``--host``) is not
        # enough to steer a live scan, trigger a report, or browse history --
        # the token is never handed to a caller who merely reaches ``/``.
        self.session_token = secrets.token_urlsafe(32)
        # Finalized in ``serve()`` once the port is known (the server binds
        # after this state is constructed); see SESSION_COOKIE_PREFIX.
        self.cookie_name = SESSION_COOKIE_PREFIX


def _make_handler(state: _ViewerState) -> type[BaseHTTPRequestHandler]:
    class ViewerHandler(BaseHTTPRequestHandler):
        server_version = "StrixViewer/1.0"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            logger.debug("viewer %s - %s", self.address_string(), format % args)

        def do_GET(self) -> None:
            parts = urlsplit(self.path)
            path = parts.path
            try:
                if path.startswith("/api/"):
                    if path not in ("/api/session",):
                        if not self._get_caller_email():
                            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                            return
                    self._handle_api(path, parse_qs(parts.query))
                else:
                    self._handle_static(path, parse_qs(parts.query))
            except BrokenPipeError:
                # The browser closed the connection mid-response (e.g. it
                # navigated away between polls). Not an error.
                logger.debug("viewer client disconnected during %s", path)
            except Exception:
                # A bad request must never kill the worker thread.
                logger.exception("viewer request failed: %s", path)
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"})

        def do_POST(self) -> None:
            path = urlsplit(self.path).path
            try:
                if path == "/api/login":
                    self._handle_login()
                    return
                if path == "/api/signup":
                    self._handle_signup()
                    return
                if path == "/api/event":
                    self._handle_event()
                    return

                if not self._get_caller_email():
                    self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                
                if path == "/api/logout":
                    self._handle_logout()
                    return

                if path == "/api/auth/otp/start":
                    self._handle_otp_start()
                elif path == "/api/auth/otp/verify":
                    self._handle_otp_verify()
                elif path == "/api/auth/forget":
                    self._handle_forget()
                elif path == "/api/report/send":
                    self._handle_report_send()
                elif path == "/api/feedback":
                    self._handle_feedback()
                elif path == "/api/agents/steer":
                    self._handle_steer()
                elif path == "/api/admin/users":
                    self._handle_admin_users("DELETE")
                elif path == "/api/admin/users/add":
                    self._handle_admin_users("ADD")
                elif path == "/api/admin/users/edit":
                    self._handle_admin_users("EDIT")
                elif path == "/api/run/start":
                    self._handle_run_start()
                elif path == "/api/run/delete":
                    self._handle_run_delete()
                elif path == "/api/profile":
                    self._handle_update_profile()
                else:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})
            except BrokenPipeError:
                logger.debug("viewer client disconnected during POST %s", path)
            except Exception:
                # A bad request must never kill the worker thread.
                logger.exception("viewer request failed: POST %s", path)
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal error"})

        def _read_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return {}
            return body if isinstance(body, dict) else {}

        # Funnel events the viewer is allowed to forward. This handler is the
        # trust boundary: only these event names, with only their known props,
        # ever reach PostHog. Everything else (including any PII) is dropped.
        _EMAIL_EVENTS = frozenset(
            {"email_submitted", "email_verified", "report_sent", "work_email_required"}
        )

        def _handle_event(self) -> None:
            body = self._read_body()
            # Forwarded as anonymous PostHog events that respect the global
            # telemetry opt-out. Never forward the email, code, or report body:
            # only the whitelisted event names and their known props are passed.
            event = body.get("event")
            if event == "cta_clicked":
                from strix.telemetry import posthog

                cta = str(body.get("cta") or "unknown")
                surface = body.get("surface")
                posthog.viewer_cta_clicked(cta, surface=str(surface) if surface else None)
            elif event in self._EMAIL_EVENTS:
                from strix.telemetry import posthog

                purpose = body.get("purpose")
                posthog.viewer_email_event(str(event), purpose=str(purpose) if purpose else None)
            elif event == "agent_steered":
                from strix.telemetry import posthog

                posthog.viewer_agent_steered()
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()

        def _handle_api(self, path: str, query: dict[str, list[str]]) -> None:
            # The launched run is always viewable with no verification. The
            # cross-run history list (/api/runs) unlocks its entries only for a
            # caller that holds this process's session capability *and* is email
            # verified, so merely reaching an exposed --host port never leaks the
            # run list (the payload still advertises the count as a teaser).
            if path == "/api/session":
                if self._get_caller_email():
                    self._send_json(HTTPStatus.OK, {"ok": True})
                else:
                    self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return

            if path == "/api/runs":
                caller_email = self._get_caller_email()
                company = None
                if caller_email:
                    from strix.interface.viewer.db import get_db, User
                    db = get_db()
                    user = db.query(User).filter(User.email == caller_email).first()
                    if user:
                        company = user.company
                        
                unlocked = True
                payload = build_runs_payload(state.base_dir, verified=unlocked, company=company)
                self._send_json(HTTPStatus.OK, payload)
                return
            if path == "/api/admin/users":
                self._handle_admin_users("GET")
                return
            if path == "/api/profile":
                self._handle_get_profile()
                return
            if path == "/api/capabilities":
                # Steering is only possible when the viewer shares a live scan's
                # coordinator + event loop (the TUI launcher wires a handler).
                self._send_json(HTTPStatus.OK, {"can_steer": state.steer_handler is not None})
                return
            if path == "/api/auth/status":
                self._handle_auth_status()
                return

            run_values = query.get("run")
            run_param = run_values[0] if run_values else None
            run_dir = resolve_run_dir(state.base_dir, run_param, state.run_dir)
            if run_dir is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "unknown run"})
                return

            # The launched run is always viewable. Any *other* run's data is part
            # of the gated history: it needs this process's session capability
            # (so merely reaching an exposed --host port is not enough) *and*
            # email verification -- otherwise knowing a run name would leak its
            # metadata, vulnerabilities, report, and transcript.
            if run_dir.resolve() != state.run_dir.resolve():
                caller_email = self._get_caller_email()
                if not caller_email:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                    return
                
                from strix.interface.viewer.db import get_db, User, Run
                db = get_db()
                user = db.query(User).filter(User.email == caller_email).first()
                if not user:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                    return
                
                db_run = db.query(Run).filter(Run.run_name == run_dir.name).first()
                if db_run and db_run.company != user.company:
                    self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                    return
            if path == "/api/run":
                self._send_json(HTTPStatus.OK, read_run_summary(run_dir))
            elif path == "/api/vulnerabilities":
                self._send_json(HTTPStatus.OK, read_vulnerabilities(run_dir))
            elif path == "/api/report":
                self._send_json(HTTPStatus.OK, {"markdown": read_report_markdown(run_dir)})
            elif path == "/api/transcript":
                self._send_json(HTTPStatus.OK, build_run_state(run_dir))
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "unknown endpoint"})

        def _handle_auth_status(self) -> None:
            email = self._get_caller_email()
            is_admin = False
            
            if email:
                db = get_db()
                user = db.query(User).filter(User.email == email).first()
                if user:
                    is_admin = user.is_admin

            self._send_json(
                HTTPStatus.OK,
                {
                    "verified": bool(email),
                    "email": email or None,
                    "is_admin": is_admin
                },
            )

        def _handle_admin_users(self, method: str) -> None:
            caller_email = self._get_caller_email()
            if not caller_email:
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
                
            db = get_db()
            caller = db.query(User).filter(User.email == caller_email).first()
            if not caller:
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
                
            if method == "GET":
                out = []
                for u in db.query(User).filter(User.company == caller.company).all():
                    out.append({
                        "email": u.email,
                        "first_name": u.first_name,
                        "last_name": u.last_name,
                        "company": u.company,
                        "job_title": u.job_title,
                        "phone": u.phone,
                        "timezone": u.timezone,
                        "is_admin": u.is_admin
                    })
                self._send_json(HTTPStatus.OK, {"users": out})
                return

            if method == "DELETE":
                body = self._read_body()
                target_email = str(body.get("email") or "").strip()
                if not target_email:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_user"})
                    return
                
                target_user = db.query(User).filter(User.email == target_email).first()
                if not target_user or target_user.company != caller.company:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_user"})
                    return
                    
                if target_email == caller_email:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"unsupported method {method}"})
                    return
                
                db.delete(target_user)
                db.commit()
                
                # Revoke any active sessions for this user (if using dict for backwards compat)
                tokens_to_delete = [t for t, e in valid_sessions.items() if e == target_email]
                for t in tokens_to_delete:
                    del valid_sessions[t]
                    
                self._send_json(HTTPStatus.OK, {"ok": True})
            elif method == "ADD":
                body = self._read_body()
                new_email = str(body.get("email") or "").strip()
                password = str(body.get("password") or "").strip()
                first_name = str(body.get("first_name") or "").strip()
                last_name = str(body.get("last_name") or "").strip()
                # Force company to match caller's company for SaaS isolation
                company = caller.company
                new_is_admin = bool(body.get("is_admin", False))
                
                if not new_email or not password or not first_name or not last_name:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing_fields"})
                    return
                    
                if not re.match(r"[^@]+@[^@]+\.[^@]+", new_email):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid email format"})
                    return
                    
                if len(password) < 8:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "password must be at least 8 characters"})
                    return
                    
                if db.query(User).filter(User.email == new_email).first():
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "user_exists"})
                    return
                
                new_user = User(
                    email=new_email,
                    password_hash=self._hash_password(password),
                    first_name=first_name,
                    last_name=last_name,
                    company=company,
                    is_admin=new_is_admin
                )
                db.add(new_user)
                db.commit()
                self._send_json(HTTPStatus.OK, {"ok": True})
            elif method == "EDIT":
                body = self._read_body()
                target_email = str(body.get("email") or "").strip()
                
                if not target_email:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_user"})
                    return
                    
                target_user = db.query(User).filter(User.email == target_email).first()
                if not target_user or target_user.company != caller.company:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_user"})
                    return
                    
                if target_email == caller_email:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "cannot_edit_self"})
                    return
                
                if "is_admin" in body:
                    target_user.is_admin = bool(body["is_admin"])
                
                db.commit()
                self._send_json(HTTPStatus.OK, {"ok": True})

        def _rate_limit(self, key: str) -> bool:
            now = time.time()
            count, last_reset = rate_limits.get(key, (0, now))
            if now - last_reset > 60:
                count = 0
                last_reset = now
            if count >= 5:
                return False
            rate_limits[key] = (count + 1, last_reset)
            return True

        def _generate_jwt(self, email: str) -> str:
            payload = {
                "email": email,
                "exp": time.time() + 7200  # 2 hours
            }
            return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

        def _get_caller_email(self) -> str:
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "")
            if not token:
                return ""
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
                return payload.get("email", "")
            except jwt.ExpiredSignatureError:
                return ""
            except jwt.InvalidTokenError:
                return valid_sessions.get(token, "")

        def _hash_password(self, password: str) -> str:
            return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

        def _check_password(self, password: str, stored_hash: str) -> bool:
            if not stored_hash:
                return False
            # Fallback for old SHA256 hashes (length 64 hex)
            if len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash.lower()):
                import hashlib
                computed = hashlib.sha256(password.encode()).hexdigest()
                return computed == stored_hash
            try:
                return bcrypt.checkpw(password.encode(), stored_hash.encode())
            except Exception:
                return False

        def _handle_get_profile(self) -> None:
            caller_email = self._get_caller_email()
            
            db = get_db()
            user = db.query(User).filter(User.email == caller_email).first()
            if not user:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "user not found"})
                return
                
            self._send_json(HTTPStatus.OK, {
                "profile": {
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "company": user.company,
                    "job_title": user.job_title,
                    "phone": user.phone,
                    "timezone": user.timezone,
                    "is_admin": user.is_admin
                }
            })

        def _handle_update_profile(self) -> None:
            caller_email = self._get_caller_email()
            
            if not caller_email:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            
            db = get_db()
            user = db.query(User).filter(User.email == caller_email).first()
            if not user:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "user not found"})
                return
                
            body = self._read_body()
            profile_data = body.get("profile", {})
            
            if "first_name" in profile_data:
                user.first_name = str(profile_data["first_name"]).strip()
            if "last_name" in profile_data:
                user.last_name = str(profile_data["last_name"]).strip()
            if "company" in profile_data:
                user.company = str(profile_data["company"]).strip()
            if "job_title" in profile_data:
                user.job_title = str(profile_data["job_title"]).strip()
            if "phone" in profile_data:
                user.phone = str(profile_data["phone"]).strip()
            if "timezone" in profile_data:
                user.timezone = str(profile_data["timezone"]).strip()
                
            password = profile_data.get("password")
            if password:
                old_password = profile_data.get("old_password")
                if not old_password:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "old_password_required"})
                    return
                
                if not self._check_password(old_password, user.password_hash):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_old_password"})
                    return
                    
                if len(password) < 8:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "password must be at least 8 characters"})
                    return
                    
                user.password_hash = self._hash_password(password)
                
            db.commit()
            self._send_json(HTTPStatus.OK, {"ok": True})

        def _handle_login(self) -> None:
            client_ip = self.client_address[0]
            if not self._rate_limit(client_ip):
                self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "rate limit exceeded"})
                return
                
            body = self._read_body()
            email = str(body.get("email") or "").strip()
            password = str(body.get("password") or "").strip()
            
            db = get_db()
            user = db.query(User).filter(User.email == email).first()
            if user:
                if self._check_password(password, user.password_hash):
                    # Upgrade hash to bcrypt if it's still SHA256
                    if len(user.password_hash) == 64:
                        user.password_hash = self._hash_password(password)
                        db.commit()
                        
                    token = self._generate_jwt(email)
                    self._send_json(HTTPStatus.OK, {"token": token, "email": email})
                    return
            
            self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_credentials"})

        def _handle_signup(self) -> None:
            client_ip = self.client_address[0]
            if not self._rate_limit(f"signup_{client_ip}"):
                self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "rate limit exceeded"})
                return
                
            body = self._read_body()
            email = str(body.get("email") or "").strip()
            password = str(body.get("password") or "").strip()
            first_name = str(body.get("first_name") or "").strip()
            last_name = str(body.get("last_name") or "").strip()
            company = str(body.get("company") or "").strip()
            
            if not email or not password or not first_name or not last_name:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing_fields"})
                return
                
            if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid email format"})
                return
                
            if len(password) < 8:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "password must be at least 8 characters"})
                return
            
            db = get_db()
            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "user_exists"})
                return
            
            is_first_user = db.query(User).count() == 0
            new_user = User(
                email=email,
                password_hash=self._hash_password(password),
                first_name=first_name,
                last_name=last_name,
                company=company,
                is_admin=is_first_user
            )
            db.add(new_user)
            db.commit()
            
            token = self._generate_jwt(email)
            self._send_json(HTTPStatus.OK, {"token": token, "email": email})

        def _handle_logout(self) -> None:
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "")
            if token in valid_sessions:
                del valid_sessions[token]
            self._send_json(HTTPStatus.OK, {"ok": True})

        def _handle_run_delete(self) -> None:
            body = self._read_body()
            run_name = body.get("run")
            if not run_name:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing run name"})
                return
            
            run_dir = state.base_dir / run_name
            if not run_dir.is_dir() or not (run_dir / "run.json").exists():
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "run not found"})
                return
                
            import shutil
            try:
                shutil.rmtree(run_dir)
                
                from strix.interface.viewer.db import get_db, Run
                db = get_db()
                db_run = db.query(Run).filter(Run.run_name == run_name).first()
                if db_run:
                    db.delete(db_run)
                    db.commit()
                    
                self._send_json(HTTPStatus.OK, {"ok": True})
            except Exception as e:
                logger.error(f"failed to delete run {run_name}: {e}")
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})

        def _handle_otp_start(self) -> None:
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            email = str(self._read_body().get("email") or "").strip()
            if not email:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_email"})
                return
            try:
                auth.otp_start(email)
            except auth.RelayError as exc:
                self._send_relay_error(exc)
                return
            self._send_json(HTTPStatus.OK, {"ok": True})

        def _handle_otp_verify(self) -> None:
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            body = self._read_body()
            email = str(body.get("email") or "").strip()
            code = str(body.get("code") or "").strip()
            if not email or not code:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_code"})
                return
            try:
                result = auth.otp_verify(email, code)
            except auth.RelayError as exc:
                self._send_relay_error(exc)
                return
            auth.write_auth(
                email=result.get("email") or email,
                token=result["token"],
                verified_at=result.get("expires_at") or "",
            )
            verified_email = result.get("email") or email
            self._send_json(HTTPStatus.OK, {"verified": True, "email": verified_email})

        def _handle_forget(self) -> None:
            # Clearing the cached verification is a state change, so it requires
            # this process's session capability: a cookie-less caller on an
            # exposed --host port must not be able to log the operator out.
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            auth.forget()
            self._send_json(HTTPStatus.OK, {"ok": True})

        def _handle_report_send(self) -> None:
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            
            # Since users are logged in via the new auth system with their email,
            # they are already verified.
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "")
            email = valid_sessions.get(token)

            if not email:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "unverified"})
                return

            run_param = self._read_body().get("run")
            run_dir = resolve_run_dir(state.base_dir, run_param, state.run_dir)
            if run_dir is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "unknown run"})
                return

            summary = read_run_summary(run_dir)
            # Emailing only makes sense for a completed run; a live scan would
            # send a partial report. The UI hides the entry point, but fail
            # closed here too so the endpoint can't be driven mid-scan.
            if not summary.get("finished", False):
                self._send_json(HTTPStatus.CONFLICT, {"error": "run_not_finished"})
                return

            from strix.interface.viewer.report_pdf import build_encrypted_report
            import base64

            pdf_bytes, password, filename = build_encrypted_report(run_dir)
            pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
            
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "password": password, "filename": filename, "pdf_b64": pdf_b64},
            )

        # Cap on a feedback message so a runaway client cannot flood the relay.
        _FEEDBACK_MESSAGE_MAX = 5000

        def _handle_feedback(self) -> None:
            # Requires this process's session capability, like the other POSTs,
            # so an exposed --host port can't be used to spam the relay.
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            body = self._read_body()
            email = str(body.get("email") or "").strip()
            message = str(body.get("message") or "").strip()
            if not email:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_email"})
                return
            if not message:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_message"})
                return
            message = message[: self._FEEDBACK_MESSAGE_MAX]
            try:
                auth.feedback_submit(email, message)
            except auth.RelayError as exc:
                self._send_relay_error(exc)
                return
            # Server-authoritative: fire only after a successful relay (respects
            # the telemetry opt-out; no message/email content is sent).
            from strix.telemetry import posthog

            posthog.viewer_feedback_submitted()
            self._send_json(HTTPStatus.OK, {"ok": True})

        # Cap on a steering message so a runaway client cannot flood the agent.
        _STEER_MESSAGE_MAX = 4000

        def _handle_steer(self) -> None:
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            body = self._read_body()
            agent_id = str(body.get("agent_id") or "").strip()
            message = str(body.get("message") or "").strip()
            if not agent_id or not message:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_input"})
                return
            message = message[: self._STEER_MESSAGE_MAX]
            logger.info("Viewer steering %r: %r", agent_id, message)
            if state.steer_handler is None:
                # Standalone / finished-run viewing has no live scan to steer.
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "steering_unavailable"})
                return
            delivered = state.steer_handler(agent_id, message)
            if delivered:
                self._send_json(HTTPStatus.OK, {"ok": True})
            else:
                self._send_json(HTTPStatus.OK, {"ok": False, "error": "not_delivered"})

        def _handle_run_start(self) -> None:
            if not self._has_session():
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            body = self._read_body()
            
            caller_email = self._get_caller_email()
            company = None
            if caller_email:
                from strix.interface.viewer.db import get_db, User, Run
                db = get_db()
                user = db.query(User).filter(User.email == caller_email).first()
                if user:
                    company = user.company
            
            targets = body.get("targets") or []
            if isinstance(targets, str):
                targets = [targets]
            
            target_list_file = body.get("target_list_file")
            if not targets and not target_list_file:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing targets"})
                return
            
            instruction = str(body.get("instructions") or "").strip()
            instruction_file = body.get("instruction_file")
            workspace_files = body.get("workspace_files") or []
            
            scan_mode = str(body.get("scan_mode") or "deep").strip()
            scope_mode = str(body.get("scope_mode") or "auto").strip()
            diff_base = str(body.get("diff_base") or "").strip()
            
            max_budget = body.get("max_budget")
            max_turns = body.get("max_turns")
            config_file = body.get("config_file")

            import secrets
            import subprocess
            import sys
            import tempfile
            import base64
            from pathlib import Path
            
            # Determine slug from first target or target list file
            slug = "scan"
            if targets:
                slug = str(targets[0]).replace("https://", "").replace("http://", "").split("/")[0][:20]
            elif target_list_file:
                slug = target_list_file.get("name", "targets").split(".")[0][:20]
            slug = "".join(c if c.isalnum() else "_" for c in slug).strip("_") or "scan"
            run_name = f"{slug}_{secrets.token_hex(2)}"
            
            # We must keep the temp directory alive during the scan, but the strix process is detached.
            # We'll create it under state.base_dir (e.g. strix_runs/.tmp_viewer_uploads) 
            # so the user can see it if needed, or strix can read from it.
            tmp_root = state.base_dir / ".tmp_viewer_uploads" / run_name
            tmp_root.mkdir(parents=True, exist_ok=True)
            
            run_dir = state.base_dir / run_name
            run_dir.mkdir(parents=True, exist_ok=True)
            
            if caller_email:
                try:
                    new_run = Run(run_name=run_name, owner_email=caller_email, company=company)
                    db.add(new_run)
                    db.commit()
                except Exception as e:
                    logger.error("Failed to add run to DB: %s", e)
                    db.rollback()

            
            cmd = [sys.executable, "-m", "strix", "--scan-mode", scan_mode, "--scope-mode", scope_mode, "--run-name", run_name, "--non-interactive"]
            if diff_base:
                cmd.extend(["--diff-base", diff_base])
            
            for t in targets:
                cmd.extend(["--target", str(t)])
                
            if target_list_file and isinstance(target_list_file, dict):
                try:
                    name = target_list_file.get("name", "targets.txt")
                    b64 = target_list_file.get("content_b64", "")
                    path = tmp_root / name
                    path.write_bytes(base64.b64decode(b64))
                    cmd.extend(["--target-list", str(path)])
                except Exception as e:
                    logger.error("Failed to decode target list file: %s", e)
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid target_list_file"})
                    return
            
            if instruction:
                cmd.extend(["--instruction", instruction])
                
            if instruction_file and isinstance(instruction_file, dict):
                try:
                    name = instruction_file.get("name", "instructions.txt")
                    b64 = instruction_file.get("content_b64", "")
                    path = tmp_root / name
                    path.write_bytes(base64.b64decode(b64))
                    cmd.extend(["--instruction-file", str(path)])
                except Exception as e:
                    logger.error("Failed to decode instruction file: %s", e)
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid instruction_file"})
                    return
                    
            if config_file and isinstance(config_file, dict):
                try:
                    name = config_file.get("name", "config.json")
                    b64 = config_file.get("content_b64", "")
                    path = tmp_root / name
                    path.write_bytes(base64.b64decode(b64))
                    cmd.extend(["--config", str(path)])
                except Exception as e:
                    logger.error("Failed to decode config file: %s", e)
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid config_file"})
                    return
                    
            if max_budget is not None:
                cmd.extend(["--max-budget", str(max_budget)])
                
            if max_turns is not None:
                cmd.extend(["--max-turns", str(max_turns)])
            
            for wf in workspace_files:
                if isinstance(wf, dict):
                    try:
                        name = wf.get("name", "file")
                        b64 = wf.get("content_b64", "")
                        path = tmp_root / name
                        path.write_bytes(base64.b64decode(b64))
                        cmd.extend(["--workspace-file", f"{path}:{name}"])
                    except Exception as e:
                        logger.error("Failed to decode workspace file: %s", e)
                        self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid workspace_files"})
                        return
                
            logger.info("Viewer starting new scan: %r", cmd)
            # Spawn the background scan without blocking the web server
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            self._send_json(HTTPStatus.OK, {"ok": True, "run_name": run_name})

        def _send_relay_error(self, exc: auth.RelayError) -> None:
            status_by_code = {
                "rate_limited": HTTPStatus.TOO_MANY_REQUESTS,
                "invalid_email": HTTPStatus.BAD_REQUEST,
                "invalid_message": HTTPStatus.BAD_REQUEST,
                "work_email_required": HTTPStatus.BAD_REQUEST,
                "invalid_code": HTTPStatus.FORBIDDEN,
                "reverify": HTTPStatus.UNAUTHORIZED,
                "forbidden": HTTPStatus.FORBIDDEN,
                "too_large": HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "unavailable": HTTPStatus.BAD_GATEWAY,
            }
            status = status_by_code.get(exc.code, HTTPStatus.BAD_GATEWAY)
            self._send_json(status, {"error": exc.code})

        def _cookies(self) -> dict[str, str]:
            jar: dict[str, str] = {}
            for chunk in (self.headers.get("Cookie") or "").split(";"):
                name, sep, value = chunk.strip().partition("=")
                if sep:
                    jar[name] = value
            return jar

        def _has_session(self) -> bool:
            auth_header = self.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "")
            return token in valid_sessions

        def _token_presented(self, query: dict[str, list[str]]) -> bool:
            """True when the request carries the correct bootstrap token.

            The token reaches the operator's browser through the URL printed /
            opened by the process that started the server, a channel an
            arbitrary network caller on an exposed port cannot observe.
            """
            supplied = (query.get("token") or [""])[0]
            return bool(supplied) and secrets.compare_digest(supplied, state.session_token)

        def _handle_static(self, path: str, query: dict[str, list[str]]) -> None:
            target = self._resolve_asset(path)
            if target is None:
                # SPA fallback: unknown non-asset routes render index.html so
                # client-side deep links work.
                target = state.assets_dir / "index.html"
            is_index = target.name == "index.html"
            if not target.is_file():
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            content = target.read_bytes()
            content_type, _ = mimetypes.guess_type(str(target))
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            if is_index and self._token_presented(query):
                # Exchange the bootstrap token for the per-process session
                # capability. Issued only when the correct token is presented,
                # so a caller who merely reaches ``/`` never obtains it.
                # HttpOnly (JS never needs it; fetch sends it automatically) and
                # SameSite=Strict (never sent from a cross-site context).
                self.send_header(
                    "Set-Cookie",
                    f"{state.cookie_name}={state.session_token}; Path=/; HttpOnly; SameSite=Strict",
                )
            self.end_headers()
            self.wfile.write(content)

        def _resolve_asset(self, path: str) -> Path | None:
            rel = unquote(path).lstrip("/")
            if not rel or rel.endswith("/"):
                return None
            root = state.assets_dir.resolve()
            candidate = (root / rel).resolve()
            # Path-traversal guard: never serve outside the bundle root.
            if root != candidate and root not in candidate.parents:
                logger.warning("viewer rejected traversal attempt: %s", path)
                return None
            return candidate if candidate.is_file() else None

        def _send_json(self, status: HTTPStatus, payload: Any) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return ViewerHandler


def authorized_url(base_url: str, token: str) -> str:
    """URL that bootstraps the viewer session for the operator.

    Presenting ``token`` on the initial page load is what mints the session
    cookie, so this URL is printed / opened only for the operator who started
    the server. Sharing it (rather than the bare ``base_url``) is what lets a
    trusted remote user authorize when the viewer is exposed with ``--host``.
    """
    return f"{base_url}/?{urlencode({'token': token})}"


def serve(
    run_dir: Path,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
    open_browser: bool = True,
    steer_handler: Callable[[str, str], bool] | None = None,
) -> tuple[ThreadingHTTPServer, str, str]:
    """Start the viewer server on a background thread; return (server, url, token).

    ``url`` is the bare base; pass it through ``authorized_url(url, token)`` to
    build the operator link that authorizes the browser.

    Binds an ephemeral port by default. If a fixed ``port`` is requested but in
    use, falls back to an ephemeral port. Reused by both the ``strix view``
    command and the in-TUI launcher; callers own the server's lifetime.

    ``steer_handler`` is supplied only by the in-TUI launcher, which runs inside
    the live scan process and can forward a message to a running agent. Left
    ``None`` (standalone ``strix view``), steering is reported unavailable.
    """
    assets_dir = bundle_dir()
    state = _ViewerState(run_dir=run_dir, assets_dir=assets_dir, steer_handler=steer_handler)
    
    # Initialize DB and migrate legacy data
    if init_db():
        db = get_db()
        if db.query(User).count() == 0:
            legacy_path = state.base_dir / "users.json"
            if legacy_path.exists():
                try:
                    with open(legacy_path, "r") as f:
                        legacy_users = json.load(f)
                    for email, user_data in legacy_users.items():
                        if isinstance(user_data, dict):
                            new_user = User(
                                email=email,
                                password_hash=user_data.get("password", ""),
                                first_name=user_data.get("first_name", ""),
                                last_name=user_data.get("last_name", ""),
                                company=user_data.get("company", ""),
                                job_title=user_data.get("job_title", ""),
                                phone=user_data.get("phone", ""),
                                timezone=user_data.get("timezone", ""),
                                is_admin=user_data.get("is_admin", False)
                            )
                        else:
                            new_user = User(
                                email=email,
                                password_hash=user_data,
                                is_admin=False
                            )
                        db.add(new_user)
                    db.commit()
                    logger.info("Migrated users.json to PostgreSQL database.")
                except Exception as e:
                    logger.error("Failed to migrate users.json: %s", e)
    
    handler = _make_handler(state)

    try:
        httpd = ThreadingHTTPServer((host, port), handler)
    except OSError:
        if port == 0:
            raise
        logger.info("viewer port %s unavailable, falling back to an ephemeral port", port)
        httpd = ThreadingHTTPServer((host, 0), handler)

    httpd.daemon_threads = True
    bound_port = int(httpd.server_address[1])
    state.cookie_name = f"{SESSION_COOKIE_PREFIX}_{bound_port}"
    url = f"http://{host}:{bound_port}"

    thread = threading.Thread(target=httpd.serve_forever, name="strix-viewer", daemon=True)
    thread.start()

    if open_browser:
        _open_browser(authorized_url(url, state.session_token))

    return httpd, url, state.session_token


def _open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001 - launching the browser is best-effort
        logger.debug("could not open browser for %s", url, exc_info=True)


__all__ = ["authorized_url", "bundle_dir", "bundle_is_built", "serve"]
