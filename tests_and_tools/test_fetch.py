import time, sys
import pymssql

print("Connecting to SQL Server...", flush=True)
t0 = time.time()
conn = pymssql.connect(
    server='123.25.239.13',
    port=669,
    user='Junsix_AppUser',
    password='BOPP!@#234521',
    database='PM2026BOPP',
    timeout=15
)
print(f"Connected in {time.time()-t0:.2f}s", flush=True)

cur = conn.cursor()
print("Querying EM_tblWork1...", flush=True)
cur.execute("SELECT COUNT(*) FROM EM_tblWork1")
print(f"EM_tblWork1 count: {cur.fetchone()[0]}", flush=True)

print("Querying EM_tblWork2...", flush=True)
cur.execute("SELECT COUNT(*) FROM EM_tblWork2")
print(f"EM_tblWork2 count: {cur.fetchone()[0]}", flush=True)

conn.close()
print("Done!", flush=True)
