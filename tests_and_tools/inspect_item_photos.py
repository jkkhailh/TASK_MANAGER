import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import get_connection

conn = get_connection()
c = conn.cursor()

c.execute("SELECT id, TaskID, ItemTitle, SampleImageUrl, SampleImagePath FROM internal_task_items WHERE SampleImageUrl IS NOT NULL OR SampleImagePath IS NOT NULL LIMIT 5")
rows = c.fetchall()
print("Sample items with sample images:", len(rows))
for r in rows:
    print(" ", dict(r))

c.execute("SELECT id, TaskID, TaskItemID, ImageType, FileUrl, NASFilePath FROM internal_work_images WHERE TaskItemID IS NOT NULL LIMIT 5")
img_rows = c.fetchall()
print("Internal work images with TaskItemID:", len(img_rows))
for r in img_rows:
    print(" ", dict(r))

conn.close()
