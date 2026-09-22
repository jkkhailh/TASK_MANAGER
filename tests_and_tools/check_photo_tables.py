import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()

c.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%photo%' OR name LIKE '%image%')")
tables = [r[0] for r in c.fetchall()]
print("Photo/Image tables:", tables)

for t in tables:
    c.execute(f"SELECT COUNT(*) FROM {t}")
    cnt = c.fetchone()[0]
    print(f"  Table {t}: {cnt} rows")
    if cnt > 0:
        c.execute(f"PRAGMA table_info({t})")
        cols = [r[1] for r in c.fetchall()]
        c.execute(f"SELECT * FROM {t} LIMIT 1")
        print(f"    Sample: {dict(zip(cols, c.fetchone()))}")

conn.close()
