import datetime
import os
import logging
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, text
from strix.core.logger import logger
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import SQLAlchemyError

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://strix_user:strix_password@localhost:5432/strix_db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    first_name = Column(String, default="")
    last_name = Column(String, default="")
    company = Column(String, default="")
    job_title = Column(String, default="")
    phone = Column(String, default="")
    timezone = Column(String, default="")
    is_admin = Column(Boolean, default=False)
    is_suspended = Column(Boolean, default=False)
    admin_notes = Column(String, default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Run(Base):
    __tablename__ = "runs"

    id = Column(Integer, primary_key=True, index=True)
    run_name = Column(String, unique=True, index=True, nullable=False)
    owner_email = Column(String, index=True, nullable=False)
    company = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, nullable=False)
    actor_email = Column(String, index=True)
    target_email = Column(String, index=True, nullable=True)
    ip_address = Column(String, nullable=True)
    details = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class PlatformSetting(Base):
    __tablename__ = "platform_settings"
    
    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

def init_db():
    try:
        # Check if columns exist, if not, alter table (SQLite/Postgres basic support)
        # This is a hacky migration for dev, avoiding Alembic
        with engine.connect() as conn:
            try:
                conn.execute(text("SELECT is_suspended FROM users LIMIT 1"))
            except SQLAlchemyError:
                logger.info("Migrating DB: Adding is_suspended and admin_notes to users")
                conn.rollback() # reset transaction
                try:
                    conn.execute(text("ALTER TABLE users ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE"))
                    conn.execute(text("ALTER TABLE users ADD COLUMN admin_notes VARCHAR DEFAULT ''"))
                    conn.commit()
                except SQLAlchemyError as e:
                    logger.error(f"Migration failed: {e}")
                    conn.rollback()
                    
        Base.metadata.create_all(bind=engine)
        
        # Initialize default settings
        db = SessionLocal()
        maintenance_setting = db.query(PlatformSetting).filter(PlatformSetting.key == "maintenance_mode").first()
        if not maintenance_setting:
            db.add(PlatformSetting(key="maintenance_mode", value="false"))
            db.commit()
        db.close()
            
        return True
    except SQLAlchemyError as e:
        logger.error(f"Error initializing DB: {e}")
        return False

import contextvars

_db_sessions = contextvars.ContextVar("_db_sessions", default=None)

def get_db():
    db = SessionLocal()
    sessions = _db_sessions.get()
    if sessions is not None:
        sessions.append(db)
    return db
