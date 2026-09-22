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

# 1. Thống kê PM_tblPurchase2D
c.execute("""
SELECT 
    COUNT(*) as total_rows,
    COUNT(DISTINCT ItemID) as distinct_items,
    SUM(Unit1Qty) as total_qty
FROM PM_tblPurchase2D p2
JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
WHERE p1.Approved = 3
""")
p1_stat = c.fetchone()
p(f"PM_tblPurchase2D (Đã duyệt): Rows = {p1_stat['total_rows']:,} | Items = {p1_stat['distinct_items']:,} | Total Qty = {float(p1_stat['total_qty'] or 0):,.2f}")

# 2. Phân bổ PM_tblPurchase2D theo kho
c.execute("""
SELECT 
    p2.WHouseID,
    COUNT(*) as rows,
    COUNT(DISTINCT p2.ItemID) as items,
    SUM(p2.Unit1Qty) as total_qty
FROM PM_tblPurchase2D p2
JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
WHERE p1.Approved = 3
GROUP BY p2.WHouseID
ORDER BY items DESC
""")
p("\nPM_tblPurchase2D theo kho:")
for r in c.fetchall():
    p(f"  + {r['WHouseID']:<8}: {r['rows']:>5} rows | {r['items']:>5} items | Qty: {float(r['total_qty'] or 0):>12,.2f}")

conn.close()
