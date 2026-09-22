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

# 1. Tìm 10CK02-214 trong IM_tblEntry2D
c.execute("""
SELECT 
    e2.WHouseID, e2.StorageID, e2.InvtAcctID, e2.IsImp, e2.Unit1Qty, e1.EntryDate, e1.Approved
FROM IM_tblEntry2D e2
JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
WHERE e2.ItemID = '10CK02-214'
ORDER BY e1.EntryDate
""")
rows_entry = c.fetchall()
p(f"10CK02-214 in IM_tblEntry2D: {len(rows_entry)} transactions")
for r in rows_entry:
    p(f"  WHouse: {r['WHouseID']}, Storage: {r['StorageID']}, Acct: {r['InvtAcctID']}, IsImp: {r['IsImp']}, Qty: {r['Unit1Qty']}, Date: {r['EntryDate']}, Appr: {r['Approved']}")

# Net in IM_tblEntry2D
c.execute("""
SELECT 
    e2.WHouseID, e2.StorageID, e2.InvtAcctID,
    SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS NetStock
FROM IM_tblEntry2D e2
JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
WHERE e2.ItemID = '10CK02-214' AND e1.Approved = 3
GROUP BY e2.WHouseID, e2.StorageID, e2.InvtAcctID
""")
p(f"NetStock in IM_tblEntry2D for 10CK02-214: {c.fetchall()}")

# 2. Tìm 10CK02-214 trong IM_tblStock2
c.execute("""
SELECT s1.EntryDate, s1.WHouseID, s2.StorageID, s2.InvtAcctID, s2.Unit1Qty
FROM IM_tblStock2 s2
JOIN IM_tblStock1 s1 ON s2.MRowID = s1.MRowID
WHERE s2.ItemID = '10CK02-214'
ORDER BY s1.EntryDate DESC
""")
rows_stock = c.fetchall()
p(f"\n10CK02-214 in IM_tblStock2: {len(rows_stock)} records")
for r in rows_stock:
    p(f"  StockDate: {r['EntryDate']}, WHouse: {r['WHouseID']}, Storage: {r['StorageID']}, Acct: {r['InvtAcctID']}, Qty: {r['Unit1Qty']}")

# 3. Tìm trong IM_tblViewAvg
c.execute("""
SELECT * FROM IM_tblViewAvg WHERE ItemID = '10CK02-214'
""")
p(f"\n10CK02-214 in IM_tblViewAvg: {c.fetchall()}")

conn.close()
