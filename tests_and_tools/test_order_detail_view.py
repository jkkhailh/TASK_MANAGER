import urllib.request
import json

# 1. Lấy 1 order đầu tiên từ /api/orders
req = urllib.request.Request("http://127.0.0.1:8082/api/orders?limit=1")
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    orders = data.get("orders") or data.get("items") or []
    print("Found orders:", len(orders))
    if orders:
        entry_id = orders[0]["EntryID"]
        print("Testing detail for EntryID:", entry_id)

        # 2. Test GET /api/orders/{entry_id}
        url_detail = f"http://127.0.0.1:8082/api/orders/{urllib.parse.quote(entry_id)}"
        try:
            with urllib.request.urlopen(url_detail) as r_det:
                print("GET order detail Status:", r_det.status)
                det_data = json.loads(r_det.read().decode())
                print("Order detail keys:", det_data.keys() if isinstance(det_data, dict) else len(det_data))
        except Exception as e:
            print("Error GET order detail:", e)

        # 3. Test GET /api/orders/{entry_id}/execution
        url_exec = f"http://127.0.0.1:8082/api/orders/{urllib.parse.quote(entry_id)}/execution"
        try:
            with urllib.request.urlopen(url_exec) as r_exec:
                print("GET order execution Status:", r_exec.status)
                exec_data = json.loads(r_exec.read().decode())
                print("Order execution keys:", exec_data.keys() if isinstance(exec_data, dict) else len(exec_data))
        except Exception as e:
            print("Error GET order execution:", e)
