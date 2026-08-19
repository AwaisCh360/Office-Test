import requests
import time
import sys

BASE_URL = "http://localhost:5050"

def test_real_rate_limiting():
    print(f"Testing Real Rate Limiting against {BASE_URL}...")
    
    # We will spam the login endpoint
    endpoint = f"{BASE_URL}/api/login"
    
    # Wait for the limit to expire (just in case we ran this recently)
    # Actually, we can just use a random email so the IP rate limit is hit,
    # wait, the rate limit is based on client_ip. Since we are testing from localhost,
    # we might be blocked if we run this multiple times. 
    # Let's just fire 6 requests rapidly.
    
    payload = {"email": "fake@test.com", "password": "fake"}
    
    allowed = 0
    blocked = 0
    
    for i in range(7):
        resp = requests.post(endpoint, json=payload)
        if resp.status_code == 429:
            blocked += 1
            print(f"Request {i+1}: BLOCKED (429 Rate Limit Exceeded)")
        else:
            allowed += 1
            print(f"Request {i+1}: ALLOWED ({resp.status_code})")
            
    if blocked > 0:
        print("✅ SUCCESS: Real rate limiting is working! Redis actually blocked the extra requests.")
    else:
        print("❌ FAILED: Rate limiting did not block the requests.")
        sys.exit(1)


def test_real_secure_cookies():
    print(f"\nTesting Real Secure Cookies against {BASE_URL}...")
    
    # We'll hit signup or login. We can't guarantee a valid login without making a user,
    # but let's just make a user via signup (or try to). 
    # Note: signup rate limit is separated by "signup_{client_ip}"
    unique_email = f"test_{int(time.time())}@example.com"
    payload = {
        "email": unique_email,
        "password": "password123",
        "first_name": "Test",
        "last_name": "User",
        "company": "TestCorp"
    }
    
    resp = requests.post(f"{BASE_URL}/api/signup", json=payload)
    print(f"Signup Response: {resp.status_code}")
    
    if "set-cookie" in resp.headers:
        cookie_val = resp.headers["set-cookie"]
        print(f"Received Cookie Header: {cookie_val}")
        
        if "Secure" in cookie_val and "HttpOnly" in cookie_val and "SameSite=lax" in cookie_val:
            print("✅ SUCCESS: Cookie is fully secure on the real server response.")
        else:
            print("❌ FAILED: Cookie is missing some secure attributes.")
            sys.exit(1)
    elif resp.status_code == 429:
         print("⚠️ SKIPPED: Rate limited from previous tests, try again in a minute.")
    else:
        print("❌ FAILED: No Set-Cookie header found in response.")
        sys.exit(1)

if __name__ == "__main__":
    try:
        test_real_rate_limiting()
        test_real_secure_cookies()
    except requests.exceptions.ConnectionError:
        print("❌ Error: The server is not running on http://localhost:5050")
