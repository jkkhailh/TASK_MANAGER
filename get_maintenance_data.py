import pyodbc
import pandas as pd
import sys

# Thiết lập encoding UTF-8 cho console Windows
sys.stdout.reconfigure(encoding='utf-8')
pd.set_option('display.max_columns', 20)
pd.set_option('display.width', 1000)
pd.set_option('display.unicode.east_asian_width', True)

DB_NAME = 'PM2026BOPP'
CONN_STR = (
    'DRIVER={ODBC Driver 18 for SQL Server};'
    'SERVER=123.25.239.13,669;'
    f'DATABASE={DB_NAME};'
    'UID=Junsix_AppUser;'
    'PWD=BOPP!@#234521;'
    'TrustServerCertificate=yes;'
    'Encrypt=optional;'
)

def get_connection():
    return pyodbc.connect(CONN_STR, timeout=10)

def fetch_latest_orders(limit=10):
    """Lấy danh sách các lệnh bảo dưỡng mới nhất (kết hợp EM_tblOrder1 và EM_tblOrder3, EM_tblWork1)"""
    query = f"""
    SELECT TOP {limit}
        o1.EntryID AS [Số Lệnh],
        CONVERT(varchar, o1.EntryDate, 103) AS [Ngày Lập],
        o1.WorkID AS [Mã CV],
        w.WorkText AS [Tên Công Việc],
        o3.MachineID AS [Mã Thiết Bị],
        CONVERT(varchar, o3.WorkDate, 103) AS [Ngày BD Dự Kiến],
        o1.DepartID AS [Bộ Phận],
        o3.Emp1ID AS [Kỹ Thuật Chính],
        o1.Memo AS [Nội Dung / Diễn Giải],
        CASE o1.Approved 
            WHEN 1 THEN N'Chờ duyệt' 
            WHEN 3 THEN N'Đã duyệt' 
            ELSE CAST(o1.Approved AS VARCHAR) 
        END AS [Trạng Thái],
        CONVERT(varchar, o1.CreatedDate, 120) AS [Thời Gian Tạo]
    FROM EM_tblOrder1 o1
    LEFT JOIN EM_tblOrder3 o3 ON o1.MRowID = o3.MRowID
    LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
    ORDER BY o1.EntryDate DESC, o1.CreatedDate DESC
    """
    with get_connection() as conn:
        return pd.read_sql(query, conn)

def fetch_order_tasks_items(limit=10):
    """Lấy chi tiết hạng mục / vật tư lệnh bảo dưỡng mới nhất (EM_tblOrder2)"""
    query = f"""
    SELECT TOP {limit}
        o1.EntryID AS [Số Lệnh],
        o2.NodeID AS [Mã Cụm/Bộ Phận],
        o2.ServiceID AS [Mã Dịch Vụ],
        s.ServiceText AS [Tên Dịch Vụ],
        o2.StaffQty AS [Số Lượng NV],
        o2.Duration AS [Thời Lượng (h)],
        o2.ItemID AS [Mã Vật Tư],
        o2.Unit1Qty AS [Số Lượng VT],
        o2.Remark AS [Ghi Chú]
    FROM EM_tblOrder2 o2
    JOIN EM_tblOrder1 o1 ON o2.MRowID = o1.MRowID
    LEFT JOIN EM_tblService s ON o2.ServiceID = s.ServiceID
    ORDER BY o1.EntryDate DESC, o1.CreatedDate DESC
    """
    with get_connection() as conn:
        return pd.read_sql(query, conn)

def fetch_upcoming_plans(limit=15):
    """Lấy các kế hoạch bảo dưỡng sắp tới từ ngày hiện tại (EM_tblMaster1 và EM_tblMaster2)"""
    query = f"""
    SELECT TOP {limit}
        m1.EntryID AS [Số Kế Hoạch],
        CONVERT(varchar, m2.PlanDate, 103) AS [Ngày Kế Hoạch],
        m2.MachineID AS [Mã Thiết Bị],
        m2.WorkID AS [Mã CV],
        w.WorkText AS [Tên Công Việc Bảo Dưỡng],
        m1.DepartID AS [Bộ Phận],
        m1.Memo AS [Kế Hoạch Chung],
        m2.Remark AS [Ghi Chú Chi Tiết]
    FROM EM_tblMaster2 m2
    JOIN EM_tblMaster1 m1 ON m2.MRowID = m1.MRowID
    LEFT JOIN EM_tblWork1 w ON m2.WorkID = w.WorkID
    WHERE m2.PlanDate >= CAST(GETDATE() AS DATE)
    ORDER BY m2.PlanDate ASC, m2.MachineID ASC
    """
    with get_connection() as conn:
        return pd.read_sql(query, conn)

def fetch_latest_results(limit=10):
    """Lấy kết quả nghiệm thu bảo dưỡng mới nhất (EM_tblResult1)"""
    query = f"""
    SELECT TOP {limit}
        r1.EntryID AS [Số Nghiệm Thu],
        CONVERT(varchar, r1.EntryDate, 103) AS [Ngày Nghiệm Thu],
        r1.MachineID AS [Mã Thiết Bị],
        r1.WorkID AS [Mã CV],
        r1.HourOdo AS [Số Giờ ODO],
        r1.RevName AS [Người Nghiệm Thu],
        r1.Memo AS [Ghi Chú / Kết Quả],
        CASE r1.Approved 
            WHEN 1 THEN N'Chờ duyệt' 
            WHEN 3 THEN N'Đã duyệt' 
            ELSE CAST(r1.Approved AS VARCHAR) 
        END AS [Trạng Thái]
    FROM EM_tblResult1 r1
    ORDER BY r1.EntryDate DESC, r1.CreatedDate DESC
    """
    with get_connection() as conn:
        return pd.read_sql(query, conn)

if __name__ == '__main__':
    print("=" * 80)
    print("1. CÁC LỆNH BẢO DƯỠNG MỚI NHẤT (EM_tblOrder1 + EM_tblOrder3)")
    print("=" * 80)
    df_orders = fetch_latest_orders(10)
    print(df_orders.to_string(index=False))

    print("\n" + "=" * 80)
    print("2. CHI TIẾT HẠNG MỤC / VẬT TƯ CỦA LỆNH MỚI NHẤT (EM_tblOrder2)")
    print("=" * 80)
    df_items = fetch_order_tasks_items(10)
    print(df_items.to_string(index=False))

    print("\n" + "=" * 80)
    print("3. KẾ HOẠCH BẢO DƯỠNG SẮP TỚI (EM_tblMaster1 + EM_tblMaster2)")
    print("=" * 80)
    df_plans = fetch_upcoming_plans(15)
    print(df_plans.to_string(index=False))

    print("\n" + "=" * 80)
    print("4. KẾT QUẢ NGHIỆM THU BẢO DƯỠNG MỚI NHẤT (EM_tblResult1)")
    print("=" * 80)
    df_results = fetch_latest_results(10)
    print(df_results.to_string(index=False))
