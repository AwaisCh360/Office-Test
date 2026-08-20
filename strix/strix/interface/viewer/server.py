
from __future__ import annotations

import json
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
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from fastapi import FastAPI, Depends, HTTPException, Request, Response, BackgroundTasks, status, Query
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import subprocess
import sys
import base64
import redis
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

from strix.core.logger import logger

# Redis for Distributed Rate Limiting
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(REDIS_URL, decode_responses=True)

from strix.core.paths import run_record_path
from strix.interface.viewer import auth
from strix.interface.viewer.db import init_db, get_db, User, Run, AuditLog, PlatformSetting
from strix.interface.viewer.transcript import (
    build_run_state,
    primary_target,
    read_report_markdown,
    read_run_summary,
    read_vulnerabilities,
    severity_counts,
)

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "admin")
JWT_SECRET = os.environ.get("JWT_SECRET", "super-secret-strix-key-12345")
SESSION_COOKIE_PREFIX = "strix_viewer_session"
rate_limits = {}

def bundle_dir() -> Path:
    return Path(__file__).resolve().parent / "static"

def bundle_is_built() -> bool:
    return (bundle_dir() / "index.html").is_file()

def _iter_run_dirs(base_dir: Path) -> list[Path]:
    if not base_dir.is_dir():
        return []
    run_dirs = [child for child in base_dir.iterdir() if child.is_dir() and not child.name.startswith(".")]
    run_dirs.sort(key=lambda child: child.stat().st_mtime, reverse=True)
    return run_dirs

def run_list_entry(run_dir: Path) -> dict[str, Any]:
    record = read_run_summary(run_dir)
    return {
        "name": record.get("run_name") or run_dir.name,
        "target": primary_target(record),
        "scan_mode": record.get("scan_mode"),
        "status": record.get("status") or "initializing",
        "start_time": record.get("start_time"),
        "end_time": record.get("end_time"),
        "finished": bool(record.get("finished")),
        "severity_counts": severity_counts(read_vulnerabilities(run_dir)),
    }

def resolve_run_dir(base_dir: Path, run_param: str | None, default_run_dir: Path) -> Path | None:
    if not run_param:
        return default_run_dir
    base = base_dir.resolve()
    candidate = (base / run_param).resolve()
    if candidate.parent != base or not candidate.is_dir():
        return None
    return candidate

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def _check_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    if len(stored_hash) == 64 and all(c in "0123456789abcdef" for c in stored_hash.lower()):
        import hashlib
        computed = hashlib.sha256(password.encode()).hexdigest()
        return computed == stored_hash
    try:
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    except Exception:
        return False

def create_jwt_token(payload: dict) -> str:
    payload["exp"] = time.time() + (24 * 3600)  # 24 hour expiry
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def _rate_limit(key: str) -> bool:
    """Redis-backed distributed rate limiter"""
    try:
        # Increment the key, and set expiry to 60s if it's new
        count = redis_client.incr(f"ratelimit:{key}")
        if count == 1:
            redis_client.expire(f"ratelimit:{key}", 60)
        
        # Max 5 requests per minute
        if count > 5:
            return False
        return True
    except redis.RedisError as e:
        logger.error(f"Redis rate limiting error: {e}")
        # Fail open if Redis is down
        return True

SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
        environment=os.environ.get("STRIX_ENV", "development"),
    )
    logger.info("Sentry integration initialized for FastAPI.")

app = FastAPI(title="Strix Viewer API")

# Strict CORS Policy
origins = [
    "http://localhost",
    "http://localhost:5050",
    "https://localhost",
    # Add production domain here later
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

import secrets

app.state.run_dir = Path(os.environ.get("STRIX_RUN_DIR", "")) if os.environ.get("STRIX_RUN_DIR") else None
app.state.base_dir = app.state.run_dir.parent if app.state.run_dir else Path(os.environ.get("STRIX_BASE_DIR", "/Users/bit/Desktop/Office/strix_runs"))
app.state.assets_dir = bundle_dir()
app.state.steer_handler = None
app.state.session_token = secrets.token_urlsafe(32)
app.state.cookie_name = SESSION_COOKIE_PREFIX
from strix.interface.viewer.db import _db_sessions

@app.middleware("http")
async def db_cleanup_middleware(request: Request, call_next):
    token = _db_sessions.set([])
    try:
        response = await call_next(request)
        return response
    finally:
        sessions = _db_sessions.get()
        if sessions:
            for session in sessions:
                try:
                    session.close()
                except Exception:
                    pass
        _db_sessions.reset(token)

def get_current_user(request: Request) -> User | None:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "")
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        email = payload.get("email")
        if not email:
            return None
        db = get_db()
        return db.query(User).filter(User.email == email).first()
    except Exception:
        return None

