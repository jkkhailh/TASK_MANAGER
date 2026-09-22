import sqlite3
import os

db_path = '/home/khailh/MAINTENANCE_DB/local_maintenance.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def ensure_col(table, col, col_type):
    cursor.execute(f"PRAGMA table_info({table})")
    cols = [r[1] for r in cursor.fetchall()]
    if col not in cols:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
        print(f"Added {col} to {table}")
    else:
        print(f"Col {col} already in {table}")

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

ensure_col('internal_work_orders', 'RecurringTemplateID', 'INTEGER')
ensure_col('internal_work_orders', 'CycleInfo', 'TEXT')
ensure_col('internal_work_orders', 'RecurringCount', 'INTEGER DEFAULT 1')
ensure_col('internal_work_orders', 'NextDueDate', 'TEXT')
ensure_col('internal_work_orders', 'NextTaskIdCreated', 'INTEGER DEFAULT 0')

conn.commit()
conn.close()
print("Migration completed successfully!")
