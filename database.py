import sqlite3
import os
import sys
from datetime import datetime
from auth import hash_password

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'local_maintenance.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def ensure_column(cursor, table_name, column_name, column_type):
    """Bổ sung cột vào bảng nếu chưa tồn tại"""
    cursor.execute(f"PRAGMA table_info({table_name})")
    cols = [row[1] for row in cursor.fetchall()]
    if column_name not in cols:
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")

def fix_subitem_orders(cursor):
    """Chuẩn hóa thứ tự ItemOrder cho tất cả hạng mục con theo thứ tự thời gian tạo để việc mới luôn nằm ở dưới cùng"""
    # 1. Hạng mục con trong Mẫu chu kỳ (Master Recurring Templates)
    cursor.execute("SELECT DISTINCT TemplateID FROM internal_task_items WHERE TemplateID IS NOT NULL AND (TaskID IS NULL OR TaskID = 0)")
    template_ids = [r[0] for r in cursor.fetchall()]
    for tid in template_ids:
        cursor.execute("SELECT id FROM internal_task_items WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0) ORDER BY CreatedAt ASC, id ASC", (tid,))
        item_rows = cursor.fetchall()
        for idx, i_row in enumerate(item_rows, start=1):
            cursor.execute("UPDATE internal_task_items SET ItemOrder = ? WHERE id = ?", (idx, i_row[0]))

    # 2. Hạng mục con trong Phiếu công việc thực tế (Work Orders)
    cursor.execute("SELECT DISTINCT TaskID FROM internal_task_items WHERE TaskID IS NOT NULL AND TaskID > 0")
    task_ids = [r[0] for r in cursor.fetchall()]
    for tid in task_ids:
        cursor.execute("SELECT id FROM internal_task_items WHERE TaskID = ? ORDER BY CreatedAt ASC, id ASC", (tid,))
        item_rows = cursor.fetchall()
        for idx, i_row in enumerate(item_rows, start=1):
            cursor.execute("UPDATE internal_task_items SET ItemOrder = ? WHERE id = ?", (idx, i_row[0]))