from strix.interface.viewer.db import PlatformSetting

def require_user(user: User | None = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(status_code=403, detail="forbidden")
    
    if getattr(user, 'is_suspended', False):
        raise HTTPException(status_code=403, detail="Your account has been suspended by an administrator.")
        
    if not getattr(user, 'is_admin', False):
        db = get_db()
        maintenance_setting = db.query(PlatformSetting).filter(PlatformSetting.key == "maintenance_mode").first()
        if maintenance_setting and maintenance_setting.value.lower() == "true":
            raise HTTPException(status_code=503, detail="The platform is currently under maintenance. Please try again later.")
            
    return user

def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="forbidden")
    return user


@app.get("/api/session")
def api_session(user: User | None = Depends(get_current_user)):
    if user:
        return {"ok": True}
    return JSONResponse(status_code=401, content={"error": "unauthorized"})

@app.get("/api/auth/status")
def auth_status(user: User | None = Depends(get_current_user)):
    return {
        "verified": bool(user),
        "email": user.email if user else None,
        "is_admin": user.is_admin if user else False
    }

@app.post("/api/login")
async def login(request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not _rate_limit(client_ip):
        return JSONResponse(status_code=429, content={"error": "rate limit exceeded"})
        
    body = await request.json()
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "").strip()
    
    db = get_db()
    user = db.query(User).filter(User.email == email).first()
    if user and _check_password(password, user.password_hash):
        if getattr(user, 'is_suspended', False):
            return JSONResponse(status_code=403, content={"error": "Your account has been suspended by an administrator."})
            
        if len(user.password_hash) == 64:
            user.password_hash = _hash_password(password)
            db.commit()
            
        token = create_jwt_token({"email": email})
        response = JSONResponse(content={"token": token, "email": email})
        response.set_cookie(
            key=SESSION_COOKIE_PREFIX, 
            value=token, 
            httponly=True,
            secure=True,     # Enforce HTTPS
            samesite="lax",  # Prevent CSRF
            max_age=86400    # 24 hours
        )
        return response
    
    return JSONResponse(status_code=401, content={"error": "invalid_credentials"})

@app.post("/api/signup")
async def signup(request: Request):
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not _rate_limit(f"signup_{client_ip}"):
        return JSONResponse(status_code=429, content={"error": "rate limit exceeded"})
        
    body = await request.json()
    email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "").strip()
    first_name = str(body.get("first_name") or "").strip()
    last_name = str(body.get("last_name") or "").strip()
    company = str(body.get("company") or "").strip()
    
    if not email or not password or not first_name or not last_name:
        return JSONResponse(status_code=400, content={"error": "missing_fields"})
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        return JSONResponse(status_code=400, content={"error": "invalid email format"})
    if len(password) < 8:
        return JSONResponse(status_code=400, content={"error": "password must be at least 8 characters"})
    
    db = get_db()
    if db.query(User).filter(User.email == email).first():
        return JSONResponse(status_code=400, content={"error": "user_exists"})
    
    is_first_user = db.query(User).count() == 0
    new_user = User(
        email=email,
        password_hash=_hash_password(password),
        first_name=first_name,
        last_name=last_name,
        company=company,
        is_admin=is_first_user
    )
    db.add(new_user)
    db.commit()
    token = create_jwt_token({"email": email})
    response = JSONResponse(content={"token": token, "email": email})
    response.set_cookie(
        key=SESSION_COOKIE_PREFIX, 
        value=token, 
        httponly=True,
        secure=True,     # Enforce HTTPS
        samesite="lax",  # Prevent CSRF
        max_age=86400    # 24 hours
    )
    return response

