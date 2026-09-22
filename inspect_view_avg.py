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

# 1. Các PeriodID gần nhất trong IM_tblViewAvg
c.execute("""
SELECT DISTINCT PeriodID 
FROM IM_tblViewAvg 
ORDER BY PeriodID DESC
""")
periods = [r['PeriodID'] for r in c.fetchall()[:10]]
p(f"Các kỳ gần nhất trong IM_tblViewAvg: {periods}")

# 2. Cột trong IM_tblViewAvg
c.execute("""
SELECT COLUMN_NAME, DATA_TYPE 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'IM_tblViewAvg'
""")
p(f"IM_tblViewAvg columns: {[r['COLUMN_NAME'] for r in c.fetchall()]}")

# 3. Đếm số bản ghi trong kỳ mới nhất của IM_tblViewAvg
latest_period = periods[0]
c.execute(f"""
SELECT COUNT(*) as total_rows, COUNT(DISTINCT ItemID) as distinct_items, SUM(Unit1Qty) as total_qty
FROM IM_tblViewAvg
WHERE PeriodID = '{latest_period}' AND Unit1Qty > 0
""")
row_latest = c.fetchone()
p(f"\nKỳ mới nhất {latest_period} trong IM_tblViewAvg:")
p(f"  Rows (Qty > 0): {row_latest['total_rows']:,}")
p(f"  Distinct items: {row_latest['distinct_items']:,}")
p(f"  Total Qty: {float(row_latest['total_qty'] or 0):,.2f}")

conn.close()