def init_sqlite_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. EM_tblOrder1 - Header Lệnh bảo dưỡng
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblOrder1 (
        MRowID TEXT PRIMARY KEY,
        EntryID TEXT NOT NULL,
        EntryDate TEXT,
        WorkID TEXT,
        ModelID TEXT,
        DepartID TEXT,
        BranchID TEXT,
        PeriodID TEXT,
        Memo TEXT,
        Stoptime REAL,
        Approved INTEGER,
        Closed INTEGER,
        Colored INTEGER,
        ProcER REAL,
        CreatorID TEXT,
        CreatedDate TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order1_entryid ON EM_tblOrder1(EntryID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order1_entrydate ON EM_tblOrder1(EntryDate)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order1_workid ON EM_tblOrder1(WorkID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order1_closed ON EM_tblOrder1(Closed)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order1_closed_date ON EM_tblOrder1(Closed, EntryDate DESC)")

    # 2. EM_tblOrder2 - Chi tiết hạng mục công việc & vật tư dự trù
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblOrder2 (
        DRowID TEXT PRIMARY KEY,
        MRowID TEXT NOT NULL,
        NodeID TEXT,
        ServiceID TEXT,
        StaffQty INTEGER,
        Duration REAL,
        ItemID TEXT,
        WHouseID TEXT,
        Unit1Qty REAL,
        Remark TEXT,
        iRow INTEGER,
        FOREIGN KEY (MRowID) REFERENCES EM_tblOrder1(MRowID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order2_mrowid ON EM_tblOrder2(MRowID)")

    # 3. EM_tblOrder3 - Chi tiết máy & phân công kỹ thuật viên
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblOrder3 (
        DRowID TEXT PRIMARY KEY,
        MRowID TEXT NOT NULL,
        MachineID TEXT,
        WorkDate TEXT,
        Emp1ID TEXT,
        Emp2ID TEXT,
        Emp3ID TEXT,
        Emp4ID TEXT,
        Emp5ID TEXT,
        Remark TEXT,
        EMdRowID TEXT,
        FOREIGN KEY (MRowID) REFERENCES EM_tblOrder1(MRowID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order3_mrowid ON EM_tblOrder3(MRowID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_order3_machineid ON EM_tblOrder3(MachineID)")

    # 4. EM_tblWork1 - Danh mục công việc bảo dưỡng (Header - 161 hạng mục)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblWork1 (
        WorkID TEXT PRIMARY KEY,
        WorkText TEXT,
        ModelID TEXT,
        CycleDay INTEGER,
        CycleHour INTEGER,
        AlertBef INTEGER,
        WorkType TEXT,
        Symbol TEXT,
        IsLocked INTEGER,
        IsClosed INTEGER,
        CreatorID TEXT,
        CreatedDate TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_work1_modelid ON EM_tblWork1(ModelID)")

    # 4b. EM_tblWork2 - Chi tiết công việc chuẩn của các hạng mục bảo dưỡng (Detail - 1,053 mục)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblWork2 (
        RowID TEXT PRIMARY KEY,
        WorkID TEXT NOT NULL,
        NodeID TEXT,
        ServiceID TEXT,
        StaffQty INTEGER,
        Duration REAL,
        ItemID TEXT,
        WHouseID TEXT,
        Unit1Qty REAL,
        Remark TEXT,
        iRow INTEGER,
        FOREIGN KEY (WorkID) REFERENCES EM_tblWork1(WorkID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_work2_workid ON EM_tblWork2(WorkID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_work2_nodeid ON EM_tblWork2(NodeID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_work2_serviceid ON EM_tblWork2(ServiceID)")

    # 4c. CL_tblItemList - Danh mục vật tư / phụ tùng bảo dưỡng chuẩn
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS CL_tblItemList (
        ItemID TEXT PRIMARY KEY,
        ItemText TEXT,
        Unit0ID TEXT
    )
    """)

    # 4d. CL_tblDepartment - Danh mục phòng ban / bộ phận
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS CL_tblDepartment (
        DepartID TEXT PRIMARY KEY,
        DepartName TEXT NOT NULL,
        IsTeam INTEGER DEFAULT 1,
        IsClosed INTEGER DEFAULT 0
    )
    """)

    # 4e. CL_tblMacList - Danh mục máy móc / thiết bị từ SQL Server
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS CL_tblMacList (
        MachineID TEXT PRIMARY KEY,
        MachineText TEXT NOT NULL,
        MacCateID TEXT,
        MacLineID TEXT,
        DepartID TEXT,
        DepartName TEXT,
        ModelID TEXT,
        IsClosed INTEGER DEFAULT 0,
        IsLocked INTEGER DEFAULT 0
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_maclist_departid ON CL_tblMacList(DepartID)")

    # 5. EM_tblService - Danh mục dịch vụ / thao tác kỹ thuật
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblService (
        ServiceID TEXT PRIMARY KEY,
        ServiceText TEXT,
        IsLocked INTEGER,
        IsClosed INTEGER,
        CreatorID TEXT,
        CreatedDate TEXT
    )
    """)

    # 6. EM_tblNode - Cây phân cấp cụm / bộ phận máy
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblNode (
        NodeID TEXT PRIMARY KEY,
        NodeText TEXT,
        ParentID TEXT,
        ModelID TEXT,
        iOrder INTEGER,
        IsParent INTEGER,
        IsLocked INTEGER,
        IsClosed INTEGER,
        CreatorID TEXT,
        CreatedDate TEXT
    )
    """)

    # 7. EM_tblResult1 - Nghiệm thu kết quả bảo dưỡng
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS EM_tblResult1 (
        MRowID TEXT PRIMARY KEY,
        EntryID TEXT NOT NULL,
        EntryDate TEXT,
        MachineID TEXT,
        WorkID TEXT,
        DepartID TEXT,
        BranchID TEXT,
        PeriodID TEXT,
        Memo TEXT,
        Stoptime REAL,
        HourOdo REAL,
        RevEmpID TEXT,
        RevName TEXT,
        RevText TEXT,
        RevCode TEXT,
        EOdRowID TEXT,
        EOmRowID TEXT,
        Approved INTEGER,
        Closed INTEGER,
        CreatorID TEXT,
        CreatedDate TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_result1_eomrowid ON EM_tblResult1(EOmRowID)")

    # 8. sync_history - Nhật ký đồng bộ dữ liệu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_time TEXT NOT NULL,
        days_requested INTEGER,
        orders_synced INTEGER,
        items_synced INTEGER,
        machines_synced INTEGER,
        status TEXT,
        message TEXT,
        duration_seconds REAL
    )
    """)

    # =========================================================================
    # CÁC BẢNG MỚI NÂNG CẤP
    # =========================================================================

    # 9. users - Quản trị người dùng & phân quyền
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        emp_id TEXT,
        role TEXT NOT NULL DEFAULT 'technician', -- 'admin', 'supervisor', 'technician'
        depart_id TEXT,
        permissions TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)
    ensure_column(cursor, 'users', 'permissions', "TEXT DEFAULT '{}'")

    # 10. maintenance_task_templates - Thư viện hạng mục & Hình ảnh mẫu chuẩn (SOP)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS maintenance_task_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        WorkID TEXT,
        WorkText TEXT,
        Work2RowID TEXT UNIQUE,
        ModelID TEXT,
        NodeID TEXT,
        NodeText TEXT,
        ServiceID TEXT,
        ServiceText TEXT,
        TaskTitle TEXT NOT NULL,
        StaffQty INTEGER DEFAULT 1,
        Duration REAL DEFAULT 0,
        ItemID TEXT,
        ItemText TEXT,
        Unit0ID TEXT,
        Unit1Qty REAL DEFAULT 0,
        iRow INTEGER DEFAULT 0,
        StandardGuideline TEXT,
        SampleImagePath TEXT,  -- Đường dẫn lưu trên NAS Synology
        SampleImageUrl TEXT,   -- Đường dẫn web URL (/nas-storage/...)
        CreatedBy TEXT,
        UpdatedAt TEXT
    )
    """)
    # Migration tự động bổ sung cột mới nếu bảng đã có từ phiên bản trước
    ensure_column(cursor, 'maintenance_task_templates', 'WorkID', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'WorkText', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'Work2RowID', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'ModelID', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'StaffQty', 'INTEGER DEFAULT 1')
    ensure_column(cursor, 'maintenance_task_templates', 'Duration', 'REAL DEFAULT 0')
    ensure_column(cursor, 'maintenance_task_templates', 'ItemID', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'ItemText', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'Unit0ID', 'TEXT')
    ensure_column(cursor, 'maintenance_task_templates', 'Unit1Qty', 'REAL DEFAULT 0')
    ensure_column(cursor, 'maintenance_task_templates', 'iRow', 'INTEGER DEFAULT 0')

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tmpl_node_svc ON maintenance_task_templates(NodeID, ServiceID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tmpl_workid ON maintenance_task_templates(WorkID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tmpl_work2rowid ON maintenance_task_templates(Work2RowID)")

    # 11. maintenance_machine_tasks - Tiến độ từng hạng mục theo từng máy (Ma trận M x N)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS maintenance_machine_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        MRowID TEXT NOT NULL,
        EntryID TEXT NOT NULL,
        MachineID TEXT NOT NULL,
        TaskDRowID TEXT NOT NULL,
        NodeID TEXT,
        ServiceID TEXT,
        Status TEXT DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'ISSUE'
        ActualHours REAL DEFAULT 0,
        Remark TEXT,
        CompletedBy TEXT,
        CompletedAt TEXT,
        UpdatedAt TEXT,
        UNIQUE(EntryID, MachineID, TaskDRowID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mmt_order_machine ON maintenance_machine_tasks(EntryID, MachineID)")

    # 12. maintenance_task_images - Ảnh thực tế kỹ thuật viên chụp lưu trên NAS Synology
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS maintenance_task_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        TaskExecutionID INTEGER,
        EntryID TEXT NOT NULL,
        MachineID TEXT NOT NULL,
        TaskDRowID TEXT NOT NULL,
        NASFilePath TEXT NOT NULL, -- Đường dẫn file trên NAS
        FileUrl TEXT NOT NULL,     -- Đường link URL HTTP
        FileName TEXT NOT NULL,
        FileSize INTEGER,
        ImageType TEXT DEFAULT 'AFTER', -- 'BEFORE', 'AFTER', 'DEFECT', 'GENERAL'
        Caption TEXT,
        UploadedBy TEXT,
        UploadedAt TEXT,
        FOREIGN KEY (TaskExecutionID) REFERENCES maintenance_machine_tasks(id)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mti_exec ON maintenance_task_images(TaskExecutionID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_mti_order_machine ON maintenance_task_images(EntryID, MachineID)")

    # 13. maintenance_order_machine_info - Quản lý số giờ chạy máy (HourOdo) theo từng máy & lệnh
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS maintenance_order_machine_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        EntryID TEXT NOT NULL,
        MachineID TEXT NOT NULL,
        HourOdo REAL DEFAULT 0,
        WorkDate TEXT,
        Remark TEXT,
        UpdatedBy TEXT,
        UpdatedAt TEXT,
        UNIQUE(EntryID, MachineID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_momi_entry_machine ON maintenance_order_machine_info(EntryID, MachineID)")

    # 14. erp_inventory_stock - Tồn kho vật tư kỹ thuật & văn phòng từ ERP
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS erp_inventory_stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        WHouseID TEXT NOT NULL,
        WHouseText TEXT NOT NULL,
        ItemID TEXT NOT NULL,
        ItemText TEXT NOT NULL,
        Unit TEXT NOT NULL,
        StorageID TEXT,
        InvtAcctID TEXT,
        CurrentStock REAL DEFAULT 0,
        QtyMin REAL DEFAULT 0,
        QtyMax REAL DEFAULT 0,
        StockStatus TEXT DEFAULT 'NORMAL',
        LastSyncedAt TEXT,
        UNIQUE(WHouseID, StorageID, ItemID, InvtAcctID)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_eis_whouse ON erp_inventory_stock(WHouseID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_eis_item ON erp_inventory_stock(ItemID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_eis_storage ON erp_inventory_stock(StorageID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_eis_status ON erp_inventory_stock(StockStatus)")

    # 15. warehouse_issue_requests & warehouse_issue_items - Yêu cầu xuất kho nội bộ
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warehouse_issue_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        RequestCode TEXT UNIQUE NOT NULL,
        RequestDate TEXT NOT NULL,
        RequestedBy TEXT NOT NULL,
        Department TEXT DEFAULT 'KỸ THUẬT',
        WHouseID TEXT NOT NULL,
        Purpose TEXT NOT NULL,
        MachineID TEXT,
        Status TEXT DEFAULT 'PENDING',
        ApprovedBy TEXT,
        ApprovedAt TEXT,
        IssuedBy TEXT,
        IssuedAt TEXT,
        Notes TEXT,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wir_code ON warehouse_issue_requests(RequestCode)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wir_status ON warehouse_issue_requests(Status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wir_whouse ON warehouse_issue_requests(WHouseID)")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warehouse_issue_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        RequestID INTEGER NOT NULL,
        ItemID TEXT NOT NULL,
        ItemText TEXT NOT NULL,
        Unit TEXT,
        StorageID TEXT,
        RequestedQty REAL NOT NULL,
        IssuedQty REAL DEFAULT 0,
        Remark TEXT,
        FOREIGN KEY (RequestID) REFERENCES warehouse_issue_requests(id)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wii_req ON warehouse_issue_items(RequestID)")

    # 16. internal_work_orders & internal_work_images - Quản lý công việc nội bộ P. Kỹ thuật
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_work_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        TaskCode TEXT UNIQUE NOT NULL,
        TaskTitle TEXT NOT NULL,
        TaskType TEXT NOT NULL,
        MachineID TEXT,
        Priority TEXT DEFAULT 'NORMAL',
        Department TEXT,
        RequesterName TEXT NOT NULL,
        RequesterEmail TEXT,
        RequesterPhone TEXT,
        AssignedTo TEXT,
        Description TEXT,
        Solution TEXT,
        Status TEXT DEFAULT 'PENDING',
        ReportedAt TEXT NOT NULL,
        StartedAt TEXT,
        CompletedAt TEXT,
        DowntimeMinutes REAL DEFAULT 0,
        CreatedBy TEXT,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwo_code ON internal_work_orders(TaskCode)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwo_status ON internal_work_orders(Status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwo_machine ON internal_work_orders(MachineID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwo_email ON internal_work_orders(RequesterEmail)")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_work_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        TaskID INTEGER NOT NULL,
        ImageType TEXT DEFAULT 'BEFORE',
        NASFilePath TEXT NOT NULL,
        FileUrl TEXT NOT NULL,
        FileName TEXT NOT NULL,
        Caption TEXT,
        UploadedBy TEXT,
        UploadedAt TEXT,
        FOREIGN KEY (TaskID) REFERENCES internal_work_orders(id)
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwi_task ON internal_work_images(TaskID)")

    # 17. internal_task_recurring_templates - Quản lý danh mục các công việc / hạng mục có chu kỳ lặp lại
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_task_recurring_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        TemplateCode TEXT UNIQUE NOT NULL,
        TaskTitle TEXT NOT NULL,
        TaskType TEXT NOT NULL,
        MachineID TEXT,
        Priority TEXT DEFAULT 'NORMAL',
        Department TEXT DEFAULT 'KỸ THUẬT',
        RequesterName TEXT NOT NULL,
        AssignedTo TEXT,
        Description TEXT,
        CycleType TEXT NOT NULL,
        IntervalDays INTEGER DEFAULT 0,
        MonthlyDays TEXT DEFAULT '',
        AutoRecreateOnComplete INTEGER DEFAULT 1,
        IsActive INTEGER DEFAULT 1,
        NextDueDate TEXT,
        LastSpawnedAt TEXT,
        CurrentTaskID INTEGER,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_itrt_code ON internal_task_recurring_templates(TemplateCode)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_itrt_active ON internal_task_recurring_templates(IsActive)")

    # 18. internal_employees - Danh bạ nhân sự Cơ điện & Kỹ thuật
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        EmpID TEXT UNIQUE NOT NULL,
        EmpName TEXT NOT NULL,
        Department TEXT NOT NULL, -- 'Cơ điện' | 'Kỹ thuật'
        PositionID TEXT,
        PositionText TEXT,
        IsActive INTEGER DEFAULT 1,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ie_empid ON internal_employees(EmpID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ie_dept ON internal_employees(Department)")

    # 19. internal_task_items - Hạng mục công việc con & phân công nhân viên thực hiện
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_task_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        TaskID INTEGER,
        TemplateID INTEGER,
        ItemOrder INTEGER DEFAULT 1,
        ItemTitle TEXT NOT NULL,
        AssignedEmpID TEXT,
        AssignedTo TEXT,
        Department TEXT,
        Status TEXT DEFAULT 'PENDING',
        CompletedAt TEXT,
        CompletedBy TEXT,
        Note TEXT,
        SampleImagePath TEXT,
        SampleImageUrl TEXT,
        StandardGuideline TEXT,
        ActualImageUrl TEXT,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UpdatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (TaskID) REFERENCES internal_work_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (TemplateID) REFERENCES internal_task_recurring_templates(id) ON DELETE CASCADE
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iti_task ON internal_task_items(TaskID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iti_template ON internal_task_items(TemplateID)")

    # 20. internal_employee_groups - Nhóm làm việc nhân sự (Trực ca, Nhóm 1, Nhóm 2, Cơ điện,...)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_employee_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        GroupCode TEXT UNIQUE NOT NULL,
        GroupName TEXT NOT NULL,
        Description TEXT,
        IsActive INTEGER NOT NULL DEFAULT 1,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ieg_code ON internal_employee_groups(GroupCode)")

    # 21. internal_employee_group_members - Thành viên thuộc nhóm (1 nhân viên có thể thuộc nhiều nhóm)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS internal_employee_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        GroupID INTEGER NOT NULL,
        EmpID TEXT NOT NULL,
        IsLeader INTEGER NOT NULL DEFAULT 0,
        CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(GroupID, EmpID),
        FOREIGN KEY (GroupID) REFERENCES internal_employee_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (EmpID) REFERENCES internal_employees(EmpID) ON DELETE CASCADE
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iegm_group ON internal_employee_group_members(GroupID)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iegm_emp ON internal_employee_group_members(EmpID)")

    # Migration bổ sung cột HourOdo vào EM_tblOrder3 nếu chưa có
    ensure_column(cursor, 'EM_tblOrder3', 'HourOdo', 'REAL DEFAULT 0')
    ensure_column(cursor, 'warehouse_issue_items', 'WHouseID', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'VoucherCode', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'IsReceived', 'INTEGER DEFAULT 0')
    ensure_column(cursor, 'warehouse_issue_items', 'ReceivedAt', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'ReceivedBy', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'ReceivedPhotoUrl', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'IsCancelled', 'INTEGER DEFAULT 0')
    ensure_column(cursor, 'warehouse_issue_items', 'CancelledAt', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'CancelledBy', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_items', 'CancelReason', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_requests', 'VoucherCode', 'TEXT')
    ensure_column(cursor, 'warehouse_issue_requests', 'ApprovalToken', 'TEXT')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wii_voucher ON warehouse_issue_items(VoucherCode)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wii_received ON warehouse_issue_items(IsReceived)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wii_cancelled ON warehouse_issue_items(IsCancelled)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_wir_token ON warehouse_issue_requests(ApprovalToken)")

    # 17. system_email_settings - Cấu hình gửi email toàn hệ thống
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_email_settings (
        id INTEGER PRIMARY KEY,
        SmtpHost TEXT DEFAULT 'smtp.gmail.com',
        SmtpPort INTEGER DEFAULT 587,
        SmtpUser TEXT DEFAULT '',
        SmtpPassword TEXT DEFAULT '',
        SmtpFromEmail TEXT DEFAULT '',
        SmtpFromName TEXT DEFAULT 'BOPP EM Maintenance',
        UseTls INTEGER DEFAULT 1,
        WarehouseKeeperEmails TEXT DEFAULT '',
        NotifyWarehouseOnCreate INTEGER DEFAULT 1,
        BaseAppUrl TEXT DEFAULT 'http://localhost:8082',
        UpdatedAt TEXT
    )
    """)
    cursor.execute("""
    INSERT OR IGNORE INTO system_email_settings (id, SmtpHost, SmtpPort, SmtpFromName, UseTls, NotifyWarehouseOnCreate, BaseAppUrl)
    VALUES (1, 'smtp.gmail.com', 587, 'BOPP EM Maintenance', 1, 1, 'http://localhost:8082')
    """)
    ensure_column(cursor, 'internal_work_orders', 'RecurringTemplateID', 'INTEGER')
    ensure_column(cursor, 'internal_work_orders', 'CycleInfo', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'RecurringCount', 'INTEGER DEFAULT 1')
    ensure_column(cursor, 'internal_work_orders', 'NextDueDate', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'NextTaskIdCreated', 'INTEGER DEFAULT 0')
    ensure_column(cursor, 'internal_work_orders', 'RequesterEmail', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'RequesterPhone', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'AssignedGroupIDs', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'AssignedGroupNames', 'TEXT')
    ensure_column(cursor, 'internal_work_orders', 'AssignedEmpIDs', 'TEXT')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwo_email ON internal_work_orders(RequesterEmail)")
    ensure_column(cursor, 'internal_task_recurring_templates', 'SampleImagePath', 'TEXT')
    ensure_column(cursor, 'internal_task_recurring_templates', 'SampleImageUrl', 'TEXT')
    ensure_column(cursor, 'internal_task_recurring_templates', 'AssignedGroupIDs', 'TEXT')
    ensure_column(cursor, 'internal_task_recurring_templates', 'AssignedGroupNames', 'TEXT')
    ensure_column(cursor, 'internal_task_recurring_templates', 'AssignedEmpIDs', 'TEXT')
    ensure_column(cursor, 'internal_task_items', 'SampleImagePath', 'TEXT')
    ensure_column(cursor, 'internal_task_items', 'SampleImageUrl', 'TEXT')
    ensure_column(cursor, 'internal_task_items', 'StandardGuideline', 'TEXT')
    ensure_column(cursor, 'internal_task_items', 'ActualImageUrl', 'TEXT')
    ensure_column(cursor, 'internal_task_items', 'HasIssue', 'INTEGER DEFAULT 0')
    ensure_column(cursor, 'internal_work_images', 'TaskItemID', 'INTEGER')
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_iwi_item ON internal_work_images(TaskItemID)")

    # Chuẩn hóa thứ tự ItemOrder cho tất cả hạng mục con theo thứ tự tạo
    fix_subitem_orders(cursor)

    # Seed 34 nhân viên Cơ điện (4BP03) & Kỹ thuật (4BP06) thực tế từ ERP
    EMPLOYEES_SEED = [
        # Bộ phận Cơ điện (4BP03)
        ("BOPP0543", "Bùi Minh Trí", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0458", "Đỗ Trung Nghĩa", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0955", "Đoàn Tấn Hùng", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0561", "Dương Minh Trung", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0014", "Dương Thành Nhân", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0588", "Huỳnh Khánh Duy", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0642", "Lê Na Huy", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0775", "Nguyễn Phát Đạt", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0646", "Nguyễn Thanh Sơn", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0597", "Nguyễn Thành Tiến", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0525", "Nguyễn Thanh Tùng", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0953", "Phan Trọng Nhân", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0153", "Phùng Quang Minh Trí", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0154", "Trần Quốc Hưng", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP1011", "Trần Tiến Đạt", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0977", "Võ Minh Khánh Huy", "Cơ điện", "CKH", "Nhân viên cơ điện"),
        ("BOPP0013", "Dương Thanh Hoàng", "Cơ điện", "TVHCC7", "Nhân viên Cơ khí"),
        ("BOPP0714", "Lữ Thanh Huy", "Cơ điện", "TVHCC7", "Nhân viên Cơ khí"),
        ("BOPP0452", "Nguyễn Quang Liêm", "Cơ điện", "TVHCC7", "Nhân viên Cơ khí"),
        ("BOPP0133", "Trần Hữu Thọ", "Cơ điện", "TVHCC8", "Tổ Phó Cơ Khí"),
        # Phòng Kỹ thuật / Kế hoạch Bảo trì (4BP06)
        ("BOPP0593", "Lê Hoàng Khải", "Kỹ thuật", "NVKHBT", "Nhân viên Kế Hoạch Bảo Trì"),
        ("BOPP0042", "Đoàn Văn Tín", "Kỹ thuật", "TNKTH", "Trưởng Nhóm Kỹ Thuật"),
        ("BOPP0047", "Nguyễn Lê Nhật Lam", "Kỹ thuật", "TNKTH", "Trưởng Nhóm Kỹ Thuật"),
        ("BOPP0048", "Nguyễn Minh Thuật", "Kỹ thuật", "TNKTH", "Trưởng Nhóm Kỹ Thuật"),
        ("BOPP0432", "Nguyễn Hữu Thọ", "Kỹ thuật", "PPKTH", "Phó Phòng Kỹ Thuật"),
        ("BOPP0537", "Nguyễn Thành Đạt", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0869", "Huỳnh Thanh Toàn", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0925", "Lưu Lê Duy Linh", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0797", "Nguyễn Hửu Duy", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0947", "Nguyễn Trần Minh Thuận", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0972", "Phan Công Hiếu", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0707", "Võ Hữu Bằng", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0964", "Võ Tấn Phát", "Kỹ thuật", "NVKTH", "Nhân viên kỹ thuật"),
        ("BOPP0868", "Nguyễn Trần Cẩm My", "Kỹ thuật", "NVHCKTH", "Nhân viên Hành Chính Kỹ Thuật")
    ]
    cursor.executemany("""
        INSERT OR IGNORE INTO internal_employees (EmpID, EmpName, Department, PositionID, PositionText)
        VALUES (?, ?, ?, ?, ?)
    """, EMPLOYEES_SEED)

    # Seed dữ liệu số giờ chạy máy lịch sử từ EM_tblResult1 nếu có
    cursor.execute("""
        INSERT OR IGNORE INTO maintenance_order_machine_info (EntryID, MachineID, HourOdo, WorkDate, UpdatedAt)
        SELECT o1.EntryID, r.MachineID, r.HourOdo, r.EntryDate, r.CreatedDate
        FROM EM_tblResult1 r
        JOIN EM_tblOrder1 o1 ON r.EOmRowID = o1.MRowID
        WHERE r.HourOdo > 0 AND r.MachineID IS NOT NULL AND r.MachineID != ''
    """)

    conn.commit()

    # Seed người dùng và hạng mục mẫu ban đầu
    seed_default_users(cursor)
    seed_employee_groups(cursor)
    seed_task_templates(cursor)

    conn.commit()
    conn.close()
    print("Khởi tạo cấu trúc SQLite database và phân quyền hoàn tất:", DB_PATH)

def seed_employee_groups(cursor):
    """Khởi tạo nhóm làm việc mẫu và phân công thành viên ban đầu"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    default_groups = [
        ("CA_TRUC", "Nhóm Trực Ca", "Kỹ thuật viên và cơ điện trực ca vận hành sản xuất"),
        ("NHOM_1", "Nhóm 1", "Nhóm kỹ thuật cơ điện 1"),
        ("NHOM_2", "Nhóm 2", "Nhóm kỹ thuật cơ điện 2"),
        ("TO_CO_DIEN", "Tổ Cơ Điện", "Tổ bảo trì & khắc phục sự cố Cơ điện"),
        ("TO_CO_KHI", "Tổ Cơ Khí", "Tổ gia công & sửa chữa cơ khí"),
    ]
    for code, name, desc in default_groups:
        cursor.execute("""
            INSERT OR IGNORE INTO internal_employee_groups (GroupCode, GroupName, Description, IsActive, CreatedAt)
            VALUES (?, ?, ?, 1, ?)
        """, (code, name, desc, now))
    
    # Kiểm tra xem có thành viên nào chưa, nếu chưa thì gán mẫu
    cursor.execute("SELECT COUNT(*) FROM internal_employee_group_members")
    if cursor.fetchone()[0] == 0:
        cursor.execute("SELECT id, GroupCode FROM internal_employee_groups")
        gmap = {r[1]: r[0] for r in cursor.fetchall()}
        
        # Nhóm Trực Ca
        if "CA_TRUC" in gmap:
            for eid in ["BOPP0537", "BOPP0133", "BOPP0042", "BOPP0543"]:
                cursor.execute("INSERT OR IGNORE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt) VALUES (?, ?, 0, ?)", (gmap["CA_TRUC"], eid, now))
        
        # Nhóm 1
        if "NHOM_1" in gmap:
            for eid in ["BOPP0543", "BOPP0458", "BOPP0955", "BOPP0561", "BOPP0537", "BOPP0869"]:
                cursor.execute("INSERT OR IGNORE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt) VALUES (?, ?, 0, ?)", (gmap["NHOM_1"], eid, now))

        # Nhóm 2
        if "NHOM_2" in gmap:
            for eid in ["BOPP0014", "BOPP0588", "BOPP0642", "BOPP0775", "BOPP0925", "BOPP0797"]:
                cursor.execute("INSERT OR IGNORE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt) VALUES (?, ?, 0, ?)", (gmap["NHOM_2"], eid, now))

        # Tổ Cơ điện
        if "TO_CO_DIEN" in gmap:
            cursor.execute("SELECT EmpID FROM internal_employees WHERE Department = 'Cơ điện'")
            for r in cursor.fetchall():
                cursor.execute("INSERT OR IGNORE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt) VALUES (?, ?, 0, ?)", (gmap["TO_CO_DIEN"], r[0], now))

        # Tổ Cơ khí
        if "TO_CO_KHI" in gmap:
            for eid in ["BOPP0013", "BOPP0714", "BOPP0452", "BOPP0133"]:
                cursor.execute("INSERT OR IGNORE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt) VALUES (?, ?, 0, ?)", (gmap["TO_CO_KHI"], eid, now))

def get_default_permissions_for_user(role: str, department: str) -> str:
    """Trả về ma trận phân quyền JSON mặc định theo vai trò và bộ phận"""
    import json
    if role == 'admin':
        perms = {
            "internal_tasks": {"view": True, "edit": True},
            "maintenance": {"view": True, "edit": True},
            "categories": {"view": True, "edit": True},
            "dashboard": {"view": True, "edit": True},
            "inventory": {"view": True, "edit": True},
            "settings": {"view": True, "edit": True}
        }
    elif role == 'supervisor':
        # Giám sát viên Kỹ thuật hoặc Cơ điện
        perms = {
            "internal_tasks": {"view": True, "edit": True},
            "maintenance": {"view": True, "edit": True},
            "categories": {"view": True, "edit": True},
            "dashboard": {"view": True, "edit": True},
            "inventory": {"view": True, "edit": True},
            "settings": {"view": True, "edit": False}
        }
    elif department == 'Cơ điện':
        # Kỹ thuật viên / Thợ Cơ điện
        perms = {
            "internal_tasks": {"view": True, "edit": True},
            "maintenance": {"view": True, "edit": True},
            "categories": {"view": True, "edit": False},
            "dashboard": {"view": True, "edit": False},
            "inventory": {"view": True, "edit": False},
            "settings": {"view": False, "edit": False}
        }
    else:
        # Nhân viên Kỹ thuật
        perms = {
            "internal_tasks": {"view": True, "edit": True},
            "maintenance": {"view": True, "edit": True},
            "categories": {"view": True, "edit": True},
            "dashboard": {"view": True, "edit": False},
            "inventory": {"view": True, "edit": False},
            "settings": {"view": False, "edit": False}
        }
    return json.dumps(perms, ensure_ascii=False)

def seed_default_users(cursor):
    """Tạo các tài khoản mẫu ban đầu và liên kết toàn bộ 34 nhân sự Cơ điện/Kỹ thuật vào tài khoản đăng nhập kèm phân quyền"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    admin_perms = get_default_permissions_for_user('admin', 'BOPP')
    default_users = [
        ("admin", hash_password("admin@123"), "Quản Trị Viên Hệ Thống", "ADMIN01", "admin", "BOPP", admin_perms, 1, now),
        ("BOPP0537", hash_password("123456"), "Nguyễn Thành Đạt", "BOPP0537", "technician", "4BP06", get_default_permissions_for_user('technician', 'Kỹ thuật'), 1, now),
        ("BOPP0133", hash_password("123456"), "Trần Hữu Thọ", "BOPP0133", "technician", "4BP06", get_default_permissions_for_user('technician', 'Cơ điện'), 1, now),
        ("BOPP0048", hash_password("123456"), "Nguyễn Minh Thuật", "BOPP0048", "supervisor", "4BP06", get_default_permissions_for_user('supervisor', 'Kỹ thuật'), 1, now),
        ("BOPP0042", hash_password("123456"), "Đoàn Văn Tín", "BOPP0042", "technician", "4BP06", get_default_permissions_for_user('technician', 'Kỹ thuật'), 1, now),
    ]
    cursor.executemany("""
        INSERT OR IGNORE INTO users (username, password_hash, full_name, emp_id, role, depart_id, permissions, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, default_users)

    # Cập nhật phân quyền cho admin nếu đang rỗng
    cursor.execute("UPDATE users SET permissions = ? WHERE username = 'admin' AND (permissions IS NULL OR permissions = '' OR permissions = '{}')", (admin_perms,))

    # Tự động đồng bộ toàn bộ 34 nhân viên từ internal_employees thành tài khoản đăng nhập
    cursor.execute("SELECT EmpID, EmpName, Department, PositionText FROM internal_employees")
    all_emps = cursor.fetchall()
    default_pw_hash = hash_password("123456")
    for emp in all_emps:
        empid, empname, dept, pos = emp[0], emp[1], emp[2], (emp[3] or "")
        dept_id = "4BP06" if dept == "Kỹ thuật" else "4BP03"
        role = "supervisor" if any(k in pos for k in ["Trưởng Nhóm", "Tổ Phó", "Phó Phòng", "Trưởng Phòng"]) else "technician"
        user_perms = get_default_permissions_for_user(role, dept)
        cursor.execute("""
            INSERT OR IGNORE INTO users (username, password_hash, full_name, emp_id, role, depart_id, permissions, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (empid, default_pw_hash, empname, empid, role, dept_id, user_perms, now))
        # Nếu user đã tồn tại nhưng chưa có permissions thì gán giá trị mặc định
        cursor.execute("""
            UPDATE users SET permissions = ?
            WHERE username = ? AND (permissions IS NULL OR permissions = '' OR permissions = '{}')
        """, (user_perms, empid))

def seed_task_templates(cursor):
    """
    Đồng bộ dữ liệu từ EM_tblWork2 vào maintenance_task_templates.
    Bảo toàn 100% hình ảnh mẫu SOP đã upload và ghi chú tùy chỉnh.
    """
    cursor.execute("SELECT COUNT(*) FROM EM_tblWork2")
    work2_count = cursor.fetchone()[0]
    if work2_count == 0:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        SELECT 
            w2.RowID AS Work2RowID,
            w2.WorkID,
            COALESCE(w1.WorkText, w2.WorkID) AS WorkText,
            w1.ModelID,
            w2.NodeID,
            COALESCE(n.NodeText, w2.NodeID) AS NodeText,
            w2.ServiceID,
            COALESCE(s.ServiceText, w2.ServiceID) AS ServiceText,
            COALESCE(w2.Remark, s.ServiceText, w1.WorkText) AS TaskTitle,
            COALESCE(w2.StaffQty, 1) AS StaffQty,
            COALESCE(w2.Duration, 0) AS Duration,
            w2.ItemID,
            COALESCE(it.ItemText, '') AS ItemText,
            COALESCE(it.Unit0ID, '') AS Unit0ID,
            COALESCE(w2.Unit1Qty, 0) AS Unit1Qty,
            COALESCE(w2.iRow, 0) AS iRow
        FROM EM_tblWork2 w2
        LEFT JOIN EM_tblWork1 w1 ON w2.WorkID = w1.WorkID
        LEFT JOIN EM_tblNode n ON w2.NodeID = n.NodeID
        LEFT JOIN EM_tblService s ON w2.ServiceID = s.ServiceID
        LEFT JOIN CL_tblItemList it ON w2.ItemID = it.ItemID
        ORDER BY w2.WorkID, w2.iRow
    """)
    rows = cursor.fetchall()
    
    for r in rows:
        work2_row_id = r[0] # Work2RowID
        cursor.execute("SELECT id, SampleImagePath, SampleImageUrl, StandardGuideline FROM maintenance_task_templates WHERE Work2RowID = ?", (work2_row_id,))
        existing = cursor.fetchone()
        
        guideline = f"Kiểm tra tiêu chuẩn kỹ thuật cho {r[8]} tại cụm {r[5]}. Chụp ảnh rõ hiện trạng, khe hở và bề mặt tiếp xúc."

        if existing:
            # Cập nhật thông tin công việc, giữ nguyên ảnh mẫu và guideline nếu đã có
            cursor.execute("""
                UPDATE maintenance_task_templates
                SET WorkID = ?, WorkText = ?, ModelID = ?, NodeID = ?, NodeText = ?, ServiceID = ?, ServiceText = ?,
                    TaskTitle = ?, StaffQty = ?, Duration = ?, ItemID = ?, ItemText = ?, Unit0ID = ?, Unit1Qty = ?, iRow = ?,
                    UpdatedAt = ?
                WHERE id = ?
            """, (
                r[1], r[2], r[3], r[4], r[5], r[6], r[7],
                r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15],
                now, existing[0]
            ))
        else:
            cursor.execute("""
                INSERT INTO maintenance_task_templates
                (WorkID, WorkText, Work2RowID, ModelID, NodeID, NodeText, ServiceID, ServiceText, TaskTitle,
                 StaffQty, Duration, ItemID, ItemText, Unit0ID, Unit1Qty, iRow, StandardGuideline, SampleImagePath, SampleImageUrl, CreatedBy, UpdatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'SYSTEM', ?)
            """, (
                r[1], r[2], r[0], r[3], r[4], r[5], r[6], r[7],
                r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15],
                guideline, now
            ))

if __name__ == '__main__':
    init_sqlite_db()
