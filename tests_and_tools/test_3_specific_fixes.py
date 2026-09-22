import urllib.request
import json

def req(url, method="GET", data=None):
    payload = json.dumps(data).encode("utf-8") if data else None
    headers = {"Content-Type": "application/json"} if data else {}
    r = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(r) as resp:
        return resp.status, json.loads(resp.read().decode())

print("--- 1. TEST LƯU CHI TIẾT CÔNG VIỆC (PUT /api/internal-tasks/64) ---")
status, res = req("http://127.0.0.1:8082/api/internal-tasks/64", method="PUT", data={
    "TaskTitle": "Check list kiểm tra Mainline",
    "Priority": "NORMAL",
    "Department": "BOPP",
    "MachineID": "BR1-ML",
    "Description": "Kiểm tra tất cả hạng mục, chụp ảnh xuất file và gửi lên nhóm",
    "AssignedTo": "Kỹ thuật viên 1",
    "Solution": "Đang kiểm tra và thay thế bạc đạn",
    "DowntimeMinutes": 15,
    "Status": "IN_PROGRESS"
})
print(f"Status: {status}, Response: {res}")
assert status == 200, "Lưu chi tiết công việc thất bại!"

print("\n--- 2. TEST GẮN BÁO SỰ CỐ HẠNG MỤC CON ---")
# Lấy 1 item của task 64
status, task_det = req("http://127.0.0.1:8082/api/internal-tasks/64")
first_item = task_det["items"][0]
item_id = first_item["id"]
print(f"Item ID: {item_id}, HasIssue ban đầu: {first_item.get('HasIssue')}")

# Gắn sự cố HasIssue = 1
status, put_res = req(f"http://127.0.0.1:8082/api/internal-tasks/items/{item_id}", method="PUT", data={"HasIssue": 1})
print(f"PUT item {item_id} HasIssue=1 -> Status: {status}")

# Đọc lại task detail xem HasIssue có bằng 1 không
status, task_det2 = req("http://127.0.0.1:8082/api/internal-tasks/64")
updated_item = [i for i in task_det2["items"] if i["id"] == item_id][0]
print(f"Item ID: {item_id}, HasIssue sau khi cập nhật: {updated_item.get('HasIssue')}")
assert updated_item.get("HasIssue") == 1, "HasIssue không lưu thành 1!"

print("\n--- 3. TEST XEM DANH SÁCH LỆNH BẢO TRÌ (GET /api/orders) ---")
status, ord_res = req("http://127.0.0.1:8082/api/orders?page=1&limit=25&status=all&percent=all&percent_type=erp")
print(f"Status: {status}")
print(f"data.items exists? {'items' in ord_res}, length={len(ord_res.get('items', []))}")
print(f"data.stats exists? {'stats' in ord_res}, stats={ord_res.get('stats')}")
assert "items" in ord_res and len(ord_res["items"]) > 0, "Không có data.items!"
assert "stats" in ord_res, "Không có data.stats!"

print("\n>>> TẤT CẢ 3 LỖI ĐÃ ĐƯỢC XÁC MINH KHẮC PHỤC THÀNH CÔNG 100%! <<<")
