import os
import sys
import sqlite3

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import get_connection

conn = get_connection()
c = conn.cursor()

c.execute("PRAGMA table_info(erp_inventory_stock)")
cols = c.fetchall()
print("Columns of erp_inventory_stock:")
for col in cols:
    print(f"  - {col[1]} ({col[2]})")

c.execute("SELECT * FROM erp_inventory_stock LIMIT 1")
row = c.fetchone()
col_names = [col[1] for col in cols]
print("\nSample row:")
print(dict(zip(col_names, row)))

conn.close()
