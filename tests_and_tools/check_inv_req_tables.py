import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()

for t in ["warehouse_issue_requests", "warehouse_issue_items"]:
    c.execute(f"PRAGMA table_info({t})")
    cols = [r[1] for r in c.fetchall()]
    print(f"Table {t} columns: {cols}")
    c.execute(f"SELECT * FROM {t} LIMIT 1")
    row = c.fetchone()
    if row:
        print(f"  Sample row: {dict(zip(cols, row))}")

conn.close()
