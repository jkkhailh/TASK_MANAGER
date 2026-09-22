import os
import sys
import py_compile
import re

SERVER_PATH = "/home/khailh/MAINTENANCE_DB/server.py"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    content = f.read()

print(f"Initial length: {len(content)}")

# 1. Sửa hàm generate_next_task_code và thêm generate_next_template_code chuẩn xác
old_gen_code = '''def generate_next_task_code(c, now) -> str:
    prefix = f"IWO-{now.strftime('%y%m')}"
    c.execute("SELECT COUNT(*) FROM internal_work_orders WHERE TaskCode LIKE ?", (f"{prefix}%",))
    seq = (c.fetchone()[0] or 0) + 1
    return f"{prefix}-{seq:04d}"'''

new_gen_code = '''def generate_next_task_code(c, now) -> str:
    prefix = f"IWO-{now.strftime('%y%m')}"
    c.execute("SELECT TaskCode FROM internal_work_orders WHERE TaskCode LIKE ? ORDER BY TaskCode DESC LIMIT 100", (f"{prefix}%",))
    rows = c.fetchall()
    max_seq = 0
    for r in rows:
        code_val = r[0] if isinstance(r, (list, tuple)) else r["TaskCode"]
        try:
            num = int(code_val.split("-")[-1])
            if num > max_seq:
                max_seq = num
        except Exception:
            pass
    seq = max_seq + 1
    while True:
        candidate = f"{prefix}-{seq:04d}"
        c.execute("SELECT 1 FROM internal_work_orders WHERE TaskCode = ?", (candidate,))
        if not c.fetchone():
            return candidate
        seq += 1

def generate_next_template_code(c) -> str:
    c.execute("SELECT TemplateCode FROM internal_task_recurring_templates WHERE TemplateCode LIKE 'REC-%' ORDER BY TemplateCode DESC LIMIT 100")
    rows = c.fetchall()
    max_seq = 0
    for r in rows:
        code_val = r[0] if isinstance(r, (list, tuple)) else r["TemplateCode"]
        try:
            num = int(code_val.split("-")[-1])
            if num > max_seq:
                max_seq = num
        except Exception:
            pass
    seq = max_seq + 1
    while True:
        candidate = f"REC-{seq:04d}"
        c.execute("SELECT 1 FROM internal_task_recurring_templates WHERE TemplateCode = ?", (candidate,))
        if not c.fetchone():
            return candidate
        seq += 1'''

if old_gen_code in content:
    content = content.replace(old_gen_code, new_gen_code, 1)
    print("Replaced generate_next_task_code & added generate_next_template_code")
else:
    print("Warning: old_gen_code not found directly!")

# 2. Sửa get_order_execution_matrix để trả về machines và machine_names
old_exec_return = '''        return {
            "order": order,
            "machine_list": machine_list,
            "tasks_by_machine": tasks_by_machine,
            "machine_stats": machine_stats,
            "machine_hours": machine_hours,
            "machine_hours_details": machine_hours_details
        }'''

new_exec_return = '''        # Lấy tên hiển thị của máy (MachineText)
        machine_names = {}
        for m_id in machine_list:
            c.execute("SELECT MachineText FROM CL_tblMacList WHERE MachineID = ?", (m_id,))
            m_row = c.fetchone()
            machine_names[m_id] = m_row["MachineText"] if m_row and m_row["MachineText"] else m_id

        return {
            "order": order,
            "machines": machine_list,
            "machine_list": machine_list,
            "machine_names": machine_names,
            "tasks_by_machine": tasks_by_machine,
            "machine_stats": machine_stats,
            "machine_hours": machine_hours,
            "machine_hours_details": machine_hours_details
        }'''

if old_exec_return in content:
    content = content.replace(old_exec_return, new_exec_return, 1)
    print("Added machines and machine_names to get_order_execution_matrix return")
else:
    print("Warning: old_exec_return not found directly!")

# 3. Xóa hàm get_internal_task_detail thứ hai (dòng ~4214)
second_detail_block = '''@app.get("/api/internal-tasks/{task_id}")
def get_internal_task_detail(task_id: int):
    """Chi tiết công việc nội bộ kèm hình ảnh và danh sách hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT w.*, 
                   (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id) as total_items,
                   (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id AND Status = 'COMPLETED') as completed_items
            FROM internal_work_orders w
            WHERE w.id = ?
        """, (task_id,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
        task = dict(row)

        # Checklist items
        c.execute("""
            SELECT * FROM internal_task_items
            WHERE TaskID = ?
            ORDER BY ItemOrder ASC, id ASC
        """, (task_id,))
        task["items"] = [dict(r) for r in c.fetchall()]

        # Images
        c.execute("""
            SELECT * FROM internal_work_images
            WHERE TaskID = ?
            ORDER BY id ASC
        """, (task_id,))
        task["images"] = [dict(r) for r in c.fetchall()]

        return task
    finally:
        conn.close()'''

if second_detail_block in content:
    content = content.replace(second_detail_block, "", 1)
    print("Removed duplicate second get_internal_task_detail block")
else:
    print("Note: second_detail_block not matched exactly as string, checking regex...")
    # Regex fallback
    content = re.sub(
        r'@app\.get\("/api/internal-tasks/\{task_id\}"\)\s+def get_internal_task_detail\(task_id:\s*int\):[\s\S]*?finally:\s+conn\.close\(\)',
        '',
        content,
        count=1
    )

with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("Compiling server.py...")
py_compile.compile(SERVER_PATH, doraise=True)
print("SUCCESS: server.py compiled!")
