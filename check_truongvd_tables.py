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

c.execute("""
SELECT name, create_date 
FROM sys.tables 
WHERE name LIKE 'zTRUONGVD%'
ORDER BY create_date DESC
""")
tables = c.fetchall()
p(f"Found {len(tables)} tables for TRUONGVD in PM2026BOPP:")
for t in tables:
    c.execute(f"SELECT COUNT(*) as cnt FROM [{t['name']}]")
    cnt = c.fetchone()['cnt']
    p(f"  {t['name']}: {cnt} rows")

c.execute("""
SELECT name, create_date 
FROM tempdb.sys.tables 
WHERE name LIKE 'zTRUONGVD%'
ORDER BY create_date DESC
""")
tables_temp = c.fetchall()
p(f"\nFound {len(tables_temp)} tables for TRUONGVD in tempdb:")
for t in tables_temp:
    try:
        c.execute(f"SELECT COUNT(*) as cnt FROM tempdb..[{t['name']}]")
        cnt = c.fetchone()['cnt']
        p(f"  {t['name']}: {cnt} rows")
    except Exception as e:
        p(f"  {t['name']}: Error {e}")

conn.close()
