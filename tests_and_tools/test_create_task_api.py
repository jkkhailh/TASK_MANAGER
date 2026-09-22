import urllib.request
import json

url = "http://127.0.0.1:8082/api/internal-tasks"
payload = {
    "TaskTitle": "Sự cố test máy cán màng",
    "TaskType": "BREAKDOWN",
    "Priority": "NORMAL",
    "MachineID": "BR1-ML",
    "Department": "BOPP",
    "RequesterName": "Kỹ thuật viên Test",
    "RequesterEmail": "test@bopp.vn",
    "RequesterPhone": "0987654321",
    "AssignedTo": "",
    "Description": "Rò rỉ khí nén van cấp",
    "IsRecurring": False,
    "Items": [
        {
            "ItemTitle": "Kiểm tra thay thế van khí",
            "AssignedTo": "KTV 1",
            "Department": "Cơ điện",
            "Note": "Van 1/2 inch",
            "ItemOrder": 1
        }
    ]
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        print("Status:", resp.status)
        print("Response:", resp.read().decode())
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}: {e.read().decode()}")
except Exception as e:
    print("Error:", e)
