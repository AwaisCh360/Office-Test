import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# Assuming server is in the path
from strix.interface.viewer.server import app, _rate_limit, SESSION_COOKIE_PREFIX, get_db, _hash_password
from strix.interface.viewer.db import User

client = TestClient(app)

def test_redis_rate_limit():
    """Verify that the Redis rate limiter blocks after 5 requests."""
    # We will mock the redis client directly
    with patch('strix.interface.viewer.server.redis_client') as mock_redis:
        # Simulate incr returning 1, 2, 3, 4, 5, 6
        mock_redis.incr.side_effect = [1, 2, 3, 4, 5, 6]
        
        test_key = "test_ip"
        
        # First 5 should be True (allowed)
        assert _rate_limit(test_key) is True
        assert _rate_limit(test_key) is True
        assert _rate_limit(test_key) is True
        assert _rate_limit(test_key) is True
        assert _rate_limit(test_key) is True
        
        # The 6th should be False (blocked)
        assert _rate_limit(test_key) is False
        
        # Verify expire was called on the first request
        mock_redis.expire.assert_called_once_with(f"ratelimit:{test_key}", 60)

def test_secure_cookies_on_login():
    """Verify that login endpoint sets Secure and HttpOnly cookies."""
    # Mock the database to simulate a valid user
    mock_db = MagicMock()
    mock_user = MagicMock(spec=User)
    mock_user.email = "test@example.com"
    mock_user.password_hash = _hash_password("password123")
    
    mock_query = mock_db.query.return_value
    mock_filter = mock_query.filter.return_value
    mock_filter.first.return_value = mock_user

    # Mock get_db
    with patch('strix.interface.viewer.server.get_db', return_value=mock_db):
        # Mock rate limiter to always allow for this test
        with patch('strix.interface.viewer.server._rate_limit', return_value=True):
            response = client.post("/api/login", json={"email": "test@example.com", "password": "password123"})
            
            assert response.status_code == 200
        assert "set-cookie" in response.headers
        
        cookie_header = response.headers["set-cookie"]
        assert SESSION_COOKIE_PREFIX in cookie_header
        assert "Secure" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "SameSite=lax" in cookie_header

    # Clean up dependency override
    app.dependency_overrides.clear()
