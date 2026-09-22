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

tbls = ['zKY.THUAT11_IM_tmp10Cached', 'zHUONG.NGUYEN_IM_tmp10Cached', 'zKHO.TP11_IM_tmp10Cached']

for t in tbls:
    try:
        c.execute(f"SELECT COUNT(*) as cnt, SUM(Unit1Qty) as total_qty FROM [{t}]")
        r = c.fetchone()
        p(f"[{t}]: rows = {r['cnt']:,} | total Unit1Qty = {float(r['total_qty'] or 0):,.2f}")
    except Exception as e:
        p(f"[{t}]: Error {e}")

conn.close()
