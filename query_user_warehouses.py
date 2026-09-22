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

    target_wh = ['DC', 'DM', 'GC', 'NL', 'PT', 'PTBS', 'TH', 'ZZZ', 'VT', 'VTNL']
    target_str = ','.join([f"'{w}'" for w in target_wh])

    # 1. Kiểm tra sự tồn tại của các mã kho trong CL_tblWHouse
    c.execute(f"SELECT WHouseID, WHouseText FROM CL_tblWHouse WHERE WHouseID IN ({target_str})")
    wh_info = {r['WHouseID']: r['WHouseText'] for r in c.fetchall()}

    # Kiểm tra riêng xem ZZZ có xuất hiện trong IM_tblEntry2D ở cột WHouseID hay StorageID
    c.execute("SELECT COUNT(*) AS cnt FROM IM_tblEntry2D WHERE WHouseID = 'ZZZ'")
    cnt_zzz_wh = c.fetchone()['cnt']
    c.execute("SELECT COUNT(*) AS cnt FROM IM_tblEntry2D WHERE StorageID = 'ZZZ'")
    cnt_zzz_st = c.fetchone()['cnt']

    # 2. Truy vấn chi tiết tồn kho theo đúng danh sách mã kho
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
      AND e2.WHouseID IN ({target_str})
    GROUP BY e2.WHouseID, w.WHouseText, e2.ItemID, c.ItemText, c.Unit0ID, sf.UnitID, sf.QtyMin, sf.QtyMax
    HAVING SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) >= 0
    ORDER BY e2.WHouseID, e2.ItemID
    """

    print("[*] Đang thực thi truy vấn tồn kho...")
    c.execute(sql)
    rows = c.fetchall()
    duration = time.time() - start

    # 3. Phân tích thống kê
    by_warehouse = {}
    for w in target_wh:
        by_warehouse[w] = {
            "WHouseText": wh_info.get(w, "Chưa định nghĩa trong CL_tblWHouse"),
            "total_items": 0,
            "stock_positive": 0,
            "stock_zero": 0,
            "low_stock": 0
        }

    stock_zero_total = 0
    stock_positive_total = 0
    low_stock_total = 0

    for r in rows:
        wh = r['WHouseID']
        stk = float(r['CurrentStock'])
        qmin = float(r['QtyMin'])

        if wh not in by_warehouse:
            by_warehouse[wh] = {
                "WHouseText": r['WHouseText'],
                "total_items": 0,
                "stock_positive": 0,
                "stock_zero": 0,
                "low_stock": 0
            }

        by_warehouse[wh]["total_items"] += 1
        if stk == 0:
            by_warehouse[wh]["stock_zero"] += 1
            stock_zero_total += 1
        else:
            by_warehouse[wh]["stock_positive"] += 1
            stock_positive_total += 1

        if qmin > 0 and stk <= qmin:
            by_warehouse[wh]["low_stock"] += 1
            low_stock_total += 1

    report = {
        "duration_seconds": duration,
        "target_warehouses": target_wh,
        "total_items": len(rows),
        "stock_positive_total": stock_positive_total,
        "stock_zero_total": stock_zero_total,
        "low_stock_total": low_stock_total,
        "zzz_check": {
            "in_WHouseID": cnt_zzz_wh,
            "in_StorageID": cnt_zzz_st
        },
        "by_warehouse": by_warehouse,
        "samples": rows[:10]
    }

    with open("user_warehouses_result.json", "w", encoding="utf-8") as f:
        json.dump(report, f, default=str, ensure_ascii=False, indent=2)

    print(f"[+] Hoàn thành trong {duration:.2f}s!")
    print(f"    Tổng số mặt hàng tìm thấy: {len(rows):,}")
    print(f"    - Tồn kho > 0: {stock_positive_total:,}")
    print(f"    - Tồn kho = 0: {stock_zero_total:,}")
    print(f"    - Dưới định mức (Low stock): {low_stock_total:,}")
    print("\nChi tiết từng mã kho yêu cầu:")
    for wh in target_wh:
        info = by_warehouse[wh]
        print(f"  + [{wh:<5}] {info['WHouseText']:<35} : Tổng={info['total_items']:>4} | Tồn>0={info['stock_positive']:>4} | Tồn=0={info['stock_zero']:>4} | Cảnh báo={info['low_stock']:>3}")

    print(f"\nKiểm tra mã 'ZZZ':")
    print(f"  + ZZZ trong cột WHouseID (Mã kho): {cnt_zzz_wh} dòng")
    print(f"  + ZZZ trong cột StorageID (Vị trí kệ/ngăn): {cnt_zzz_st:,} dòng")

    conn.close()

if __name__ == '__main__':
    main()
