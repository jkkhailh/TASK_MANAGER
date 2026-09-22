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

p("=== 10CK02-214 in IM_tblStock2 ===")
c.execute("""
SELECT s1.EntryDate, s1.WHouseID, s2.StorageID, s2.InvtAcctID, s2.Unit1Qty, s1.Memo
FROM IM_tblStock2 s2
JOIN IM_tblStock1 s1 ON s2.MRowID = s1.MRowID
WHERE s2.ItemID = '10CK02-214'
ORDER BY s1.EntryDate DESC
""")
for r in c.fetchall():
    p(r)

p("\n=== 10CK02-214 in IM_tblEntry2D ===")
c.execute("""
SELECT e1.EntryDate, e2.WHouseID, e2.StorageID, e2.InvtAcctID, e2.IsImp, e2.Unit1Qty, e1.Memo
FROM IM_tblEntry2D e2
JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
WHERE e2.ItemID = '10CK02-214'
ORDER BY e1.EntryDate DESC
""")
for r in c.fetchall():
    p(r)

conn.close()
