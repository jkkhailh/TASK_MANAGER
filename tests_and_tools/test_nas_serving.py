import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from nas_storage import get_file_for_serving

sample_path = "internal_tasks/IWO-2609-0004/IWO-2609-0004_BEFORE_20260918_113404_db9bf114.jpg"
res = get_file_for_serving(sample_path)
print("get_file_for_serving result:", res)
if res:
    print("Exists?", os.path.exists(res))

# Kiểm tra tất cả ảnh trong internal_work_images
from database import get_connection
conn = get_connection()
c = conn.cursor()
c.execute("SELECT id, TaskID, FileUrl, NASFilePath FROM internal_work_images LIMIT 5")
rows = c.fetchall()
print("\nSample internal_work_images:")
for r in rows:
    furl = r[2]
    clean_path = furl.replace("/nas-storage/", "")
    served = get_file_for_serving(clean_path)
    print(f"  ID {r[0]} TaskID {r[1]} FileUrl {furl} -> Served: {served} Exists: {os.path.exists(served) if served else False}")

conn.close()
