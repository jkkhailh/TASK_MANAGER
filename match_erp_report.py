import pymssql

conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=30,
    login_timeout=30,
    as_dict=True
)
c = conn.cursor()

# 1. Thử tính tổng số lượng tồn kho theo từng kho từ IM_tblEntry2D
print("=== TỔNG SỐ LƯỢNG TỒN THEO KHO TỪ IM_tblEntry2D ===")
sql_wh = """
SELECT 
    e2.WHouseID,
    COALESCE(w.WHouseText, e2.WHouseID) AS WHouseText,
    COUNT(*) AS total_trans,
    COUNT(DISTINCT e2.ItemID) AS distinct_items,
    SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS NetStock
FROM IM_tblEntry2D e2
JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
LEFT JOIN CL_tblWHouse w ON e2.WHouseID = w.WHouseID
WHERE e1.Approved = 3
GROUP BY e2.WHouseID, w.WHouseText
ORDER BY NetStock DESC
"""
c.execute(sql_wh)
rows = c.fetchall()
total_stock_all = 0
for r in rows:
    net = float(r['NetStock'] or 0)
    total_stock_all += net
    print(f"{r['WHouseID']:<8} | {r['WHouseText']:<35} | Items: {r['distinct_items']:<5} | NetStock: {net:>14,.2f}")

print(f"\n-> TỔNG TỒN KHO TẤT CẢ CÁC KHO: {total_stock_all:,.2f}")

# 2. Thử nhóm theo (WHouseID, StorageID, ItemID, InvtAcctID) hoặc (WHouseID, ItemID) xem số dòng là bao nhiêu
print("\n=== KIỂM TRA SỐ DÒNG (ROWS) VỚI CÁC CẤP GROUP BY ===")

# Group by ItemID, WHouseID, StorageID
c.execute("""
SELECT 
    COUNT(*) as row_count,
    SUM(NetStock) as total_qty
FROM (
    SELECT 
        e2.WHouseID, e2.StorageID, e2.ItemID,
        SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS NetStock
    FROM IM_tblEntry2D e2
    JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    WHERE e1.Approved = 3
    GROUP BY e2.WHouseID, e2.StorageID, e2.ItemID
    HAVING SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) > 0
) t
""")
res1 = c.fetchone()
print(f"Group by (WHouseID, StorageID, ItemID) có tồn > 0: Rows = {res1['row_count']:,} | Total Qty = {float(res1['total_qty'] or 0):,.2f}")

# Group by ItemID, WHouseID, StorageID, InvtAcctID
c.execute("""
SELECT 
    COUNT(*) as row_count,
    SUM(NetStock) as total_qty
FROM (
    SELECT 
        e2.WHouseID, e2.StorageID, e2.ItemID, e2.InvtAcctID,
        SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS NetStock
    FROM IM_tblEntry2D e2
    JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    WHERE e1.Approved = 3
    GROUP BY e2.WHouseID, e2.StorageID, e2.ItemID, e2.InvtAcctID
    HAVING SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) > 0
) t
""")
res2 = c.fetchone()
print(f"Group by (WHouseID, StorageID, ItemID, InvtAcctID) có tồn > 0: Rows = {res2['row_count']:,} | Total Qty = {float(res2['total_qty'] or 0):,.2f}")

# Kiểm tra IM_tblStock2 (bảng tổng hợp tồn kho nếu có)
c.execute("""
SELECT COUNT(*) as row_count, SUM(Qty) as total_qty 
FROM IM_tblStock2 WHERE Qty > 0
""")
res3 = c.fetchone()
print(f"IM_tblStock2 (Qty > 0): Rows = {res3['row_count']:,} | Total Qty = {float(res3['total_qty'] or 0):,.2f}")

conn.close()
