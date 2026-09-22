import pymssql

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

# 1. Tìm tất cả bảng chứa 'tmp' trong PM2026BOPP được tạo gần đây
c.execute("""
SELECT name, create_date 
FROM sys.tables 
WHERE name LIKE '%tmp%' OR name LIKE '%10Cached%' OR name LIKE '%Stock%'
ORDER BY create_date DESC
""")
tables = c.fetchall()[:25]
p("Bảng tạo gần đây trong PM2026BOPP:")
for t in tables:
    p(f"  {t['create_date']} : {t['name']}")

# 2. Tìm trong tempdb
c.execute("""
SELECT name, create_date 
FROM tempdb.sys.tables 
WHERE create_date > DATEADD(hour, -24, GETDATE())
ORDER BY create_date DESC
""")
temp_tables = c.fetchall()[:25]
p("\nBảng tạo trong tempdb 24h qua:")
for t in temp_tables:
    p(f"  {t['create_date']} : {t['name']}")

conn.close()
