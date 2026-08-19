import requests
import time
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Setup DB to create an admin user for testing
import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from strix.interface.viewer.db import Base, User, init_db

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://strix_user:strix_password@localhost:5432/strix_db")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

BASE_URL = "http://localhost:5050"

def setup_test_users():
    db = SessionLocal()
    
    admin_email = "superadmin@test.com"
    standard_email = "standarduser@test.com"
    
    # Check if admin exists
    admin = db.query(User).filter(User.email == admin_email).first()
    if not admin:
        import bcrypt
        hashed = bcrypt.hashpw(b"adminpass123", bcrypt.gensalt()).decode("utf-8")
        admin = User(email=admin_email, password_hash=hashed, first_name="Super", last_name="Admin", is_admin=True)
        db.add(admin)
        
    # Check if standard user exists
    user = db.query(User).filter(User.email == standard_email).first()
    if not user:
        import bcrypt
        hashed = bcrypt.hashpw(b"userpass123", bcrypt.gensalt()).decode("utf-8")
        user = User(email=standard_email, password_hash=hashed, first_name="Standard", last_name="User", is_admin=False, is_suspended=False)
        db.add(user)
        
    db.commit()
    
    admin_id = admin.id
    user_id = user.id
    db.close()
    
    return admin_email, standard_email, admin_id, user_id


def test_live_admin_features():
    print(f"Setting up test users in DB...")
    admin_email, standard_email, admin_id, user_id = setup_test_users()
    
    print(f"Logging in as Super Admin...")
    resp = requests.post(f"{BASE_URL}/api/login", json={"email": admin_email, "password": "adminpass123"})
    if resp.status_code != 200:
        print(f"❌ FAILED: Could not login as admin. {resp.text}")
        sys.exit(1)
    
    admin_token = resp.json().get("token")
    headers = {"Authorization": f"Bearer {admin_token}"}
    
    print("Testing 1. GET /api/admin/users")
    resp = requests.get(f"{BASE_URL}/api/admin/users", headers=headers)
    if resp.status_code == 200:
        users = resp.json().get("users", [])
        if any(u["email"] == standard_email for u in users):
            print("✅ SUCCESS: Admin can view all users")
        else:
            print("❌ FAILED: Standard user not in user list")
            sys.exit(1)
    else:
        print(f"❌ FAILED: /api/admin/users returned {resp.status_code}")
        sys.exit(1)
        
    print("Testing 2. POST /api/admin/users/{id}/suspend")
    resp = requests.post(f"{BASE_URL}/api/admin/users/{user_id}/suspend", headers=headers, json={"suspend": True})
    if resp.status_code == 200:
        print("✅ SUCCESS: Suspended standard user")
    else:
        print(f"❌ FAILED: Suspend returned {resp.status_code}")
        sys.exit(1)
        
    print("Testing 3. Login as Suspended User (Should Fail)")
    resp = requests.post(f"{BASE_URL}/api/login", json={"email": standard_email, "password": "userpass123"})
    if resp.status_code == 403 and "suspended" in resp.text.lower():
        print("✅ SUCCESS: Suspended user was denied login with 403 Forbidden")
    else:
        print(f"❌ FAILED: Suspended user got status {resp.status_code}")
        sys.exit(1)
        
    print("Testing 4. POST /api/admin/users/{id}/impersonate")
    resp = requests.post(f"{BASE_URL}/api/admin/users/{user_id}/impersonate", headers=headers)
    if resp.status_code == 200 and "token" in resp.json():
        print("✅ SUCCESS: Admin received impersonation token")
    else:
        print(f"❌ FAILED: Impersonate failed {resp.status_code}")
        sys.exit(1)
        
    print("Testing 5. Toggle Maintenance Mode")
    resp = requests.post(f"{BASE_URL}/api/admin/maintenance", headers=headers, json={"enable": True})
    if resp.status_code == 200:
        print("✅ SUCCESS: Maintenance mode enabled")
    else:
        print(f"❌ FAILED: Maintenance toggle failed {resp.status_code}")
        sys.exit(1)
        
    print("Testing 6. Fetch Audit Logs")
    resp = requests.get(f"{BASE_URL}/api/admin/audit-logs", headers=headers)
    if resp.status_code == 200:
        logs = resp.json().get("logs", [])
        if len(logs) > 0:
            print(f"✅ SUCCESS: Audit logs retrieved (found {len(logs)} logs)")
        else:
            print("❌ FAILED: No audit logs found")
            sys.exit(1)
    else:
        print(f"❌ FAILED: Audit logs fetch failed {resp.status_code}")
        sys.exit(1)
        
    print("\n🎉 All Super Admin integration tests passed successfully!")
    
    # Restore state
    requests.post(f"{BASE_URL}/api/admin/users/{user_id}/suspend", headers=headers, json={"suspend": False})
    requests.post(f"{BASE_URL}/api/admin/maintenance", headers=headers, json={"enable": False})

if __name__ == "__main__":
    try:
        test_live_admin_features()
    except Exception as e:
        print(f"❌ Script Error: {e}")
        sys.exit(1)