@app.post("/api/logout")
def logout():
    return {"ok": True}

@app.get("/api/runs")
def list_runs(user: User | None = Depends(get_current_user)):
    if not user:
        run_dirs = _iter_run_dirs(app.state.base_dir)
        return {"locked": True, "count": len(run_dirs), "runs": []}
    
    db = get_db()
    db_runs = db.query(Run).filter(Run.company == user.company).all()
    run_names = {r.run_name for r in db_runs}
    
    run_dirs = _iter_run_dirs(app.state.base_dir)
    filtered = [d for d in run_dirs if d.name in run_names]
    return {"locked": False, "count": len(filtered), "runs": [run_list_entry(d) for d in filtered]}

def resolve_authorized_run(run: str | None, user: User | None, state) -> Path | None:
    if not run and not state.run_dir:
        db = get_db()
        if user:
            db_run = db.query(Run).filter(Run.company == user.company).order_by(Run.id.desc()).first()
            if db_run:
                run = db_run.run_name
        else:
            run_dirs = _iter_run_dirs(state.base_dir)
            if run_dirs:
                run = run_dirs[0].name

    run_dir = resolve_run_dir(state.base_dir, run, state.run_dir)
    if not run_dir:
        return None
        
    if state.run_dir and run_dir.resolve() != state.run_dir.resolve():
        if not user:
            return None
            
    if user:
        db = get_db()
        db_run = db.query(Run).filter(Run.run_name == run_dir.name).first()
        if db_run and db_run.company != user.company:
            return None
            
    return run_dir

@app.get("/api/run")
def get_run(run: str | None = None, user: User | None = Depends(get_current_user)):
    run_dir = resolve_authorized_run(run, user, app.state)
    if not run_dir:
        raise HTTPException(status_code=404, detail="unknown run or forbidden")
    return read_run_summary(run_dir)

@app.get("/api/vulnerabilities")
def get_vulns(run: str | None = None, user: User | None = Depends(get_current_user)):
    run_dir = resolve_authorized_run(run, user, app.state)
    if not run_dir:
        raise HTTPException(status_code=404, detail="unknown run or forbidden")
    return read_vulnerabilities(run_dir)

@app.get("/api/report")
def get_report(run: str | None = None, user: User | None = Depends(get_current_user)):
    run_dir = resolve_authorized_run(run, user, app.state)
    if not run_dir:
        raise HTTPException(status_code=404, detail="unknown run or forbidden")
    return {"markdown": read_report_markdown(run_dir)}

@app.get("/api/transcript")
def get_transcript(run: str | None = None, user: User | None = Depends(get_current_user)):
    run_dir = resolve_authorized_run(run, user, app.state)
    if not run_dir:
        raise HTTPException(status_code=404, detail="unknown run or forbidden")
    return build_run_state(run_dir)

@app.post("/api/run/delete")
async def delete_run(request: Request, user: User = Depends(require_user)):
    import shutil
    body = await request.json()
    run_name = body.get("run")
    if not run_name:
        return JSONResponse(status_code=400, content={"error": "missing run name"})
        
    run_dir = app.state.base_dir / run_name
    if not run_dir.is_dir():
        return JSONResponse(status_code=404, content={"error": "run not found"})
        
    db = get_db()
    db_run = db.query(Run).filter(Run.run_name == run_name).first()
    if db_run and db_run.company != user.company:
        return JSONResponse(status_code=403, content={"error": "forbidden"})
        
    try:
        shutil.rmtree(run_dir)
        if db_run:
            db.delete(db_run)
            db.commit()
        return {"ok": True}
    except Exception as e:
        logger.exception(f"failed to delete run {run_name}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/run/start")
