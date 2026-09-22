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

procs = ['IM_rpt10Ending', 'IM_rpt10List', 'IM_rpt10Filter', 'IM_rpt12End', 'IM_rpt31Stock', 'IM_rpt32Stock', 'IM_rpt11Trial']

for p in procs:
    c.execute(f"""
    SELECT PARAMETER_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, PARAMETER_MODE
    FROM INFORMATION_SCHEMA.PARAMETERS
    WHERE SPECIFIC_NAME = '{p}'
    ORDER BY ORDINAL_POSITION
    """)
    params = c.fetchall()
    print(f"\nSP: {p}")
    for pm in params:
        print(f"  {pm['PARAMETER_NAME']} ({pm['DATA_TYPE']})")

conn.close()
