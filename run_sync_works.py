import time, sys
from sync_service import sync_work_templates

print("Bắt đầu đồng bộ danh mục hạng mục và chi tiết công việc từ SQL Server sang SQLite...", flush=True)
res = sync_work_templates()
print("Kết quả đồng bộ:", res, flush=True)
