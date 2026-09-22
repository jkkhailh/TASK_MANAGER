import os
import sys
import py_compile
import re

SERVER_PATH = "/home/khailh/MAINTENANCE_DB/server.py"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    content = f.read()

print(f"Original content length: {len(content)}")

# 1. Thêm 3 hàm helper trước @app.get("/api/internal-tasks") hoặc sau các models
helper_functions = '''
def normalize_department_name(c, dept: Optional[str]) -> str:
    if not dept or not dept.strip():
        return "KỸ THUẬT"
    dept_clean = dept.strip()
    try:
        c.execute("SELECT DepartName FROM CL_tblDepartment WHERE DepartID = ? OR DepartName = ?", (dept_clean, dept_clean))
        row = c.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return dept_clean

def normalize_machine_id(c, mac: Optional[str]) -> str:
    if not mac or not mac.strip():
        return ""
    mac_clean = mac.strip()
    try:
        c.execute("SELECT MachineID FROM CL_tblMacList WHERE MachineID = ? OR MachineText = ?", (mac_clean, mac_clean))
        row = c.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return mac_clean

def generate_next_task_code(c, now) -> str:
    prefix = f"IWO-{now.strftime('%y%m')}"
    c.execute("SELECT COUNT(*) FROM internal_work_orders WHERE TaskCode LIKE ?", (f"{prefix}%",))
    seq = (c.fetchone()[0] or 0) + 1
    return f"{prefix}-{seq:04d}"

'''

if "def normalize_department_name" not in content:
    # Chèn trước route /api/internal-tasks đầu tiên
    pos = content.find('@app.get("/api/internal-tasks/employees")')
    if pos == -1:
        pos = content.find('@app.get("/api/internal-tasks')
    if pos != -1:
        content = content[:pos] + helper_functions + "\n" + content[pos:]
        print("Added helper functions normalize_department_name, normalize_machine_id, generate_next_task_code")

# 2. Thêm HasIssue vào câu SELECT internal_task_items trong get_internal_task_detail
old_items_select = """            SELECT id, TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, CompletedAt, CompletedBy, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt
            FROM internal_task_items"""

new_items_select = """            SELECT id, TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, CompletedAt, CompletedBy, Note, SampleImageUrl, SampleImagePath, StandardGuideline, HasIssue, CreatedAt, UpdatedAt
            FROM internal_task_items"""

if old_items_select in content:
    content = content.replace(old_items_select, new_items_select)
    print("Added HasIssue to get_internal_task_detail items query")
else:
    # Regex fallback
    content = re.sub(
        r'SELECT id, TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, CompletedAt, CompletedBy, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt\s+FROM internal_task_items',
        'SELECT id, TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, CompletedAt, CompletedBy, Note, SampleImageUrl, SampleImagePath, StandardGuideline, HasIssue, CreatedAt, UpdatedAt\n            FROM internal_task_items',
        content
    )
    print("Added HasIssue via regex")

# 3. Bổ sung items và stats vào list_orders
old_list_orders_return = """        return {
            "orders": orders,
            "total": total_count,
            "page": page,
            "limit": limit,
            "pages": total_pages
        }"""

new_list_orders_return = """        stats = {
            "total_orders": total_orders_cnt,
            "erp_result_count": erp_res_cnt,
            "erp_result_percent": erp_res_pct,
            "staff_total_tasks": tot_tasks,
            "staff_completed_tasks": comp_tasks,
            "staff_percent": staff_overall_pct
        }

        return {
            "items": orders,
            "orders": orders,
            "stats": stats,
            "total": total_count,
            "page": page,
            "limit": limit,
            "pages": total_pages
        }"""

if old_list_orders_return in content:
    content = content.replace(old_list_orders_return, new_list_orders_return, 1)
    print("Added items and stats to list_orders return dict")
else:
    print("Warning: old_list_orders_return not found directly!")

with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("Compiling server.py...")
py_compile.compile(SERVER_PATH, doraise=True)
print("Compiled successfully!")
