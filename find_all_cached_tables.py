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
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME LIKE '%IM_tmp10Cached%'
""")
tbls = [r['TABLE_NAME'] for r in c.fetchall()]
p(f"Found {len(tbls)} cached tables:")

for t in tbls:
    try:
        c.execute(f"SELECT COUNT(*) as cnt, SUM(Unit1Qty) as total_qty FROM [{t}]")
        r = c.fetchone()
        cnt = r['cnt']
        tot = float(r['total_qty'] or 0)
        p(f"  [{t}]: rows = {cnt:,} | total Qty = {tot:,.2f}")
        if cnt == 3055 or abs(tot - 133689.45) < 1:
            p(f"  ===> EXACT MATCH FOUND: [{t}] <===")
    except Exception as e:
        p(f"  [{t}]: Error {e}")

conn.close()
