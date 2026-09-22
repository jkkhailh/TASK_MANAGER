import pymssql
import json
import time

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

# 1. Check all warehouses in CL_tblWHouse
c.execute("SELECT WHouseID, WHouseText, BranchID, IsClosed FROM CL_tblWHouse ORDER BY WHouseID")
all_wh = c.fetchall()

print("=== TẤT CẢ KHO TRONG HỆ THỐNG ===")
for w in all_wh:
    print(f"{w['WHouseID']:<8} | {w['WHouseText']:<40} | Đóng: {w['IsClosed']}")

# 2. Check total items in CL_tblItemList
c.execute("SELECT COUNT(*) AS total FROM CL_tblItemList")
print(f"\nTổng số mặt hàng trong danh mục CL_tblItemList: {c.fetchone()['total']}")

# 3. Check items in IM_tblStock2 (bảng số dư đầu kỳ hoặc bảng tổng hợp kho)
c.execute("SELECT COUNT(*) AS total, COUNT(DISTINCT ItemID) as items FROM IM_tblStock2")
s2 = c.fetchone()
print(f"Tổng bản ghi trong IM_tblStock2: {s2['total']}, Mặt hàng unique: {s2['items']}")

# 4. Check items in IM_tblStock2 by warehouse
c.execute("""
SELECT WHouseID, COUNT(DISTINCT ItemID) as items, SUM(Qty) as total_qty
FROM IM_tblStock2
GROUP BY WHouseID
ORDER BY items DESC
""")
print("\nIM_tblStock2 theo kho:")
for r in c.fetchall():
    print(f"  + {r['WHouseID']:<8}: {r['items']} items, Tổng Qty: {r['total_qty']}")

conn.close()
