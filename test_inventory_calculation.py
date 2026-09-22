import json
import pymssql

def main():
    conn = pymssql.connect(
        server='123.25.239.13',
        port=669,
        user='Junsix_AppUser',
        password='BOPP!@#234521',
        database='PM2026BOPP',
        timeout=15,
        login_timeout=15,
        as_dict=True
    )
    c = conn.cursor()

    # 1. Kiểm tra danh sách các kho kỹ thuật & văn phòng
    target_whouses = ('VT', 'DM', 'DC', 'DCPX', 'PT', 'PTBS', 'PTXL', 'VPP', 'VPPBS')
    placeholders = ','.join([f"'{w}'" for w in target_whouses])

    # 2. Lấy số dư tồn kho từ IM_tblStock2 của kỳ kiểm kê mới nhất
    c.execute(f"""
        SELECT TOP 5 s1.EntryID, s1.EntryDate, s1.WHouseID, s2.ItemID, s2.StorageID, s2.Unit1Qty
        FROM IM_tblStock2 s2
        JOIN IM_tblStock1 s1 ON s2.MRowID = s1.MRowID
        WHERE s1.WHouseID IN ({placeholders})
        ORDER BY s1.EntryDate DESC
    """)
    latest_stock_samples = c.fetchall()

    # 3. Xem tổng hợp phát sinh từ IM_tblEntry2D
    c.execute(f"""
        SELECT TOP 5 e1.EntryDate, e2.WHouseID, e2.ItemID, e2.IsImp, e2.Unit1Qty, e2.StorageID, e2.MachineID
        FROM IM_tblEntry2D e2
        JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
        WHERE e2.WHouseID IN ({placeholders})
        ORDER BY e1.EntryDate DESC
    """)
    latest_entries = c.fetchall()

    # 4. Kiểm tra 1 mã vật tư cụ thể: ví dụ dầu '04XD07-006' hoặc '04XD07-008'
    sample_item = '04XD07-006'
    c.execute(f"""
        SELECT 
            SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE 0 END) AS TotalImport,
            SUM(CASE WHEN e2.IsImp = 0 THEN e2.Unit1Qty ELSE 0 END) AS TotalExport,
            SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) AS NetStock
        FROM IM_tblEntry2D e2
        JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
        WHERE e2.ItemID = '{sample_item}' AND e1.Approved = 3
    """)
    item_calc = c.fetchone()

    # 5. Kiểm tra mã vật tư này trong IM_tblViewAvg kỳ gần nhất
    c.execute(f"""
        SELECT TOP 3 PeriodID, ItemID, Unit1Qty, Unit1Cost, CostAmt
        FROM IM_tblViewAvg
        WHERE ItemID = '{sample_item}'
        ORDER BY PeriodID DESC
    """)
    avg_samples = c.fetchall()

    result = {
        "latest_stock_samples": latest_stock_samples,
        "latest_entries": latest_entries,
        "item_calc_sample_04XD07_006": item_calc,
        "avg_samples": avg_samples
    }

    with open("calc_test_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, default=str, ensure_ascii=False, indent=2)

    print("DONE testing calculation")
    conn.close()

if __name__ == '__main__':
    main()
