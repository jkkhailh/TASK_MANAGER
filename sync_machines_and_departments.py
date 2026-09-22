import pymssql
import sqlite3
import sys

def sync():
    print("Connecting to SQL Server 123.25.239.13:669...", flush=True)
    sql_conn = pymssql.connect(
        server='123.25.239.13',
        port=669,
        user='Junsix_AppUser',
        password='BOPP!@#234521',
        database='PM2026BOPP',
        timeout=15,
        login_timeout=15,
        as_dict=True
    )
    sql_cur = sql_conn.cursor()
    print("Connected to SQL Server!", flush=True)

    lite_conn = sqlite3.connect('/home/khailh/MAINTENANCE_DB/local_maintenance.db')
    lite_cur = lite_conn.cursor()

    # 1. Create SQLite tables
    lite_cur.execute("""
    CREATE TABLE IF NOT EXISTS CL_tblDepartment (
        DepartID TEXT PRIMARY KEY,
        DepartName TEXT NOT NULL,
        IsTeam INTEGER DEFAULT 1,
        IsClosed INTEGER DEFAULT 0
    )
    """)

    lite_cur.execute("""
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

    # 2. Sync Departments from CL_tblObject (teams/departments)
    sql_cur.execute("""
        SELECT ObjectID, ObjectText, IsTeam, IsClosed 
        FROM CL_tblObject 
        WHERE IsTeam = 1 OR ObjectID LIKE '4BP%' OR ObjectID LIKE '4NM%'
        ORDER BY ObjectID
    """)
    dept_rows = sql_cur.fetchall()
    print(f"Found {len(dept_rows)} departments/teams in SQL Server.", flush=True)

    lite_cur.executemany("""
        INSERT OR REPLACE INTO CL_tblDepartment (DepartID, DepartName, IsTeam, IsClosed)
        VALUES (?, ?, ?, ?)
    """, [(
        r['ObjectID'],
        r['ObjectText'],
        1 if r['IsTeam'] else 0,
        1 if r['IsClosed'] else 0
    ) for r in dept_rows])

    # 3. Sync Machines from CL_tblMacList joined with CL_tblObject for DepartName
    sql_cur.execute("""
        SELECT m.MachineID, m.MachineText, m.MacCateID, m.MacLineID, m.DepartID, 
               o.ObjectText AS DepartName, m.ModelID, m.IsClosed, m.IsLocked
        FROM CL_tblMacList m
        LEFT JOIN CL_tblObject o ON m.DepartID = o.ObjectID
        ORDER BY m.MachineID
    """)
    mac_rows = sql_cur.fetchall()
    print(f"Found {len(mac_rows)} machines in SQL Server.", flush=True)

    lite_cur.executemany("""
        INSERT OR REPLACE INTO CL_tblMacList 
        (MachineID, MachineText, MacCateID, MacLineID, DepartID, DepartName, ModelID, IsClosed, IsLocked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [(
        r['MachineID'],
        r['MachineText'] or '',
        r['MacCateID'] or '',
        r['MacLineID'] or '',
        r['DepartID'] or '',
        r['DepartName'] or '',
        r['ModelID'] or '',
        1 if r['IsClosed'] else 0,
        1 if r['IsLocked'] else 0
    ) for r in mac_rows])

    lite_conn.commit()

    # Verification
    lite_cur.execute("SELECT COUNT(*) FROM CL_tblDepartment")
    d_cnt = lite_cur.fetchone()[0]
    lite_cur.execute("SELECT COUNT(*) FROM CL_tblMacList")
    m_cnt = lite_cur.fetchone()[0]

    print(f"\nSYNC COMPLETED!")
    print(f"SQLite CL_tblDepartment count: {d_cnt}")
    print(f"SQLite CL_tblMacList count: {m_cnt}")

    sql_conn.close()
    lite_conn.close()

if __name__ == '__main__':
    sync()
