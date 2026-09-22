import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()
c.execute("PRAGMA table_info(internal_task_items)")
cols = [r[1] for r in c.fetchall()]
print("Columns in internal_task_items:", cols)
print("HasIssue in cols?", "HasIssue" in cols)

if "HasIssue" not in cols:
    print("Adding HasIssue column to internal_task_items...")
    c.execute("ALTER TABLE internal_task_items ADD COLUMN HasIssue INTEGER DEFAULT 0")
    conn.commit()
    print("Added HasIssue successfully.")
else:
    c.execute("SELECT id, ItemTitle, HasIssue FROM internal_task_items WHERE HasIssue = 1 LIMIT 5")
    rows = c.fetchall()
    print("Rows with HasIssue=1:", [dict(r) for r in rows])

conn.close()
