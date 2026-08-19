import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Create logs directory if it doesn't exist
LOGS_DIR = Path(os.environ.get("STRIX_LOGS_DIR", "logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOGS_DIR / "strix_app.log"

def setup_logger(name: str = "strix") -> logging.Logger:
    """
    Sets up and returns a centralized logger with both console and rotating file handlers.
    """
    logger = logging.getLogger(name)
    
    # Only configure if no handlers are set to avoid duplicate logs
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        
        formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        
        # Console Handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        
        # Rotating File Handler (Max 10MB per file, keep 5 backups)
        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=10*1024*1024, backupCount=5
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
    return logger

# Expose a default configured logger
logger = setup_logger()
