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

try:
    c.execute("""
    SELECT TOP 20 
        qs.last_execution_time,
        SUBSTRING(st.text, (qs.statement_start_offset/2)+1,   
            ((CASE qs.statement_end_offset  
              WHEN -1 THEN DATALENGTH(st.text)  
             ELSE qs.statement_end_offset  
             END - qs.statement_start_offset)/2) + 1) AS statement_text,
        st.text AS full_text
    FROM sys.dm_exec_query_stats AS qs  
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) AS st  
    WHERE st.text LIKE '%IM_%' OR st.text LIKE '%10CK02%' OR st.text LIKE '%WHouseID%' OR st.text LIKE '%rpt%'
    ORDER BY qs.last_execution_time DESC;
    """)
    rows = c.fetchall()
    p(f"Found {len(rows)} cached queries:")
    for r in rows:
        p(f"\n--- Time: {r['last_execution_time']} ---")
        p(r['statement_text'][:300] if r['statement_text'] else r['full_text'][:300])
except Exception as e:
    p(f"Error querying dm_exec_query_stats: {e}")

conn.close()
