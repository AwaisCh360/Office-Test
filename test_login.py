import urllib.request
import urllib.parse
import json

data = json.dumps({'email': 'admin@example.com', 'password': '112233'}).encode('utf-8')
req = urllib.request.Request('http://127.0.0.1:5050/api/login', data=data, headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as f:
        print(f.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"Error: {e.code} {e.read().decode('utf-8')}")
