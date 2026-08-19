from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import subprocess
import threading
import os
import json
import re
import urllib.request
import urllib.error

import schemas
import models
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/api/strix", tags=["strix"])

# In-memory store for active strix view processes: {scan_id: {"process": proc, "url": str, "port": int, "token": str}}
_active_viewers: dict = {}

def _parse_view_url(line: str) -> Optional[str]:
    """Extract the view URL from strix view output."""
    match = re.search(r'(http://127\.0\.0\.1:\d+/\?token=[^\s]+)', line)
    return match.group(1) if match else None

def _start_strix_view(scan_id: int, run_name: str):
    """Start strix view for a run and capture the URL."""
    from database import SessionLocal

    env = os.environ.copy()
    if "no_proxy" in env:
        env["no_proxy"] = ""
    if "NO_PROXY" in env:
        env["NO_PROXY"] = ""

    proc = subprocess.Popen(
        ["strix", "view", run_name],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env
    )

    view_url = None
    # Read stdout line by line to find the URL
    for line in proc.stdout:
        url = _parse_view_url(line)
        if url:
            view_url = url
            break

    if view_url:
        _active_viewers[scan_id] = {
            "process": proc,
            "url": view_url,
        }
        # Persist URL to DB
        db = SessionLocal()
        db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id).first()
        if db_scan:
            db_scan.view_url = view_url
            db.commit()
        db.close()


def execute_scan_background(db_scan_id: int, cmd: List[str], env: dict, run_name_prefix: str):
    """Run strix scan in background, capture run_name, then start viewer."""
    from database import SessionLocal

    db = SessionLocal()
    db_scan = db.query(models.Scan).filter(models.Scan.id == db_scan_id).first()
    if not db_scan:
        db.close()
        return

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env
        )

        run_name = None
        # Parse output to detect run name (e.g. "Output  strix_runs/bitlogicx-com_d3ec")
        for line in proc.stdout:
            if run_name is None:
                match = re.search(r'strix_runs/([^\s]+)', line)
                if match:
                    run_name = match.group(1)
                    db_scan.run_name = run_name
                    db.commit()
                    # Start viewer in a separate thread as soon as we have the run_name
                    t = threading.Thread(target=_start_strix_view, args=(db_scan_id, run_name), daemon=True)
                    t.start()

        proc.wait()
        db_scan.status = "completed" if proc.returncode == 0 else "failed"
        db_scan.returncode = proc.returncode

    except Exception as e:
        db_scan.status = "error"
        db_scan.stderr = str(e)

    db.commit()
    db.close()


def _viewer_request(scan_id: int, path: str, method: str = "GET", body: dict = None):
    """Make a request to the active strix viewer for a given scan."""
    viewer = _active_viewers.get(scan_id)
    if not viewer:
        if path == "/api/run":
            return {"status": "starting", "total_tokens": 0, "total_cost": 0, "run_name": None}
        if path == "/api/vulnerabilities":
            return {"vulnerabilities": []}
        if path == "/api/transcript":
            return {"agents": [], "events": []}
        raise HTTPException(status_code=404, detail="Viewer not ready yet.")

    url = viewer["url"]
    # Extract base URL and token from the stored view URL
    base_match = re.match(r'(http://127\.0\.0\.1:\d+)/\?token=(.+)', url)
    if not base_match:
        raise HTTPException(status_code=500, detail="Could not parse viewer URL.")

    base_url = base_match.group(1)
    token = base_match.group(2)

    full_url = f"{base_url}{path}?token={token}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(full_url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Cookie", f"strix_viewer_session_{base_url.split(':')[-1]}={token}")

    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=e.code, detail=e.read().decode())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Install / Settings ──────────────────────────────────────────────────────

