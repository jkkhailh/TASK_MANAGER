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

    # 1. Danh sách kho CL_tblWHouse
    c.execute("SELECT * FROM CL_tblWHouse ORDER BY WHouseID")
    whouses = c.fetchall()

    # 2. Danh mục nhóm hàng CL_tblItemCate
    c.execute("SELECT * FROM CL_tblItemCate ORDER BY ItemCateID")
    cates = c.fetchall()

    # 3. Xem cấu trúc IM_tblEntry1G và IM_tblEntry2D
    c.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'IM_tblEntry1G'
        ORDER BY ORDINAL_POSITION
    """)
    entry1_cols = c.fetchall()

    c.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'IM_tblEntry2D'
        ORDER BY ORDINAL_POSITION
    """)
    entry2_cols = c.fetchall()

    # 4. Xem mẫu 3 dòng IM_tblEntry1G
    c.execute("SELECT TOP 3 * FROM IM_tblEntry1G ORDER BY EntryDate DESC")
    entry1_samples = c.fetchall()

    result = {
        "warehouses": whouses,
        "item_categories": cates,
        "entry1_cols": entry1_cols,
        "entry2_cols": entry2_cols,
        "entry1_samples": entry1_samples
    }

    with open("warehouses_and_cates.json", "w", encoding="utf-8") as f:
        json.dump(result, f, default=str, ensure_ascii=False, indent=2)

    print("DONE inspect warehouses and cates")
    conn.close()

if __name__ == '__main__':
    main()
