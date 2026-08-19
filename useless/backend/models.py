from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    
    scans = relationship("Scan", back_populates="user", cascade="all, delete-orphan")
    settings = relationship("Settings", back_populates="user", uselist=False, cascade="all, delete-orphan")

class Settings(Base):
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    strix_llm = Column(String, nullable=False, default="openai/gpt-5.4")
    llm_api_key = Column(String, nullable=False)
    llm_api_base = Column(String, nullable=True)
    perplexity_api_key = Column(String, nullable=True)
    reasoning_effort = Column(String, nullable=True)
    
    user = relationship("User", back_populates="settings")

class Scan(Base):
    __tablename__ = "scans"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    targets = Column(String, nullable=False)
    instruction = Column(String, nullable=True)
    scan_mode = Column(String, nullable=True)
    run_name = Column(String, nullable=True)
    view_url = Column(String, nullable=True)
    status = Column(String, nullable=False)
    returncode = Column(Integer, nullable=True)
    stdout = Column(String, nullable=True)
    stderr = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="scans")
