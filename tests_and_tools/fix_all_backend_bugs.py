import os
import sys
import py_compile
import re

SERVER_PATH = "/home/khailh/MAINTENANCE_DB/server.py"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

print(f"Total lines initially: {len(lines)}")
content = "".join(lines)

# 1. FIX LỖI 1: list_orders SQL Syntax Error near 'AS'
bad_sql_fragment = """                (
                (
                    SELECT COUNT(*)
                    FROM maintenance_machine_tasks mmt
                    WHERE mmt.EntryID = o1.EntryID
                ) AS TotalTasks,
                    SELECT COUNT(*)
                    FROM maintenance_machine_tasks mmt
                    WHERE mmt.EntryID = o1.EntryID
                ) AS TotalTasks,"""

good_sql_fragment = """                (
                    SELECT COUNT(*)
                    FROM maintenance_machine_tasks mmt
                    WHERE mmt.EntryID = o1.EntryID
                ) AS TotalTasks,"""

if bad_sql_fragment in content:
    content = content.replace(bad_sql_fragment, good_sql_fragment, 1)
    print("Fixed list_orders SQL syntax near AS")
else:
    print("Warning: bad_sql_fragment not matched exactly, checking regex...")
    # Regex fallback
    rgx = r'\(\s*\(\s*SELECT COUNT\(\*\)\s*FROM maintenance_machine_tasks mmt\s*WHERE mmt\.EntryID = o1\.EntryID\s*\) AS TotalTasks,\s*SELECT COUNT\(\*\)\s*FROM maintenance_machine_tasks mmt\s*WHERE mmt\.EntryID = o1\.EntryID\s*\) AS TotalTasks,'
    content = re.sub(rgx, good_sql_fragment.strip(), content)

# 2. FIX LỖI 2: get_categories_machines - No such column FactoryID
bad_machines_sql = "SELECT MachineID, MachineText, DepartID, FactoryID, IsClosed\n            FROM CL_tblMacList"
good_machines_sql = "SELECT MachineID, MachineText, MacCateID, MacLineID, DepartID, DepartName, ModelID, IsClosed\n            FROM CL_tblMacList"
if bad_machines_sql in content:
    content = content.replace(bad_machines_sql, good_machines_sql, 1)
    print("Fixed get_categories_machines FactoryID bug")

# 3. FIX LỖI 3: update_internal_task_priority - Delete hanging code block after finally
# Đoạn code rác từ dòng 3444: c.execute(""" INSERT INTO internal_work_orders ...
bad_hanging_block = '''        c.execute("""
            INSERT INTO internal_work_orders
            (TaskCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName,
             RequesterEmail, RequesterPhone, AssignedTo,
             Description, Status, ReportedAt, CreatedBy, CreatedAt, UpdatedAt,
             RecurringTemplateID, CycleInfo, RecurringCount, NextDueDate, NextTaskIdCreated)
            VALUES (?, ?, 'DEPT_REQUEST', ?, ?, ?, ?, ?, ?, '', ?, 'PENDING', ?, ?, ?, ?, NULL, NULL, 1, NULL, 0)
        """, (
            task_code, payload.TaskTitle.strip(), resolved_machine,
            payload.Priority.upper() if payload.Priority else 'NORMAL',
            resolved_dept, payload.RequesterName.strip(),
            payload.RequesterEmail.strip() if payload.RequesterEmail else '',
            payload.RequesterPhone.strip() if payload.RequesterPhone else '',
            payload.Description.strip() if payload.Description else '',
            now_str, creator, now_str, now_str
        ))
        task_id = c.lastrowid'''

if bad_hanging_block in content:
    content = content.replace(bad_hanging_block, "", 1)
    print("Fixed hanging block in update_internal_task_priority")

# 4. FIX LỖI 4: Delete corrupted duplicate get_internal_task_detail at line 3858
# Tìm vị trí hàm hỏng
bad_func_start = '@app.get("/api/internal-tasks/{task_id}")\ndef get_internal_task_detail(task_id: int):'
first_idx = content.find(bad_func_start)
if first_idx != -1:
    second_idx = content.find(bad_func_start, first_idx + len(bad_func_start))
    if second_idx != -1:
        # Tìm đến cuối hàm này (trước @app.post("/api/public/requests"))
        end_idx = content.find('@app.post("/api/public/requests")', second_idx)
        if end_idx != -1:
            print(f"Removing corrupted duplicate get_internal_task_detail between index {second_idx} and {end_idx}")
            content = content[:second_idx] + content[end_idx:]

# 5. FIX LỖI 5: TaskItemID in get_internal_task_detail
# Đảm bảo câu SELECT ảnh có TaskItemID
old_select_img = "SELECT id, ImageType, FileUrl, FileName, Caption, UploadedBy, UploadedAt FROM internal_work_images WHERE TaskID = ? ORDER BY id ASC"
new_select_img = "SELECT id, TaskID, TaskItemID, ImageType, FileUrl, FileName, Caption, UploadedBy, UploadedAt FROM internal_work_images WHERE TaskID = ? ORDER BY id ASC"
if old_select_img in content:
    content = content.replace(old_select_img, new_select_img)
    print("Added TaskItemID to internal_work_images query in get_internal_task_detail")

# 6. FIX LỖI 6: Định tuyến router order:
# Route @app.get("/api/internal-tasks/{task_id}") phải nằm SAU:
# - /api/internal-tasks/recurring-items
# - /api/internal-tasks/groups
# - /api/internal-tasks/recurring-templates
# - /api/internal-tasks/employees

# Hãy bóc tách hàm get_internal_task_detail chính (ở khoảng dòng 2650)
# và di chuyển nó xuống sau các route tĩnh.
route_to_move = '''@app.get("/api/internal-tasks/{task_id}")
def get_internal_task_detail(task_id: int):'''

detail_start = content.find(route_to_move)
if detail_start != -1:
    # Tìm đoạn kết thúc của hàm này
    detail_end = content.find('\n\n@app.', detail_start + 10)
    if detail_end != -1:
        detail_func_code = content[detail_start:detail_end].strip()
        # Xóa vị trí cũ
        content = content[:detail_start] + content[detail_end:]
        # Chèn vào sau @app.patch("/api/internal-tasks/{task_id}/priority")
        prio_pos = content.find('@app.patch("/api/internal-tasks/{task_id}/priority")')
        if prio_pos != -1:
            prio_end = content.find('\n\n@app.', prio_pos + 10)
            if prio_end != -1:
                content = content[:prio_end] + "\n\n\n" + detail_func_code + content[prio_end:]
                print("Successfully relocated get_internal_task_detail AFTER static routes!")

with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Refactor finished. New line count: {len(content.splitlines())}. Compiling...")
py_compile.compile(SERVER_PATH, doraise=True)
print("SUCCESS: server.py compiled with 0 errors!")
