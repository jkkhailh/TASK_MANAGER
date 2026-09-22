try:
    import pymssql
    PYMSSQL_AVAILABLE = True
except ImportError:
    pymssql = None
    PYMSSQL_AVAILABLE = False

try:
    import pyodbc
    PYODBC_AVAILABLE = True
except (ImportError, Exception):
    pyodbc = None
    PYODBC_AVAILABLE = False

import sqlite3
import time
import sys
from datetime import datetime, timedelta
from database import get_connection, init_sqlite_db

sys.stdout.reconfigure(encoding='utf-8')

# Cấu hình kết nối SQL Server
SQL_SERVER_HOST = '123.25.239.13'
SQL_SERVER_PORT = 669
SQL_SERVER_DB = 'PM2026BOPP'
SQL_SERVER_USER = 'Junsix_AppUser'
SQL_SERVER_PASS = 'BOPP!@#234521'

SQL_SERVER_CONN_STR = (
    'DRIVER={ODBC Driver 18 for SQL Server};'
    f'SERVER={SQL_SERVER_HOST},{SQL_SERVER_PORT};'
    f'DATABASE={SQL_SERVER_DB};'
    f'UID={SQL_SERVER_USER};'
    f'PWD={SQL_SERVER_PASS};'
    'TrustServerCertificate=yes;'
    'Encrypt=optional;'
)

def get_sql_server_connection():
    """Ưu tiên pymssql (chuẩn trên Ubuntu/Linux không cần ODBC driver), dự phòng pyodbc"""
    if PYMSSQL_AVAILABLE:
        conn = pymssql.connect(
            server=SQL_SERVER_HOST,
            port=SQL_SERVER_PORT,
            user=SQL_SERVER_USER,
            password=SQL_SERVER_PASS,
            database=SQL_SERVER_DB,
            timeout=15,
            login_timeout=15
        )
        return conn, 'pymssql'
    elif PYODBC_AVAILABLE:
        conn = pyodbc.connect(SQL_SERVER_CONN_STR, timeout=15)
        return conn, 'pyodbc'
    else:
        raise RuntimeError("Chưa cài đặt thư viện kết nối SQL Server (pymssql hoặc pyodbc). Hãy cài đặt 'pip install pymssql'.")

def execute_sql(cursor, conn_type, query, params=None):
    """Thực thi câu truy vấn hỗ trợ placeholder ? (pyodbc) hoặc %s (pymssql)"""
    if params:
        if conn_type == 'pymssql':
            query = query.replace('?', '%s')
            cursor.execute(query, tuple(params))
        else:
            cursor.execute(query, tuple(params))
    else:
        cursor.execute(query)

