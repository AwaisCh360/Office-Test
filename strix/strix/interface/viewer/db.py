import datetime
import os
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime
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
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Run(Base):
    __tablename__ = "runs"

    id = Column(Integer, primary_key=True, index=True)
    run_name = Column(String, unique=True, index=True, nullable=False)
    owner_email = Column(String, index=True, nullable=False)
    company = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        return True
    except SQLAlchemyError as e:
        print(f"Error initializing DB: {e}")
        return False

def get_db():
    db = SessionLocal()
    try:
        return db
    finally:
        db.close()
