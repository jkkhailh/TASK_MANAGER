import os
import sys
import py_compile
import re

SERVER_PATH = "/home/khailh/MAINTENANCE_DB/server.py"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    code = f.read()

print(f"Original lines: {len(code.splitlines())}")

# 1. Sửa create_inventory_request: NameError 'seq'
old_req_code_block = '''prefix = f"REQ-{now.strftime('%y%m')}"
        c.execute("SELECT COUNT(*) FROM warehouse_issue_requests WHERE RequestCode LIKE ?", (f"{prefix}%",))
        req_code = f"{prefix}-{seq:04d}"'''

new_req_code_block = '''prefix = f"REQ-{now.strftime('%y%m')}"
        c.execute("SELECT COUNT(*) FROM warehouse_issue_requests WHERE RequestCode LIKE ?", (f"{prefix}%",))
        seq = (c.fetchone()[0] or 0) + 1
        req_code = f"{prefix}-{seq:04d}"'''

if old_req_code_block in code:
    code = code.replace(old_req_code_block, new_req_code_block, 1)
    print("Fixed create_inventory_request seq bug")

# 2. Sửa list_orders: NameError 'percent'
old_list_orders_def = '''@app.get("/api/orders")
def list_orders(
    search: Optional[str] = None,
    status: Optional[str] = "all",
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100)
):'''

new_list_orders_def = '''@app.get("/api/orders")
def list_orders(
    search: Optional[str] = None,
    status: Optional[str] = "all",
    percent: Optional[str] = "all",
    percent_type: Optional[str] = "staff",
    month: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100)
):'''

if old_list_orders_def in code:
    code = code.replace(old_list_orders_def, new_list_orders_def, 1)
    print("Fixed list_orders arguments")

# Xóa đoạn duplicate 'elif status == "closed": where_clauses.append("o1.Closed = 1")' trong list_orders
dup_closed = '''        elif status == "closed":
            where_clauses.append("o1.Closed = 1")

        elif status == "closed":
            where_clauses.append("o1.Closed = 1")'''
single_closed = '''        elif status == "closed":
            where_clauses.append("o1.Closed = 1")'''
if dup_closed in code:
    code = code.replace(dup_closed, single_closed, 1)
    print("Cleaned duplicate status closed check")

# Bổ sung lọc theo month trong list_orders nếu chưa có
if "if month and month.strip() and month.lower() != 'all':" not in code and "strftime('%Y-%m', o1.EntryDate) = ?" not in code:
    spot = '        if status == "open":\n            where_clauses.append("(o1.Closed = 0 OR o1.Closed IS NULL)")'
    add_month = '''        if month and month.strip() and month.lower() != "all":
            where_clauses.append("strftime('%Y-%m', o1.EntryDate) = ?")
            params.append(month.strip())
'''
    code = code.replace(spot, add_month + "\n" + spot, 1)
    print("Added month filter in list_orders")

with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(code)

py_compile.compile(SERVER_PATH, doraise=True)
print("Compiled stage 1 successfully.")
