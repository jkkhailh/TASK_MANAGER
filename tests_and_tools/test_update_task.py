import os
import sys
import json
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()
c.execute("SELECT id, TaskCode, Status FROM internal_work_orders ORDER BY id DESC LIMIT 1")
row = c.fetchone()
conn.close()

if not row:
    print("No tasks in DB!")
    sys.exit(0)

task_id = row[0]
task_code = row[1]
current_status = row[2]

print(f"Testing task ID={task_id}, Code={task_code}, Current Status={current_status}")

url = f"http://127.0.0.1:8082/api/internal-tasks/{task_id}"
payload = json.dumps({"Status": "IN_PROGRESS"}).encode("utf-8")

req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="PUT")

try:
    with urllib.request.urlopen(req) as resp:
        print("HTTP Status:", resp.status)
        print("Response:", resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("HTTPError Code:", e.code)
    print("HTTPError Reason:", e.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)
