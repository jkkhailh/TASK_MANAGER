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

target_wh = ['DC', 'DM', 'GC', 'NL', 'PT', 'PTBS', 'TH', 'VT', 'VTNL', 'VPP', 'VPPBS']
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
    COALESCE(w.WHouseText, t.WHouseID) AS WHouseText,
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
LEFT JOIN CL_tblWHouse w ON t.WHouseID = w.WHouseID
GROUP BY t.WHouseID, w.WHouseText
ORDER BY total_items DESC
"""

c.execute(sql_total)
rows = c.fetchall()
duration = time.time() - start

p("=== THỐNG KÊ CHI TIẾT KHI BỔ SUNG THÊM VPP VÀ VPPBS ===")
grand_total_items = 0
grand_total_rows = 0
grand_positive = 0
grand_zero = 0
grand_qty = 0

for r in rows:
    grand_total_items += r['total_items']
    grand_total_rows += r['total_rows_grouped']
    grand_positive += r['positive_stock_items']
    grand_zero += r['zero_stock_items']
    qty = float(r['total_qty'] or 0)
    grand_qty += qty
    p(f"[{r['WHouseID']:<6}] {r['WHouseText']:<35} | Mặt hàng: {r['total_items']:>4} | Dòng: {r['total_rows_grouped']:>4} | Tồn > 0: {r['positive_stock_items']:>4} | Tồn = 0: {r['zero_stock_items']:>4} | Tổng số lượng: {qty:>10,.2f}")

p("-" * 80)
p(f"TỔNG CỘNG TẤT CẢ 11 KHO:")
p(f"  - Tổng số mặt hàng (distinct): {grand_total_items:,}")
p(f"  - Tổng số dòng theo vị trí kệ: {grand_total_rows:,}")
p(f"  - Số dòng có tồn > 0: {grand_positive:,}")
p(f"  - Số dòng tồn = 0: {grand_zero:,}")
p(f"  - Tổng số lượng tồn: {grand_qty:,.2f}")
p(f"  - Thời gian thực thi: {duration:.2f}s")

# Lấy mẫu 5 mặt hàng VPP
c.execute("""
WITH AllTrans AS (
    SELECT p2.WHouseID, p2.StorageID, p2.ItemID, p2.InvtAcctID, p2.Unit1Qty AS ImportQty, 0.0 AS ExportQty
    FROM PM_tblPurchase2D p2 JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
    WHERE p1.Approved = 3 AND p2.WHouseID IN ('VPP', 'VPPBS')
    UNION ALL
    SELECT e2.WHouseID, e2.StorageID, e2.ItemID, e2.InvtAcctID,
           CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE 0.0 END,
           CASE WHEN e2.IsImp = 0 THEN e2.Unit1Qty ELSE 0.0 END
    FROM IM_tblEntry2D e2 JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    WHERE e1.Approved = 3 AND e2.WHouseID IN ('VPP', 'VPPBS')
)
SELECT TOP 5 t.ItemID, c.ItemText, t.WHouseID, t.StorageID, t.InvtAcctID,
       SUM(t.ImportQty - t.ExportQty) as CurrentStock,
       c.Unit0ID
FROM AllTrans t
LEFT JOIN CL_tblItemList c ON t.ItemID = c.ItemID
GROUP BY t.ItemID, c.ItemText, t.WHouseID, t.StorageID, t.InvtAcctID, c.Unit0ID
HAVING SUM(t.ImportQty - t.ExportQty) > 0
ORDER BY CurrentStock DESC
""")
samples_vpp = c.fetchall()
p("\n=== MẪU 5 MẶT HÀNG KHO VĂN PHÒNG PHẨM ===")
for s in samples_vpp:
    p(f"  + {s['ItemID']:<14} | {s['ItemText']:<35} | Kho: {s['WHouseID']} | Tồn: {float(s['CurrentStock']):>8,.2f} {s['Unit0ID']}")

conn.close()
