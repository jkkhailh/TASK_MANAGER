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

tbls = [
    'zHUONG.NGUYEN_IM_tmp10Cached',
    'zKD141_IM_tmp10Cached',
    'zKD151_IM_tmp10Cached',
    'zKHO.TP11_IM_tmp10Cached',
    'zKY.THUAT11_IM_tmp10Cached',
    'zSX071_IM_tmp10Cached'
]

for t in tbls:
    c.execute(f"SELECT * FROM [{t}] WHERE ItemID = '10CK02-214'")
    rows = c.fetchall()
    if rows:
        p(f"\nMatch in [{t}]:")
        for r in rows:
            p(f"  WHouse: {r['WHouseID']}, Storage: {r['StorageID']}, Acct: {r['InvtAcctID']}, Qty: {r['Unit1Qty']}")

conn.close()
