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

target_wh = ['DC', 'DM', 'GC', 'NL', 'PT', 'PTBS', 'TH', 'VT', 'VTNL']
target_str = ','.join([f"'{w}'" for w in target_wh])

c.execute(f"""
SELECT COUNT(*) as cnt, COUNT(DISTINCT ItemID) as items, SUM(Unit1Qty) as qty
FROM SM_tblSelling2D s2
JOIN SM_tblSelling1G s1 ON s2.MRowID = s1.MRowID
WHERE s1.Approved = 3 AND s2.WHouseID IN ({target_str})
""")
r = c.fetchone()
p(f"SM_tblSelling2D (Bán ra từ các kho kỹ thuật): {r['cnt']} rows | {r['items']} items | Qty: {r['qty']}")

conn.close()
