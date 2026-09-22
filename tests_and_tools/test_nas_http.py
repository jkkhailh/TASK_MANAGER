import urllib.request

url = "http://127.0.0.1:8082/nas-storage/internal_tasks/IWO-2609-0004/IWO-2609-0004_BEFORE_20260918_113404_db9bf114.jpg"
try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        print("Status:", resp.status)
        print("Content-Type:", resp.headers.get("Content-Type"))
        print("Length:", len(resp.read()))
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print("Error:", e)
