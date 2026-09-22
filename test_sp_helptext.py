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

for proc in ['IM_rpt10Ending', 'IM_rpt10List', 'IM_rpt31Stock']:
    try:
        c.execute(f"EXEC sp_helptext '{proc}'")
        lines = [r['Text'] for r in c.fetchall()]
        p(f"=== {proc} (length {len(lines)}) ===")
        p(''.join(lines[:40]))
    except Exception as e:
        p(f"Error {proc}: {e}")

conn.close()
