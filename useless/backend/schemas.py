from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal
from datetime import datetime

class ScanCreate(BaseModel):
    targets: List[str]
    instruction: Optional[str] = None
    scan_mode: Optional[Literal["quick", "standard", "deep"]] = "quick"
    scope_mode: Optional[Literal["auto", "diff", "full"]] = None
    diff_base: Optional[str] = None
    max_budget_usd: Optional[float] = None
    max_turns: Optional[int] = None

class Scan(BaseModel):
    id: int
    user_id: int
    targets: str
    instruction: Optional[str] = None
    scan_mode: Optional[str] = None
    run_name: Optional[str] = None
    view_url: Optional[str] = None
    status: str
    returncode: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class SteerRequest(BaseModel):
    agent_id: str
    message: str

class SettingsUpdate(BaseModel):
    strix_llm: str
    llm_api_key: str
    llm_api_base: Optional[str] = None
    perplexity_api_key: Optional[str] = None
    reasoning_effort: Optional[str] = None

class SettingsResponse(BaseModel):
    strix_llm: str
    masked_api_key: Optional[str] = None
    llm_api_base: Optional[str] = None
    masked_perplexity_key: Optional[str] = None
    reasoning_effort: Optional[str] = None

class UserBase(BaseModel):
    email: EmailStr
    username: str
    first_name: str
    last_name: str

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class User(UserBase):
    id: int

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
