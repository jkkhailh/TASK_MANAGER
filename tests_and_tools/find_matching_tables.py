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

# Tìm tất cả bảng/view có cột StorageID và Unit1Qty
c.execute("""
SELECT c1.TABLE_NAME
FROM INFORMATION_SCHEMA.COLUMNS c1
JOIN INFORMATION_SCHEMA.COLUMNS c2 ON c1.TABLE_NAME = c2.TABLE_NAME
WHERE c1.COLUMN_NAME = 'StorageID' AND c2.COLUMN_NAME = 'Unit1Qty'
GROUP BY c1.TABLE_NAME
""")
tables = [r['TABLE_NAME'] for r in c.fetchall()]
p(f"Tables with StorageID and Unit1Qty: {tables}")

# Trong từng bảng đó, kiểm tra xem bảng nào có ItemID = '10CK02-214'
for t in tables:
    try:
        c.execute(f"SELECT COUNT(*) as cnt FROM {t} WHERE ItemID = '10CK02-214'")
        cnt = c.fetchone()['cnt']
        p(f"  {t}: {cnt} rows for 10CK02-214")
    except Exception as e:
        p(f"  {t}: Error {e}")

conn.close()
