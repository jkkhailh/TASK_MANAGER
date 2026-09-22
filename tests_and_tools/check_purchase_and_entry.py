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

# 1. Kiểm tra phiếu mua hàng PM_tblPurchase1
c.execute("SELECT * FROM PM_tblPurchase1 WHERE MRowID = '2607131430172735A72A'")
row_p1 = c.fetchone()
p("PM_tblPurchase1 row:")
p(row_p1)

# 2. Tìm trong IM_tblEntry1G xem có EntryID hoặc MRowID nào liên quan không
if row_p1:
    entry_id = row_p1.get('EntryID')
    p(f"EntryID from Purchase: {entry_id}")
    c.execute(f"SELECT * FROM IM_tblEntry1G WHERE EntryID = '{entry_id}' OR MRowID = '2607131430172735A72A'")
    p("Found in IM_tblEntry1G:")
    p(c.fetchall())

# 3. Xem tất cả các bảng bắt đầu bằng PM_
c.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'PM_%'")
p(f"\nPM tables: {[r['TABLE_NAME'] for r in c.fetchall()]}")

conn.close()