async def start_run(request: Request, user: User = Depends(require_user)):
    body = await request.json()
    
    targets = body.get("targets") or []
    if isinstance(targets, str):
        targets = [targets]
    target_list_file = body.get("target_list_file")
    if not targets and not target_list_file:
        return JSONResponse(status_code=400, content={"error": "missing targets"})
        
    instruction = str(body.get("instructions") or "").strip()
    instruction_file = body.get("instruction_file")
    workspace_files = body.get("workspace_files") or []
    
    scan_mode = str(body.get("scan_mode") or "deep").strip()
    scope_mode = str(body.get("scope_mode") or "auto").strip()
    diff_base = str(body.get("diff_base") or "").strip()
    
    max_budget = body.get("max_budget")
    max_turns = body.get("max_turns")
    config_file = body.get("config_file")
    
    slug = "scan"
    if targets:
        slug = str(targets[0]).replace("https://", "").replace("http://", "").split("/")[0][:20]
    elif target_list_file:
        slug = target_list_file.get("name", "targets").split(".")[0][:20]
    slug = "".join(c if c.isalnum() else "_" for c in slug).strip("_") or "scan"
    run_name = f"{slug}_{secrets.token_hex(2)}"
    
    tmp_root = app.state.base_dir / ".tmp_viewer_uploads" / run_name
    tmp_root.mkdir(parents=True, exist_ok=True)
    
    run_dir = app.state.base_dir / run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    
    db = get_db()
    try:
        new_run = Run(run_name=run_name, owner_email=user.email, company=user.company)
        db.add(new_run)
        db.commit()
    except Exception as e:
        logger.exception("Failed to add run to DB")
        db.rollback()
        
    # Write an initial placeholder summary so the UI can show the target immediately
    import json, time
    initial_summary = {
        "run_name": run_name,
        "scan_mode": scan_mode,
        "status": "initializing",
        "start_time": time.time(),
        "targets": targets,
    }
    (run_dir / "run.json").write_text(json.dumps(initial_summary), encoding="utf-8")

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
            logger.exception("invalid target_list_file")
            return JSONResponse(status_code=400, content={"error": "invalid target_list_file"})
            
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
            logger.exception("invalid instruction_file")
            return JSONResponse(status_code=400, content={"error": "invalid instruction_file"})
            
    if config_file and isinstance(config_file, dict):
        try:
            name = config_file.get("name", "config.json")
            b64 = config_file.get("content_b64", "")
            path = tmp_root / name
            path.write_bytes(base64.b64decode(b64))
            cmd.extend(["--config", str(path)])
        except Exception as e:
            logger.exception("invalid config_file")
            return JSONResponse(status_code=400, content={"error": "invalid config_file"})
            
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
                logger.exception("invalid workspace_files")
                return JSONResponse(status_code=400, content={"error": "invalid workspace_files"})
        
    logger.info("Viewer starting new scan via Celery: %r", cmd)
    from strix.interface.viewer.tasks import start_scan
    
    # We pass the token in the environment to the celery worker so it has access
    # to the JWT when making requests if needed, although strix scans are standalone.
    # Currently strix doesn't require a web token, but passing it is safe.
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else ""
    env_vars = {"STRIX_VIEWER_TOKEN": token} if token else {}
    start_scan.delay(cmd, run_name, env_vars)
    return {"ok": True, "run_name": run_name}

@app.get("/api/admin/users")
def get_admin_users(admin: User = Depends(require_admin)):
    db = get_db()
    out = []
    # Super admin sees all users across the platform
    for u in db.query(User).all():
        out.append({
            "id": u.id,
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "company": u.company,
            "job_title": u.job_title,
            "phone": u.phone,
            "timezone": u.timezone,
            "is_admin": u.is_admin,
            "is_suspended": u.is_suspended,
            "admin_notes": u.admin_notes
        })
    return {"users": out}

