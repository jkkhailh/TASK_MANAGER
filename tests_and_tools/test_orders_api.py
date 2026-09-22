import urllib.request
import json

url = "http://127.0.0.1:8082/api/orders"
req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req) as resp:
        print("GET /api/orders Status:", resp.status)
        data = json.loads(resp.read().decode("utf-8"))
        print("Data keys:", data.keys() if isinstance(data, dict) else len(data))
        if isinstance(data, dict):
            print("Orders count:", len(data.get("orders", [])))
except urllib.error.HTTPError as e:
    print("HTTPError Code:", e.code)
    print("HTTPError Body:", e.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)