@router.post("/install")
def install_strix(current_user: models.User = Depends(get_current_user)):
    try:
        result = subprocess.run(
            ["bash", "-c", "curl -sSL https://strix.ai/install | bash"],
            capture_output=True,
            text=True
        )
        return {
            "status": "completed" if result.returncode == 0 else "failed",
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + key[-4:]

@router.post("/settings", response_model=schemas.SettingsResponse)
def update_settings(settings_in: schemas.SettingsUpdate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_settings = db.query(models.Settings).filter(models.Settings.user_id == current_user.id).first()
    if db_settings:
        db_settings.strix_llm = settings_in.strix_llm
        if settings_in.llm_api_key:
            db_settings.llm_api_key = settings_in.llm_api_key
        db_settings.llm_api_base = settings_in.llm_api_base
        if settings_in.perplexity_api_key is not None:
            db_settings.perplexity_api_key = settings_in.perplexity_api_key
        db_settings.reasoning_effort = settings_in.reasoning_effort
    else:
        db_settings = models.Settings(
            user_id=current_user.id,
            strix_llm=settings_in.strix_llm,
            llm_api_key=settings_in.llm_api_key,
            llm_api_base=settings_in.llm_api_base,
            perplexity_api_key=settings_in.perplexity_api_key,
            reasoning_effort=settings_in.reasoning_effort
        )
        db.add(db_settings)
    db.commit()
    return {
        "strix_llm": db_settings.strix_llm, 
        "masked_api_key": mask_key(db_settings.llm_api_key),
        "llm_api_base": db_settings.llm_api_base,
        "masked_perplexity_key": mask_key(db_settings.perplexity_api_key),
        "reasoning_effort": db_settings.reasoning_effort
    }


@router.get("/settings", response_model=schemas.SettingsResponse)
def get_settings(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_settings = db.query(models.Settings).filter(models.Settings.user_id == current_user.id).first()
    if not db_settings:
        return {"strix_llm": "openai/gpt-5.4", "masked_api_key": ""}
    return {
        "strix_llm": db_settings.strix_llm, 
        "masked_api_key": mask_key(db_settings.llm_api_key),
        "llm_api_base": db_settings.llm_api_base,
        "masked_perplexity_key": mask_key(db_settings.perplexity_api_key),
        "reasoning_effort": db_settings.reasoning_effort
    }


# ─── Scan ─────────────────────────────────────────────────────────────────────

@router.get("/history", response_model=List[schemas.Scan])
def get_scans(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    scans = db.query(models.Scan).filter(models.Scan.user_id == current_user.id).order_by(models.Scan.id.desc()).all()
    return scans


@router.post("/scan", response_model=schemas.Scan)
def run_scan(scan_in: schemas.ScanCreate, background_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_settings = db.query(models.Settings).filter(models.Settings.user_id == current_user.id).first()
    if not db_settings or not db_settings.llm_api_key:
        raise HTTPException(status_code=400, detail="LLM API Key is not configured. Please update settings.")

    env = os.environ.copy()
    env["STRIX_LLM"] = db_settings.strix_llm
    env["LLM_API_KEY"] = db_settings.llm_api_key
    
    if db_settings.llm_api_base:
        env["LLM_API_BASE"] = db_settings.llm_api_base
    if db_settings.perplexity_api_key:
        env["PERPLEXITY_API_KEY"] = db_settings.perplexity_api_key
    if db_settings.reasoning_effort:
        env["STRIX_REASONING_EFFORT"] = db_settings.reasoning_effort

    # Unset IPv6 proxy variables that cause LiteLLM connection errors
    if "no_proxy" in env:
        env["no_proxy"] = ""
    if "NO_PROXY" in env:
        env["NO_PROXY"] = ""

    # Build the strix command (headless mode so terminal stays clean)
    cmd = ["strix", "-n"]

    for target in scan_in.targets:
        cmd.extend(["--target", target])

    if scan_in.instruction:
        cmd.extend(["--instruction", scan_in.instruction])

    if scan_in.scan_mode:
        cmd.extend(["--scan-mode", scan_in.scan_mode])

    if scan_in.scope_mode:
        cmd.extend(["--scope-mode", scan_in.scope_mode])

    if scan_in.diff_base:
        cmd.extend(["--diff-base", scan_in.diff_base])

    if scan_in.max_budget_usd is not None:
        cmd.extend(["--max-budget-usd", str(scan_in.max_budget_usd)])

    if scan_in.max_turns is not None:
        cmd.extend(["--max-turns", str(scan_in.max_turns)])

    # Save scan as pending
    db_scan = models.Scan(
        user_id=current_user.id,
        targets=json.dumps(scan_in.targets),
        instruction=scan_in.instruction,
        scan_mode=scan_in.scan_mode,
        status="running"
    )
    db.add(db_scan)
    db.commit()
    db.refresh(db_scan)

    # Run scan in background (also starts strix view and captures URL)
    background_tasks.add_task(execute_scan_background, db_scan.id, cmd, env, "scan")

    return db_scan


@router.get("/scan/{scan_id}", response_model=schemas.Scan)
def get_scan(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return db_scan


# ─── Live Dashboard Proxy APIs ────────────────────────────────────────────────

@router.get("/scan/{scan_id}/status")
def get_scan_status(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current run status from strix viewer."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
        
    viewer = _active_viewers.get(scan_id)
    # If viewer is not running but we have a run_name (e.g. past completed scan), start it on demand
    if not viewer and db_scan.run_name:
        _start_strix_view(scan_id, db_scan.run_name)
        viewer = _active_viewers.get(scan_id)

    if not viewer and db_scan.status in ["failed", "completed", "error"]:
        return {
            "status": db_scan.status, 
            "total_tokens": 0, 
            "total_cost": 0, 
            "run_name": db_scan.run_name,
            "error": db_scan.stderr
        }
        
    return _viewer_request(scan_id, "/api/run")


@router.get("/scan/{scan_id}/vulnerabilities")
def get_vulnerabilities(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get real-time vulnerabilities from the live scan."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
        
    viewer = _active_viewers.get(scan_id)
    if not viewer and db_scan.run_name:
        _start_strix_view(scan_id, db_scan.run_name)
        
    return _viewer_request(scan_id, "/api/vulnerabilities")


@router.get("/scan/{scan_id}/transcript")
def get_transcript(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get agent transcript (agents list + events/messages)."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
        
    viewer = _active_viewers.get(scan_id)
    if not viewer and db_scan.run_name:
        _start_strix_view(scan_id, db_scan.run_name)
        
    return _viewer_request(scan_id, "/api/transcript")


@router.get("/scan/{scan_id}/capabilities")
def get_capabilities(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Check if steering is allowed (can_steer: true/false)."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _viewer_request(scan_id, "/api/capabilities")


@router.post("/scan/{scan_id}/steer")
def steer_agent(scan_id: int, steer_in: schemas.SteerRequest, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Send a steering message to a specific agent during a live scan."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _viewer_request(
        scan_id,
        "/api/agents/steer",
        method="POST",
        body={"agent_id": steer_in.agent_id, "message": steer_in.message}
    )


@router.get("/scan/{scan_id}/view-url")
def get_view_url(scan_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the live dashboard URL for iframe embedding."""
    db_scan = db.query(models.Scan).filter(models.Scan.id == scan_id, models.Scan.user_id == current_user.id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if not db_scan.view_url:
        return {"view_url": None, "ready": False, "message": "Viewer not ready yet. Retry in a few seconds."}
    return {"view_url": db_scan.view_url, "ready": True}
