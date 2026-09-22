import urllib.request
import json

url = "http://127.0.0.1:8082/api/internal-tasks/64/items"
payload = json.dumps({
    "ItemTitle": "Hạng mục test thử nghiệm",
    "StandardGuideline": "Kiểm tra kỹ thông số",
    "AssignedTo": "Kỹ thuật viên",
    "Notes": "Ghi chú test"
}).encode("utf-8")

req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")

try:
    with urllib.request.urlopen(req) as resp:
        print("POST Status:", resp.status)
        print("Response:", resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print("Error:", e)
