import json
import pymssql

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

# 1. Tìm các stored procedure hoặc view liên quan đến báo cáo tồn kho
print("=== TÌM KIẾM STORED PROCEDURES / VIEWS VỀ TỒN KHO ===")
c.execute("""
SELECT name, type_desc, create_date, modify_date 
FROM sys.objects 
WHERE (name LIKE '%Stock%' OR name LIKE '%Invt%' OR name LIKE '%TonKho%' OR name LIKE '%BaoCao%' OR name LIKE 'IM_%')
  AND type IN ('P', 'V', 'FN', 'IF', 'TF')
ORDER BY type, name
""")
procs = c.fetchall()
for p in procs:
    print(f"[{p['type_desc']}] {p['name']}")

# 2. Tìm kiếm trong sys.sql_modules chứa 'Chi tiết tồn kho' hoặc 'IM_tblEntry'
c.execute("""
SELECT o.name, o.type_desc
FROM sys.sql_modules m
JOIN sys.objects o ON m.object_id = o.object_id
WHERE m.definition LIKE '%Chi tiết tồn kho%' 
   OR m.definition LIKE '%IM_tblViewAvg%'
   OR m.definition LIKE '%IM_tblStock%'
""")
modules = c.fetchall()
print("\n=== MODULES LIÊN QUAN ===")
for m in modules:
    print(f"[{m['type_desc']}] {m['name']}")

# 3. Kiểm tra IM_tblViewAvg
c.execute("SELECT COUNT(*) as cnt FROM IM_tblViewAvg")
print(f"\nSố dòng trong IM_tblViewAvg: {c.fetchone()['cnt']}")

c.execute("SELECT TOP 5 * FROM IM_tblViewAvg")
print("Mẫu 1 dòng trong IM_tblViewAvg:")
print(c.fetchone())

conn.close()
