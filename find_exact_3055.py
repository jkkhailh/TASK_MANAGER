import pymssql
import sys

def p(msg):
    print(msg, flush=True)

conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=10,
    login_timeout=10,
    as_dict=True
)
c = conn.cursor()
p("[*] Connected to SQL Server")

# 1. Kiểm tra cấu trúc IM_tblStock1 và IM_tblStock2
c.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'IM_tblStock2'")
cols = c.fetchall()
p(f"IM_tblStock2 columns: {[r['COLUMN_NAME'] for r in cols]}")

# 2. Thử đếm số dòng trong IM_tblStock2 theo từng điều kiện
c.execute("SELECT COUNT(*) AS cnt FROM IM_tblStock2")
p(f"IM_tblStock2 total rows: {c.fetchone()['cnt']}")

c.execute("SELECT TOP 3 * FROM IM_tblStock2")
p(f"IM_tblStock2 sample: {c.fetchall()}")

conn.close()
p("[*] Done")
