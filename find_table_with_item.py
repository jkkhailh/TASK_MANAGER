import pymssql

def p(msg):
    print(msg, flush=True)

conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=10,
    login_timeout=10,
    as_dict=True
)
c = conn.cursor()

# Tìm tất cả bảng trong PM2026BOPP có cột ItemID
c.execute("""
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE COLUMN_NAME = 'ItemID' AND TABLE_NAME NOT LIKE 'CL_%'
""")
tables = [r['TABLE_NAME'] for r in c.fetchall()]
p(f"Checking {len(tables)} tables for ItemID = '10CK02-214' and '10CK02-176'...")

for t in tables:
    try:
        c.execute(f"SELECT COUNT(*) as cnt FROM [{t}] WHERE ItemID = '10CK02-214'")
        cnt = c.fetchone()['cnt']
        if cnt > 0:
            c.execute(f"SELECT TOP 3 * FROM [{t}] WHERE ItemID = '10CK02-214'")
            samples = c.fetchall()
            p(f"\n===> FOUND in [{t}] ({cnt} rows):")
            for s in samples:
                p(f"   {s}")
    except Exception as e:
        pass

conn.close()
