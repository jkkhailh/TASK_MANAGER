import urllib.request
import json
import os
import sys

def request(url, method="GET", data=None):
    payload = json.dumps(data).encode("utf-8") if data else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return 999, str(e)

print("==================================================")
print("     COMPREHENSIVE BACKEND VERIFICATION SUITE     ")
print("==================================================")

# 1. Danh sách lệnh bảo dưỡng (GET /api/orders)
code, res = request("http://127.0.0.1:8082/api/orders?status=all&percent=all&page=1&limit=10")
print(f"1. GET /api/orders: Status {code}")
assert code == 200, f"Failed GET /api/orders: {res}"
print(f"   -> Found {len(res.get('orders', []))} orders, Total={res.get('total_orders')}")

# 2. Danh mục máy móc (GET /api/categories/machines)
code, res = request("http://127.0.0.1:8082/api/categories/machines")
print(f"2. GET /api/categories/machines: Status {code}")
assert code == 200, f"Failed GET /api/categories/machines: {res}"
print(f"   -> Found {len(res.get('machines', []))} machines")

# 3. Hạng mục con định kỳ (GET /api/internal-tasks/recurring-items)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/recurring-items")
print(f"3. GET /api/internal-tasks/recurring-items: Status {code}")
assert code == 200, f"Failed GET /api/internal-tasks/recurring-items: {res}"
print(f"   -> Found {len(res.get('items', []))} recurring items")

# 4. Nhóm kỹ thuật (GET /api/internal-tasks/groups)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/groups")
print(f"4. GET /api/internal-tasks/groups: Status {code}")
assert code == 200, f"Failed GET /api/internal-tasks/groups: {res}"
print(f"   -> Groups count: {len(res) if isinstance(res, list) else len(res.get('groups', []))}")

# 5. Chi tiết công việc & Ảnh đính kèm (GET /api/internal-tasks/64)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/64")
print(f"5. GET /api/internal-tasks/64: Status {code}")
assert code == 200, f"Failed GET /api/internal-tasks/64: {res}"
print(f"   -> Task items: {len(res.get('items', []))}, Images: {len(res.get('images', []))}")
if res.get('items'):
    sample_it = res['items'][0]
    print(f"   -> Sample item ActualImageUrl: {sample_it.get('ActualImageUrl')}")

# 6. Thêm hạng mục con vào công việc (POST /api/internal-tasks/64/items)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/64/items", method="POST", data={
    "ItemTitle": "Kiểm tra siết ốc bệ máy",
    "StandardGuideline": "Dùng cờ lê lực 45Nm",
    "AssignedTo": "KTV Test"
})
print(f"6. POST /api/internal-tasks/64/items: Status {code}")
assert code == 200, f"Failed POST items: {res}"
print(f"   -> New item ID: {res.get('item_id')}")

# 7. Cập nhật mức ưu tiên (PATCH /api/internal-tasks/64/priority)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/64/priority", method="PATCH", data={
    "Priority": "HIGH"
})
print(f"7. PATCH /api/internal-tasks/64/priority: Status {code}")
assert code == 200, f"Failed PATCH priority: {res}"
print(f"   -> Priority updated to: {res.get('Priority')}")

# 8. Cập nhật trạng thái công việc (PUT /api/internal-tasks/64)
code, res = request("http://127.0.0.1:8082/api/internal-tasks/64", method="PUT", data={
    "Status": "IN_PROGRESS",
    "Solution": "Đã siết chặt bu-lông và bổ sung mỡ bôi trơn",
    "DowntimeMinutes": 15
})
print(f"8. PUT /api/internal-tasks/64: Status {code}")
assert code == 200, f"Failed PUT task status: {res}"

# 9. Tạo phiếu yêu cầu xuất kho (POST /api/inventory/requests)
code, res = request("http://127.0.0.1:8082/api/inventory/requests", method="POST", data={
    "RequestedBy": "Kỹ thuật viên Test Suite",
    "Department": "PHÒNG KỸ THUẬT",
    "WHouseID": "DC",
    "Purpose": "Bảo trì máy phân cuộn",
    "Items": [
        {
            "ItemID": "10CD02-023",
            "ItemText": "Đồng hồ đo nhiệt độ TH101",
            "Unit": "CAI",
            "StorageID": "G1.3",
            "WHouseID": "DC",
            "RequestedQty": 1.0,
            "Remark": "Lắp vào máy"
        }
    ]
})
print(f"9. POST /api/inventory/requests: Status {code}")
assert code == 200, f"Failed POST inventory request: {res}"
print(f"   -> Generated Request: {res.get('request_code')}, ID: {res.get('request_id')}")

# 10. Tồn kho ERP & Thống kê
code, res = request("http://127.0.0.1:8082/api/inventory/summary")
print(f"10. GET /api/inventory/summary: Status {code}")
assert code == 200, f"Failed GET inventory summary: {res}"
print(f"    -> Warehouses: {len(res.get('warehouses', []))}, Total Rows: {res.get('totals', {}).get('total_rows')}")

print("\n>>> ALL 10 TEST CASES PASSED WITH 100% SUCCESS! <<<")
