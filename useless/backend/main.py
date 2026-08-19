from fastapi import FastAPI, HTTPException, Depends
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
import jwt
from sqlalchemy.orm import Session
import subprocess
import os

import models
import schemas
import auth
from database import engine, get_db

# Create DB tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Strix API")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception
        
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Strix API is running"}

@app.get("/api/users/me", response_model=schemas.User)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.post("/api/signup", response_model=schemas.Token)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user_email = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user_email:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    db_user_username = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        email=user.email, 
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        hashed_password=hashed_password
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = auth.create_access_token(data={"sub": new_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

from fastapi.security import OAuth2PasswordRequestForm

@app.post("/api/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2 expects 'username' field, we will map our 'email' to it
    db_user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not db_user or not auth.verify_password(form_data.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    access_token = auth.create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}


from routers import strix

app.include_router(strix.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
