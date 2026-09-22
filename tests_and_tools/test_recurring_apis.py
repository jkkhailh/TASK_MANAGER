import urllib.request
import json

def test_api(url):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"URL: {url} -> Status: {resp.status}")
            if isinstance(data, dict):
                for k, v in data.items():
                    print(f"  key {k}: {len(v) if isinstance(v, list) else v}")
            return True
    except urllib.error.HTTPError as e:
        print(f"URL: {url} -> HTTPError {e.code}: {e.read().decode('utf-8')}")
        return False
    except Exception as e:
        print(f"URL: {url} -> Error: {e}")
        return False

print("1. Testing recurring-templates:")
test_api("http://127.0.0.1:8082/api/internal-tasks/recurring-templates")

print("\n2. Testing recurring-items:")
test_api("http://127.0.0.1:8082/api/internal-tasks/recurring-items")

print("\n3. Testing internal-tasks detail for ID 64:")
test_api("http://127.0.0.1:8082/api/internal-tasks/64")
