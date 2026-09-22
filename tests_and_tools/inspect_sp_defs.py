import pymssql

conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=30,
    login_timeout=30,
    as_dict=True
)
c = conn.cursor()

procs_to_check = ['IM_rpt10Ending', 'IM_rpt10List', 'IM_rpt31Stock', 'IM_rpt32Stock', 'IM_rpt12End']

for p in procs_to_check:
    print(f"================== {p} ==================")
    c.execute(f"SELECT OBJECT_DEFINITION(OBJECT_ID('{p}')) as def")
    row = c.fetchone()
    if row and row['def']:
        lines = row['def'].split('\n')
        print(f"Total lines: {len(lines)}")
        print('\n'.join(lines[:60]))  # Print first 60 lines
    else:
        print("No definition found")

conn.close()
