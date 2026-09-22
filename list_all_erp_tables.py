import json
import pymssql

def main():
    try:
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
        
        # 1. Lấy tất cả bảng có tiền tố IM_
        c.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND TABLE_NAME LIKE 'IM_%' ORDER BY TABLE_NAME")
        im_tables = [r['TABLE_NAME'] for r in c.fetchall()]
        
        # 2. Lấy các tiền tố bảng khác liên quan đến kho, vật tư, xuất nhập
        c.execute("""
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE='BASE TABLE' AND (
                TABLE_NAME LIKE 'IM_%' OR 
                TABLE_NAME LIKE 'WH_%' OR 
                TABLE_NAME LIKE 'IV_%' OR 
                TABLE_NAME LIKE 'IC_%' OR 
                TABLE_NAME LIKE 'IN_%' OR 
                TABLE_NAME LIKE 'WR_%' OR
                TABLE_NAME LIKE 'CL_%'
            )
            ORDER BY TABLE_NAME
        """)
        other_tables = [r['TABLE_NAME'] for r in c.fetchall()]

        # 3. Lấy số dòng của tất cả bảng IM_
        im_stats = {}
        for t in im_tables:
            try:
                c.execute(f"SELECT COUNT(*) AS cnt FROM [{t}]")
                im_stats[t] = c.fetchone()['cnt']
            except Exception as e:
                im_stats[t] = str(e)

        result = {
            "im_tables": im_tables,
            "im_stats": im_stats,
            "other_inventory_tables": other_tables
        }
        
        with open("erp_inventory_tables.json", "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
            
        print("SUCCESS")
        print("IM_TABLES:", im_tables)
        print("IM_STATS:", im_stats)
        conn.close()
    except Exception as e:
        print("ERROR:", e)

if __name__ == '__main__':
    main()
