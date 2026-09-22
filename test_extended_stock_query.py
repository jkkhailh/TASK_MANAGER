import json
import time
import pymssql

def main():
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

    excluded = ('NB', 'DG', 'DGSX', 'TP', 'TPT', 'TPTV', 'TPXL', 'BTP', 'NVL', 'NLNL', 'NTH', 'TANK', 'LSX', 'DGC', 'PL', 'PLGRS')
    ex_str = ','.join([f"'{w}'" for w in excluded])

    # 1. Truy vấn tồn kho (kể cả tồn kho = 0)
    # Lấy tất cả vật tư từng phát sinh nhập/xuất trong các kho còn lại
    sql = f"""
    SELECT 
        e2.WHouseID,
        COALESCE(w.WHouseText, e2.WHouseID) AS WHouseText,
        e2.ItemID,
        COALESCE(c.ItemText, e2.ItemID) AS ItemText,
        COALESCE(c.Unit0ID, sf.UnitID, 'Cái') AS Unit,
        MAX(e2.StorageID) AS StorageID,
        SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS CurrentStock,
        COALESCE(sf.QtyMin, 0) AS QtyMin,
        COALESCE(sf.QtyMax, 0) AS QtyMax
    FROM IM_tblEntry2D e2
    JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
    LEFT JOIN CL_tblWHouse w ON e2.WHouseID = w.WHouseID
    LEFT JOIN CL_tblItemList c ON e2.ItemID = c.ItemID
    LEFT JOIN IM_tblSafety2 sf ON e2.ItemID = sf.ItemID
    WHERE e1.Approved = 3
      AND e2.WHouseID NOT IN ({ex_str})
    GROUP BY e2.WHouseID, w.WHouseText, e2.ItemID, c.ItemText, c.Unit0ID, sf.UnitID, sf.QtyMin, sf.QtyMax
    HAVING SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) >= 0
    ORDER BY e2.WHouseID, e2.ItemID
    """
    
    print("[*] Đang thực thi truy vấn...")
    c.execute(sql)
    rows = c.fetchall()
    duration = time.time() - start

    # Thống kê
    by_warehouse = {}
    stock_zero = 0
    stock_positive = 0
    low_stock = 0

    for r in rows:
        wh = r['WHouseID']
        by_warehouse[wh] = by_warehouse.get(wh, 0) + 1
        stk = float(r['CurrentStock'])
        qmin = float(r['QtyMin'])
        if stk == 0:
            stock_zero += 1
        else:
            stock_positive += 1
        if qmin > 0 and stk <= qmin:
            low_stock += 1

    report = {
        "duration_seconds": duration,
        "total_items": len(rows),
        "stock_positive_count": stock_positive,
        "stock_zero_count": stock_zero,
        "low_stock_count": low_stock,
        "by_warehouse": by_warehouse,
        "samples_positive": [r for r in rows if float(r['CurrentStock']) > 0][:5],
        "samples_zero": [r for r in rows if float(r['CurrentStock']) == 0][:5]
    }

    with open("extended_stock_result.json", "w", encoding="utf-8") as f:
        json.dump(report, f, default=str, ensure_ascii=False, indent=2)

    print(f"[+] Hoàn thành trong {duration:.2f}s!")
    print(f"    Tổng số mặt hàng: {len(rows):,}")
    print(f"    - Tồn kho > 0: {stock_positive:,}")
    print(f"    - Tồn kho = 0: {stock_zero:,}")
    print(f"    - Dưới định mức (Low Stock): {low_stock:,}")
    print("    Phân bổ theo kho:")
    for wh, count in sorted(by_warehouse.items()):
        print(f"      + {wh}: {count:,} mặt hàng")

    conn.close()

if __name__ == '__main__':
    main()
