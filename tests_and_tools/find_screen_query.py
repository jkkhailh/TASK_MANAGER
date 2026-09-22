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

# 1. Tìm các query chứa 10CK02 hoặc Báo cáo tồn kho
c.execute("""
SELECT TOP 10 qs.last_execution_time, st.text
FROM sys.dm_exec_query_stats AS qs  
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st  
WHERE st.text LIKE '%10CK02%' OR st.text LIKE '%IM_rpt%' OR st.text LIKE '%133689%' OR st.text LIKE '%10CK%'
ORDER BY qs.last_execution_time DESC
""")
rows = c.fetchall()
p(f"Found {len(rows)} matching query plans:")
for r in rows:
    p(f"\n--- {r['last_execution_time']} ---")
    p(r['text'][:500])

# 2. Tìm tất cả các bảng tạm hoặc bảng hệ thống chứa 'rpt' hoặc 'Stock'
c.execute("""
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME LIKE '%Stock%' OR TABLE_NAME LIKE '%Invt%' OR TABLE_NAME LIKE '%rpt%' OR TABLE_NAME LIKE '%Balance%'
""")
p(f"\nMatching tables: {[r['TABLE_NAME'] for r in c.fetchall()]}")

conn.close()
