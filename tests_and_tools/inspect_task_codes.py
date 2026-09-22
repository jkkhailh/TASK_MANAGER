import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()
c.execute("SELECT TaskCode FROM internal_work_orders WHERE TaskCode LIKE 'IWO-2609%' ORDER BY TaskCode ASC")
codes = [r[0] for r in c.fetchall()]
print("Existing codes count:", len(codes))
print("Codes list:", codes)
conn.close()
