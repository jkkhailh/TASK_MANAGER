import pymssql
import json
import time

def p(msg):
    print(msg, flush=True)

start = time.time()
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

# 1. Kiểm tra 10CK02-214 và 10CK02-176 với công thức hợp nhất
test_items = ['10CK02-214', '10CK02-215', '10CK02-176', '10CK02-050', '10CK02-031']
test_str = ','.join([f"'{i}'" for i in test_items])

sql_test = f"""
WITH AllTrans AS (
    -- 1. Nhập từ mua hàng (PM_tblPurchase2D)
    SELECT 
        p2.WHouseID, p2.StorageID, p2.ItemID, p2.InvtAcctID,
        p2.Unit1Qty AS ImportQty,
        0.0 AS ExportQty
    FROM PM_tblPurchase2D p2
    JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
    WHERE p1.Approved = 3 AND p2.ItemID IN ({test_str})

    UNION ALL

    -- 2. Nhập / Xuất nội bộ (IM_tblEntry2D)
    SELECT 
        e2.WHouseID, e2.StorageID, e2.ItemID, e2.InvtAcctID,
        CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE 0.0 END AS ImportQty,
        CASE WHEN e2.IsImp = 0 THEN e2.Unit1Qty ELSE 0.0 END AS ExportQty
    FROM IM_tblEntry2D e2
    JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    WHERE e1.Approved = 3 AND e2.ItemID IN ({test_str})
)
SELECT 
    t.ItemID, t.WHouseID, t.StorageID, t.InvtAcctID,
    SUM(t.ImportQty) AS TotalImport,
    SUM(t.ExportQty) AS TotalExport,
    SUM(t.ImportQty - t.ExportQty) AS NetStock
FROM AllTrans t
GROUP BY t.ItemID, t.WHouseID, t.StorageID, t.InvtAcctID
ORDER BY t.ItemID
"""

c.execute(sql_test)
rows = c.fetchall()
p("=== KIỂM TRA MẪU CÁC MẶT HÀNG TRÊN HÌNH ERP CỦA BẠN ===")
for r in rows:
    p(f"Mã: {r['ItemID']:<12} | Kho: {r['WHouseID']} | Vị trí: {r['StorageID']} | TK: {r['InvtAcctID']} | Nhập: {r['TotalImport']} | Xuất: {r['TotalExport']} | TỒN = {r['NetStock']}")

# 2. Bây giờ tính tổng số lượng tồn kho cho toàn bộ các kho kỹ thuật
target_wh = ['DC', 'DM', 'GC', 'NL', 'PT', 'PTBS', 'TH', 'VT', 'VTNL']
target_str = ','.join([f"'{w}'" for w in target_wh])

sql_total = f"""
WITH AllTrans AS (
    -- 1. Nhập từ mua hàng (PM_tblPurchase2D)
    SELECT 
        p2.WHouseID, p2.StorageID, p2.ItemID, p2.InvtAcctID,
        p2.Unit1Qty AS ImportQty,
        0.0 AS ExportQty
    FROM PM_tblPurchase2D p2
    JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
    WHERE p1.Approved = 3 AND p2.WHouseID IN ({target_str})

    UNION ALL

    -- 2. Nhập / Xuất nội bộ (IM_tblEntry2D)
    SELECT 
        e2.WHouseID, e2.StorageID, e2.ItemID, e2.InvtAcctID,
        CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE 0.0 END AS ImportQty,
        CASE WHEN e2.IsImp = 0 THEN e2.Unit1Qty ELSE 0.0 END AS ExportQty
    FROM IM_tblEntry2D e2
    JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    WHERE e1.Approved = 3 AND e2.WHouseID IN ({target_str})
)
SELECT 
    t.WHouseID,
    COUNT(DISTINCT t.ItemID) AS total_items,
    COUNT(*) AS total_rows_grouped,
    SUM(CASE WHEN t.NetStock > 0 THEN 1 ELSE 0 END) AS positive_stock_items,
    SUM(CASE WHEN t.NetStock = 0 THEN 1 ELSE 0 END) AS zero_stock_items,
    SUM(t.NetStock) AS total_qty
FROM (
    SELECT 
        WHouseID, StorageID, ItemID, InvtAcctID,
        SUM(ImportQty - ExportQty) AS NetStock
    FROM AllTrans
    GROUP BY WHouseID, StorageID, ItemID, InvtAcctID
    HAVING SUM(ImportQty - ExportQty) >= 0
) t
GROUP BY t.WHouseID
ORDER BY total_items DESC
"""

p("\n=== TỔNG HỢP THEO KHO (KẾT HỢP PM_tblPurchase2D + IM_tblEntry2D) ===")
c.execute(sql_total)
wh_rows = c.fetchall()
grand_total_items = 0
grand_total_rows = 0
for r in wh_rows:
    grand_total_items += r['total_items']
    grand_total_rows += r['total_rows_grouped']
    p(f"Kho: {r['WHouseID']:<6} | Mặt hàng distinct: {r['total_items']:>5} | Dòng (kể cả vị trí/TK): {r['total_rows_grouped']:>5} | Tồn > 0: {r['positive_stock_items']:>5} | Tổng số lượng: {float(r['total_qty'] or 0):>10,.2f}")

p(f"\n=> TỔNG CỘNG MẶT HÀNG DISTINCT: {grand_total_items:,}")
p(f"=> TỔNG CỘNG SỐ DÒNG BÁO CÁO (GROUP BY VỊ TRÍ): {grand_total_rows:,}")
p(f"Thời gian truy vấn: {time.time() - start:.2f}s")

conn.close()
