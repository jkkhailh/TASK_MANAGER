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

c.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'IM_tblStock1'")
p(f"IM_tblStock1 columns: {[r['COLUMN_NAME'] for r in c.fetchall()]}")

c.execute("SELECT COUNT(*) as cnt FROM IM_tblStock1")
p(f"IM_tblStock1 row count: {c.fetchone()['cnt']}")

c.execute("SELECT TOP 10 * FROM IM_tblStock1 ORDER BY MRowID DESC")
for r in c.fetchall():
    p(r)

conn.close()
