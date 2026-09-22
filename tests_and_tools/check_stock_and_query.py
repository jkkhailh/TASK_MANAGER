import pymssql
import json

conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=30,
    login_timeout=30,
    as_dict=True
)
c = conn.cursor()

# 1. Cột trong IM_tblStock2
c.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'IM_tblStock2'")
cols_s2 = [r['COLUMN_NAME'] for r in c.fetchall()]
print("IM_tblStock2 cols:", cols_s2)

# 2. Cột trong IM_tblStock1
c.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'IM_tblStock1'")
cols_s1 = [r['COLUMN_NAME'] for r in c.fetchall()]
print("IM_tblStock1 cols:", cols_s1)

# 3. Lấy 1 bản ghi mẫu của IM_tblStock1 và IM_tblStock2
c.execute("SELECT TOP 3 * FROM IM_tblStock1 ORDER BY StockDate DESC")
print("\nIM_tblStock1 top 3:")
for r in c.fetchall():
    print(r)

c.execute("SELECT TOP 3 * FROM IM_tblStock2")
print("\nIM_tblStock2 top 3:")
for r in c.fetchall():
    print(r)

conn.close()
