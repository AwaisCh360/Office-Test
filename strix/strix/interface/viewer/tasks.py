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
        
        base_dir = os.environ.get("STRIX_BASE_DIR", "/app/strix_runs")
        run_dir_path = Path(base_dir) / run_name
        
        # Write logs to strix.log
        if run_dir_path.exists():
            log_path = run_dir_path / "strix.log"
            try:
                with open(log_path, "w") as f:
                    if result.stdout:
                        f.write("--- STDOUT ---\n")
                        f.write(result.stdout)
                        f.write("\n")
                    if result.stderr:
                        f.write("--- STDERR ---\n")
                        f.write(result.stderr)
                        f.write("\n")
            except Exception as e:
                logger.error(f"Failed to write strix.log for {run_name}: {e}")

        if result.returncode != 0:
            logger.error(f"Scan {run_name} failed. Check strix.log in run directory.")
            # Update run.json to failed status
            try:
                import json
                run_json_path = run_dir_path / "run.json"
                if run_json_path.exists():
                    with open(run_json_path, "r") as f:
                        run_data = json.load(f)
                    run_data["status"] = "failed"
                    run_data["error"] = "Process exited with code " + str(result.returncode)

                    with open(run_json_path, "w") as f:
                        json.dump(run_data, f)
            except Exception as e:
                logger.error(f"Failed to update run.json for {run_name}: {e}")
                
            return {"status": "failed", "error": result.stderr}
            
        logger.info(f"Scan {run_name} completed successfully.")
        return {"status": "success", "run_name": run_name}

    except Exception as e:
        logger.exception(f"Error executing scan {run_name}")
        return {"status": "error", "error": str(e)}

@celery_app.task(name="strix.kill_scan")
def kill_scan(run_name: str):
    """
    Kill a running strix scan by matching its run_name in the process list.
    This runs on the Celery worker where the scan is executing.
    """
    try:
        # Send SIGTERM to any process matching --run-name <run_name>
        result = subprocess.run(["pkill", "-f", f"--run-name {run_name}"], check=False)
        if result.returncode == 0:
            logger.info(f"Successfully sent kill signal to processes for scan {run_name}")
        else:
            logger.info(f"No running processes found to kill for scan {run_name}")
    except Exception as e:
        logger.error(f"Failed to kill scan {run_name}: {e}")
