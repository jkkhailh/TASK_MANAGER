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
        timeout=25,
        login_timeout=25,
        as_dict=True
    )
    c = conn.cursor()

    target_whouses = ('VT', 'DM', 'DC', 'DCPX', 'PT', 'PTBS', 'PTXL', 'VPP', 'VPPBS')
    placeholders = ','.join([f"'{w}'" for w in target_whouses])

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
      AND e2.WHouseID IN ({placeholders})
    GROUP BY e2.WHouseID, w.WHouseText, e2.ItemID, c.ItemText, c.Unit0ID, sf.UnitID, sf.QtyMin, sf.QtyMax
    HAVING SUM(CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE -e2.Unit1Qty END) > 0
    ORDER BY e2.WHouseID, e2.ItemID
    """
    c.execute(sql)
    rows = c.fetchall()
    duration = time.time() - start

    summary = {
        "duration_seconds": duration,
        "total_active_stock_items": len(rows),
        "by_warehouse": {},
        "low_stock_count": 0,
        "samples": rows[:10]
    }

    for r in rows:
        wh = r['WHouseID']
        summary["by_warehouse"][wh] = summary["by_warehouse"].get(wh, 0) + 1
        stock = float(r['CurrentStock'])
        min_stock = float(r['QtyMin'])
        if min_stock > 0 and stock <= min_stock:
            summary["low_stock_count"] += 1

    with open("stock_summary_test.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, default=str, ensure_ascii=False, indent=2)

    print(f"DONE in {duration:.2f}s, found {len(rows)} items with positive stock.")
    print("Warehouse breakdown:", summary["by_warehouse"])
    print(f"Low stock items (<= Min): {summary['low_stock_count']}")
    conn.close()

if __name__ == '__main__':
    main()
