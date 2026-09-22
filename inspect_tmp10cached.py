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

# Cột trong zKD151_IM_tmp10Cached
c.execute("""
SELECT COLUMN_NAME, DATA_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'zKD151_IM_tmp10Cached'
""")
cols = [r['COLUMN_NAME'] for r in c.fetchall()]
p(f"zKD151_IM_tmp10Cached columns: {cols}")

c.execute("SELECT COUNT(*) as cnt FROM [zKD151_IM_tmp10Cached]")
p(f"zKD151_IM_tmp10Cached count: {c.fetchone()['cnt']}")

c.execute("SELECT TOP 5 * FROM [zKD151_IM_tmp10Cached]")
for r in c.fetchall():
    p(r)

conn.close()
