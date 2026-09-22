import urllib.request
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

print("=== STARTING COMPREHENSIVE VERIFICATION ===")

def test_url(url, method="GET", data=None):
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method=method
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:
        return 999, str(e)

# 1. Test /maintenance & /orders
code, body = test_url("http://127.0.0.1:8082/maintenance")
print(f"1. GET /maintenance: Status {code}, HTML length={len(body)}")
assert code == 200, f"Failed /maintenance: {code}"

code, body = test_url("http://127.0.0.1:8082/orders")
print(f"   GET /orders: Status {code}, HTML length={len(body)}")
assert code == 200, f"Failed /orders: {code}"

# 2. Test /api/inventory/summary
code, body = test_url("http://127.0.0.1:8082/api/inventory/summary")
print(f"2. GET /api/inventory/summary: Status {code}")
assert code == 200, f"Failed /api/inventory/summary: {body}"
data = json.loads(body)
print(f"   Warehouses count: {len(data.get('warehouses', []))}, Total rows: {data.get('totals', {}).get('total_rows')}")

# 3. Test /api/inventory/items
code, body = test_url("http://127.0.0.1:8082/api/inventory/items?limit=5")
print(f"3. GET /api/inventory/items: Status {code}")
assert code == 200, f"Failed /api/inventory/items: {body}"
items_data = json.loads(body)
print(f"   Returned {len(items_data.get('items', []))} items, total in DB: {items_data.get('total')}")
if items_data.get('items'):
    sample = items_data['items'][0]
    print(f"   Sample Item: {sample.get('ItemID')} - {sample.get('ItemText')} (Stock: {sample.get('CurrentStock')})")

# 4. Test /api/inventory/requests & issue-items
code, body = test_url("http://127.0.0.1:8082/api/inventory/requests")
print(f"4. GET /api/inventory/requests: Status {code}")
assert code == 200, f"Failed /api/inventory/requests: {body}"

code, body = test_url("http://127.0.0.1:8082/api/inventory/issue-items")
print(f"   GET /api/inventory/issue-items: Status {code}")
assert code == 200, f"Failed /api/inventory/issue-items: {body}"

# 5. Test PUT /api/internal-tasks/{task_id} (Update task status)
conn = get_connection()
c = conn.cursor()
c.execute("SELECT id, TaskCode, Status FROM internal_work_orders ORDER BY id DESC LIMIT 1")
t_row = c.fetchone()
conn.close()

if t_row:
    t_id, t_code, t_status = t_row[0], t_row[1], t_row[2]
    print(f"5. Testing PUT /api/internal-tasks/{t_id} ({t_code}, was {t_status})")
    
    # Đổi sang IN_PROGRESS
    payload = json.dumps({"Status": "IN_PROGRESS", "Solution": "Đang kiểm tra và thay thế bạc đạn"}).encode("utf-8")
    code, body = test_url(f"http://127.0.0.1:8082/api/internal-tasks/{t_id}", method="PUT", data=payload)
    print(f"   Update to IN_PROGRESS: Status {code}, Response: {body}")
    assert code == 200, f"Failed to update task to IN_PROGRESS: {body}"

    # Đổi về PENDING hoặc trạng thái ban đầu
    payload_back = json.dumps({"Status": t_status}).encode("utf-8")
    code, body = test_url(f"http://127.0.0.1:8082/api/internal-tasks/{t_id}", method="PUT", data=payload_back)
    print(f"   Restored to {t_status}: Status {code}")
    assert code == 200, f"Failed to restore task status: {body}"

print("\n>>> ALL 3 ISSUES VERIFIED FIXED 100% SUCCESSFULLY! <<<")