def sync_catalogs(sql_conn, sqlite_conn):
    """Đồng bộ các danh mục tham chiếu: Hạng mục (EM_tblWork1), Chi tiết công việc (EM_tblWork2), Vật tư (CL_tblItemList), Dịch vụ, Cụm máy"""
    sql_cur = sql_conn.cursor()
    lite_cur = sqlite_conn.cursor()

    # 1. EM_tblWork1 (161 hạng mục lớn)
    sql_cur.execute("""
        SELECT WorkID, WorkText, ModelID, CycleDay, CycleHour, AlertBef, WorkType, Symbol, IsLocked, IsClosed, CreatorID, CreatedDate
        FROM EM_tblWork1
    """)
    rows = sql_cur.fetchall()
    lite_cur.executemany("""
        INSERT OR REPLACE INTO EM_tblWork1 
        (WorkID, WorkText, ModelID, CycleDay, CycleHour, AlertBef, WorkType, Symbol, IsLocked, IsClosed, CreatorID, CreatedDate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], int(r[8]) if r[8] is not None else 0, int(r[9]) if r[9] is not None else 0, r[10], str(r[11]) if r[11] else None) for r in rows])

    # 2. EM_tblService
    sql_cur.execute("SELECT ServiceID, ServiceText, IsLocked, IsClosed, CreatorID, CreatedDate FROM EM_tblService")
    rows = sql_cur.fetchall()
    lite_cur.executemany("""
        INSERT OR REPLACE INTO EM_tblService
        (ServiceID, ServiceText, IsLocked, IsClosed, CreatorID, CreatedDate)
        VALUES (?, ?, ?, ?, ?, ?)
    """, [(r[0], r[1], int(r[2]) if r[2] is not None else 0, int(r[3]) if r[3] is not None else 0, r[4], str(r[5]) if r[5] else None) for r in rows])

    # 3. EM_tblNode
    sql_cur.execute("SELECT NodeID, NodeText, ParentID, ModelID, iOrder, IsParent, IsLocked, IsClosed, CreatorID, CreatedDate FROM EM_tblNode")
    rows = sql_cur.fetchall()
    lite_cur.executemany("""
        INSERT OR REPLACE INTO EM_tblNode
        (NodeID, NodeText, ParentID, ModelID, iOrder, IsParent, IsLocked, IsClosed, CreatorID, CreatedDate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [(r[0], r[1], r[2], r[3], r[4], int(r[5]) if r[5] is not None else 0, int(r[6]) if r[6] is not None else 0, int(r[7]) if r[7] is not None else 0, r[8], str(r[9]) if r[9] else None) for r in rows])

    # 4. EM_tblWork2 (1,053 chi tiết công việc chuẩn)
    sql_cur.execute("""
        SELECT RowID, WorkID, NodeID, ServiceID, StaffQty, Duration, ItemID, WHouseID, Unit1Qty, Remark, iRow
        FROM EM_tblWork2
    """)
    w2_rows = sql_cur.fetchall()
    lite_cur.executemany("""
        INSERT OR REPLACE INTO EM_tblWork2
        (RowID, WorkID, NodeID, ServiceID, StaffQty, Duration, ItemID, WHouseID, Unit1Qty, Remark, iRow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [(
        r[0], r[1], r[2], r[3],
        int(r[4]) if r[4] is not None else 0,
        float(r[5]) if r[5] is not None else 0.0,
        r[6], r[7],
        float(r[8]) if r[8] is not None else 0.0,
        r[9],
        int(r[10]) if r[10] is not None else 0
    ) for r in w2_rows])

    # 5. CL_tblItemList (Vật tư phụ tùng tham chiếu trong công việc chuẩn)
    item_ids = list(set([r[6] for r in w2_rows if r[6] and r[6].strip()]))
    if item_ids:
        batch_size = 100
        for i in range(0, len(item_ids), batch_size):
            batch = item_ids[i:i + batch_size]
            placeholders = ','.join(['%s'] * len(batch))
            sql_cur.execute(f"""
                SELECT ItemID, ItemText, Unit0ID
                FROM CL_tblItemList
                WHERE ItemID IN ({placeholders})
            """, tuple(batch))
            item_rows = sql_cur.fetchall()
            if item_rows:
                lite_cur.executemany("""
                    INSERT OR REPLACE INTO CL_tblItemList (ItemID, ItemText, Unit0ID)
                    VALUES (?, ?, ?)
                """, [(r[0], r[1], r[2]) for r in item_rows])

    # 6. CL_tblMacList (Danh mục thiết bị / máy móc)
    try:
        sql_cur.execute("""
            SELECT MachineID, MachineText, MacCateID, MacLineID, DepartID, ModelID, IsLocked, IsClosed
            FROM CL_tblMacList
        """)
        mac_rows = sql_cur.fetchall()
        if mac_rows:
            lite_cur.executemany("""
                INSERT OR REPLACE INTO CL_tblMacList 
                (MachineID, MachineText, MacCateID, MacLineID, DepartID, ModelID, IsLocked, IsClosed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [(r[0], r[1], r[2], r[3], r[4], r[5], int(r[6]) if r[6] is not None else 0, int(r[7]) if r[7] is not None else 0) for r in mac_rows])
    except Exception as e:
        print(f"[!] Bỏ qua đồng bộ CL_tblMacList: {e}")

    # 7. CL_tblDepartment (Danh mục phòng ban / bộ phận)
    try:
        sql_cur.execute("""
            SELECT ObjectID, ObjectText, IsTeam, IsClosed
            FROM CL_tblObject
            WHERE IsTeam = 1 OR ObjectID LIKE '4BP%'
        """)
        dept_rows = sql_cur.fetchall()
        if dept_rows:
            lite_cur.executemany("""
                INSERT OR REPLACE INTO CL_tblDepartment
                (DepartID, DepartName, IsTeam, IsClosed)
                VALUES (?, ?, ?, ?)
            """, [(r[0], r[1], int(r[2]) if r[2] is not None else 0, int(r[3]) if r[3] is not None else 0) for r in dept_rows])
    except Exception as e:
        print(f"[!] Bỏ qua đồng bộ CL_tblDepartment: {e}")

    # 8. Đồng bộ / Khởi tạo mẫu chuẩn SOP vào maintenance_task_templates
    from database import seed_task_templates
    seed_task_templates(lite_cur)

    sqlite_conn.commit()

def sync_work_templates():
    """Đồng bộ toàn bộ 161 danh mục và 1,053 chi tiết công việc chuẩn để làm mẫu SOP"""
    start_time = time.time()
    init_sqlite_db()
    sql_conn, conn_type = get_sql_server_connection()
    sqlite_conn = get_connection()
    try:
        sync_catalogs(sql_conn, sqlite_conn)
        
        c = sqlite_conn.cursor()
        c.execute("SELECT COUNT(*) FROM EM_tblWork1")
        total_works = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM EM_tblWork2")
        total_tasks = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM maintenance_task_templates")
        total_templates = c.fetchone()[0]
        
        duration = round(time.time() - start_time, 2)
        msg = f"Đồng bộ thành công {total_works} danh mục bảo dưỡng và {total_tasks} hạng mục chi tiết làm mẫu ({duration}s)."
        return {
            "status": "success",
            "total_works": total_works,
            "total_tasks": total_tasks,
            "total_templates": total_templates,
            "duration": duration,
            "message": msg
        }
    finally:
        sql_conn.close()
        sqlite_conn.close()


def sync_data_internal(orders_query, params=(), days_requested=None):
    """Hàm nội bộ để kéo lệnh và các bảng liên quan vào SQLite"""
    start_time = time.time()
    init_sqlite_db()
    
    sql_conn, conn_type = get_sql_server_connection()
    sqlite_conn = get_connection()
    sql_cur = sql_conn.cursor()
    lite_cur = sqlite_conn.cursor()

    try:
        # Đồng bộ danh mục trước
        sync_catalogs(sql_conn, sqlite_conn)

        # 1. Kéo Lệnh bảo dưỡng (EM_tblOrder1)
        execute_sql(sql_cur, conn_type, orders_query, params)
        order_rows = sql_cur.fetchall()
        if not order_rows:
            duration = round(time.time() - start_time, 2)
            msg = "Không có lệnh bảo dưỡng nào cần đồng bộ trong khoảng thời gian này."
            lite_cur.execute("""
                INSERT INTO sync_history (sync_time, days_requested, orders_synced, items_synced, machines_synced, status, message, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), days_requested, 0, 0, 0, 'SUCCESS', msg, duration))
            sqlite_conn.commit()
            return {
                'status': 'success',
                'orders_synced': 0,
                'items_synced': 0,
                'machines_synced': 0,
                'message': msg,
                'duration': duration,
                'sync_time': datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            }

        mrow_ids = [r[0] for r in order_rows]

        lite_cur.executemany("""
            INSERT OR REPLACE INTO EM_tblOrder1
            (MRowID, EntryID, EntryDate, WorkID, ModelID, DepartID, BranchID, PeriodID, Memo, Stoptime, Approved, Closed, Colored, ProcER, CreatorID, CreatedDate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [(
            r[0], r[1], str(r[2]) if r[2] else None, r[3], r[4], r[5], r[6], r[7],
            r[8], float(r[9]) if r[9] is not None else 0.0,
            int(r[10]) if r[10] is not None else 0, int(r[11]) if r[11] is not None else 0,
            int(r[12]) if r[12] is not None else 0, float(r[13]) if r[13] is not None else 0.0,
            r[14], str(r[15]) if r[15] else None
        ) for r in order_rows])

        # Phân trang theo từng batch mrow_ids (tối đa 300 ID mỗi đợt) để truy vấn bảng con
        total_items = 0
        total_machines = 0
        total_results = 0
        batch_size = 300

        placeholder_char = '%s' if conn_type == 'pymssql' else '?'

        for i in range(0, len(mrow_ids), batch_size):
            batch = mrow_ids[i:i + batch_size]
            placeholders = ','.join([placeholder_char] * len(batch))

            # 2. Chi tiết hạng mục công việc & vật tư (EM_tblOrder2)
            sql_cur.execute(f"""
                SELECT DRowID, MRowID, NodeID, ServiceID, StaffQty, Duration, ItemID, WHouseID, Unit1Qty, Remark, iRow
                FROM EM_tblOrder2
                WHERE MRowID IN ({placeholders})
            """, tuple(batch))
            order2_rows = sql_cur.fetchall()
            if order2_rows:
                lite_cur.executemany("""
                    INSERT OR REPLACE INTO EM_tblOrder2
                    (DRowID, MRowID, NodeID, ServiceID, StaffQty, Duration, ItemID, WHouseID, Unit1Qty, Remark, iRow)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [(
                    r[0], r[1], r[2], r[3],
                    int(r[4]) if r[4] is not None else 0,
                    float(r[5]) if r[5] is not None else 0.0,
                    r[6], r[7],
                    float(r[8]) if r[8] is not None else 0.0,
                    r[9], int(r[10]) if r[10] is not None else 0
                ) for r in order2_rows])
                total_items += len(order2_rows)

            # 3. Phân công Máy & Nhân sự (EM_tblOrder3)
            sql_cur.execute(f"""
                SELECT DRowID, MRowID, MachineID, WorkDate, Emp1ID, Emp2ID, Emp3ID, Emp4ID, Emp5ID, Remark, EMdRowID
                FROM EM_tblOrder3
                WHERE MRowID IN ({placeholders})
            """, tuple(batch))
            order3_rows = sql_cur.fetchall()
            if order3_rows:
                lite_cur.executemany("""
                    INSERT OR REPLACE INTO EM_tblOrder3
                    (DRowID, MRowID, MachineID, WorkDate, Emp1ID, Emp2ID, Emp3ID, Emp4ID, Emp5ID, Remark, EMdRowID)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [(
                    r[0], r[1], r[2], str(r[3]) if r[3] else None,
                    r[4], r[5], r[6], r[7], r[8], r[9], r[10]
                ) for r in order3_rows])
                total_machines += len(order3_rows)

            # 4. Nghiệm thu kết quả (EM_tblResult1) đối chiếu qua EOmRowID
            sql_cur.execute(f"""
                SELECT MRowID, EntryID, EntryDate, MachineID, WorkID, DepartID, BranchID, PeriodID, Memo, Stoptime, HourOdo,
                       RevEmpID, RevName, RevText, RevCode, EOdRowID, EOmRowID, Approved, Closed, CreatorID, CreatedDate
                FROM EM_tblResult1
                WHERE EOmRowID IN ({placeholders})
            """, tuple(batch))
            result1_rows = sql_cur.fetchall()
            if result1_rows:
                lite_cur.executemany("""
                    INSERT OR REPLACE INTO EM_tblResult1
                    (MRowID, EntryID, EntryDate, MachineID, WorkID, DepartID, BranchID, PeriodID, Memo, Stoptime, HourOdo,
                     RevEmpID, RevName, RevText, RevCode, EOdRowID, EOmRowID, Approved, Closed, CreatorID, CreatedDate)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [(
                    r[0], r[1], str(r[2]) if r[2] else None, r[3], r[4], r[5], r[6], r[7], r[8],
                    float(r[9]) if r[9] is not None else 0.0,
                    float(r[10]) if r[10] is not None else 0.0,
                    r[11], r[12], r[13], r[14], r[15], r[16],
                    int(r[17]) if r[17] is not None else 0,
                    int(r[18]) if r[18] is not None else 0,
                    r[19], str(r[20]) if r[20] else None
                ) for r in result1_rows])
                total_results += len(result1_rows)

        duration = round(time.time() - start_time, 2)
        msg = f"Đã đồng bộ {len(order_rows)} lệnh, {total_machines} lượt phân công máy, {total_items} hạng mục/vật tư, {total_results} phiếu nghiệm thu."
        
        lite_cur.execute("""
            INSERT INTO sync_history (sync_time, days_requested, orders_synced, items_synced, machines_synced, status, message, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), days_requested, len(order_rows), total_items, total_machines, 'SUCCESS', msg, duration))

        sqlite_conn.commit()

        return {
            'status': 'success',
            'orders_synced': len(order_rows),
            'items_synced': total_items,
            'machines_synced': total_machines,
            'results_synced': total_results,
            'duration': duration,
            'message': msg,
            'sync_time': datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        }

    except Exception as e:
        duration = round(time.time() - start_time, 2)
        err_msg = str(e)
        lite_cur.execute("""
            INSERT INTO sync_history (sync_time, days_requested, orders_synced, items_synced, machines_synced, status, message, duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), days_requested, 0, 0, 0, 'ERROR', err_msg, duration))
        sqlite_conn.commit()
        raise e
    finally:
        sql_conn.close()
        sqlite_conn.close()

def seed_initial_data(limit=1000):
    """Kéo 1,000 lệnh mới nhất ban đầu về SQLite"""
    print(f"Bắt đầu kéo dữ liệu ban đầu ({limit} lệnh mới nhất)...")
    query = f"""
        SELECT TOP {limit}
            MRowID, EntryID, EntryDate, WorkID, ModelID, DepartID, BranchID, PeriodID, Memo, Stoptime,
            Approved, Closed, Colored, ProcER, CreatorID, CreatedDate
        FROM EM_tblOrder1
        ORDER BY EntryDate DESC, CreatedDate DESC
    """
    return sync_data_internal(query, days_requested=0)

def sync_recent_data(days=7):
    """Kéo dữ liệu mới nhất theo số ngày (mặc định 7 ngày tính từ ngày mới nhất trong DB)"""
    print(f"Bắt đầu đồng bộ dữ liệu trong {days} ngày gần nhất...")
    # Lấy ngày mốc từ max EntryDate trong SQL Server hoặc GETDATE()
    sql_conn, _ = get_sql_server_connection()
    sql_cur = sql_conn.cursor()
    sql_cur.execute("SELECT MAX(EntryDate) FROM EM_tblOrder1")
    max_date = sql_cur.fetchone()[0]
    sql_conn.close()

    if max_date:
        cutoff_date = max_date - timedelta(days=int(days))
    else:
        cutoff_date = datetime.now().date() - timedelta(days=int(days))

    cutoff_str = cutoff_date.strftime("%Y-%m-%d")
    print(f"Mốc thời gian quét: từ {cutoff_str} trở đi")

    query = """
        SELECT MRowID, EntryID, EntryDate, WorkID, ModelID, DepartID, BranchID, PeriodID, Memo, Stoptime,
               Approved, Closed, Colored, ProcER, CreatorID, CreatedDate
        FROM EM_tblOrder1
        WHERE EntryDate >= ?
        ORDER BY EntryDate DESC, CreatedDate DESC
    """
    return sync_data_internal(query, params=(cutoff_str,), days_requested=days)

def sync_erp_inventory():
    """
    Đồng bộ dữ liệu tồn kho thực tế từ SQL Server ERP về SQLite.
    Hợp nhất 2 phân hệ:
      - PM_tblPurchase2D (Nhập mua hàng)
      - IM_tblEntry2D (Nhập / Xuất nội bộ)
    Áp dụng cho 11 kho kỹ thuật & văn phòng phẩm:
      'PTBS', 'VT', 'TH', 'PT', 'VPP', 'DC', 'VTNL', 'GC', 'VPPBS', 'DM', 'NL'
    Tính toán chi tiết theo: WHouseID, StorageID, ItemID, InvtAcctID.
    Kể cả tồn kho > 0 và tồn kho = 0.
    """
    start_time = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] Bắt đầu đồng bộ tồn kho ERP về SQLite...")

    target_wh = ('PTBS', 'VT', 'TH', 'PT', 'VPP', 'DC', 'VTNL', 'GC', 'VPPBS', 'DM', 'NL')
    target_str = ','.join([f"'{w}'" for w in target_wh])

    sql_conn, conn_type = get_sql_server_connection()
    sqlite_conn = get_connection()

    try:
        sql_cur = sql_conn.cursor()
        lite_cur = sqlite_conn.cursor()

        query = f"""
        WITH AllTrans AS (
            -- 1. Nhập từ mua hàng (PM_tblPurchase2D)
            SELECT 
                p2.WHouseID, 
                COALESCE(NULLIF(p2.StorageID, ''), 'ZZZ') AS StorageID, 
                p2.ItemID, 
                COALESCE(p2.InvtAcctID, '') AS InvtAcctID,
                p2.Unit1Qty AS ImportQty,
                0.0 AS ExportQty
            FROM PM_tblPurchase2D p2
            JOIN PM_tblPurchase1G p1 ON p2.MRowID = p1.MRowID
            WHERE p1.Approved = 3 AND p2.WHouseID IN ({target_str})

            UNION ALL

            -- 2. Nhập / Xuất nội bộ (IM_tblEntry2D)
            SELECT 
                e2.WHouseID, 
                COALESCE(NULLIF(e2.StorageID, ''), 'ZZZ') AS StorageID, 
                e2.ItemID, 
                COALESCE(e2.InvtAcctID, '') AS InvtAcctID,
                CASE WHEN e2.IsImp = 1 THEN e2.Unit1Qty ELSE 0.0 END AS ImportQty,
                CASE WHEN e2.IsImp = 0 THEN e2.Unit1Qty ELSE 0.0 END AS ExportQty
            FROM IM_tblEntry2D e2
            JOIN IM_tblEntry1G e1 ON e2.MRowID = e1.MRowID
            WHERE e1.Approved = 3 AND e2.WHouseID IN ({target_str})
        ),
        AggregatedStock AS (
            SELECT 
                WHouseID, StorageID, ItemID, InvtAcctID,
                SUM(ImportQty - ExportQty) AS NetStock
            FROM AllTrans
            GROUP BY WHouseID, StorageID, ItemID, InvtAcctID
            HAVING SUM(ImportQty - ExportQty) >= 0
        )
        SELECT 
            s.WHouseID,
            COALESCE(w.WHouseText, s.WHouseID) AS WHouseText,
            s.ItemID,
            COALESCE(c.ItemText, s.ItemID) AS ItemText,
            COALESCE(c.Unit0ID, sf.UnitID, 'Cái') AS Unit,
            s.StorageID,
            s.InvtAcctID,
            s.NetStock AS CurrentStock,
            COALESCE(sf.QtyMin, 0.0) AS QtyMin,
            COALESCE(sf.QtyMax, 0.0) AS QtyMax
        FROM AggregatedStock s
        LEFT JOIN CL_tblWHouse w ON s.WHouseID = w.WHouseID
        LEFT JOIN CL_tblItemList c ON s.ItemID = c.ItemID
        LEFT JOIN IM_tblSafety2 sf ON s.ItemID = sf.ItemID
        ORDER BY s.WHouseID, s.ItemID, s.StorageID
        """

        sql_cur.execute(query)
        rows = sql_cur.fetchall()
        print(f"-> Quét được {len(rows):,} dòng tồn kho từ SQL Server ERP.")

        records_to_insert = []
        positive_count = 0
        zero_count = 0
        low_count = 0
        distinct_items = set()

        for r in rows:
            wh_id = r[0]
            wh_text = r[1]
            item_id = r[2]
            item_text = r[3]
            unit = r[4]
            storage_id = r[5] or 'ZZZ'
            acct_id = r[6] or ''
            stock = float(r[7]) if r[7] is not None else 0.0
            qmin = float(r[8]) if r[8] is not None else 0.0
            qmax = float(r[9]) if r[9] is not None else 0.0

            distinct_items.add(item_id)
            if stock == 0:
                zero_count += 1
                status = 'OUT_OF_STOCK'
            elif qmin > 0 and stock <= qmin:
                low_count += 1
                status = 'LOW_STOCK'
            else:
                positive_count += 1
                status = 'NORMAL'

            records_to_insert.append((
                wh_id, wh_text, item_id, item_text, unit, storage_id, acct_id,
                stock, qmin, qmax, status, now_str
            ))

        # Lưu vào SQLite
        lite_cur.execute("DELETE FROM erp_inventory_stock")
        lite_cur.executemany("""
            INSERT INTO erp_inventory_stock
            (WHouseID, WHouseText, ItemID, ItemText, Unit, StorageID, InvtAcctID, CurrentStock, QtyMin, QtyMax, StockStatus, LastSyncedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records_to_insert)

        sqlite_conn.commit()
        duration = round(time.time() - start_time, 2)
        msg = f"Đã đồng bộ {len(distinct_items):,} mặt hàng ({len(records_to_insert):,} dòng vị trí kệ/kho). Tồn > 0: {positive_count:,}, Tồn = 0: {zero_count:,}, Cảnh báo: {low_count:,}."
        print(f"[+] {msg} ({duration}s)")

        return {
            'status': 'success',
            'total_items': len(distinct_items),
            'total_rows': len(records_to_insert),
            'positive_stock_rows': positive_count,
            'zero_stock_rows': zero_count,
            'low_stock_rows': low_count,
            'duration': duration,
            'message': msg,
            'sync_time': now_str
        }

    except Exception as e:
        sqlite_conn.rollback()
        print(f"[-] Lỗi đồng bộ tồn kho ERP: {e}")
        raise e
    finally:
        sql_conn.close()
        sqlite_conn.close()

if __name__ == '__main__':
    res = seed_initial_data(1000)
    print("Kết quả kéo ban đầu:", res)

