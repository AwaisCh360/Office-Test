import os
import subprocess
from celery import Celery
import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration

from strix.core.logger import logger

# Configure Celery
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "strix_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    worker_concurrency=10, # default concurrent scans per worker
    task_track_started=True,
    task_time_limit=3600 * 2, # 2 hours max per scan
)

# Initialize Sentry for Celery Worker
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[CeleryIntegration()],
        traces_sample_rate=1.0,
        environment=os.environ.get("STRIX_ENV", "development"),
    )
    logger.info("Sentry integration initialized for Celery Worker.")


@celery_app.task(bind=True, name="strix.scan")
def start_scan(self, cmd: list, run_name: str, env: dict = None):
    """
    Start a strix scan in the background.
    """
    # Merge custom env (like strix tokens/configs) with os.environ
    subprocess_env = os.environ.copy()
    if env:
        subprocess_env.update(env)
        
    import sys
    if "python" in cmd[0]:
        cmd[0] = sys.executable

    logger.info(f"Starting scan for {run_name} with command: {cmd}")
    
    try:
        # We use run() here so the celery worker holds the task until completion.
        # This properly utilizes the Celery queue/concurrency limits.
        result = subprocess.run(
            cmd,
            env=subprocess_env,
            capture_output=True,
            text=True,
            check=False
        )
        
        if result.returncode != 0:
            logger.error(f"Scan {run_name} failed: {result.stderr}")
            return {"status": "failed", "error": result.stderr}
            
        logger.info(f"Scan {run_name} completed successfully.")
        return {"status": "success", "run_name": run_name}

    except Exception as e:
        logger.exception(f"Error executing scan {run_name}")
        return {"status": "error", "error": str(e)}