@app.post("/api/admin/users/add")
async def add_admin_users(request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    new_email = str(body.get("email") or "").strip()
    password = str(body.get("password") or "").strip()
    first_name = str(body.get("first_name") or "").strip()
    last_name = str(body.get("last_name") or "").strip()
    company = str(body.get("company") or admin.company).strip()
    new_is_admin = bool(body.get("is_admin", False))
    
    if not new_email or not password or not first_name or not last_name:
        return JSONResponse(status_code=400, content={"error": "missing_fields"})
    if not re.match(r"[^@]+@[^@]+\.[^@]+", new_email):
        return JSONResponse(status_code=400, content={"error": "invalid email format"})
    if len(password) < 8:
        return JSONResponse(status_code=400, content={"error": "password must be at least 8 characters"})
        
    db = get_db()
    if db.query(User).filter(User.email == new_email).first():
        return JSONResponse(status_code=400, content={"error": "user_exists"})
    
    new_user = User(
        email=new_email,
        password_hash=_hash_password(password),
        first_name=first_name,
        last_name=last_name,
        company=company,
        is_admin=new_is_admin
    )
    db.add(new_user)
    db.commit()
    return {"ok": True}

@app.delete("/api/admin/users")
async def delete_admin_users(request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    target_email = str(body.get("email") or "").strip()
    if not target_email:
        return JSONResponse(status_code=400, content={"error": "invalid_user"})
        
    db = get_db()
    target_user = db.query(User).filter(User.email == target_email).first()
    if not target_user:
        return JSONResponse(status_code=400, content={"error": "invalid_user"})
    if target_email == admin.email:
        return JSONResponse(status_code=400, content={"error": "unsupported method DELETE"})
        
    db.delete(target_user)
    db.commit()
    return {"ok": True}

@app.post("/api/admin/users/edit")
async def edit_admin_users(request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    target_email = str(body.get("email") or "").strip()
    if not target_email:
        return JSONResponse(status_code=400, content={"error": "invalid_user"})
        
    db = get_db()
    target_user = db.query(User).filter(User.email == target_email).first()
    if not target_user:
        return JSONResponse(status_code=400, content={"error": "invalid_user"})
    if target_email == admin.email:
        return JSONResponse(status_code=400, content={"error": "cannot_edit_self"})
        
    if "is_admin" in body:
        target_user.is_admin = bool(body["is_admin"])
    db.commit()
    return {"ok": True}

# ==========================================
# SUPER ADMIN ENDPOINTS (Require is_admin)
# ==========================================

@app.post("/api/admin/users/{user_id}/suspend")
async def toggle_suspend_user(user_id: int, request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    suspend = bool(body.get("suspend", True))
    db = get_db()
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    if target_user.id == admin.id:
        return JSONResponse(status_code=400, content={"error": "cannot_suspend_self"})
        
    target_user.is_suspended = suspend
    
    # Audit log
    db.add(AuditLog(
        action="suspend_user" if suspend else "unsuspend_user",
        actor_email=admin.email,
        target_email=target_user.email,
        ip_address=request.client.host if request.client else "unknown"
    ))
    db.commit()
    return {"ok": True, "is_suspended": suspend}

@app.put("/api/admin/users/{user_id}/notes")
async def update_user_notes(user_id: int, request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    notes = body.get("notes", "")
    db = get_db()
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        return JSONResponse(status_code=404, content={"error": "not_found"})
        
    target_user.admin_notes = notes
    db.commit()
    return {"ok": True}

@app.get("/api/admin/global-runs")
async def get_global_runs(admin: User = Depends(require_admin)):
    db = get_db()
    runs = db.query(Run).order_by(Run.created_at.desc()).limit(100).all()
    # We should return status, but status is in json files, so we do same as standard runs
    resp = []
    for r in runs:
        meta = read_run_summary(r.run_name)
        status = meta.get("status", "unknown")
        # include owner_email for global visibility
        resp.append({
            "run_name": r.run_name,
            "owner_email": r.owner_email,
            "status": status,
            "company": r.company,
            "created_at": r.created_at.isoformat()
        })
    return {"runs": resp}

@app.post("/api/admin/global-runs/{run_name}/kill")
async def kill_global_run(run_name: str, admin: User = Depends(require_admin)):
    # To kill a Celery task, we normally need its task_id. Since we don't store task_id in DB, 
    # we can try to find it, or we can use a workaround: write a kill signal file.
    # We will use the existing steering mechanism or a stop marker.
    db = get_db()
    r = db.query(Run).filter(Run.run_name == run_name).first()
    if not r:
        return JSONResponse(status_code=404, content={"error": "not_found"})
        
    run_dir = run_record_path(run_name)
    if run_dir.exists():
        (run_dir / "stop_signal").write_text("killed_by_admin")
        
    db.add(AuditLog(
        action="kill_run",
        actor_email=admin.email,
        details=f"Killed run {run_name}"
    ))
    db.commit()
    return {"ok": True}

@app.post("/api/admin/maintenance")
async def toggle_maintenance(request: Request, admin: User = Depends(require_admin)):
    body = await request.json()
    enable = bool(body.get("enable", True))
    
    db = get_db()
    setting = db.query(PlatformSetting).filter(PlatformSetting.key == "maintenance_mode").first()
    if not setting:
        setting = PlatformSetting(key="maintenance_mode", value=str(enable).lower())
        db.add(setting)
    else:
        setting.value = str(enable).lower()
        
    db.add(AuditLog(
        action="toggle_maintenance",
        actor_email=admin.email,
        details=f"Set maintenance to {enable}"
    ))
    db.commit()
    return {"ok": True, "maintenance_mode": enable}

@app.get("/api/admin/settings")
async def get_admin_settings(admin: User = Depends(require_admin)):
    db = get_db()
    maintenance_setting = db.query(PlatformSetting).filter(PlatformSetting.key == "maintenance_mode").first()
    m_mode = maintenance_setting.value.lower() == "true" if maintenance_setting else False
    return {"maintenance_mode": m_mode}

@app.get("/api/admin/audit-logs")
async def get_audit_logs(admin: User = Depends(require_admin)):
    db = get_db()
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(50).all()
    return {"logs": [{
        "id": l.id,
        "action": l.action,
        "actor_email": l.actor_email,
        "target_email": l.target_email,
        "ip_address": l.ip_address,
        "details": l.details,
        "created_at": l.created_at.isoformat()
    } for l in logs]}

@app.post("/api/admin/nuclei/update")
async def update_nuclei_templates(admin: User = Depends(require_admin)):
    db = get_db()
    # Trigger nuclei update in background
    try:
        subprocess.Popen(["nuclei", "-update-templates"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        db.add(AuditLog(
            action="update_nuclei",
            actor_email=admin.email,
            details="Triggered nuclei template update"
        ))
        db.commit()
        return {"ok": True}
    except Exception as e:
        logger.error(f"Failed to trigger nuclei update: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/profile")
def get_profile(user: User = Depends(require_user)):
    return {
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
    }

@app.post("/api/profile")
async def update_profile(request: Request, user: User = Depends(require_user)):
    body = await request.json()
    profile_data = body.get("profile", {})
    
    db = get_db()
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
            return JSONResponse(status_code=400, content={"error": "old_password_required"})
        if not _check_password(old_password, user.password_hash):
            return JSONResponse(status_code=400, content={"error": "invalid_old_password"})
        if len(password) < 8:
            return JSONResponse(status_code=400, content={"error": "password must be at least 8 characters"})
        user.password_hash = _hash_password(password)
        
    db.commit()
    return {"ok": True}

@app.get("/api/capabilities")
def get_caps():
    return {"can_steer": app.state.steer_handler is not None}

@app.post("/api/report/send")
async def send_report(request: Request, user: User = Depends(require_user)):
    body = await request.json()
    run_param = body.get("run")
    run_dir = resolve_authorized_run(run_param, user, app.state)
    if not run_dir:
        raise HTTPException(status_code=404, detail="unknown run or forbidden")
        
    summary = read_run_summary(run_dir)
    if not summary.get("finished", False):
        return JSONResponse(status_code=409, content={"error": "run_not_finished"})
        
    from strix.interface.viewer.report_pdf import build_encrypted_report
    pdf_bytes, password, filename = build_encrypted_report(run_dir)
    pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
    return {"ok": True, "password": password, "filename": filename, "pdf_b64": pdf_b64}


@app.post("/api/event")
async def handle_event(request: Request):
    body = await request.json()
    event = body.get("event")
    _EMAIL_EVENTS = frozenset({"email_submitted", "email_verified", "report_sent", "work_email_required"})
    
    if event == "cta_clicked":
        from strix.telemetry import posthog
        cta = str(body.get("cta") or "unknown")
        surface = body.get("surface")
        posthog.viewer_cta_clicked(cta, surface=str(surface) if surface else None)
    elif event in _EMAIL_EVENTS:
        from strix.telemetry import posthog
        purpose = body.get("purpose")
        posthog.viewer_email_event(str(event), purpose=str(purpose) if purpose else None)
    elif event == "agent_steered":
        from strix.telemetry import posthog
        posthog.viewer_agent_steered()
    return Response(status_code=204)

@app.post("/api/agents/steer")
async def steer_agent(request: Request, user: User = Depends(require_user)):
    body = await request.json()
    agent_id = str(body.get("agent_id") or "").strip()
    message = str(body.get("message") or "").strip()
    if not agent_id or not message:
        return JSONResponse(status_code=400, content={"error": "invalid_input"})
    message = message[:4000]
    
    if app.state.steer_handler is None:
        return JSONResponse(status_code=403, content={"error": "steering_unavailable"})
    delivered = app.state.steer_handler(agent_id, message)
    if delivered:
        return {"ok": True}
    return {"ok": False, "error": "not_delivered"}

@app.get("/api/debug-sentry")
async def trigger_error():
    """Dummy endpoint to test Sentry and Logging."""
    logger.info("Triggering intentional zero division error to test Sentry.")
    division_by_zero = 1 / 0
    return {"ok": True}

# SPA fallback
@app.get("/{full_path:path}")
async def serve_spa(full_path: str, request: Request):
    assets_dir = getattr(app.state, "assets_dir", None) or bundle_dir()
    file_path = assets_dir / full_path
    
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"error": "not found"})
        
    if file_path.is_file():
        if file_path.name == "index.html":
            token = request.query_params.get("token")
            if token and secrets.compare_digest(token, app.state.session_token):
                response = FileResponse(file_path)
                response.set_cookie(
                    key=SESSION_COOKIE_PREFIX, 
                    value=token, 
                    httponly=True,
                    secure=True,     # Enforce HTTPS
                    samesite="lax",  # Prevent CSRF
                    max_age=86400    # 24 hours
                )
                return response
        return FileResponse(file_path)
        
    # SPA fallback
    index_path = assets_dir / "index.html"
    if index_path.is_file():
        token = request.query_params.get("token")
        response = FileResponse(index_path)
        if token and secrets.compare_digest(token, app.state.session_token):
            response.set_cookie(
                key=app.state.cookie_name,
                value=app.state.session_token,
                path="/",
                httponly=True,
                samesite="strict"
            )
        return response
        
    return JSONResponse(status_code=404, content={"error": "not found"})


def authorized_url(base_url: str, token: str) -> str:
    return f"{base_url}/?{urlencode({'token': token})}"

def serve(
    run_dir: Path,
    *,
    host: str = "127.0.0.1",
    port: int = 0,
    open_browser: bool = True,
    steer_handler: Callable[[str, str], bool] | None = None,
) -> tuple[Any, str, str]:
    import sentry_sdk
    sentry_sdk.init(dsn=os.environ.get("SENTRY_DSN", ""), traces_sample_rate=1.0)
    
    assets_dir = bundle_dir()
    
    app.state.run_dir = run_dir
    app.state.assets_dir = assets_dir
    app.state.base_dir = run_dir.parent
    app.state.steer_handler = steer_handler
    app.state.session_token = secrets.token_urlsafe(32)
    
    if init_db():
        db = get_db()
        if db.query(User).count() == 0:
            legacy_path = app.state.base_dir / "users.json"
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
                except Exception as e:
                    logger.exception("Failed to migrate users.json")

    import socket
    if port == 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            port = s.getsockname()[1]
            
    app.state.cookie_name = f"{SESSION_COOKIE_PREFIX}_{port}"
    url = f"http://{host}:{port}"
    
    # Run Uvicorn in a thread
    def run_server():
        uvicorn.run(app, host=host, port=port, log_level="warning")
        
    thread = threading.Thread(target=run_server, name="strix-viewer", daemon=True)
    thread.start()

    if open_browser:
        _open_browser(authorized_url(url, app.state.session_token))

    # Return a dummy httpd object so controller.py doesn't crash (it expects .server_address)
    class DummyHttpd:
        server_address = (host, port)
        def shutdown(self): pass
        def server_close(self): pass
        
    return DummyHttpd(), url, app.state.session_token

def _open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        logger.debug("could not open browser for %s", url, exc_info=True)

__all__ = ["authorized_url", "bundle_dir", "bundle_is_built", "serve"]
