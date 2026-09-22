import sqlite3
import os
import sys
import json
import calendar
import logging
from typing import Optional, List, Union, Dict, Any
from datetime import datetime, date, timedelta
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import secrets
from fastapi import FastAPI, Query, HTTPException, Body, Depends, UploadFile, File, Form, Header, BackgroundTasks, WebSocket, WebSocketDisconnect
from websocket_manager import ws_manager
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel, Field

from database import (
    get_connection, DB_PATH, init_sqlite_db, seed_employee_groups,
    seed_default_users, get_default_permissions_for_user
)
from sync_service import sync_recent_data, sync_erp_inventory
from auth import (
    hash_password, verify_password, create_access_token, decode_access_token,
    get_current_user_optional, get_current_user, require_role
)
from nas_storage import (
    get_nas_base_path, save_sample_image, save_order_proof_image,
    save_internal_task_image, save_recurring_template_sample_image,
    save_item_sample_image, promote_image_to_item_sample,
    get_file_for_serving, get_nas_status, STORAGE_MODE
)

sys.stdout.reconfigure(encoding='utf-8')
logger = logging.getLogger("bopp-maintenance")

app = FastAPI(title="Hệ Thống Quản Lý Lệnh Bảo Dưỡng - BOPP Maintenance", version="2.0.0")

@app.on_event("startup")
def on_startup():
    try:
        init_sqlite_db()
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()
        ws_manager.set_event_loop(loop)
    except Exception as e:
        print("Startup db init error:", e)

    # Đảm bảo các cột mới của internal_work_orders và public requests được bổ sung và commit ngay
    try:
        conn = get_connection()
        c = conn.cursor()

        # Bảng nhóm làm việc và thành viên nhóm
        c.execute("""
        CREATE TABLE IF NOT EXISTS internal_employee_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            GroupName TEXT NOT NULL,
            Description TEXT,
            IsActive INTEGER NOT NULL DEFAULT 1,
            CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """)
        c.execute("""
        CREATE TABLE IF NOT EXISTS internal_employee_group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            GroupID INTEGER NOT NULL,
            EmpID TEXT NOT NULL,
            IsLeader INTEGER NOT NULL DEFAULT 0,
            CreatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(GroupID, EmpID),
            FOREIGN KEY (GroupID) REFERENCES internal_employee_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (EmpID) REFERENCES internal_employees(EmpID) ON DELETE CASCADE
        )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_iegm_group ON internal_employee_group_members(GroupID)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_iegm_emp ON internal_employee_group_members(EmpID)")

        c.execute("PRAGMA table_info(internal_work_orders)")
        cols = [r[1] for r in c.fetchall()]
        if "RequesterEmail" not in cols:
            c.execute("ALTER TABLE internal_work_orders ADD COLUMN RequesterEmail TEXT")
        if "RequesterPhone" not in cols:
            c.execute("ALTER TABLE internal_work_orders ADD COLUMN RequesterPhone TEXT")
        if "AssignedGroupIDs" not in cols:
            c.execute("ALTER TABLE internal_work_orders ADD COLUMN AssignedGroupIDs TEXT")
        if "AssignedGroupNames" not in cols:
            c.execute("ALTER TABLE internal_work_orders ADD COLUMN AssignedGroupNames TEXT")
        if "AssignedEmpIDs" not in cols:
            c.execute("ALTER TABLE internal_work_orders ADD COLUMN AssignedEmpIDs TEXT")

        c.execute("PRAGMA table_info(internal_task_recurring_templates)")
        tcols = [r[1] for r in c.fetchall()]
        if "AssignedGroupIDs" not in tcols:
            c.execute("ALTER TABLE internal_task_recurring_templates ADD COLUMN AssignedGroupIDs TEXT")
        if "AssignedGroupNames" not in tcols:
            c.execute("ALTER TABLE internal_task_recurring_templates ADD COLUMN AssignedGroupNames TEXT")
        if "AssignedEmpIDs" not in tcols:
            c.execute("ALTER TABLE internal_task_recurring_templates ADD COLUMN AssignedEmpIDs TEXT")

        c.execute("PRAGMA table_info(internal_task_items)")
        it_cols = [r[1] for r in c.fetchall()]
        if "HasIssue" not in it_cols:
            c.execute("ALTER TABLE internal_task_items ADD COLUMN HasIssue INTEGER DEFAULT 0")

        seed_default_users(c)
        seed_employee_groups(c)

        c.execute("CREATE INDEX IF NOT EXISTS idx_iwo_email ON internal_work_orders(RequesterEmail)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_order1_closed ON EM_tblOrder1(Closed)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_order1_closed_date ON EM_tblOrder1(Closed, EntryDate DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_result1_eomrowid_mac ON EM_tblResult1(EOmRowID, MachineID)")
        conn.commit()
        conn.close()
    except Exception as ex:
        print("Error ensuring RequesterEmail/Phone/Group columns:", ex)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
NAS_DIR = get_nas_base_path()

# Mount static files
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(NAS_DIR, exist_ok=True)
INVENTORY_RECEIPTS_DIR = os.path.join(STATIC_DIR, "uploads", "inventory_receipts")
os.makedirs(INVENTORY_RECEIPTS_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/nas-storage/{file_path:path}")
def serve_nas_file(file_path: str):
    """
    Phục vụ hình ảnh từ NAS Synology / Local Cache.
    Tự động tải từ NAS về cache nếu chưa có (Cache-Miss).
    """
    local_path = get_file_for_serving(file_path)
    if not local_path or not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp trên bộ nhớ lưu trữ.")
    return FileResponse(local_path, headers={"Cache-Control": "public, max-age=604800"})

@app.get("/api/nas/status")
def nas_connection_status():
    """Kiểm tra trạng thái kết nối tới bộ nhớ lưu trữ NAS Synology (SFTP / Local)"""
    return get_nas_status()

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str

class SyncRequest(BaseModel):
    days: int = 7

class TaskStatusUpdate(BaseModel):
    machine_id: str
    task_drow_id: str
    status: str  # 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'ISSUE'
    remark: Optional[str] = ""
    actual_hours: Optional[float] = 0.0

class TemplateUpdate(BaseModel):
    task_title: Optional[str] = None
    standard_guideline: Optional[str] = None

class SetSampleFromProofPayload(BaseModel):
    image_id: int
    guideline: Optional[str] = None

class MachineHoursUpdate(BaseModel):
    hour_odo: float = Field(..., ge=0, description="Số giờ chạy máy (HourOdo >= 0)")
    work_date: Optional[str] = None
    remark: Optional[str] = None

class InventoryIssueItemCreate(BaseModel):
    ItemID: str
    ItemText: str
    WHouseID: Optional[str] = ""
    Unit: Optional[str] = "Cái"
    StorageID: Optional[str] = "ZZZ"
    RequestedQty: float
    Remark: Optional[str] = ""

class InventoryIssueRequestCreate(BaseModel):
    RequestedBy: str
    Department: Optional[str] = "KỸ THUẬT"
    WHouseID: Optional[str] = ""
    Purpose: Optional[str] = "Xuất sử dụng bảo trì kỹ thuật"
    MachineID: Optional[str] = ""
    Notes: Optional[str] = ""
    Items: List[InventoryIssueItemCreate]

class InventoryStatusUpdate(BaseModel):
    Status: str  # 'APPROVED', 'ISSUED', 'REJECTED'
    Notes: Optional[str] = ""

class InventoryAssignVoucherPayload(BaseModel):
    item_ids: Optional[List[int]] = None
    request_ids: Optional[List[int]] = None
    voucher_code: str

class EmailSettingsPayload(BaseModel):
    SmtpHost: str = "smtp.gmail.com"
    SmtpPort: int = 587
    SmtpUser: str = ""
    SmtpPassword: Optional[str] = ""
    SmtpFromEmail: Optional[str] = ""
    SmtpFromName: Optional[str] = "BOPP EM Maintenance"
    UseTls: int = 1
    WarehouseKeeperEmails: Optional[str] = ""
    NotifyWarehouseOnCreate: int = 1
    BaseAppUrl: Optional[str] = "http://localhost:8082"

class EmailTestPayload(BaseModel):
    TestEmail: str
    SmtpHost: Optional[str] = None
    SmtpPort: Optional[int] = None
    SmtpUser: Optional[str] = None
    SmtpPassword: Optional[str] = None
    SmtpFromEmail: Optional[str] = None
    SmtpFromName: Optional[str] = None
    UseTls: Optional[int] = None

class TaskItemCreate(BaseModel):
    ItemTitle: str
    AssignedEmpID: Optional[str] = ""
    AssignedTo: Optional[str] = ""
    Department: Optional[str] = "Cơ điện"
    Note: Optional[str] = ""
    Notes: Optional[str] = ""
    ItemOrder: Optional[int] = None
    SampleImageUrl: Optional[str] = None
    SampleImagePath: Optional[str] = None
    StandardGuideline: Optional[str] = None

class TaskItemUpdate(BaseModel):
    ItemTitle: Optional[str] = None
    AssignedEmpID: Optional[str] = None
    AssignedTo: Optional[str] = None
    Department: Optional[str] = None
    Status: Optional[str] = None  # 'PENDING', 'IN_PROGRESS', 'COMPLETED'
    Note: Optional[str] = None
    Notes: Optional[str] = None
    HasIssue: Optional[Union[bool, int]] = None
    ItemOrder: Optional[int] = None
    SampleImageUrl: Optional[str] = None
    SampleImagePath: Optional[str] = None
    StandardGuideline: Optional[str] = None

class SetItemSamplePayload(BaseModel):
    image_id: Optional[int] = None
    image_source: Optional[str] = "internal"  # "internal", "maintenance", "url"
    file_url: Optional[str] = None
    guideline: Optional[str] = None

class RecurringTemplateCreate(BaseModel):
    TaskTitle: str
    TaskType: str = "INTERNAL"
    MachineID: Optional[str] = ""
    Priority: str = "NORMAL"
    Department: Optional[str] = "KỸ THUẬT"
    RequesterName: Optional[str] = "KỸ THUẬT"
    AssignedTo: Optional[str] = ""
    Description: Optional[str] = ""
    CycleType: str = "INTERVAL_DAYS"  # 'INTERVAL_DAYS', 'MONTHLY_DAYS'
    IntervalDays: Optional[int] = 0
    MonthlyDays: Optional[str] = ""
    AutoRecreateOnComplete: Optional[bool] = True
    IsActive: Optional[bool] = True
    SpawnImmediately: Optional[bool] = True
    SampleImageUrl: Optional[str] = None
    SampleImagePath: Optional[str] = None
    Items: Optional[List[TaskItemCreate]] = None
    items: Optional[List[TaskItemCreate]] = None

class RecurringTemplateUpdate(BaseModel):
    TaskTitle: Optional[str] = None
    TaskType: Optional[str] = None
    MachineID: Optional[str] = None
    Priority: Optional[str] = None
    Department: Optional[str] = None
    RequesterName: Optional[str] = None
    AssignedTo: Optional[str] = None
    Description: Optional[str] = None
    CycleType: Optional[str] = None
    IntervalDays: Optional[int] = None
    MonthlyDays: Optional[str] = None
    AutoRecreateOnComplete: Optional[bool] = None
    IsActive: Optional[bool] = None
    NextDueDate: Optional[str] = None
    SampleImageUrl: Optional[str] = None
    SampleImagePath: Optional[str] = None
    Items: Optional[List[TaskItemCreate]] = None
    items: Optional[List[TaskItemCreate]] = None

class EmployeeGroupCreate(BaseModel):
    GroupCode: str
    GroupName: str
    Description: Optional[str] = ""

class EmployeeGroupUpdate(BaseModel):
    GroupName: Optional[str] = None
    Description: Optional[str] = None
    IsActive: Optional[int] = None

class EmployeeGroupMemberAdd(BaseModel):
    EmpID: str
    IsLeader: Optional[int] = 0

class TaskPriorityUpdate(BaseModel):
    Priority: str

class InternalTaskCreate(BaseModel):
    TaskTitle: str
    TaskType: str = "BREAKDOWN"  # 'BREAKDOWN', 'DEPT_REQUEST', 'IMPROVEMENT', 'INTERNAL'
    MachineID: Optional[str] = ""
    Priority: str = "NORMAL"     # 'URGENT', 'HIGH', 'NORMAL', 'LOW'
    Department: Optional[str] = "KỸ THUẬT"
    RequesterName: Optional[str] = "KỸ THUẬT"
    RequesterEmail: Optional[str] = ""
    RequesterPhone: Optional[str] = ""
    AssignedTo: Optional[str] = ""
    AssignedGroupIDs: Optional[Union[List[int], str]] = None
    AssignedGroupNames: Optional[str] = None
    AssignedEmpIDs: Optional[Union[List[str], str]] = None
    Description: Optional[str] = ""
    Items: Optional[List[TaskItemCreate]] = None
    items: Optional[List[TaskItemCreate]] = None
    # Tùy chọn chu kỳ lặp lại
    IsRecurring: Optional[bool] = False
    CycleType: Optional[str] = "INTERVAL_DAYS"  # 'INTERVAL_DAYS', 'MONTHLY_DAYS'
    IntervalDays: Optional[int] = 0
    MonthlyDays: Optional[str] = ""
    AutoRecreateOnComplete: Optional[bool] = True
    RecurringTemplateID: Optional[int] = None

class InternalTaskUpdate(BaseModel):
    TaskTitle: Optional[str] = None
    TaskType: Optional[str] = None
    MachineID: Optional[str] = None
    Department: Optional[str] = None
    RequesterName: Optional[str] = None
    RequesterEmail: Optional[str] = None
    RequesterPhone: Optional[str] = None
    Description: Optional[str] = None
    Status: Optional[str] = None
    AssignedTo: Optional[str] = None
    AssignedGroupIDs: Optional[Union[List[int], str]] = None
    AssignedGroupNames: Optional[str] = None
    AssignedEmpIDs: Optional[Union[List[str], str]] = None
    Solution: Optional[str] = None
    DowntimeMinutes: Optional[float] = None
    Priority: Optional[str] = None
    NextDueDate: Optional[str] = None

class PublicTaskCreate(BaseModel):
    TaskTitle: str
    Department: str
    RequesterName: str
    RequesterEmail: Optional[str] = ""
    RequesterPhone: Optional[str] = ""
    MachineID: Optional[str] = ""
    Priority: Optional[str] = "NORMAL"
    Description: Optional[str] = ""
    Items: Optional[List[dict]] = None


def send_email_notification(to_emails: List[str], subject: str, html_body: str) -> bool:
    """Gửi email HTML qua SMTP đã cấu hình trong system_email_settings"""
    if not to_emails:
        return False
    
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM system_email_settings WHERE id = 1")
        settings = c.fetchone()
        if not settings:
            return False
        settings = dict(settings)
    finally:
        conn.close()

    host = settings.get("SmtpHost") or settings.get("SmtpServer") or "smtp.gmail.com"
    port = settings.get("SmtpPort") or 587
    user = settings.get("SmtpUser") or settings.get("SenderEmail") or ""
    pwd = settings.get("SmtpPassword") or settings.get("SenderPassword") or ""
    from_email = settings.get("SmtpFromEmail") or user
    from_name = settings.get("SmtpFromName") or "BOPP EM Maintenance"
    use_tls = settings.get("UseTls", 1)

    if not host or not user or not pwd:
        logger.warning("Cấu hình Email SMTP chưa hoàn chỉnh, bỏ qua gửi email.")
        return False

    try:
        if int(port) == 465:
            server = smtplib.SMTP_SSL(host, int(port), timeout=15)
        else:
            server = smtplib.SMTP(host, int(port), timeout=15)
            if use_tls:
                server.starttls()
        
        server.login(user, pwd)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_email}>"
        msg["To"] = ", ".join(to_emails)
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        server.sendmail(from_email, to_emails, msg.as_string())
        server.quit()
        logger.info(f"Đã gửi email thông báo thành công tới: {to_emails}")
        return True
    except Exception as e:
        logger.error(f"Lỗi gửi email: {e}")
        return False

def notify_warehouse_keeper_request(request_id: int):
    """Gửi email thông báo cho thủ kho khi có phiếu xuất kho mới kèm link 1-click duyệt đơn"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM system_email_settings WHERE id = 1")
        settings_row = c.fetchone()
        if not settings_row:
            return
        settings = dict(settings_row)

        if not settings.get("NotifyWarehouseOnCreate"):
            return

        raw_emails = settings.get("WarehouseKeeperEmails") or settings.get("WarehouseKeeperEmail") or ""
        warehouse_emails = [e.strip() for e in raw_emails.replace(";", ",").split(",") if e.strip() and "@" in e]
        if not warehouse_emails:
            logger.info("Chưa cấu hình email thủ kho, bỏ qua gửi thông báo.")
            return

        c.execute("SELECT * FROM warehouse_issue_requests WHERE id = ?", (request_id,))
        req_row = c.fetchone()
        if not req_row:
            return
        req = dict(req_row)

        c.execute("SELECT * FROM warehouse_issue_items WHERE RequestID = ?", (request_id,))
        items = [dict(it) for it in c.fetchall()]

        base_app_url = (settings.get("BaseAppUrl") or "http://localhost:8082").rstrip('/')
        approval_token = req.get("ApprovalToken") or ""
        approval_link = f"{base_app_url}/api/inventory/requests/{request_id}/approve-link?token={approval_token}"
        inventory_link = f"{base_app_url}/inventory"

        # Dựng bảng vật tư
        items_rows_html = ""
        for idx, item in enumerate(items, 1):
            items_rows_html += f"""
            <tr style="border-bottom:1px solid #e2e8f0; font-size:13px;">
                <td style="padding:8px; text-align:center;">{idx}</td>
                <td style="padding:8px; font-weight:bold; color:#0f172a;">{item.get('ItemID', '')}</td>
                <td style="padding:8px;">{item.get('ItemText', '')}</td>
                <td style="padding:8px; text-align:center;">{item.get('Unit', 'Cái')}</td>
                <td style="padding:8px; text-align:right; font-weight:bold; color:#2563eb;">{item.get('RequestedQty', 0):g}</td>
                <td style="padding:8px; color:#475569;">{item.get('Remark', '') or '-'}</td>
            </tr>
            """

        subject = f"[Yêu Cầu Xuất Kho] Phiếu {req.get('RequestCode')} - {req.get('RequestedBy', 'Kỹ thuật')}"
        html_body = f"""
        <div style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width:680px; margin:0 auto; padding:24px; border:1px solid #cbd5e1; border-radius:12px; background:#ffffff;">
            <div style="background:#2563eb; color:#ffffff; padding:16px 20px; border-radius:8px 8px 0 0; margin:-24px -24px 20px -24px;">
                <h2 style="margin:0; font-size:18px;">📦 THÔNG BÁO YÊU CẦU XUẤT KHO MỚI</h2>
                <div style="font-size:13px; opacity:0.9; margin-top:4px;">Hệ thống Quản Lý Bảo Trì BOPP Maintenance</div>
            </div>

            <p style="font-size:14px; color:#334155;">Kính gửi Bộ Phận Kho / Thủ Kho,</p>
            <p style="font-size:14px; color:#334155;">Vừa có một phiếu yêu cầu xuất kho mới được tạo trên hệ thống cần được xác nhận và duyệt:</p>

            <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:14px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
                <tr><td style="padding:8px 12px; color:#64748b; width:140px;">Mã phiếu:</td><td style="padding:8px 12px; font-weight:bold; color:#1e293b;">{req.get('RequestCode')}</td></tr>
                <tr><td style="padding:8px 12px; color:#64748b;">Người yêu cầu:</td><td style="padding:8px 12px; font-weight:bold;">{req.get('RequestedBy')} ({req.get('Department') or 'KỸ THUẬT'})</td></tr>
                <tr><td style="padding:8px 12px; color:#64748b;">Kho yêu cầu:</td><td style="padding:8px 12px;"><strong>{req.get('WHouseID') or 'VT'}</strong></td></tr>
                <tr><td style="padding:8px 12px; color:#64748b;">Mục đích chung:</td><td style="padding:8px 12px;">{req.get('Purpose') or 'Bảo trì'}</td></tr>
                <tr><td style="padding:8px 12px; color:#64748b;">Ngày tạo:</td><td style="padding:8px 12px;">{req.get('RequestDate')}</td></tr>
            </table>

            <h4 style="margin:16px 0 8px 0; color:#1e293b; font-size:15px;">Danh Sách Vật Tư Cần Xuất ({len(items)} mặt hàng):</h4>
            <table style="width:100%; border-collapse:collapse; border:1px solid #e2e8f0; margin-bottom:24px;">
                <thead>
                    <tr style="background:#f1f5f9; color:#475569; font-size:12px; text-transform:uppercase; text-align:left;">
                        <th style="padding:8px; text-align:center; width:35px;">STT</th>
                        <th style="padding:8px; width:110px;">Mã Vật Tư</th>
                        <th style="padding:8px;">Tên Vật Tư</th>
                        <th style="padding:8px; text-align:center; width:55px;">ĐVT</th>
                        <th style="padding:8px; text-align:right; width:65px;">SL</th>
                        <th style="padding:8px;">Mục Đích / Ghi Chú</th>
                    </tr>
                </thead>
                <tbody>
                    {items_rows_html}
                </tbody>
            </table>

            <div style="text-align:center; margin:28px 0 16px 0; padding:20px; background:#f0fdf4; border:1px dashed #86efac; border-radius:10px;">
                <p style="margin:0 0 12px 0; font-size:14px; color:#166534; font-weight:600;">Thủ kho bấm vào nút bên dưới để DUYỆT ĐƠN nhanh mà không cần đăng nhập:</p>
                <a href="{approval_link}" style="display:inline-block; padding:12px 32px; background:#16a34a; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:bold; font-size:15px; box-shadow:0 4px 12px rgba(22,163,74,0.3);">
                    ✅ DUYỆT PHIẾU XUẤT KHO NGAY
                </a>
            </div>

            <div style="text-align:center; margin-top:12px;">
                <a href="{inventory_link}" style="color:#2563eb; font-size:13px; text-decoration:none;">🔗 Xem toàn bộ danh sách phiếu trên Phần mềm Quản lý Kho</a>
            </div>

            <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0 12px 0;" />
            <p style="font-size:11px; color:#94a3b8; text-align:center; margin:0;">Email tự động từ hệ thống BOPP Maintenance. Vui lòng không trả lời email này.</p>
        </div>
        """

        send_email_notification(warehouse_emails, subject, html_body)
    except Exception as e:
        logger.error(f"Lỗi gửi email cho thủ kho (request_id={request_id}): {e}")
    finally:
        conn.close()

def send_task_lifecycle_email(task_id: int, event_type: str, extra_info: Optional[dict] = None) -> bool:
    """
    Gửi email thông báo vòng đời công việc cho người yêu cầu:
    - CREATED: Tiếp nhận yêu cầu thành công
    - ASSIGNED: Đã có kỹ thuật viên nhận việc
    - STARTED: Công việc bắt đầu thực hiện
    - COMPLETED: Công việc đã hoàn thành nghiệm thu
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM internal_work_orders WHERE id = ?", (task_id,))
        task = c.fetchone()
        if not task:
            return False
        task = dict(task)

        requester_email = (task.get("RequesterEmail") or "").strip()
        if not requester_email or "@" not in requester_email:
            return False

        c.execute("SELECT * FROM system_email_settings WHERE id = 1")
        settings = c.fetchone()
        settings = dict(settings) if settings else {}

        base_app_url = (settings.get("BaseAppUrl") or "http://localhost:8082").rstrip('/')
        track_url = f"{base_app_url}/request?code={task.get('TaskCode', '')}"

        task_code = task.get("TaskCode", "")
        task_title = task.get("TaskTitle", "")
        requester_name = task.get("RequesterName", "")
        department = task.get("Department", "")
        machine = task.get("MachineID") or "Khu vực chung"
        priority = task.get("Priority", "NORMAL")
        assigned_to = task.get("AssignedTo") or "Đang chờ phân công"
        started_at = task.get("StartedAt") or ""
        completed_at = task.get("CompletedAt") or ""
        solution = task.get("Solution") or ""
        downtime = task.get("DowntimeMinutes") or 0

        priority_labels = {
            "NORMAL": ("Bình thường", "#10B981", "#ECFDF5"),
            "HIGH": ("Ưu tiên cao", "#F59E0B", "#FFFBEB"),
            "URGENT": ("Khẩn cấp (Dừng máy)", "#EF4444", "#FEF2F2")
        }
        p_text, p_color, p_bg = priority_labels.get(priority.upper(), (priority, "#64748B", "#F1F5F9"))

        if event_type == "CREATED":
            subject = f"📋 [BOPP EM] Tiếp nhận Yêu cầu: {task_code} - {task_title}"
            event_title = "YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN THÀNH CÔNG"
            event_badge = '<span style="display:inline-block; padding:5px 14px; background:#FEF3C7; color:#B45309; border-radius:20px; font-weight:700; font-size:13px;">⏳ Chờ Phân Công Kỹ Thuật (PENDING)</span>'
            event_intro = f"Xin chào <strong>{requester_name}</strong> ({department}),<br>Yêu cầu công việc của bạn đã được ghi nhận thành công vào hệ thống Quản lý Kỹ thuật Cơ điện BOPP. Đội ngũ Kỹ thuật sẽ xem xét và phân công nhân sự xử lý sớm nhất có thể."
        elif event_type == "ASSIGNED":
            subject = f"👷 [BOPP EM] Đã tiếp nhận yêu cầu: {task_code} - {task_title}"
            event_title = "ĐÃ CÓ KỸ THUẬT VIÊN TIẾP NHẬN XỬ LÝ"
            event_badge = f'<span style="display:inline-block; padding:5px 14px; background:#DBEAFE; color:#1D4ED8; border-radius:20px; font-weight:700; font-size:13px;">👷 Đã Phân Công: {assigned_to}</span>'
            event_intro = f"Xin chào <strong>{requester_name}</strong>,<br>Yêu cầu công việc <strong>{task_code}</strong> của bạn đã được tiếp nhận bởi kỹ thuật viên <strong>{assigned_to}</strong> và đang được chuẩn bị triển khai."
        elif event_type == "STARTED":
            subject = f"🚀 [BOPP EM] Bắt đầu thực hiện: {task_code} - {task_title}"
            event_title = "CÔNG VIỆC ĐÃ BẮT ĐẦU ĐƯỢC TIẾN HÀNH"
            event_badge = '<span style="display:inline-block; padding:5px 14px; background:#E0E7FF; color:#4338CA; border-radius:20px; font-weight:700; font-size:13px;">🚀 Đang Thực Hiện (IN_PROGRESS)</span>'
            event_intro = f"Xin chào <strong>{requester_name}</strong>,<br>Kỹ thuật viên <strong>{assigned_to}</strong> đã chính thức bắt đầu thực hiện yêu cầu công việc <strong>{task_code}</strong> tại hiện trường vào lúc <strong>{started_at}</strong>."
        elif event_type == "COMPLETED":
            subject = f"✅ [BOPP EM] Hoàn thành công việc: {task_code} - {task_title}"
            event_title = "CÔNG VIỆC ĐÃ XỬ LÝ HOÀN TẤT & NGHIỆM THU"
            event_badge = '<span style="display:inline-block; padding:5px 14px; background:#D1FAE5; color:#065F46; border-radius:20px; font-weight:700; font-size:13px;">✅ Đã Hoàn Thành (COMPLETED)</span>'
            event_intro = f"Xin chào <strong>{requester_name}</strong>,<br>Yêu cầu công việc <strong>{task_code}</strong> của bạn đã được kỹ thuật viên <strong>{assigned_to}</strong> xử lý hoàn tất và nghiệm thu vào lúc <strong>{completed_at}</strong>."
        else:
            return False

        sol_html = f'<div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;"><span style="font-size: 13px; color: #64748B;">Giải pháp / Kết quả:</span><div style="font-size: 14px; color: #047857; font-weight: 600; margin-top: 2px;">{solution}</div></div>' if solution else ''
        dt_html = f'<div style="padding-top: 4px;"><span style="font-size: 13px; color: #64748B;">Thời gian dừng máy:</span><span style="font-size: 13px; font-weight: 700; color: #DC2626; margin-left: 8px;">{downtime} phút</span></div>' if downtime > 0 else ''

        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
            <div style="background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%); padding: 24px; color: #ffffff; text-align: center;">
                <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #60A5FA; margin-bottom: 6px;">BOPP EM MAINTENANCE SYSTEM</div>
                <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #F8FAFC;">{event_title}</h2>
                <div style="margin-top: 10px;">{event_badge}</div>
            </div>

            <div style="padding: 24px 28px; color: #334155; line-height: 1.6;">
                <p style="font-size: 15px; margin-top: 0;">{event_intro}</p>

                <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
                    <div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;">
                        <span style="font-size: 13px; color: #64748B;">Mã công việc:</span>
                        <strong style="font-size: 15px; color: #2563EB; font-family: monospace; margin-left: 8px;">{task_code}</strong>
                    </div>
                    <div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;">
                        <span style="font-size: 13px; color: #64748B;">Tiêu đề công việc:</span>
                        <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-top: 2px;">{task_title}</div>
                    </div>
                    <div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;">
                        <span style="font-size: 13px; color: #64748B;">Máy / Dây chuyền:</span>
                        <span style="font-size: 13px; font-weight: 600; color: #0F172A; margin-left: 8px;">⚙️ {machine}</span>
                    </div>
                    <div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;">
                        <span style="font-size: 13px; color: #64748B;">Mức độ ưu tiên:</span>
                        <span style="font-size: 12px; font-weight: 700; color: {p_color}; background: {p_bg}; padding: 2px 8px; border-radius: 4px; margin-left: 8px;">{p_text}</span>
                    </div>
                    <div style="border-bottom: 1px dashed #CBD5E1; padding-bottom: 8px; margin-bottom: 8px;">
                        <span style="font-size: 13px; color: #64748B;">Kỹ thuật viên phụ trách:</span>
                        <span style="font-size: 13px; font-weight: 600; color: #0F172A; margin-left: 8px;">👷 {assigned_to}</span>
                    </div>
                    {sol_html}
                    {dt_html}
                </div>

                <div style="text-align: center; margin: 26px 0 16px 0;">
                    <a href="{track_url}" style="display: inline-block; padding: 12px 32px; background: #2563EB; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 12px rgba(37,99,235,0.3);">
                        🔍 Xem Tiến Độ Trực Tiếp Trên Web
                    </a>
                </div>
                <div style="text-align: center; font-size: 12px; color: #64748B;">
                    Hoặc copy link sau: <a href="{track_url}" style="color: #2563EB; word-break: break-all;">{track_url}</a>
                </div>

                <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0 14px 0;" />
                <p style="font-size: 11px; color: #94A3B8; text-align: center; margin: 0;">
                    Email này được gửi tự động từ Hệ thống Quản lý Kỹ thuật & Bảo dưỡng BOPP. Quý phòng ban vui lòng không phản hồi trực tiếp vào email này.
                </p>
            </div>
        </div>
        """

        send_email_notification([requester_email], subject, html_body)
        return True
    except Exception as e:
        logger.error(f"Lỗi gửi email vòng đời công việc ({event_type}, task_id={task_id}): {e}")
        return False
    finally:
        conn.close()


# =========================================================================
# 1. HTML PAGES ROUTES
# =========================================================================

@app.get("/")
def read_root():
    it_file = os.path.join(STATIC_DIR, "internal-tasks.html")
    if os.path.exists(it_file):
        return FileResponse(it_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/maintenance")
@app.get("/orders")
def read_maintenance():
    idx_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(idx_file):
        return FileResponse(idx_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "internal-tasks.html"))

@app.get("/dashboard")
def read_dashboard():
    dashboard_file = os.path.join(STATIC_DIR, "dashboard.html")
    if os.path.exists(dashboard_file):
        return FileResponse(dashboard_file)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/inventory")
def read_inventory():
    inv_file = os.path.join(STATIC_DIR, "inventory.html")
    if os.path.exists(inv_file):
        return FileResponse(inv_file)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/internal-tasks")
def read_internal_tasks():
    it_file = os.path.join(STATIC_DIR, "internal-tasks.html")
    if os.path.exists(it_file):
        return FileResponse(it_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/request")
@app.get("/inventory")
def read_inventory():
    inv_file = os.path.join(STATIC_DIR, "inventory.html")
    if os.path.exists(inv_file):
        return FileResponse(inv_file)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/internal-tasks")
def read_internal_tasks():
    it_file = os.path.join(STATIC_DIR, "internal-tasks.html")
    if os.path.exists(it_file):
        return FileResponse(it_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/request")
@app.get("/public-request")
@app.get("/yeu-cau")
def read_public_request():
    req_file = os.path.join(STATIC_DIR, "request.html")
    if os.path.exists(req_file):
        return FileResponse(req_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# =========================================================================
# REALTIME WEBSOCKET ENDPOINT
# =========================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Kết nối WebSocket đồng bộ dữ liệu thời gian thực giữa các máy trạm & thiết bị di động"""
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)


@app.get("/categories")
def read_categories():
    cat_file = os.path.join(STATIC_DIR, "categories.html")
    if os.path.exists(cat_file):
        return FileResponse(cat_file)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/settings")
def read_settings():
    settings_file = os.path.join(STATIC_DIR, "settings.html")
    if os.path.exists(settings_file):
        return FileResponse(settings_file)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

# =========================================================================
# 2. AUTHENTICATION & USERS APIS
# =========================================================================

@app.post("/api/auth/login")
def login(payload: LoginRequest):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (payload.username.strip(),))
        user = c.fetchone()
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Tên đăng nhập hoặc mật khẩu không đúng.")

        user_dict = dict(user)
        del user_dict["password_hash"]

        # Lấy danh sách nhóm trực thuộc của nhân viên
        emp_id = user_dict.get("emp_id") or user_dict.get("username")
        c.execute("""
            SELECT g.id, g.GroupCode, g.GroupName, gm.IsLeader
            FROM internal_employee_groups g
            JOIN internal_employee_group_members gm ON g.id = gm.GroupID
            WHERE gm.EmpID = ? AND g.IsActive = 1
        """, (emp_id,))
        user_groups = [dict(r) for r in c.fetchall()]
        user_dict["groups"] = user_groups
        user_dict["group_ids"] = [g["id"] for g in user_groups]
        user_dict["emp_id"] = emp_id

        token = create_access_token(user_dict)

        return {
            "token": token,
            "access_token": token,
            "user": user_dict
        }
    finally:
        conn.close()

@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    conn = get_connection()
    c = conn.cursor()
    try:
        user_dict = dict(user)
        emp_id = user_dict.get("emp_id") or user_dict.get("username")
        c.execute("""
            SELECT g.id, g.GroupCode, g.GroupName, gm.IsLeader
            FROM internal_employee_groups g
            JOIN internal_employee_group_members gm ON g.id = gm.GroupID
            WHERE gm.EmpID = ? AND g.IsActive = 1
        """, (emp_id,))
        user_groups = [dict(r) for r in c.fetchall()]
        user_dict["groups"] = user_groups
        user_dict["group_ids"] = [g["id"] for g in user_groups]
        user_dict["emp_id"] = emp_id
        return user_dict
    finally:
        conn.close()

@app.get("/api/auth/users")
def list_users(user: dict = Depends(require_role(["admin", "supervisor"]))):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, username, full_name, emp_id, role, depart_id, is_active, created_at FROM users")
        return {"users": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()

# =========================================================================
# 3. TASK TEMPLATES & SAMPLE IMAGES APIS



@app.post("/api/templates/{template_id}/set-sample-from-proof")
def set_sample_from_proof(
    template_id: int,
    payload: SetSampleFromProofPayload,
    current_user: dict = Depends(require_role(["admin", "supervisor"]))
):
    """Chọn 1 ảnh thực tế từ kỹ thuật viên làm ảnh mẫu chuẩn SOP cho hạng mục"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, NodeID, ServiceID, TaskTitle, WorkID, StandardGuideline 
            FROM maintenance_task_templates 
            WHERE id = ?
        """, (template_id,))
        tmpl = c.fetchone()
        if not tmpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục mẫu này.")

        c.execute("""
            SELECT id, FileUrl, NASFilePath, FileName, UploadedBy, UploadedAt, Caption 
            FROM maintenance_task_images 
            WHERE id = ?
        """, (payload.image_id,))
        img = c.fetchone()
        if not img:
            raise HTTPException(status_code=404, detail="Không tìm thấy ảnh thực tế được chỉ định.")

        from nas_storage import promote_proof_to_sample
        node_id = tmpl["NodeID"] or "NODE"
        service_id = tmpl["ServiceID"] or "SVC"
        
        res = promote_proof_to_sample(img["FileUrl"], img["FileName"] or "sample.jpg", node_id, service_id)
        
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        uploader_text = current_user.get("full_name") or current_user.get("username") or "ADMIN"
        
        guideline = payload.guideline if (payload.guideline is not None and payload.guideline.strip()) else tmpl["StandardGuideline"]
        if not guideline:
            guideline = f"Ảnh mẫu chuẩn SOP chọn từ thực tế ngày {img['UploadedAt']} bởi KTV {img['UploadedBy']}."

        c.execute("""
            UPDATE maintenance_task_templates
            SET SampleImagePath = ?, SampleImageUrl = ?, StandardGuideline = ?, UpdatedAt = ?, CreatedBy = ?
            WHERE id = ?
        """, (res["file_path"], res["file_url"], guideline, now, uploader_text, template_id))
        conn.commit()

        return {
            "status": "success",
            "message": f"Đã chọn ảnh thực tế của {img['UploadedBy']} làm ảnh mẫu chuẩn SOP!",
            "template_id": template_id,
            "sample_image_url": res["file_url"],
            "SampleImageUrl": res["file_url"],
            "standard_guideline": guideline,
            "StandardGuideline": guideline
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi đặt ảnh mẫu SOP: {str(e)}")
    finally:
        conn.close()


@app.post("/api/templates/{template_id}/sample-image")
async def upload_sample_image(
    template_id: int,
    file: UploadFile = File(...),
    guideline: Optional[str] = Form(None),
    current_user: dict = Depends(require_role(["admin", "supervisor"]))
):
    """Upload ảnh mẫu SOP lên NAS Synology và cập nhật cho hạng mục chuẩn"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, NodeID, ServiceID FROM maintenance_task_templates WHERE id = ?", (template_id,))
        tmpl = c.fetchone()
        if not tmpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục mẫu này.")

        contents = await file.read()
        res = save_sample_image(contents, file.filename or "sample.jpg", tmpl["NodeID"] or "NODE", tmpl["ServiceID"] or "SVC")

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if guideline:
            c.execute("""
                UPDATE maintenance_task_templates
                SET SampleImagePath = ?, SampleImageUrl = ?, StandardGuideline = ?, UpdatedAt = ?, CreatedBy = ?
                WHERE id = ?
            """, (res["file_path"], res["file_url"], guideline, now, current_user.get("full_name", "ADMIN"), template_id))
        else:
            c.execute("""
                UPDATE maintenance_task_templates
                SET SampleImagePath = ?, SampleImageUrl = ?, UpdatedAt = ?, CreatedBy = ?
                WHERE id = ?
            """, (res["file_path"], res["file_url"], now, current_user.get("full_name", "ADMIN"), template_id))

        conn.commit()
        return {
            "status": "success",
            "message": "Đã lưu ảnh mẫu lên NAS Synology thành công!",
            "sample_image_url": res["file_url"],
            "SampleImageUrl": res["file_url"],
            "template_id": template_id,
            "TemplateID": template_id,
            "StandardGuideline": guideline
        }
    finally:
        conn.close()


@app.get("/api/orders/{entry_id}/execution")
def get_order_execution_matrix(entry_id: str):
    """
    Lấy ma trận thực hiện: Mỗi thiết bị độc lập làm toàn bộ danh sách hạng mục.
    Tự động khởi tạo bản ghi tiến độ PENDING nếu chưa tồn tại.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        # 1. Lấy Header
        c.execute("SELECT MRowID, EntryID, EntryDate, WorkID, DepartID, Memo, Approved, Closed FROM EM_tblOrder1 WHERE EntryID = ?", (entry_id,))
        order_row = c.fetchone()
        if not order_row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy lệnh {entry_id}")
        order = dict(order_row)
        mrow_id = order["MRowID"]

        # 2. Lấy danh sách máy từ EM_tblOrder3
        c.execute("SELECT MachineID, WorkDate, Emp1ID, Remark, HourOdo FROM EM_tblOrder3 WHERE MRowID = ? ORDER BY MachineID ASC", (mrow_id,))
        machines_raw = c.fetchall()
        machine_list = [r["MachineID"] for r in machines_raw if r["MachineID"]]
        if not machine_list:
            machine_list = ["MAIN_UNIT"]

        # 3. Lấy danh sách hạng mục từ EM_tblOrder2
        c.execute("""
            SELECT o2.DRowID, o2.NodeID, COALESCE(n.NodeText, o2.NodeID) AS NodeText,
                   o2.ServiceID, COALESCE(s.ServiceText, o2.ServiceID) AS ServiceText,
                   o2.Duration, o2.ItemID, o2.Unit1Qty, o2.Remark, o2.iRow
            FROM EM_tblOrder2 o2
            LEFT JOIN EM_tblNode n ON o2.NodeID = n.NodeID
            LEFT JOIN EM_tblService s ON o2.ServiceID = s.ServiceID
            WHERE o2.MRowID = ?
            ORDER BY o2.iRow ASC
        """, (mrow_id,))
        tasks_raw = [dict(r) for r in c.fetchall()]

        # 4. Đảm bảo ma trận M x N tồn tại trong maintenance_machine_tasks
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for m_id in machine_list:
            for t in tasks_raw:
                c.execute("""
                    INSERT OR IGNORE INTO maintenance_machine_tasks
                    (MRowID, EntryID, MachineID, TaskDRowID, NodeID, ServiceID, Status, ActualHours, Remark, UpdatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, '', ?)
                """, (mrow_id, entry_id, m_id, t["DRowID"], t["NodeID"], t["ServiceID"], now))
        conn.commit()

        # 5. Lấy toàn bộ tiến độ của các máy trong lệnh
        c.execute("""
            SELECT id, MachineID, TaskDRowID, Status, ActualHours, Remark, CompletedBy, CompletedAt, UpdatedAt
            FROM maintenance_machine_tasks
            WHERE EntryID = ?
        """, (entry_id,))
        exec_map = {}
        for r in c.fetchall():
            key = (r["MachineID"], r["TaskDRowID"])
            exec_map[key] = dict(r)

        # 6. Lấy toàn bộ ảnh thực tế đã lưu trên NAS cho lệnh này
        c.execute("""
            SELECT id, TaskExecutionID, MachineID, TaskDRowID, NASFilePath, FileUrl, FileName, FileSize, ImageType, Caption, UploadedBy, UploadedAt
            FROM maintenance_task_images
            WHERE EntryID = ?
            ORDER BY id ASC
        """, (entry_id,))
        images_by_task = {}
        for img in c.fetchall():
            img_dict = dict(img)
            k = (img["MachineID"], img["TaskDRowID"])
            if k not in images_by_task:
                images_by_task[k] = []
            images_by_task[k].append(img_dict)

        # 7. Lấy ảnh mẫu chuẩn SOP và hướng dẫn từ maintenance_task_templates
        c.execute("""
            SELECT WorkID, NodeID, ServiceID, TaskTitle, SampleImageUrl, StandardGuideline 
            FROM maintenance_task_templates
        """)
        exact_tmpl_map = {}
        fallback_tmpl_map = {}
        for t_row in c.fetchall():
            w_id = t_row["WorkID"] or ""
            n_id = t_row["NodeID"] or ""
            s_id = t_row["ServiceID"] or ""
            t_title = (t_row["TaskTitle"] or "").strip()
            item_data = {
                "sample_image_url": t_row["SampleImageUrl"],
                "standard_guideline": t_row["StandardGuideline"]
            }
            if w_id and n_id and s_id and t_title:
                exact_tmpl_map[(w_id, n_id, s_id, t_title)] = item_data
            if n_id and s_id and t_title and (n_id, s_id, t_title) not in fallback_tmpl_map:
                fallback_tmpl_map[(n_id, s_id, t_title)] = item_data
            if (n_id, s_id) not in fallback_tmpl_map or t_row["SampleImageUrl"]:
                fallback_tmpl_map[(n_id, s_id)] = item_data

        order_work_id = order.get("WorkID") or ""

        # 8. Xây dựng kết quả trả về theo từng máy
        tasks_by_machine = {}
        machine_stats = {}

        for m_id in machine_list:
            tasks_for_m = []
            comp_cnt = 0
            prog_cnt = 0
            issue_cnt = 0

            for t in tasks_raw:
                k = (m_id, t["DRowID"])
                ex = exec_map.get(k, {
                    "id": None,
                    "Status": "PENDING",
                    "ActualHours": 0,
                    "Remark": "",
                    "CompletedBy": None,
                    "CompletedAt": None
                })

                st = ex["Status"]
                if st == "COMPLETED":
                    comp_cnt += 1
                elif st == "IN_PROGRESS":
                    prog_cnt += 1
                elif st == "ISSUE":
                    issue_cnt += 1

                task_title_str = (t["Remark"] or "").strip()
                tmpl_info = exact_tmpl_map.get((order_work_id, t["NodeID"], t["ServiceID"], task_title_str))
                if not tmpl_info:
                    tmpl_info = fallback_tmpl_map.get((t["NodeID"], t["ServiceID"], task_title_str))
                if not tmpl_info:
                    tmpl_info = fallback_tmpl_map.get((t["NodeID"], t["ServiceID"])) or {}

                # Hướng dẫn tiêu chuẩn (nếu chưa có thì tạo hướng dẫn mặc định trực quan)
                guideline_text = tmpl_info.get("standard_guideline")
                if not guideline_text or not guideline_text.strip():
                    n_txt = t.get("NodeText") or t.get("NodeID") or "thiết bị"
                    s_txt = t.get("ServiceText") or t.get("ServiceID") or "bảo dưỡng"
                    t_txt = task_title_str or s_txt
                    guideline_text = f"Tiêu chuẩn chụp ảnh minh chứng: Chụp cận cảnh rõ nét cụm {n_txt} ({t_txt}) khi thực hiện {s_txt}. Thể hiện rõ hiện trạng trước/sau khi bảo dưỡng, độ sạch sẽ, bề mặt tiếp xúc, khe hở kỹ thuật hoặc mối nối bu lông."

                task_obj = {
                    "execution_id": ex.get("id"),
                    "task_drow_id": t["DRowID"],
                    "node_id": t["NodeID"],
                    "node_text": t["NodeText"],
                    "service_id": t["ServiceID"],
                    "service_text": t["ServiceText"],
                    "task_title": t["Remark"] or t["ServiceText"],
                    "item_id": t["ItemID"],
                    "unit1_qty": t["Unit1Qty"],
                    "estimated_duration": t["Duration"],
                    "status": st,
                    "remark": ex.get("Remark") or "",
                    "actual_hours": ex.get("ActualHours") or 0.0,
                    "completed_by": ex.get("CompletedBy"),
                    "completed_at": ex.get("CompletedAt"),
                    "sample_image_url": tmpl_info.get("sample_image_url"),
                    "standard_guideline": guideline_text,
                    "proof_images": images_by_task.get(k, [])
                }
                tasks_for_m.append(task_obj)

            total_t = len(tasks_raw)
            percent = int((comp_cnt / total_t) * 100) if total_t > 0 else 0
            tasks_by_machine[m_id] = tasks_for_m
            machine_stats[m_id] = {
                "total": total_t,
                "completed": comp_cnt,
                "in_progress": prog_cnt,
                "issues": issue_cnt,
                "percent": percent
            }

        # 8b. Lấy số giờ chạy máy theo từng máy từ maintenance_order_machine_info & EM_tblOrder3
        c.execute("""
            SELECT MachineID, HourOdo, WorkDate, Remark, UpdatedBy, UpdatedAt
            FROM maintenance_order_machine_info
            WHERE EntryID = ?
        """, (entry_id,))
        momi_rows = c.fetchall()
        machine_hours = {r["MachineID"]: (r["HourOdo"] or 0.0) for r in momi_rows}
        machine_hours_details = {r["MachineID"]: dict(r) for r in momi_rows}

        for r in machines_raw:
            m_id = r["MachineID"]
            if m_id and m_id not in machine_hours:
                h_val = r["HourOdo"] if ("HourOdo" in r.keys() and r["HourOdo"] is not None) else 0.0
                machine_hours[m_id] = float(h_val)
                machine_hours_details[m_id] = {
                    "MachineID": m_id,
                    "HourOdo": float(h_val),
                    "WorkDate": r["WorkDate"],
                    "Remark": r["Remark"],
                    "UpdatedBy": None,
                    "UpdatedAt": None
                }

        return {
            "order": order,
            "machine_list": machine_list,
            "tasks_by_machine": tasks_by_machine,
            "machine_stats": machine_stats,
            "machine_hours": machine_hours,
            "machine_hours_details": machine_hours_details
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/sync/history")
def get_sync_history():
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, sync_time, days_requested, orders_synced, items_synced, machines_synced, status, message, duration_seconds
            FROM sync_history
            ORDER BY id DESC LIMIT 20
        """)
        return {"history": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()

@app.post("/api/orders/{entry_id}/machines/{machine_id}/hours")
def update_machine_hours(
    entry_id: str,
    machine_id: str,
    payload: MachineHoursUpdate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Cập nhật số giờ chạy máy (HourOdo / Odometer) cho một máy cụ thể trong lệnh bảo dưỡng.
    Lưu vào bảng bảo dưỡng chuyên dụng và đồng bộ vào EM_tblOrder3.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updated_by = current_user.get("full_name") if current_user else "KỸ THUẬT VIÊN"

        c.execute("SELECT MRowID, EntryID, Closed FROM EM_tblOrder1 WHERE EntryID = ?", (entry_id,))
        order_row = c.fetchone()
        if not order_row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy lệnh {entry_id}")
        mrow_id = order_row["MRowID"]

        # Lưu hoặc cập nhật vào bảng maintenance_order_machine_info
        c.execute("""
            INSERT INTO maintenance_order_machine_info
                (EntryID, MachineID, HourOdo, WorkDate, Remark, UpdatedBy, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(EntryID, MachineID) DO UPDATE SET
                HourOdo = excluded.HourOdo,
                WorkDate = COALESCE(excluded.WorkDate, maintenance_order_machine_info.WorkDate),
                Remark = COALESCE(excluded.Remark, maintenance_order_machine_info.Remark),
                UpdatedBy = excluded.UpdatedBy,
                UpdatedAt = excluded.UpdatedAt
        """, (entry_id, machine_id, payload.hour_odo, payload.work_date, payload.remark, updated_by, now))

        # Đồng bộ vào EM_tblOrder3 nếu có
        c.execute("""
            UPDATE EM_tblOrder3
            SET HourOdo = ?
            WHERE MRowID = ? AND MachineID = ?
        """, (payload.hour_odo, mrow_id, machine_id))

        conn.commit()
        return {
            "success": True,
            "message": f"Đã lưu số giờ chạy máy cho {machine_id}: {payload.hour_odo:,.1f} giờ",
            "data": {
                "entry_id": entry_id,
                "machine_id": machine_id,
                "hour_odo": payload.hour_odo,
                "updated_by": updated_by,
                "updated_at": now
            }
        }
    finally:
        conn.close()

@app.post("/api/orders/{entry_id}/tasks/status")
def update_machine_task_status(
    entry_id: str,
    payload: TaskStatusUpdate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Cập nhật trạng thái hạng mục bảo dưỡng của một thiết bị cụ thể"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        completed_by = current_user.get("full_name") if current_user else "KỸ THUẬT VIÊN"
        completed_at = now if payload.status == "COMPLETED" else None

        c.execute("""
            UPDATE maintenance_machine_tasks
            SET Status = ?, Remark = ?, ActualHours = ?, CompletedBy = ?, CompletedAt = ?, UpdatedAt = ?
            WHERE EntryID = ? AND MachineID = ? AND TaskDRowID = ?
        """, (
            payload.status, payload.remark or "", payload.actual_hours or 0.0,
            completed_by if payload.status == "COMPLETED" else None,
            completed_at, now, entry_id, payload.machine_id, payload.task_drow_id
        ))

        # Nếu tất cả các hạng mục của tất cả các máy đã xong -> Đóng lệnh
        c.execute("SELECT COUNT(*) FROM maintenance_machine_tasks WHERE EntryID = ? AND Status != 'COMPLETED'", (entry_id,))
        unfinished = c.fetchone()[0]
        if unfinished == 0:
            c.execute("UPDATE EM_tblOrder1 SET Closed = 1 WHERE EntryID = ?", (entry_id,))

        conn.commit()
        return {
            "status": "success",
            "message": f"Đã cập nhật trạng thái {payload.status} cho thiết bị {payload.machine_id} thành công!"
        }
    finally:
        conn.close()

@app.post("/api/orders/{entry_id}/upload-proof")
async def upload_proof_photo(
    entry_id: str,
    machine_id: str = Form(...),
    task_drow_id: str = Form(...),
    caption: Optional[str] = Form(""),
    image_type: Optional[str] = Form("AFTER"),
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """
    Tải ảnh minh chứng thực tế do kỹ thuật viên chụp lưu trực tiếp vào NAS Synology
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        contents = await file.read()
        res = save_order_proof_image(contents, file.filename or "proof.jpg", entry_id, machine_id, task_drow_id)

        # Lấy execution_id
        c.execute("""
            SELECT id FROM maintenance_machine_tasks
            WHERE EntryID = ? AND MachineID = ? AND TaskDRowID = ?
        """, (entry_id, machine_id, task_drow_id))
        row = c.fetchone()
        exec_id = row["id"] if row else None

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        uploader = current_user.get("full_name") if current_user else "Kỹ thuật viên"

        c.execute("""
            INSERT INTO maintenance_task_images
            (TaskExecutionID, EntryID, MachineID, TaskDRowID, NASFilePath, FileUrl, FileName, FileSize, ImageType, Caption, UploadedBy, UploadedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            exec_id, entry_id, machine_id, task_drow_id,
            res["file_path"], res["file_url"], res["filename"], res["size"],
            image_type, caption, uploader, now
        ))
        image_id = c.lastrowid
        conn.commit()

        return {
            "status": "success",
            "message": "Đã lưu ảnh thực tế lên NAS Synology thành công!",
            "image": {
                "id": image_id,
                "file_url": res["file_url"],
                "caption": caption,
                "image_type": image_type,
                "uploaded_by": uploader,
                "uploaded_at": now
            }
        }
    finally:
        conn.close()

@app.delete("/api/orders/proof-images/{image_id}")
def delete_proof_image(
    image_id: int,
    current_user: dict = Depends(require_role(["admin", "supervisor", "technician"]))
):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, NASFilePath FROM maintenance_task_images WHERE id = ?", (image_id,))
        img = c.fetchone()
        if not img:
            raise HTTPException(status_code=404, detail="Không tìm thấy hình ảnh này.")

        # Xóa file vật lý trên NAS nếu có
        try:
            if os.path.exists(img["NASFilePath"]):
                os.remove(img["NASFilePath"])
        except Exception:
            pass

        c.execute("DELETE FROM maintenance_task_images WHERE id = ?", (image_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa ảnh minh chứng thành công."}
    finally:
        conn.close()

# =========================================================================
# 5. DASHBOARD & SYNC APIS (Kế thừa từ phiên bản trước)
# =========================================================================

@app.get("/api/stats")
def get_stats():
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT COUNT(*) FROM EM_tblOrder1")
        total_orders = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM EM_tblOrder1 WHERE Closed = 0 OR Closed IS NULL")
        open_orders = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM EM_tblOrder1 WHERE Closed = 1")
        closed_orders = c.fetchone()[0]

        c.execute("SELECT COUNT(DISTINCT MachineID) FROM EM_tblOrder3 WHERE MachineID IS NOT NULL AND MachineID != ''")
        total_machines = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM EM_tblOrder2")
        total_items = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM maintenance_task_images")
        total_photos = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM maintenance_task_templates WHERE SampleImageUrl IS NOT NULL")
        templates_with_samples = c.fetchone()[0]

        c.execute("""
            SELECT sync_time, days_requested, orders_synced, items_synced, status, message, duration_seconds
            FROM sync_history
            ORDER BY id DESC LIMIT 1
        """)
        last_sync_row = c.fetchone()
        last_sync = None
        if last_sync_row:
            last_sync = {
                "sync_time": last_sync_row["sync_time"],
                "days_requested": last_sync_row["days_requested"],
                "orders_synced": last_sync_row["orders_synced"],
                "items_synced": last_sync_row["items_synced"],
                "status": last_sync_row["status"],
                "message": last_sync_row["message"],
                "duration_seconds": last_sync_row["duration_seconds"]
            }

        return {
            "total_orders": total_orders,
            "open_orders": open_orders,
            "closed_orders": closed_orders,
            "total_machines": total_machines,
            "total_items": total_items,
            "total_photos": total_photos,
            "templates_with_samples": templates_with_samples,
            "nas_storage_path": NAS_DIR,
            "last_sync": last_sync
        }
    finally:
        conn.close()

@app.get("/api/orders")
def list_orders(
    search: Optional[str] = None,
    status: Optional[str] = "all",
    percent: Optional[str] = "all",
    percent_type: Optional[str] = "staff",
    month: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100)
):
    conn = get_connection()
    c = conn.cursor()
    try:
        where_clauses = []
        params = []

        if month and month.strip() and month.lower() != "all":
            where_clauses.append("strftime('%Y-%m', o1.EntryDate) = ?")
            params.append(month.strip())

        if status == "open":
            where_clauses.append("(o1.Closed = 0 OR o1.Closed IS NULL)")
        elif status == "closed":
            where_clauses.append("o1.Closed = 1")

        if percent in ("100", "under_100", "under"):
            if percent == "100":
                if percent_type == "staff":
                    where_clauses.append("""
                        (EXISTS (SELECT 1 FROM maintenance_machine_tasks mmt WHERE mmt.EntryID = o1.EntryID)
                         AND NOT EXISTS (
                             SELECT 1 FROM maintenance_machine_tasks mmt 
                             WHERE mmt.EntryID = o1.EntryID AND (mmt.Status != 'COMPLETED' OR mmt.Status IS NULL)
                         ))
                    """)
                elif percent_type == "either":
                    where_clauses.append("""
                        ((o1.Closed = 1 OR (o1.ProcER IS NOT NULL AND o1.ProcER >= 100))
                         OR (EXISTS (SELECT 1 FROM maintenance_machine_tasks mmt WHERE mmt.EntryID = o1.EntryID)
                             AND NOT EXISTS (
                                 SELECT 1 FROM maintenance_machine_tasks mmt 
                                 WHERE mmt.EntryID = o1.EntryID AND (mmt.Status != 'COMPLETED' OR mmt.Status IS NULL)
                             )))
                    """)
                else:
                    where_clauses.append("(o1.Closed = 1 OR (o1.ProcER IS NOT NULL AND o1.ProcER >= 100))")
            else: # under 100%
                if percent_type == "staff":
                    where_clauses.append("""
                        (NOT EXISTS (SELECT 1 FROM maintenance_machine_tasks mmt WHERE mmt.EntryID = o1.EntryID)
                         OR EXISTS (
                             SELECT 1 FROM maintenance_machine_tasks mmt 
                             WHERE mmt.EntryID = o1.EntryID AND (mmt.Status != 'COMPLETED' OR mmt.Status IS NULL)
                         ))
                    """)
                elif percent_type == "either":
                    where_clauses.append("""
                        (((o1.Closed = 0 OR o1.Closed IS NULL) AND (o1.ProcER IS NULL OR o1.ProcER < 100))
                         AND (NOT EXISTS (SELECT 1 FROM maintenance_machine_tasks mmt WHERE mmt.EntryID = o1.EntryID)
                              OR EXISTS (
                                  SELECT 1 FROM maintenance_machine_tasks mmt 
                                  WHERE mmt.EntryID = o1.EntryID AND (mmt.Status != 'COMPLETED' OR mmt.Status IS NULL)
                              )))
                    """)
                else:
                    where_clauses.append("((o1.Closed = 0 OR o1.Closed IS NULL) AND (o1.ProcER IS NULL OR o1.ProcER < 100))")


        if search and search.strip():
            s = f"%{search.strip()}%"
            where_clauses.append("""
                (o1.EntryID LIKE ? OR w.WorkText LIKE ? OR o1.Memo LIKE ? OR o1.DepartID LIKE ? 
                 OR EXISTS (
                     LEFT JOIN CL_tblMacList mac ON o3.MachineID = mac.MachineID
                     WHERE o3.MRowID = o1.MRowID AND (o3.MachineID LIKE ? OR mac.MachineText LIKE ? OR o3.Emp1ID LIKE ?)
                 ))
            """)
            params.extend([s, s, s, s, s, s, s])

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        count_sql = f"""
            SELECT COUNT(*)
            FROM EM_tblOrder1 o1
            LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
            {where_sql}
        """
        c.execute(count_sql, params)
        total_count = c.fetchone()[0]

        offset = (page - 1) * limit
        data_sql = f"""
            SELECT 
                o1.MRowID,
                o1.EntryID,
                o1.EntryDate,
                o1.WorkID,
                w.WorkText,
                o1.DepartID,
                o1.Memo,
                o1.Stoptime,
                o1.Approved,
                o1.Closed,
                o1.ProcER,
                o1.CreatedDate,
                (
                    SELECT GROUP_CONCAT(DISTINCT o3.MachineID)
                    FROM EM_tblOrder3 o3
                    WHERE o3.MRowID = o1.MRowID AND o3.MachineID != ''
                ) AS Machines,
                (
                    SELECT GROUP_CONCAT(DISTINCT o3.MachineID)
                    FROM EM_tblOrder3 o3
                    WHERE o3.MRowID = o1.MRowID AND o3.MachineID != ''
                ) AS MachineIDs,
                (
                    SELECT o3.Emp1ID
                    FROM EM_tblOrder3 o3
                    WHERE o3.MRowID = o1.MRowID AND o3.Emp1ID != ''
                    LIMIT 1
                ) AS MainEmp,
                (
                    SELECT COUNT(*)
                    FROM EM_tblOrder2 o2
                    WHERE o2.MRowID = o1.MRowID
                ) AS ItemCount,
                (
                    SELECT COUNT(*)
                    FROM maintenance_task_images mti
                    WHERE mti.EntryID = o1.EntryID
                ) AS PhotoCount,
                (
                    SELECT COUNT(*)
                    FROM maintenance_machine_tasks mmt
                    WHERE mmt.EntryID = o1.EntryID
                ) AS TotalTasks,
                (
                    SELECT COUNT(*)
                    FROM maintenance_machine_tasks mmt
                    WHERE mmt.EntryID = o1.EntryID AND mmt.Status = 'COMPLETED'
                ) AS CompletedTasks
            FROM EM_tblOrder1 o1
            LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
            {where_sql}
            ORDER BY o1.EntryDate DESC, o1.CreatedDate DESC
            LIMIT ? OFFSET ?
        """
        c.execute(data_sql, params + [limit, offset])
        rows = c.fetchall()

        # Thống kê tổng hợp theo bộ lọc hiện tại:
        # 1. % ERP: tỷ lệ các lệnh bảo trì đã có kết quả trên dữ liệu ERP
        stats_sql = f"""
            SELECT 
                COUNT(*) AS TotalOrders,
                COUNT(CASE WHEN o1.ProcER > 0 OR o1.Closed = 1 THEN 1 END) AS OrdersWithErpResult,
                COUNT(CASE WHEN o1.Closed = 1 THEN 1 END) AS ClosedOrders,
                COUNT(CASE WHEN o1.Closed = 0 OR o1.Closed IS NULL THEN 1 END) AS OpenOrders
            FROM EM_tblOrder1 o1
            LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
            {where_sql}
        """
        c.execute(stats_sql, params)
        st_row = c.fetchone()
        total_orders_cnt = st_row["TotalOrders"] or 0
        erp_res_cnt = st_row["OrdersWithErpResult"] or 0
        erp_res_pct = round((erp_res_cnt / total_orders_cnt) * 100, 1) if total_orders_cnt > 0 else 0.0

        # 2. % do nhân viên cập nhật: tỷ lệ các hạng mục công việc đã hoàn thành
        task_stats_sql = f"""
            SELECT 
                COUNT(mmt.id) AS TotalTasks,
                COUNT(CASE WHEN mmt.Status = 'COMPLETED' THEN 1 END) AS CompletedTasks
            FROM maintenance_machine_tasks mmt
            JOIN EM_tblOrder1 o1 ON mmt.EntryID = o1.EntryID
            LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
            {where_sql}
        """
        c.execute(task_stats_sql, params)
        t_row = c.fetchone()
        tot_tasks = t_row["TotalTasks"] or 0
        comp_tasks = t_row["CompletedTasks"] or 0
        staff_overall_pct = round((comp_tasks / tot_tasks) * 100, 1) if tot_tasks > 0 else 0.0

        orders = []
        for r in rows:
            is_closed = (r["Closed"] == 1)
            proc_er = r["ProcER"] if ("ProcER" in r.keys() and r["ProcER"] is not None) else None
            total_tasks = r["TotalTasks"] or 0
            completed_tasks = r["CompletedTasks"] or 0

            # 1. % do nhân viên cập nhật: tính theo tỷ lệ các hạng mục công việc đã hoàn thành trên app
            staff_pct = int(round((completed_tasks / total_tasks) * 100)) if total_tasks > 0 else 0

            # 2. % ERP: là % các lệnh bảo trì đã có kết quả trên dữ liệu ERP
            if proc_er is not None and proc_er > 0:
                erp_pct = int(round(proc_er))
                has_erp_result = True
            elif is_closed:
                erp_pct = 100
                has_erp_result = True
            else:
                erp_pct = 0
                has_erp_result = False

            orders.append({
                "MRowID": r["MRowID"],
                "EntryID": r["EntryID"],
                "EntryDate": r["EntryDate"],
                "WorkID": r["WorkID"],
                "WorkText": r["WorkText"] or "Chưa phân loại",
                "DepartID": r["DepartID"] or "",
                "Memo": r["Memo"] or "",
                "Stoptime": r["Stoptime"] or 0,
                "Approved": r["Approved"],
                "Closed": r["Closed"],
                "ProcER": proc_er,
                "CreatedDate": r["CreatedDate"],
                "Machines": r["Machines"] or "Chưa gán máy",
                "MainEmp": r["MainEmp"] or "Chưa phân công",
                "ItemCount": r["ItemCount"],
                "PhotoCount": r["PhotoCount"],
                "TotalTasks": total_tasks,
                "CompletedTasks": completed_tasks,
                "StaffPercent": staff_pct,
                "ErpPercent": erp_pct,
                "HasErpResult": has_erp_result,
                "CompletionPercent": staff_pct
            })

        total_pages = (total_count + limit - 1) // limit if total_count > 0 else 1

        return {
            "orders": orders,
            "total": total_count,
            "page": page,
            "limit": limit,
            "pages": total_pages
        }
    finally:
        conn.close()


@app.get("/api/orders/{entry_id}")
def get_order_detail(entry_id: str):
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT 
                o1.MRowID, o1.EntryID, o1.EntryDate, o1.WorkID, w.WorkText, w.CycleDay, w.CycleHour, w.WorkType,
                o1.ModelID, o1.DepartID, o1.BranchID, o1.PeriodID, o1.Memo, o1.Stoptime,
                o1.Approved, o1.Closed, o1.Colored, o1.ProcER, o1.CreatorID, o1.CreatedDate
            FROM EM_tblOrder1 o1
            LEFT JOIN EM_tblWork1 w ON o1.WorkID = w.WorkID
            WHERE o1.EntryID = ?
        """, (entry_id,))
        header_row = c.fetchone()
        if not header_row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy lệnh bảo dưỡng {entry_id}")

        mrow_id = header_row["MRowID"]
        header = dict(header_row)

        c.execute("""
            SELECT DRowID, MachineID, WorkDate, Emp1ID, Emp2ID, Emp3ID, Emp4ID, Emp5ID, Remark, EMdRowID
            FROM EM_tblOrder3
            WHERE MRowID = ?
            ORDER BY MachineID ASC
        """, (mrow_id,))
        machines = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT 
                o2.DRowID, o2.NodeID, n.NodeText, o2.ServiceID, s.ServiceText,
                o2.StaffQty, o2.Duration, o2.ItemID, o2.WHouseID, o2.Unit1Qty, o2.Remark, o2.iRow
            FROM EM_tblOrder2 o2
            LEFT JOIN EM_tblService s ON o2.ServiceID = s.ServiceID
            LEFT JOIN EM_tblNode n ON o2.NodeID = n.NodeID
            WHERE o2.MRowID = ?
            ORDER BY o2.iRow ASC
        """, (mrow_id,))
        tasks_items = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT 
                MRowID, EntryID, EntryDate, MachineID, WorkID, DepartID, Memo, Stoptime,
                HourOdo, RevEmpID, RevName, RevText, RevCode, Approved, Closed, CreatedDate
            FROM EM_tblResult1
            WHERE EOmRowID = ?
            ORDER BY EntryDate DESC
        """, (mrow_id,))
        results = [dict(r) for r in c.fetchall()]

        proc_er = header.get("ProcER")
        is_closed = (header.get("Closed") == 1)
        if proc_er is not None and proc_er > 0:
            header["ErpPercent"] = int(round(proc_er))
            header["HasErpResult"] = True
        elif is_closed:
            header["ErpPercent"] = 100
            header["HasErpResult"] = True
        else:
            header["ErpPercent"] = 0

        # Tính tiến độ nhân viên cập nhật & tiến độ ERP cho chi tiết lệnh
        c.execute("""
            SELECT 
                COUNT(*) as TotalTasks,
                COUNT(CASE WHEN Status = 'COMPLETED' THEN 1 END) as CompletedTasks
            FROM maintenance_machine_tasks
            WHERE EntryID = ?
        """, (entry_id,))
        task_counts = c.fetchone()
        tot_t = task_counts["TotalTasks"] or 0
        comp_t = task_counts["CompletedTasks"] or 0
        header["TotalTasks"] = tot_t
        header["CompletedTasks"] = comp_t
        header["StaffPercent"] = int(round((comp_t / tot_t) * 100)) if tot_t > 0 else 0

        # Tính % ERP theo số máy đã thực hiện có Phiếu kết quả trên data ERP
        c.execute("""
            SELECT 
                COUNT(DISTINCT o3.MachineID) as TotalMachines,
                (SELECT COUNT(DISTINCT r1.MachineID) FROM EM_tblResult1 r1 WHERE r1.EOmRowID = ? AND r1.MachineID != '') as ErpResultMachines,
                (SELECT COUNT(*) FROM EM_tblResult1 r1 WHERE r1.EOmRowID = ?) as ErpTotalResults
            FROM EM_tblOrder3 o3
            WHERE o3.MRowID = ? AND o3.MachineID != ''
        """, (mrow_id, mrow_id, mrow_id))
        mac_counts = c.fetchone()
        tot_m = mac_counts["TotalMachines"] if (mac_counts and mac_counts["TotalMachines"]) else len(machines)
        erp_m = mac_counts["ErpResultMachines"] if (mac_counts and mac_counts["ErpResultMachines"]) else 0
        erp_res_tot = mac_counts["ErpTotalResults"] if (mac_counts and mac_counts["ErpTotalResults"]) else len(results)

        if tot_m > 0:
            actual_erp_m = min(tot_m, erp_m if erp_m > 0 else erp_res_tot)
            header["TotalMachines"] = tot_m
            header["ErpResultMachines"] = actual_erp_m
            header["ErpPercent"] = int(round((actual_erp_m / tot_m) * 100))
            header["HasErpResult"] = (actual_erp_m > 0)
        else:
            if erp_res_tot > 0:
                header["TotalMachines"] = 1
                header["ErpResultMachines"] = 1
                header["ErpPercent"] = 100
                header["HasErpResult"] = True
            else:
                header["TotalMachines"] = 0
                header["ErpResultMachines"] = 0
                header["ErpPercent"] = 0
                header["HasErpResult"] = False
        header["CompletionPercent"] = header["StaffPercent"]

        return {
            "order": header,
            "machines": machines,
            "tasks_items": tasks_items,
            "results": results
        }
    finally:
        conn.close()

@app.post("/api/inventory/requests")
def create_inventory_request(
    payload: InventoryIssueRequestCreate,
    background_tasks: BackgroundTasks,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tạo phiếu yêu cầu xuất kho nội bộ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        req_date = now.strftime("%Y-%m-%d")
        
        prefix = f"REQ-{now.strftime('%y%m')}"
        c.execute("SELECT COUNT(*) FROM warehouse_issue_requests WHERE RequestCode LIKE ?", (f"{prefix}%",))
        seq = (c.fetchone()[0] or 0) + 1
        req_code = f"{prefix}-{seq:04d}"

        requester = payload.RequestedBy or (current_user["full_name"] if current_user else "Kỹ thuật viên")
        
        # Suy luận WHouseID nếu không chọn kho ở đầu phiếu
        whouse_id = (payload.WHouseID or "").strip()
        if not whouse_id and payload.Items:
            whouse_id = (payload.Items[0].WHouseID or "").strip()
        if not whouse_id:
            whouse_id = 'VT'

        purpose = (payload.Purpose or "").strip() or "Xuất sử dụng bảo trì kỹ thuật"
        approval_token = secrets.token_urlsafe(32)

        c.execute("""
            INSERT INTO warehouse_issue_requests 
            (RequestCode, RequestDate, RequestedBy, Department, WHouseID, Purpose, MachineID, Status, Notes, ApprovalToken, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
        """, (req_code, req_date, requester, payload.Department or 'KỸ THUẬT', whouse_id, purpose, payload.MachineID or '', payload.Notes or '', approval_token, now_str, now_str))
        
        request_id = c.lastrowid

        for item in payload.Items:
            c.execute("""
                INSERT INTO warehouse_issue_items
                (RequestID, ItemID, ItemText, WHouseID, Unit, StorageID, RequestedQty, IssuedQty, Remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (request_id, item.ItemID, item.ItemText, item.WHouseID or whouse_id or '', item.Unit or 'Cái', item.StorageID or 'ZZZ', item.RequestedQty, item.Remark or ''))

        conn.commit()

        # Thông báo email cho thủ kho ở background
        background_tasks.add_task(notify_warehouse_keeper_request, request_id)

        return {
            "status": "success",
            "request_id": request_id,
            "request_code": req_code,
            "message": f"Tạo phiếu yêu cầu xuất kho {req_code} thành công."
        }
    finally:
        conn.close()


# -------------------------------------------------------------------------
# EMPLOYEES DIRECTORY API (CƠ ĐIỆN & KỸ THUẬT)
# -------------------------------------------------------------------------

@app.get("/api/internal-tasks/employees")
def get_internal_employees(department: Optional[str] = None):
    """Danh bạ nhân sự thực hiện công việc (Bộ phận Cơ điện & Phòng Kỹ thuật)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sql = "SELECT id, EmpID, EmpName, Department, PositionID, PositionText FROM internal_employees WHERE IsActive = 1"
        params = []
        if department:
            sql += " AND Department = ?"
            params.append(department)
        sql += " ORDER BY Department ASC, EmpName ASC"
        c.execute(sql, params)
        emps = [dict(r) for r in c.fetchall()]

        grouped = {}
        for emp in emps:
            dept = emp["Department"]
            if dept not in grouped:
                grouped[dept] = []
            grouped[dept].append(emp)

        return {"employees": emps, "grouped": grouped}
    finally:
        conn.close()


# -------------------------------------------------------------------------
# RECURRING TEMPLATES CRUD
# -------------------------------------------------------------------------

def sync_missing_recurring_templates(c, conn):
    """
    Tự động đồng bộ / khôi phục các hạng mục định kỳ bị thiếu trong bảng internal_task_recurring_templates
    khi có công việc (internal_work_orders) tham chiếu tới RecurringTemplateID mà template đó chưa có trong DB.
    """
    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")

    # Hợp nhất task thử nghiệm id 19 vào template 20 nếu có
    try:
        c.execute("SELECT id FROM internal_work_orders WHERE RecurringTemplateID = 19")
        r19 = c.fetchall()
        if r19:
            c.execute("UPDATE internal_work_orders SET RecurringTemplateID = 20 WHERE RecurringTemplateID = 19")
            c.execute("UPDATE internal_task_items SET TemplateID = 20 WHERE TemplateID = 19")
    except Exception:
        pass

    # Tìm tất cả RecurringTemplateID trong internal_work_orders mà chưa có trong internal_task_recurring_templates
    c.execute("""
        SELECT DISTINCT RecurringTemplateID 
        FROM internal_work_orders 
        WHERE RecurringTemplateID IS NOT NULL 
          AND RecurringTemplateID > 0 
          AND RecurringTemplateID NOT IN (SELECT id FROM internal_task_recurring_templates)
    """)
    missing_ids = [r[0] for r in c.fetchall()]
    if not missing_ids:
        return

    import re

    for tpl_id in missing_ids:
        c.execute("""
            SELECT * FROM internal_work_orders 
            WHERE RecurringTemplateID = ? 
            ORDER BY id DESC LIMIT 1
        """, (tpl_id,))
        wo = c.fetchone()
        if not wo:
            continue
        wo = dict(wo)

        cycle_info = wo.get("CycleInfo") or ""
        if "tháng" in cycle_info.lower():
            cycle_type = "MONTHLY_DAYS"
            digits = re.findall(r'\d+', cycle_info)
            monthly_days = ", ".join(digits) if digits else "1, 15"
            interval_days = 0
        else:
            cycle_type = "INTERVAL_DAYS"
            digits = re.findall(r'\d+', cycle_info)
            interval_days = int(digits[0]) if digits else 10
            monthly_days = ""

        tpl_code = generate_next_template_code(c)
        next_due = wo.get("NextDueDate") or now.date().isoformat()

        c.execute("""
            INSERT INTO internal_task_recurring_templates
            (id, TemplateCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName, AssignedTo,
             Description, CycleType, IntervalDays, MonthlyDays, AutoRecreateOnComplete, IsActive,
             NextDueDate, LastSpawnedAt, CurrentTaskID, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)
        """, (
            tpl_id, tpl_code, wo.get("TaskTitle") or "Công việc định kỳ",
            wo.get("TaskType") or "INTERNAL", wo.get("MachineID") or "",
            wo.get("Priority") or "NORMAL", wo.get("Department") or "KỸ THUẬT",
            wo.get("RequesterName") or "KỸ THUẬT", wo.get("AssignedTo") or "",
            wo.get("Description") or "", cycle_type, interval_days, monthly_days,
            next_due, wo.get("CreatedAt") or now_str, wo.get("id"),
            wo.get("CreatedAt") or now_str, now_str
        ))

        # Kiểm tra và đồng bộ các hạng mục chuẩn (Master checklist items) cho template này
        c.execute("""
            SELECT COUNT(*) FROM internal_task_items 
            WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)
        """, (tpl_id,))
        master_count = c.fetchone()[0]

        if master_count == 0:
            c.execute("""
                SELECT ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Note, SampleImageUrl, SampleImagePath, StandardGuideline
                FROM internal_task_items
                WHERE TaskID = ?
                ORDER BY ItemOrder ASC, id ASC
            """, (wo["id"],))
            wo_items = c.fetchall()
            for idx, itm in enumerate(wo_items, start=1):
                itm_dict = dict(itm)
                c.execute("""
                    INSERT INTO internal_task_items
                    (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
                """, (
                    tpl_id, itm_dict.get('ItemOrder') or idx, itm_dict.get('ItemTitle', '').strip(),
                    itm_dict.get('AssignedEmpID') or '', itm_dict.get('AssignedTo') or '',
                    itm_dict.get('Department') or 'Cơ điện', itm_dict.get('Note') or '',
                    itm_dict.get('SampleImageUrl') or '', itm_dict.get('SampleImagePath') or '',
                    itm_dict.get('StandardGuideline') or '',
                    now_str, now_str
                ))

    conn.commit()


@app.get("/api/internal-tasks/recurring-templates")
def get_recurring_templates():
    """Danh mục các hạng mục / công việc có chu kỳ định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        c.execute("""
            SELECT t.*, 
                   (SELECT COUNT(*) FROM internal_work_orders w WHERE w.RecurringTemplateID = t.id) as TotalSpawned,
                   (SELECT COUNT(*) FROM internal_task_items i WHERE i.TemplateID = t.id AND (i.TaskID IS NULL OR i.TaskID = 0)) as TotalItems
            FROM internal_task_recurring_templates t
            ORDER BY t.id DESC
        """)
        templates = [dict(r) for r in c.fetchall()]
        return {"templates": templates}
    finally:
        conn.close()


@app.post("/api/internal-tasks/recurring-templates")
def create_recurring_template(
    payload: RecurringTemplateCreate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tạo mới hạng mục công việc định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        tpl_code = generate_next_template_code(c)

        # Tính toán ngày đến hạn đầu tiên
        next_due = compute_next_due_date(
            cycle_type=payload.CycleType,
            interval_days=payload.IntervalDays or 0,
            monthly_days=payload.MonthlyDays or "",
            from_date=now.date()
        )

        c.execute("""
            INSERT INTO internal_task_recurring_templates
            (TemplateCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName, AssignedTo,
             Description, CycleType, IntervalDays, MonthlyDays, AutoRecreateOnComplete, IsActive,
             NextDueDate, LastSpawnedAt, CurrentTaskID, SampleImageUrl, SampleImagePath, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        """, (
            tpl_code, payload.TaskTitle, payload.TaskType, payload.MachineID or '',
            payload.Priority or 'NORMAL', payload.Department or 'KỸ THUẬT', payload.RequesterName,
            payload.AssignedTo or '', payload.Description or '', payload.CycleType,
            payload.IntervalDays or 0, (payload.MonthlyDays or '').strip(),
            1 if payload.AutoRecreateOnComplete else 0,
            1 if payload.IsActive else 0,
            next_due, payload.SampleImageUrl, payload.SampleImagePath, now_str, now_str
        ))
        template_id = c.lastrowid

        # Lưu các hạng mục công việc con nếu có
        raw_items = payload.Items or payload.items
        if raw_items:
            for idx, itm in enumerate(raw_items, start=1):
                note_str = itm.Note or itm.Notes or ''
                c.execute("""
                    INSERT INTO internal_task_items
                    (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
                """, (
                    template_id, itm.ItemOrder or idx, itm.ItemTitle.strip(),
                    itm.AssignedEmpID or '', itm.AssignedTo or '',
                    itm.Department or 'Cơ điện', note_str,
                    itm.SampleImageUrl or '', itm.SampleImagePath or '',
                    itm.StandardGuideline or '',
                    now_str, now_str
                ))

        spawned_task = None
        if payload.SpawnImmediately and payload.IsActive:
            spawned_task = spawn_task_from_template(c, template_id, from_date=now.date(), creator=current_user["full_name"] if current_user else payload.RequesterName)

        conn.commit()

        msg = f"Tạo hạng mục định kỳ {tpl_code} thành công."
        if spawned_task:
            msg += f" Đã khởi tạo công việc đầu tiên: {spawned_task['task_code']} (Hạn: {spawned_task['next_due_date']})."

        return {
            "status": "success",
            "template_id": template_id,
            "template_code": tpl_code,
            "message": msg,
            "spawned_task": spawned_task
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo hạng mục định kỳ: {str(e)}")
    finally:
        conn.close()


@app.get("/api/internal-tasks/recurring-templates/{template_id}")
def get_recurring_template_detail(template_id: int):
    """Chi tiết hạng mục định kỳ và lịch sử các công việc đã sinh"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        c.execute("SELECT * FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        tpl = c.fetchone()
        if not tpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục định kỳ.")

        tpl_dict = dict(tpl)
        c.execute("""
            SELECT id, TaskCode, TaskTitle, Status, ReportedAt, CompletedAt, NextDueDate, RecurringCount
            FROM internal_work_orders
            WHERE RecurringTemplateID = ?
            ORDER BY id DESC LIMIT 20
        """, (template_id,))
        tpl_dict["history"] = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT id, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Note, SampleImageUrl, SampleImagePath, StandardGuideline
            FROM internal_task_items
            WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)
            ORDER BY ItemOrder ASC, id ASC
        """, (template_id,))
        tpl_dict["items"] = [dict(r) for r in c.fetchall()]

        return tpl_dict
    finally:
        conn.close()
@app.post("/api/inventory/items/{item_id}/unreceive")
def unreceive_inventory_item(
    item_id: int,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Hủy đánh dấu nhận hàng cho vật tư"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("UPDATE warehouse_issue_items SET IsReceived = 0, ReceivedAt = NULL, ReceivedBy = NULL WHERE id = ?", (item_id,))
        c.execute("UPDATE warehouse_issue_items SET IsReceived = 0, ReceivedAt = NULL, ReceivedBy = NULL WHERE id = ?", (item_id,))
        conn.commit()
        return {"status": "success", "message": "Đã hủy trạng thái nhận hàng.", "item_id": item_id}
    finally:
        conn.close()

@app.post("/api/inventory/items/{item_id}/cancel")
def cancel_inventory_issue_item(
    item_id: int,
    payload: Optional[dict] = Body(None),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Đánh dấu hủy mặt hàng đã thêm vào phiếu yêu cầu xuất kho"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT i.id, i.RequestID, i.ItemID, i.ItemText, i.IsReceived, i.IsCancelled, r.RequestedBy, r.Status as RequestStatus
            FROM warehouse_issue_items i
            JOIN warehouse_issue_requests r ON i.RequestID = r.id
            WHERE i.id = ?
        """, (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy mặt hàng yêu cầu.")

        if item["IsReceived"]:
            raise HTTPException(status_code=400, detail="Mặt hàng đã nhận xuất kho, vui lòng hủy nhận trước nếu cần hủy.")

        user_name = (payload.get("cancelled_by") if payload else None) or (current_user["full_name"] if current_user else (item["RequestedBy"] or "Người tạo"))
        reason = (payload.get("reason") if payload else "") or "Người tạo đánh dấu hủy"
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        c.execute("""
            UPDATE warehouse_issue_items
            SET IsCancelled = 1, CancelledAt = ?, CancelledBy = ?, CancelReason = ?
            WHERE id = ?
        """, (now_str, user_name, reason, item_id))
        conn.commit()

        return {
            "status": "success",
            "message": f"Đã đánh dấu hủy mặt hàng {item['ItemText']}.",
            "item_id": item_id
        }
    finally:
        conn.close()

@app.post("/api/inventory/items/{item_id}/uncancel")
def uncancel_inventory_issue_item(
    item_id: int,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Khôi phục mặt hàng đã bị đánh dấu hủy"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            UPDATE warehouse_issue_items
            SET IsCancelled = 0, CancelledAt = NULL, CancelledBy = NULL, CancelReason = NULL
            WHERE id = ?
        """, (item_id,))
        conn.commit()
        return {"status": "success", "message": "Đã khôi phục mặt hàng thành công.", "item_id": item_id}
    finally:
        conn.close()

@app.get("/api/inventory/issue-items")
def get_inventory_issue_items(
    voucher_filter: str = "unassigned",  # 'unassigned', 'assigned', 'all'
    receipt_filter: str = "all",          # 'all', 'unreceived', 'received'
    whouse_id: Optional[str] = None,
    search: Optional[str] = None
):
    """Lấy danh sách chi tiết các mặt hàng cần xuất từ các phiếu yêu cầu (dạng bảng phẳng)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sql = """
            SELECT 
                i.id as item_id,
                i.RequestID,
                i.ItemID,
                i.ItemText,
                i.Unit,
                i.StorageID,
                i.RequestedQty,
                i.IssuedQty,
                i.Remark as ItemRemark,
                i.WHouseID as ItemWHouseID,
                i.VoucherCode,
                i.IsReceived,
                i.ReceivedAt,
                i.ReceivedBy,
                i.ReceivedPhotoUrl,
                i.IsCancelled,
                i.CancelledAt,
                i.CancelledBy,
                i.CancelReason,
                r.RequestCode,
                r.RequestDate,
                r.RequestedBy,
                r.Department,
                r.WHouseID as RequestWHouseID,
                r.Purpose as RequestPurpose,
                r.MachineID,
                r.Status as RequestStatus
            FROM warehouse_issue_items i
            JOIN warehouse_issue_requests r ON i.RequestID = r.id
            WHERE 1=1
        """
        params = []

        if voucher_filter == "unassigned":
            sql += " AND (i.VoucherCode IS NULL OR trim(i.VoucherCode) = '')"
        elif voucher_filter == "assigned":
            sql += " AND (i.VoucherCode IS NOT NULL AND trim(i.VoucherCode) != '')"

        if receipt_filter == "unreceived":
            sql += " AND (i.IsReceived IS NULL OR i.IsReceived = 0)"
        elif receipt_filter == "received":
            sql += " AND i.IsReceived = 1"
        
        if whouse_id and whouse_id.strip() and whouse_id.strip() != "all":
            sql += " AND (i.WHouseID = ? OR (i.WHouseID = '' AND r.WHouseID = ?))"
            params.extend([whouse_id.strip(), whouse_id.strip()])

        if search and search.strip():
            s = f"%{search.strip()}%"
            sql += " AND (i.ItemID LIKE ? OR i.ItemText LIKE ? OR r.RequestCode LIKE ? OR r.Purpose LIKE ? OR i.Remark LIKE ?)"
            params.extend([s, s, s, s, s])

        sql += " ORDER BY i.id DESC LIMIT 500"

        c.execute(sql, params)
        items = [dict(row) for row in c.fetchall()]
        return {"items": items, "count": len(items)}
    finally:
        conn.close()

@app.post("/api/inventory/issue-items/assign-voucher")
def assign_voucher_to_items(
    payload: InventoryAssignVoucherPayload,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Gán hoặc xóa mã đơn / số phiếu xuất ERP cho các vật tư đã chọn"""
    conn = get_connection()
    c = conn.cursor()
    try:
        voucher_code = (payload.voucher_code or "").strip()
        updated_count = 0

        # Nếu truyền danh sách item_ids
        if payload.item_ids:
            placeholders = ",".join("?" for _ in payload.item_ids)
            c.execute(f"""
                UPDATE warehouse_issue_items 
                SET VoucherCode = ? 
                WHERE id IN ({placeholders})
            """, [voucher_code] + payload.item_ids)
            updated_count += c.rowcount

        # Nếu truyền danh sách request_ids
        if payload.request_ids:
            placeholders = ",".join("?" for _ in payload.request_ids)
            # Cập nhật các items thuộc request
            c.execute(f"""
                UPDATE warehouse_issue_items 
                SET VoucherCode = ? 
                WHERE RequestID IN ({placeholders})
            """, [voucher_code] + payload.request_ids)
            updated_count += c.rowcount

            # Cập nhật luôn request
            c.execute(f"""
                UPDATE warehouse_issue_requests 
                SET VoucherCode = ? 
                WHERE id IN ({placeholders})
            """, [voucher_code] + payload.request_ids)

        conn.commit()
        return {
            "status": "success",
            "message": f"Đã gán mã đơn '{voucher_code}' cho {updated_count} vật tư thành công." if voucher_code else f"Đã xóa mã đơn cho {updated_count} vật tư.",
            "updated_count": updated_count,
            "voucher_code": voucher_code
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi gán mã đơn: {str(e)}")
    finally:
        conn.close()

@app.get("/api/system/email-settings")
def get_system_email_settings(current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Lấy cấu hình gửi Email hệ thống"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM system_email_settings WHERE id = 1")
        row = c.fetchone()
        if not row:
            return {
                "SmtpHost": "smtp.gmail.com",
                "SmtpPort": 587,
                "SmtpUser": "",
                "SmtpFromEmail": "",
                "SmtpFromName": "BOPP EM Maintenance",
                "UseTls": 1,
                "WarehouseKeeperEmails": "",
                "NotifyWarehouseOnCreate": 1,
                "BaseAppUrl": "http://localhost:8082",
                "HasPassword": False
            }
        d = dict(row)
        d["HasPassword"] = bool(d.get("SmtpPassword"))
        d["SmtpPassword"] = "" # Không bao giờ lộ mật khẩu ra client
        return d
    finally:
        conn.close()

@app.delete("/api/internal-tasks/recurring-templates/{template_id}")
def delete_recurring_template(template_id: int):
    """Xóa hạng mục định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa hạng mục định kỳ thành công."}
    finally:
        conn.close()

def delete_recurring_template(template_id: int):
    """Xóa hạng mục định kỳ và dọn dẹp các liên kết"""
    try:
        c.execute("DELETE FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa hạng mục định kỳ thành công."}
    finally:
        conn.close()



@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn")
@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn-now")
def spawn_task_now(template_id: int, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Chủ động tạo ngay một công việc mới từ hạng mục định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        user_name = current_user["full_name"] if current_user else "Kỹ thuật viên"
        spawned = spawn_task_from_template(c, template_id, creator=user_name, allow_paused=True)
        conn.commit()
        return {
            "status": "success",
            "message": f"Đã tạo thành công công việc mới: {spawned['task_code']} (Hạn: {spawned['next_due_date']})",
            "task": spawned
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.put("/api/inventory/requests/{request_id}/status")
def update_inventory_request_status(
    request_id: int,
    payload: InventoryStatusUpdate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Duyệt hoặc Xuất kho cho phiếu yêu cầu"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        user_name = current_user["full_name"] if current_user else "Quản lý"

        c.execute("SELECT id, Status FROM warehouse_issue_requests WHERE id = ?", (request_id,))
        existing = c.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Không tìm thấy phiếu yêu cầu xuất kho.")

        status = payload.Status.upper()
        if status == "APPROVED":
            c.execute("""
                UPDATE warehouse_issue_requests
                SET Status = 'APPROVED', ApprovedBy = ?, ApprovedAt = ?, Notes = COALESCE(?, Notes), UpdatedAt = ?
                WHERE id = ?
            """, (user_name, now_str, payload.Notes, now_str, request_id))
        elif status == "ISSUED":
            c.execute("""
                UPDATE warehouse_issue_requests
                SET Status = 'ISSUED', IssuedBy = ?, IssuedAt = ?, Notes = COALESCE(?, Notes), UpdatedAt = ?
                WHERE id = ?
            """, (user_name, now_str, payload.Notes, now_str, request_id))
            c.execute("UPDATE warehouse_issue_items SET IssuedQty = RequestedQty WHERE RequestID = ?", (request_id,))
        elif status == "REJECTED":
            c.execute("""
                UPDATE warehouse_issue_requests
                SET Status = 'REJECTED', Notes = COALESCE(?, Notes), UpdatedAt = ?
                WHERE id = ?
            """, (payload.Notes, now_str, request_id))
        else:
            raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ (chỉ chấp nhận APPROVED, ISSUED, REJECTED).")

        conn.commit()
        return {"status": "success", "message": f"Cập nhật phiếu #{request_id} thành công: {status}"}
    finally:
        conn.close()
# -------------------------------------------------------------------------
# SUB-ITEMS (CHECKLIST) CRUD FOR WORK ORDERS
# -------------------------------------------------------------------------

@app.get("/api/internal-tasks/{task_id}/items")
def get_task_items(task_id: int):
    """Danh sách các hạng mục con của công việc"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, TaskID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo,
                   Department, Note, Status, CompletedBy, CompletedAt, CreatedAt, UpdatedAt
            FROM internal_task_items
            WHERE TaskID = ?
            ORDER BY ItemOrder ASC, id ASC
        """, (task_id,))
        items = [dict(r) for r in c.fetchall()]
        for item in items:
            c.execute("""
                SELECT id, FileUrl, FileName, Caption, ImageType, UploadedBy, UploadedAt
                FROM internal_task_item_images
                WHERE TaskItemID = ?
                ORDER BY id DESC
            """, (item["id"],))
            item["images"] = [dict(r) for r in c.fetchall()]
        return {"items": items, "total": len(items)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/api/internal-tasks/{task_id}/items")
def add_task_item(
    task_id: int,
    payload: TaskItemCreate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Thêm hạng mục con mới vào công việc"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT id FROM internal_work_orders WHERE id = ?", (task_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")

        c.execute("SELECT COALESCE(MAX(ItemOrder), 0) + 1 FROM internal_task_items WHERE TaskID = ?", (task_id,))
        next_order = c.fetchone()[0]

        order_val = payload.ItemOrder if (payload.ItemOrder is not None and payload.ItemOrder > 0) else next_order

        c.execute("""
            INSERT INTO internal_task_items
            (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
            VALUES (?, NULL, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
        """, (
            task_id, order_val, payload.ItemTitle.strip(),
            payload.AssignedEmpID or '', payload.AssignedTo or '',
            payload.Department or 'Cơ điện', payload.Note or payload.Notes or '',
            payload.SampleImageUrl or '', payload.SampleImagePath or '',
            payload.StandardGuideline or '',
            now_str, now_str
        ))
        item_id = c.lastrowid
        conn.commit()
        return {
            "status": "success",
            "item_id": item_id,
            "message": "Đã thêm hạng mục thành công."
        }
    finally:
        conn.close()


@app.put("/api/internal-tasks/items/{item_id}")
def update_task_item(
    item_id: int,
    payload: TaskItemUpdate,
    background_tasks: BackgroundTasks,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Cập nhật trạng thái hạng mục (PENDING / COMPLETED), người thực hiện, ghi chú, ảnh mẫu"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT * FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục công việc.")

        item = dict(item)
        fields = ["UpdatedAt = ?"]
        values = [now_str]

        user_name = (payload.AssignedTo or (current_user["full_name"] if current_user else "")).strip() or "Kỹ thuật viên"
        user_empid = (payload.AssignedEmpID or (current_user["emp_id"] if current_user and "emp_id" in current_user else "")).strip()

        if payload.Status is not None:
            new_status = payload.Status.upper()
            fields.append("Status = ?")
            values.append(new_status)
            if new_status == "COMPLETED":
                fields.append("CompletedAt = ?")
                values.append(now_str)
                fields.append("CompletedBy = ?")
                values.append(user_name)
                # Người cập nhật hạng mục con chính là người đã thực hiện công việc đó
                fields.append("AssignedTo = ?")
                values.append(user_name)
                if user_empid:
                    fields.append("AssignedEmpID = ?")
                    values.append(user_empid)
            elif new_status == "PENDING":
                fields.append("CompletedAt = NULL")
                fields.append("CompletedBy = NULL")

        if payload.ItemTitle is not None:
            fields.append("ItemTitle = ?")
            values.append(payload.ItemTitle.strip())

        if payload.AssignedEmpID is not None and (payload.Status != "COMPLETED" or not user_empid):
            fields.append("AssignedEmpID = ?")
            values.append(payload.AssignedEmpID)

        if payload.AssignedTo is not None and (payload.Status != "COMPLETED" or not user_name):
            fields.append("AssignedTo = ?")
            values.append(payload.AssignedTo)

        if payload.Department is not None:
            fields.append("Department = ?")
            values.append(payload.Department)

        note_val = payload.Note if payload.Note is not None else payload.Notes
        if note_val is not None:
            fields.append("Note = ?")
            values.append(note_val)

        if payload.ItemOrder is not None:
            fields.append("ItemOrder = ?")
            values.append(payload.ItemOrder)

        if payload.SampleImageUrl is not None:
            fields.append("SampleImageUrl = ?")
            values.append(payload.SampleImageUrl)

        if payload.SampleImagePath is not None:
            fields.append("SampleImagePath = ?")
            values.append(payload.SampleImagePath)

        if payload.StandardGuideline is not None:
            fields.append("StandardGuideline = ?")
            values.append(payload.StandardGuideline)

        if payload.HasIssue is not None:
            fields.append("HasIssue = ?")
            values.append(1 if payload.HasIssue else 0)

        values.append(item_id)
        sql = f"UPDATE internal_task_items SET {', '.join(fields)} WHERE id = ?"
        c.execute(sql, values)

        # Tính toán lại tiến độ công việc cha nếu có TaskID
        task_id = item["TaskID"]
        task_info = None
        if task_id:
            c.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN Status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                FROM internal_task_items WHERE TaskID = ?
            """, (task_id,))
            stat = c.fetchone()
            total = stat['total'] if stat and stat['total'] else 0
            completed = stat['completed'] if stat and stat['completed'] else 0
            pct = int(round((completed / total) * 100)) if total > 0 else 0

            # Nếu công việc đang PENDING mà có hạng mục chuyển sang hoàn thành, tự động chuyển công việc sang IN_PROGRESS
            c.execute("SELECT Status, StartedAt FROM internal_work_orders WHERE id = ?", (task_id,))
            parent = c.fetchone()
            if parent and parent["Status"] == "PENDING" and (completed > 0 or payload.Status in ["IN_PROGRESS", "COMPLETED"]):
                c.execute("UPDATE internal_work_orders SET Status = 'IN_PROGRESS', StartedAt = COALESCE(StartedAt, ?), UpdatedAt = ? WHERE id = ?", (now_str, now_str, task_id))
                background_tasks.add_task(send_task_lifecycle_email, task_id, "STARTED")

            task_info = {
                "task_id": task_id,
                "total_items": total,
                "completed_items": completed,
                "progress_percent": pct
            }

        conn.commit()
        return {
            "status": "success",
            "message": "Cập nhật hạng mục thành công.",
            "item_id": item_id,
            "task_progress": task_info
        }
    finally:
        conn.close()


@app.delete("/api/internal-tasks/items/{item_id}")
def delete_task_item(item_id: int):
    """Xóa hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM internal_task_items WHERE id = ?", (item_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa hạng mục thành công."}
    finally:
        conn.close()




@app.get("/api/system/email-settings")
def get_system_email_settings(current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Lấy cấu hình gửi Email hệ thống"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM system_email_settings WHERE id = 1")
        row = c.fetchone()
        if not row:
            return {
                "SmtpHost": "smtp.gmail.com",
                "SmtpPort": 587,
                "SmtpUser": "",
                "SmtpFromEmail": "",
                "SmtpFromName": "BOPP EM Maintenance",
                "UseTls": 1,
                "WarehouseKeeperEmails": "",
                "NotifyWarehouseOnCreate": 1,
                "BaseAppUrl": "http://localhost:8082",
                "HasPassword": False
            }
        d = dict(row)
        d["HasPassword"] = bool(d.get("SmtpPassword"))
        d["SmtpPassword"] = "" # Không bao giờ lộ mật khẩu ra client
        return d
    finally:
        conn.close()

@app.post("/api/system/email-settings")
def save_system_email_settings(
    payload: EmailSettingsPayload,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Lưu cấu hình gửi Email hệ thống"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT SmtpPassword FROM system_email_settings WHERE id = 1")
        existing = c.fetchone()
        current_pwd = existing["SmtpPassword"] if existing else ""

        # Nếu người dùng nhập mật khẩu mới, cập nhật; nếu để trống hoặc '***', giữ nguyên mật khẩu cũ
        new_pwd = payload.SmtpPassword
        if not new_pwd or new_pwd.strip() == "" or new_pwd.strip() == "***":
            new_pwd = current_pwd

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("""
            INSERT INTO system_email_settings 
            (id, SmtpHost, SmtpPort, SmtpUser, SmtpPassword, SmtpFromEmail, SmtpFromName, UseTls, WarehouseKeeperEmails, NotifyWarehouseOnCreate, BaseAppUrl, UpdatedAt)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                SmtpHost = excluded.SmtpHost,
                SmtpPort = excluded.SmtpPort,
                SmtpUser = excluded.SmtpUser,
                SmtpPassword = excluded.SmtpPassword,
                SmtpFromEmail = excluded.SmtpFromEmail,
                SmtpFromName = excluded.SmtpFromName,
                UseTls = excluded.UseTls,
                WarehouseKeeperEmails = excluded.WarehouseKeeperEmails,
                NotifyWarehouseOnCreate = excluded.NotifyWarehouseOnCreate,
                BaseAppUrl = excluded.BaseAppUrl,
                UpdatedAt = excluded.UpdatedAt
        """, (
            payload.SmtpHost, payload.SmtpPort, payload.SmtpUser, new_pwd,
            payload.SmtpFromEmail or payload.SmtpUser, payload.SmtpFromName or "BOPP EM Maintenance",
            payload.UseTls, payload.WarehouseKeeperEmails or "", payload.NotifyWarehouseOnCreate,
            payload.BaseAppUrl or "http://localhost:8082", now_str
        ))
        conn.commit()
        return {"status": "success", "message": "Đã lưu cấu hình Email thành công."}
    finally:
        conn.close()
@app.get("/api/internal-tasks/employees")
def get_internal_employees(department: Optional[str] = None):
    """Danh bạ nhân sự thực hiện công việc (Bộ phận Cơ điện & Phòng Kỹ thuật)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sql = "SELECT id, EmpID, EmpName, Department, PositionID, PositionText FROM internal_employees WHERE IsActive = 1"
        params = []
        if department:
            sql += " AND Department = ?"
            params.append(department)
        sql += " ORDER BY Department ASC, EmpName ASC"
        c.execute(sql, params)
        emps = [dict(r) for r in c.fetchall()]

        grouped = {}
        for emp in emps:
            dept = emp["Department"]
            if dept not in grouped:
                grouped[dept] = []
            grouped[dept].append(emp)

        return {"employees": emps, "grouped": grouped}
    finally:
        conn.close()


# -------------------------------------------------------------------------
# CATEGORIES: DEPARTMENTS & MACHINES (SQL Server CL_tblMacList & CL_tblObject)
# -------------------------------------------------------------------------

@app.get("/api/categories/departments")
def get_department_categories():
    """Lấy danh mục phòng ban từ SQLite (đồng bộ từ SQL Server CL_tblObject)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT DepartID, DepartName, IsTeam, IsClosed 
            FROM CL_tblDepartment 
            WHERE IsClosed = 0 
            ORDER BY DepartID ASC
        """)
        rows = [dict(r) for r in c.fetchall()]
        return {"departments": rows}
    except Exception as e:
        return {"departments": []}
    finally:
        conn.close()





@app.get("/api/internal-tasks/items/{item_id}/proof-images")
def get_task_item_proof_images(item_id: int):
    """
    Lấy danh sách ảnh thực tế kỹ thuật viên đã chụp khi thực hiện hạng mục này (hoặc các lần làm trước đó)
    để người dùng có thể xem và chọn làm ảnh mẫu chuẩn SOP.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục này.")
        item = dict(item)

        item_title = (item.get("ItemTitle") or "").strip()
        task_id = item.get("TaskID")
        template_id = item.get("TemplateID")

        candidate_images = []
        seen_urls = set()

        # 1. Ảnh đính kèm trực tiếp cho hạng mục này
        c.execute("""
            SELECT id, TaskID, ImageType, FileUrl, FileName, Caption, UploadedBy, UploadedAt, TaskItemID
            FROM internal_work_images
            WHERE TaskItemID = ?
            ORDER BY UploadedAt DESC
        """, (item_id,))
        for r in c.fetchall():
            d = dict(r)
            d["Source"] = "internal_item"
            d["SourceTitle"] = "Ảnh chụp trực tiếp cho hạng mục này"
            if d["FileUrl"] not in seen_urls:
                seen_urls.add(d["FileUrl"])
                candidate_images.append(d)

        # 2. Ảnh từ công việc hiện tại (TaskID)
        if task_id:
            c.execute("""
                SELECT i.id, i.TaskID, i.ImageType, i.FileUrl, i.FileName, i.Caption, i.UploadedBy, i.UploadedAt, i.TaskItemID,
                       t.TaskCode, t.TaskTitle, t.MachineID
                FROM internal_work_images i
                JOIN internal_work_orders t ON i.TaskID = t.id
                WHERE i.TaskID = ?
                ORDER BY i.UploadedAt DESC
            """, (task_id,))
            for r in c.fetchall():
                d = dict(r)
                d["Source"] = "current_task"
                d["SourceTitle"] = f"Phiếu #{d.get('TaskCode', '')} ({d.get('TaskTitle', '')})"
                if d["FileUrl"] not in seen_urls:
                    seen_urls.add(d["FileUrl"])
                    candidate_images.append(d)

        # 3. Ảnh từ các công việc khác có cùng hạng mục con (ItemTitle tương tự) hoặc cùng Template
        query_parts = []
        params = []

        if template_id:
            query_parts.append("t.RecurringTemplateID = ?")
            params.append(template_id)
        if item_title:
            query_parts.append("ti.ItemTitle = ?")
            params.append(item_title)

        if query_parts:
            sql = f"""
                SELECT DISTINCT i.id, i.TaskID, i.ImageType, i.FileUrl, i.FileName, i.Caption, i.UploadedBy, i.UploadedAt, i.TaskItemID,
                                t.TaskCode, t.TaskTitle, t.MachineID
                FROM internal_work_images i
                JOIN internal_task_items ti ON i.TaskItemID = ti.id
                JOIN internal_work_orders t ON ti.TaskID = t.id
                WHERE ({' OR '.join(query_parts)})
                ORDER BY i.UploadedAt DESC LIMIT 30
            """
            c.execute(sql, params)
            for r in c.fetchall():
                d = dict(r)
                d["Source"] = "other_tasks"
                d["SourceTitle"] = f"Phiếu #{d.get('TaskCode', '')} ({d.get('TaskTitle', '')})"
                if d["FileUrl"] not in seen_urls:
                    seen_urls.add(d["FileUrl"])
                    candidate_images.append(d)

        return {
            "status": "success",
            "item": item,
            "images": candidate_images,
            "total": len(candidate_images)
        }
    finally:
        conn.close()





@app.get("/api/internal-tasks/recurring-templates")
def get_recurring_templates():
    """Danh mục các hạng mục / công việc có chu kỳ định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        c.execute("""
            SELECT t.*, 
                   (SELECT COUNT(*) FROM internal_work_orders w WHERE w.RecurringTemplateID = t.id) as TotalSpawned,
                   (SELECT Status FROM internal_work_orders w WHERE w.id = t.CurrentTaskID) as CurrentTaskStatus,
                   (SELECT TaskCode FROM internal_work_orders w WHERE w.id = t.CurrentTaskID) as CurrentTaskCode,
                   (SELECT COUNT(*) FROM internal_task_items ti WHERE ti.TemplateID = t.id AND (ti.TaskID IS NULL OR ti.TaskID = 0)) as ItemsCount
            FROM internal_task_recurring_templates t
            ORDER BY t.IsActive DESC, t.id DESC
        """)
        templates = [dict(r) for r in c.fetchall()]
        return {"templates": templates}
    finally:
        conn.close()


def spawn_task_from_template(c, template_id: int, from_date: Optional[date] = None, creator: str = "Hệ thống", allow_paused: bool = False):
    """Sinh công việc mới (internal_work_orders) từ hạng mục định kỳ"""
    c.execute("SELECT * FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
    tpl = c.fetchone()
    if not tpl:
        raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục định kỳ.")

    tpl = dict(tpl)
    if not tpl["IsActive"] and not allow_paused:
        raise HTTPException(status_code=400, detail="Hạng mục định kỳ đang bị tạm dừng.")

    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")

    # Sinh mã công việc mới: IWO-YYMM-XXXX
    task_code = generate_next_task_code(c, now)

    # Đếm số lần lặp lại
    c.execute("SELECT COUNT(*) FROM internal_work_orders WHERE RecurringTemplateID = ?", (template_id,))
    recurring_count = c.fetchone()[0] + 1

    # Tính ngày đến hạn
    next_due_date = compute_next_due_date(
        cycle_type=tpl["CycleType"],
        interval_days=tpl["IntervalDays"],
        monthly_days=tpl["MonthlyDays"],
        from_date=from_date or now.date()
    )

    if tpl["CycleType"] == "MONTHLY_DAYS":
        cycle_info = f"Ngày {tpl['MonthlyDays']} hàng tháng"
    else:
        cycle_info = f"Mỗi {tpl['IntervalDays']} ngày"

    c.execute("""
        INSERT INTO internal_work_orders
        (TaskCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName, AssignedTo,
         AssignedGroupIDs, AssignedGroupNames, AssignedEmpIDs,
         Description, Status, ReportedAt, CreatedBy, CreatedAt, UpdatedAt,
         RecurringTemplateID, CycleInfo, RecurringCount, NextDueDate, NextTaskIdCreated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 0)
    """, (
        task_code, tpl["TaskTitle"], tpl["TaskType"], tpl["MachineID"] or '',
        tpl["Priority"] or 'NORMAL', tpl["Department"] or 'KỸ THUẬT', tpl["RequesterName"],
        tpl["AssignedTo"] or '',
        tpl.get("AssignedGroupIDs") or '', tpl.get("AssignedGroupNames") or '', tpl.get("AssignedEmpIDs") or '',
        tpl["Description"] or '', now_str, creator, now_str, now_str,
        template_id, cycle_info, recurring_count, next_due_date
    ))
    new_task_id = c.lastrowid

    # Sao chép các hạng mục con từ template sang task mới (kèm ảnh mẫu SOP nếu có)
    c.execute("""
        SELECT ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Note, SampleImageUrl, SampleImagePath, StandardGuideline
        FROM internal_task_items
        WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)
        ORDER BY ItemOrder ASC, id ASC
    """, (template_id,))
    tpl_items = c.fetchall()
    for item in tpl_items:
        guide_val = (item['StandardGuideline'] or item['Note'] or '').strip()
        c.execute("""
            INSERT INTO internal_task_items
            (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', '', ?, ?, ?, ?, ?)
        """, (
            new_task_id, template_id, item['ItemOrder'], item['ItemTitle'],
            item['AssignedEmpID'], item['AssignedTo'], item['Department'],
            item['SampleImageUrl'], item['SampleImagePath'],
            guide_val, now_str, now_str
        ))

    # Cập nhật lại template
    c.execute("""
        UPDATE internal_task_recurring_templates
        SET LastSpawnedAt = ?, NextDueDate = ?, CurrentTaskID = ?, UpdatedAt = ?
        WHERE id = ?
    """, (now_str, next_due_date, new_task_id, now_str, template_id))

    return {
        "task_id": new_task_id,
        "task_code": task_code,
        "next_due_date": next_due_date,
        "recurring_count": recurring_count,
        "cycle_info": cycle_info
    }


@app.get("/api/internal-tasks/groups")
def get_internal_employee_groups():
    """Lấy danh mục nhóm làm việc kèm danh sách nhân viên trong từng nhóm"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, GroupCode, GroupName, Description, IsActive, CreatedAt
            FROM internal_employee_groups
            WHERE IsActive = 1
            ORDER BY id ASC
        """)
        groups = [dict(r) for r in c.fetchall()]

        for g in groups:
            c.execute("""
                SELECT m.id as MemberID, m.EmpID, e.EmpName, e.Department, e.PositionText, m.IsLeader
                FROM internal_employee_group_members m
                JOIN internal_employees e ON m.EmpID = e.EmpID
                WHERE m.GroupID = ?
                ORDER BY m.IsLeader DESC, e.EmpName ASC
            """, (g["id"],))
            g["members"] = [dict(m) for m in c.fetchall()]
            g["member_count"] = len(g["members"])
            g["members_count"] = len(g["members"])

        return {"groups": groups}
    finally:
        conn.close()

@app.put("/api/internal-tasks/recurring-templates/{template_id}")
def update_recurring_template(template_id: int, payload: RecurringTemplateUpdate):
    """Cập nhật hạng mục định kỳ hoặc tạm dừng/kích hoạt"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        c.execute("SELECT * FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        tpl = c.fetchone()
        if not tpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục định kỳ.")

        fields = ["UpdatedAt = ?"]
        values = [now_str]

        for field_name in ["TaskTitle", "TaskType", "MachineID", "Priority", "Department",
                           "RequesterName", "AssignedTo", "Description", "CycleType", "NextDueDate",
                           "SampleImageUrl", "SampleImagePath"]:
            val = getattr(payload, field_name)
            if val is not None:
                fields.append(f"{field_name} = ?")
                values.append(val)

        if payload.IntervalDays is not None:
            fields.append("IntervalDays = ?")
            values.append(payload.IntervalDays)

        if payload.MonthlyDays is not None:
            fields.append("MonthlyDays = ?")
            values.append(payload.MonthlyDays.strip())

        if payload.AutoRecreateOnComplete is not None:
            fields.append("AutoRecreateOnComplete = ?")
            values.append(1 if payload.AutoRecreateOnComplete else 0)

        if payload.IsActive is not None:
            fields.append("IsActive = ?")
            values.append(1 if payload.IsActive else 0)

        values.append(template_id)
        sql = f"UPDATE internal_task_recurring_templates SET {', '.join(fields)} WHERE id = ?"
        c.execute(sql, values)

        # Cập nhật danh sách hạng mục con của template nếu có
        raw_items = payload.Items or payload.items
        if raw_items is not None:
            c.execute("DELETE FROM internal_task_items WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)", (template_id,))
            for idx, itm in enumerate(raw_items, start=1):
                note_str = itm.Note or itm.Notes or ''
                c.execute("""
                    INSERT INTO internal_task_items
                    (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
                """, (
                    template_id, itm.ItemOrder or idx, itm.ItemTitle.strip(),
                    itm.AssignedEmpID or '', itm.AssignedTo or '',
                    itm.Department or 'Cơ điện', note_str,
                    itm.SampleImageUrl or '', itm.SampleImagePath or '',
                    itm.StandardGuideline or '',
                    now_str, now_str
                ))

        conn.commit()

        return {"status": "success", "message": "Cập nhật hạng mục định kỳ thành công."}
    finally:
        conn.close()


@app.post("/api/internal-tasks/recurring-templates/{template_id}/sample-image")
async def upload_recurring_template_sample_image(
    template_id: int,
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tải ảnh mẫu chuẩn SOP cho hạng mục công việc định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, TemplateCode FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        tpl = c.fetchone()
        if not tpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục định kỳ.")

        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Tệp tải lên rỗng.")

        saved = save_recurring_template_sample_image(
            file_bytes=file_bytes,
            original_filename=file.filename or "sample.jpg",
            template_code=tpl["TemplateCode"]
        )

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("""
            UPDATE internal_task_recurring_templates
            SET SampleImagePath = ?, SampleImageUrl = ?, UpdatedAt = ?
            WHERE id = ?
        """, (saved["file_path"], saved["file_url"], now_str, template_id))
        conn.commit()
        return {
            "status": "success",
            "message": "Đã lưu ảnh mẫu SOP cho hạng mục định kỳ thành công.",
            "template_id": template_id,
            "sample_image_url": saved["file_url"]
        }
    finally:
        conn.close()


@app.get("/api/internal-tasks/recurring-templates/{template_id}/items")
def get_recurring_template_items(template_id: int):
    """Danh sách các hạng mục công việc con trong mẫu định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Note,
                   SampleImageUrl, SampleImagePath, StandardGuideline
            FROM internal_task_items
            WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)
            ORDER BY ItemOrder ASC, id ASC
        """, (template_id,))
        items = [dict(r) for r in c.fetchall()]
        return {"items": items}
    finally:
        conn.close()


@app.post("/api/internal-tasks/recurring-templates/{template_id}/items")
def add_recurring_template_item(template_id: int, payload: TaskItemCreate):
    """Thêm hạng mục con vào mẫu định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT id FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Không tìm thấy mẫu định kỳ.")

        c.execute("SELECT COALESCE(MAX(ItemOrder), 0) + 1 FROM internal_task_items WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)", (template_id,))
        next_order = c.fetchone()[0]

        order_val = payload.ItemOrder if (payload.ItemOrder is not None and payload.ItemOrder > 0) else next_order

        note_val = payload.Note or payload.Notes or ''
        c.execute("""
            INSERT INTO internal_task_items
            (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
        """, (
            template_id, order_val, payload.ItemTitle.strip(),
            payload.AssignedEmpID or '', payload.AssignedTo or '',
            payload.Department or 'Cơ điện', note_val,
            payload.SampleImageUrl or '', payload.SampleImagePath or '',
            payload.StandardGuideline or '',
            now_str, now_str
        ))
        item_id = c.lastrowid
        conn.commit()
        return {"status": "success", "item_id": item_id, "message": "Đã thêm hạng mục vào mẫu định kỳ."}
    finally:
        conn.close()


@app.get("/api/internal-tasks/recurring-items")
def get_all_recurring_template_items(template_id: Optional[int] = None):
    """
    Lấy danh sách tất cả các hạng mục con của mẫu định kỳ (kèm thông tin mẫu, số ảnh thực tế KTV).
    Phục vụ giao diện Thư viện hạng mục & Ảnh mẫu chuẩn Master-Detail giống categories.html.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        query = """
            SELECT ti.id, ti.TemplateID, ti.ItemOrder, ti.ItemTitle, ti.AssignedEmpID, ti.AssignedTo, 
                   ti.Department, ti.Note, ti.SampleImageUrl, ti.SampleImagePath, ti.StandardGuideline,
                   t.TemplateCode, t.TaskTitle, t.MachineID, t.CycleType, t.IntervalDays, t.MonthlyDays, 
                   t.IsActive as TemplateIsActive, t.AssignedTo as TemplateAssignedTo, t.NextDueDate,
                   (
                       SELECT COUNT(DISTINCT i.id)
                       FROM internal_work_images i
                       LEFT JOIN internal_work_orders wo ON i.TaskID = wo.id
                       WHERE i.TaskItemID = ti.id
                          OR (wo.RecurringTemplateID = ti.TemplateID AND (i.TaskItemID IN (SELECT id FROM internal_task_items WHERE ItemTitle = ti.ItemTitle) OR i.Caption LIKE '%' || ti.ItemTitle || '%'))
                   ) as ProofCount
            FROM internal_task_items ti
            JOIN internal_task_recurring_templates t ON ti.TemplateID = t.id
            WHERE ti.TemplateID IS NOT NULL AND (ti.TaskID IS NULL OR ti.TaskID = 0)
        """
        params = []
        if template_id:
            query += " AND ti.TemplateID = ?"
            params.append(template_id)
        query += " ORDER BY t.IsActive DESC, t.id DESC, ti.ItemOrder ASC, ti.id ASC"
        c.execute(query, params)
        items = [dict(r) for r in c.fetchall()]
        return {"items": items}
    finally:
        conn.close()



@app.delete("/api/internal-tasks/recurring-templates/{template_id}")
def delete_recurring_template(template_id: int):
    """Xóa hạng mục định kỳ và dọn dẹp các liên kết"""
    conn = get_connection()
    c = conn.cursor()
    try:
        # Xóa các hạng mục con mẫu (master template items)
        c.execute("DELETE FROM internal_task_items WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)", (template_id,))
        # Hủy liên kết ở các công việc đã tạo trước đó để không bị orphan
        c.execute("UPDATE internal_work_orders SET RecurringTemplateID = NULL WHERE RecurringTemplateID = ?", (template_id,))
        # Xóa template
        c.execute("DELETE FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa hạng mục định kỳ thành công."}
    finally:
        conn.close()


@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn")
@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn-now")
def spawn_task_now(template_id: int, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Chủ động tạo ngay một công việc mới từ hạng mục định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        user_name = current_user["full_name"] if current_user else "Kỹ thuật viên"
        spawned = spawn_task_from_template(c, template_id, creator=user_name, allow_paused=True)
        conn.commit()
        return {
            "status": "success",
            "message": f"Đã tạo thành công công việc mới: {spawned['task_code']} (Hạn: {spawned['next_due_date']})",
            "task": spawned,
            "task_id": spawned["task_id"],
            "task_code": spawned["task_code"]
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo công việc định kỳ: {str(e)}")
    finally:
        conn.close()


# -------------------------------------------------------------------------
# INTERNAL WORK ORDERS LIST & CRUD
# -------------------------------------------------------------------------

@app.post("/api/internal-tasks/groups")
def create_internal_employee_group(payload: EmployeeGroupCreate, user: Optional[dict] = Depends(get_current_user_optional)):
    """Tạo nhóm làm việc mới"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        code = payload.GroupCode.strip().upper()
        name = payload.GroupName.strip()
        c.execute("""
            INSERT INTO internal_employee_groups (GroupCode, GroupName, Description, IsActive, CreatedAt)
            VALUES (?, ?, ?, 1, ?)
        """, (code, name, payload.Description or "", now_str))
        conn.commit()
        return {"success": True, "id": c.lastrowid, "GroupCode": code, "GroupName": name}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Mã nhóm đã tồn tại!")
    finally:
        conn.close()

@app.put("/api/internal-tasks/groups/{group_id}")
def update_internal_employee_group(group_id: int, payload: EmployeeGroupUpdate, user: Optional[dict] = Depends(get_current_user_optional)):
    """Cập nhật thông tin nhóm làm việc"""
    conn = get_connection()
    c = conn.cursor()
    try:
        fields = []
        vals = []
        if payload.GroupName is not None:
            fields.append("GroupName = ?")
            vals.append(payload.GroupName.strip())
        if payload.Description is not None:
            fields.append("Description = ?")
            vals.append(payload.Description.strip())
        if payload.IsActive is not None:
            fields.append("IsActive = ?")
            vals.append(payload.IsActive)
        if not fields:
            return {"success": True}
        vals.append(group_id)
        c.execute(f"UPDATE internal_employee_groups SET {', '.join(fields)} WHERE id = ?", vals)
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

@app.delete("/api/internal-tasks/groups/{group_id}")
def delete_internal_employee_group(group_id: int, user: Optional[dict] = Depends(get_current_user_optional)):
    """Xóa / Vô hiệu hóa nhóm làm việc"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("UPDATE internal_employee_groups SET IsActive = 0 WHERE id = ?", (group_id,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

@app.post("/api/internal-tasks/groups/{group_id}/members")
def add_member_to_group(group_id: int, payload: EmployeeGroupMemberAdd, user: Optional[dict] = Depends(get_current_user_optional)):
    """Thêm nhân viên vào nhóm (1 nhân viên có thể thuộc nhiều nhóm)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("""
            INSERT OR REPLACE INTO internal_employee_group_members (GroupID, EmpID, IsLeader, CreatedAt)
            VALUES (?, ?, ?, ?)
        """, (group_id, payload.EmpID.strip(), payload.IsLeader or 0, now_str))
        conn.commit()
        return {"success": True, "GroupID": group_id, "EmpID": payload.EmpID}
    finally:
        conn.close()

@app.delete("/api/internal-tasks/groups/{group_id}/members/{emp_id}")
def remove_member_from_group(group_id: int, emp_id: str, user: Optional[dict] = Depends(get_current_user_optional)):
    """Xóa nhân viên khỏi nhóm"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM internal_employee_group_members WHERE GroupID = ? AND EmpID = ?", (group_id, emp_id.strip()))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

@app.patch("/api/internal-tasks/{task_id}/priority")
def update_internal_task_priority(task_id: int, payload: TaskPriorityUpdate, user: Optional[dict] = Depends(get_current_user_optional)):
    """Chỉnh sửa trực tiếp mức độ ưu tiên của công việc"""
    valid_priorities = ["URGENT", "HIGH", "NORMAL", "LOW"]
    new_prio = payload.Priority.strip().upper()
    if new_prio not in valid_priorities:
        raise HTTPException(status_code=400, detail="Mức độ ưu tiên không hợp lệ")
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("UPDATE internal_work_orders SET Priority = ?, UpdatedAt = ? WHERE id = ?", (new_prio, now_str, task_id))
        if c.rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc")
        conn.commit()
        return {"success": True, "id": task_id, "Priority": new_prio}
    finally:
        conn.close()





# -------------------------------------------------------------------------
# INTERNAL WORK ORDERS LIST & CRUD
# -------------------------------------------------------------------------


@app.get("/api/internal-tasks/{task_id}")
def get_internal_task_detail(task_id: int):
    """Chi tiết công việc nội bộ kèm hình ảnh và danh sách hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM internal_work_orders WHERE id = ?", (task_id,))
        task = c.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")

        task_dict = dict(task)
        c.execute("SELECT id, TaskID, TaskItemID, ImageType, FileUrl, FileName, Caption, UploadedBy, UploadedAt FROM internal_work_images WHERE TaskID = ? ORDER BY id ASC", (task_id,))
        task_dict['images'] = [dict(im) for im in c.fetchall()]

        # Lấy danh sách hạng mục con
        c.execute("""
            SELECT id, TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, CompletedAt, CompletedBy, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt
            FROM internal_task_items
            WHERE TaskID = ?
            ORDER BY ItemOrder ASC, id ASC
        """, (task_id,))
        items = [dict(r) for r in c.fetchall()]

        # Gắn ảnh thực tế mới nhất vào từng item nếu có
        images_by_item = {}
        for im in task_dict['images']:
            t_item_id = im.get('TaskItemID')
            if t_item_id:
                images_by_item[t_item_id] = im

        for it in items:
            it_img = images_by_item.get(it['id'])
            if it_img:
                it['ActualImageUrl'] = it_img.get('FileUrl')
                it['ActualImageId'] = it_img.get('id')
                it['ActualImageUploadedAt'] = it_img.get('UploadedAt', '')
            else:
                it['ActualImageUrl'] = None
                it['ActualImageId'] = None

        task_dict['items'] = items

        total_items = len(items)
        comp_items = sum(1 for it in items if it['Status'] == 'COMPLETED')
        task_dict['items_count'] = total_items
        task_dict['completed_items_count'] = comp_items
        task_dict['progress_percent'] = int(round((comp_items / total_items) * 100)) if total_items > 0 else (100 if task_dict['Status'] == 'COMPLETED' else 0)

        # Lấy thêm thông tin template và ảnh mẫu nếu có
        if task_dict.get("RecurringTemplateID"):
            c.execute("SELECT TemplateCode, CycleType, IntervalDays, MonthlyDays, AutoRecreateOnComplete, IsActive, SampleImageUrl, SampleImagePath FROM internal_task_recurring_templates WHERE id = ?", (task_dict["RecurringTemplateID"],))
            tpl = c.fetchone()
            if tpl:
                task_dict["template"] = dict(tpl)

        return task_dict
    finally:
        conn.close()

@app.get("/api/internal-tasks")
def get_internal_tasks(
    type: Optional[str] = Query(None, description="BREAKDOWN, DEPT_REQUEST, IMPROVEMENT, INTERNAL"),
    status: Optional[str] = Query(None, description="PENDING, IN_PROGRESS, COMPLETED, HOLD"),
    priority: Optional[str] = Query(None, description="URGENT, HIGH, NORMAL, LOW"),
    machine_id: Optional[str] = Query(None),
    recurring: Optional[str] = Query(None, description="all, yes, no"),
    q: Optional[str] = Query(None)
):
    """Danh sách công việc nội bộ / sửa chữa phát sinh"""
    conn = get_connection()
    c = conn.cursor()
    try:
        where_clauses = ["1=1"]
        params = []

        if type and type.strip() and type.lower() != "all":
            where_clauses.append("TaskType = ?")
            params.append(type.strip().upper())

        if status and status.strip() and status.lower() != "all":
            where_clauses.append("Status = ?")
            params.append(status.strip().upper())

        if priority and priority.strip() and priority.lower() != "all":
            where_clauses.append("Priority = ?")
            params.append(priority.strip().upper())

        if machine_id and machine_id.strip():
            where_clauses.append("MachineID = ?")
            params.append(machine_id.strip())

        if recurring == "yes":
            where_clauses.append("(RecurringTemplateID IS NOT NULL AND RecurringTemplateID > 0)")
        elif recurring == "no":
            where_clauses.append("(RecurringTemplateID IS NULL OR RecurringTemplateID = 0)")

        if q and q.strip():
            kw = f"%{q.strip()}%"
            where_clauses.append("(w.TaskCode LIKE ? OR w.TaskTitle LIKE ? OR w.RequesterName LIKE ? OR w.AssignedTo LIKE ? OR w.MachineID LIKE ? OR mac.MachineText LIKE ?)")
            params.extend([kw, kw, kw, kw, kw, kw])

        where_sql = " AND ".join(where_clauses)

        c.execute(f"""
            SELECT w.id, w.TaskCode, w.TaskTitle, w.TaskType, w.MachineID,
                   COALESCE(mac.MachineText, w.MachineID) AS MachineName,
                   w.Priority, w.Department,
                   w.RequesterName, w.RequesterEmail, w.RequesterPhone, w.AssignedTo, w.Description, w.Solution, w.Status,
                   w.ReportedAt, w.StartedAt, w.CompletedAt, w.DowntimeMinutes, w.CreatedBy, w.CreatedAt, w.UpdatedAt,
                   w.RecurringTemplateID, w.CycleInfo, w.RecurringCount, w.NextDueDate, w.NextTaskIdCreated
            FROM internal_work_orders w
            LEFT JOIN CL_tblMacList mac ON w.MachineID = mac.MachineID
            WHERE {where_sql}
            ORDER BY 
                CASE WHEN w.Status = 'PENDING' THEN 0 WHEN w.Status = 'IN_PROGRESS' THEN 1 ELSE 2 END,
                CASE WHEN w.Priority = 'URGENT' THEN 0 WHEN w.Priority = 'HIGH' THEN 1 ELSE 2 END,
                w.id DESC
        """, params)
        tasks = [dict(r) for r in c.fetchall()]

        for t in tasks:
            c.execute("SELECT id, FileUrl, ImageType, FileName, Caption FROM internal_work_images WHERE TaskID = ? ORDER BY id DESC", (t['id'],))
            t['images'] = [dict(im) for im in c.fetchall()]

            c.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN Status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                FROM internal_task_items WHERE TaskID = ?
            """, (t['id'],))
            stat = c.fetchone()
            tot = stat['total'] if stat and stat['total'] else 0
            cmp = stat['completed'] if stat and stat['completed'] else 0
            t['items_count'] = tot
            t['completed_items_count'] = cmp
            t['progress_percent'] = int(round((cmp / tot) * 100)) if tot > 0 else (100 if t['Status'] == 'COMPLETED' else 0)

        return {"tasks": tasks, "total": len(tasks)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/internal-tasks/recurring-templates/{template_id}/items")
def add_recurring_template_item(template_id: int, payload: TaskItemCreate):
    """Thêm hạng mục con vào mẫu định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT id FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Không tìm thấy mẫu định kỳ.")

        c.execute("SELECT COALESCE(MAX(ItemOrder), 0) + 1 FROM internal_task_items WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)", (template_id,))
        next_order = c.fetchone()[0]

        order_val = payload.ItemOrder if (payload.ItemOrder is not None and payload.ItemOrder > 0) else next_order

        note_val = payload.Note or payload.Notes or ''
        c.execute("""
            INSERT INTO internal_task_items
            (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
        """, (
            template_id, order_val, payload.ItemTitle.strip(),
            payload.AssignedEmpID or '', payload.AssignedTo or '',
            payload.Department or 'Cơ điện', note_val,
            payload.SampleImageUrl or '', payload.SampleImagePath or '',
            payload.StandardGuideline or '',
            now_str, now_str
        ))
        item_id = c.lastrowid
        conn.commit()
        return {"status": "success", "item_id": item_id, "message": "Đã thêm hạng mục vào mẫu định kỳ."}
    finally:
        conn.close()


@app.get("/api/internal-tasks/recurring-items")
def get_all_recurring_template_items(template_id: Optional[int] = None):
    """
    Lấy danh sách tất cả các hạng mục con của mẫu định kỳ (kèm thông tin mẫu, số ảnh thực tế KTV).
    Phục vụ giao diện Thư viện hạng mục & Ảnh mẫu chuẩn Master-Detail giống categories.html.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        query = """
            SELECT ti.id, ti.TemplateID, ti.ItemOrder, ti.ItemTitle, ti.AssignedEmpID, ti.AssignedTo, 
                   ti.Department, ti.Note, ti.SampleImageUrl, ti.SampleImagePath, ti.StandardGuideline,
                   t.TemplateCode, t.TaskTitle, t.MachineID, t.CycleType, t.IntervalDays, t.MonthlyDays, 
                   t.IsActive as TemplateIsActive, t.AssignedTo as TemplateAssignedTo, t.NextDueDate,
                   (
                       SELECT COUNT(DISTINCT i.id)
                       FROM internal_work_images i
                       LEFT JOIN internal_work_orders wo ON i.TaskID = wo.id
                       WHERE i.TaskItemID = ti.id
                          OR (wo.RecurringTemplateID = ti.TemplateID AND (i.TaskItemID IN (SELECT id FROM internal_task_items WHERE ItemTitle = ti.ItemTitle) OR i.Caption LIKE '%' || ti.ItemTitle || '%'))
                   ) as ProofCount
            FROM internal_task_items ti
            JOIN internal_task_recurring_templates t ON ti.TemplateID = t.id
            WHERE ti.TemplateID IS NOT NULL AND (ti.TaskID IS NULL OR ti.TaskID = 0)
        """
        params = []
        if template_id:
            query += " AND ti.TemplateID = ?"
            params.append(template_id)
        query += " ORDER BY t.IsActive DESC, t.id DESC, ti.ItemOrder ASC, ti.id ASC"
        c.execute(query, params)
        items = [dict(r) for r in c.fetchall()]
        return {"items": items}
    finally:
        conn.close()


@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn")
@app.post("/api/internal-tasks/recurring-templates/{template_id}/spawn-now")
def spawn_task_now(template_id: int, current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Chủ động tạo ngay một công việc mới từ hạng mục định kỳ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        user_name = current_user["full_name"] if current_user else "Kỹ thuật viên"
        spawned = spawn_task_from_template(c, template_id, creator=user_name, allow_paused=True)
        conn.commit()
        return {
            "status": "success",
            "message": f"Đã tạo thành công công việc mới: {spawned['task_code']} (Hạn: {spawned['next_due_date']})",
            "task": spawned,
            "task_id": spawned["task_id"],
            "task_code": spawned["task_code"]
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo công việc định kỳ: {str(e)}")
    finally:
        conn.close()





@app.get("/api/internal-tasks/recurring-templates/{template_id}")
def get_recurring_template_detail(template_id: int):
    """Chi tiết hạng mục định kỳ và lịch sử các công việc đã sinh"""
    conn = get_connection()
    c = conn.cursor()
    try:
        sync_missing_recurring_templates(c, conn)
        c.execute("SELECT * FROM internal_task_recurring_templates WHERE id = ?", (template_id,))
        tpl = c.fetchone()
        if not tpl:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục định kỳ.")

        tpl_dict = dict(tpl)
        c.execute("""
            SELECT id, TaskCode, TaskTitle, Status, ReportedAt, CompletedAt, NextDueDate, RecurringCount
            FROM internal_work_orders
            WHERE RecurringTemplateID = ?
            ORDER BY id DESC LIMIT 20
        """, (template_id,))
        tpl_dict["history"] = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT id, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Note, SampleImageUrl, SampleImagePath, StandardGuideline
            FROM internal_task_items
            WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0)
            ORDER BY ItemOrder ASC, id ASC
        """, (template_id,))
        tpl_dict["items"] = [dict(r) for r in c.fetchall()]

        return tpl_dict
    finally:
        conn.close()


@app.get("/api/internal-tasks")
def get_internal_tasks(
    type: Optional[str] = Query(None, description="BREAKDOWN, DEPT_REQUEST, IMPROVEMENT, INTERNAL"),
    status: Optional[str] = Query(None, description="PENDING, IN_PROGRESS, COMPLETED, HOLD"),
    priority: Optional[str] = Query(None, description="URGENT, HIGH, NORMAL, LOW"),
    machine_id: Optional[str] = Query(None),
    recurring: Optional[str] = Query(None, description="all, yes, no"),
    q: Optional[str] = Query(None),
    scope: Optional[str] = Query("all", description="all, group, my"),
    emp_id: Optional[str] = Query(None),
    group_ids: Optional[str] = Query(None),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Danh sách công việc nội bộ / sửa chữa phát sinh hỗ trợ phân loại theo Nhóm và Việc của tôi"""
    conn = get_connection()
    c = conn.cursor()
    try:
        where_clauses = ["1=1"]
        params = []

        if type and type.strip() and type.lower() != "all":
            where_clauses.append("TaskType = ?")
            params.append(type.strip().upper())

        if status and status.strip() and status.lower() != "all":
            where_clauses.append("Status = ?")
            params.append(status.strip().upper())

        if priority and priority.strip() and priority.lower() != "all":
            where_clauses.append("Priority = ?")
            params.append(priority.strip().upper())

        if machine_id and machine_id.strip():
            where_clauses.append("MachineID = ?")
            params.append(machine_id.strip())

        if recurring == "yes":
            where_clauses.append("(RecurringTemplateID IS NOT NULL AND RecurringTemplateID > 0)")
        elif recurring == "no":
            where_clauses.append("(RecurringTemplateID IS NULL OR RecurringTemplateID = 0)")

        # Phân quyền & Lọc phạm vi (Scope): all | group | my
        effective_emp_id = (emp_id or "").strip()
        effective_emp_name = ""
        effective_group_ids = []

        if group_ids and group_ids.strip():
            effective_group_ids = [int(x) for x in group_ids.split(",") if x.strip().isdigit()]

        if not effective_emp_id and current_user:
            effective_emp_id = current_user.get("emp_id") or current_user.get("username") or ""
            effective_emp_name = current_user.get("full_name") or ""
            if not effective_group_ids and current_user.get("group_ids"):
                effective_group_ids = current_user.get("group_ids", [])

        if effective_emp_id and not effective_emp_name:
            c.execute("SELECT EmpName FROM internal_employees WHERE EmpID = ?", (effective_emp_id,))
            erow = c.fetchone()
            if erow:
                effective_emp_name = erow[0]

        if not effective_group_ids and effective_emp_id:
            c.execute("SELECT GroupID FROM internal_employee_group_members WHERE EmpID = ?", (effective_emp_id,))
            effective_group_ids = [r[0] for r in c.fetchall()]

        if scope == "my":
            if effective_emp_id:
                name_like = f"%{effective_emp_name}%" if effective_emp_name else f"%{effective_emp_id}%"
                id_like = f"%{effective_emp_id}%"
                where_clauses.append("""
                    (
                        w.AssignedEmpIDs LIKE ? 
                        OR w.AssignedTo LIKE ? 
                        OR w.AssignedTo LIKE ?
                        OR EXISTS (
                            SELECT 1 FROM internal_task_items iti 
                            WHERE iti.TaskID = w.id AND (iti.AssignedEmpID = ? OR iti.AssignedTo LIKE ?)
                        )
                    )
                """)
                params.extend([id_like, id_like, name_like, effective_emp_id, name_like])
            else:
                where_clauses.append("1=0")
        elif scope == "group":
            if effective_group_ids:
                group_conds = []
                for gid in effective_group_ids:
                    group_conds.append("(w.AssignedGroupIDs LIKE ? OR w.AssignedGroupIDs LIKE ?)")
                    params.extend([f"%{gid}%", f"%\"{gid}\"%"])
                where_clauses.append(f"({' OR '.join(group_conds)})")
            else:
                where_clauses.append("1=0")

        if q and q.strip():
            kw = f"%{q.strip()}%"
            where_clauses.append("(w.TaskCode LIKE ? OR w.TaskTitle LIKE ? OR w.RequesterName LIKE ? OR w.AssignedTo LIKE ? OR w.AssignedGroupNames LIKE ? OR w.MachineID LIKE ? OR mac.MachineText LIKE ?)")
            params.extend([kw, kw, kw, kw, kw, kw, kw])

        where_sql = " AND ".join(where_clauses)

        c.execute(f"""
            SELECT w.id, w.TaskCode, w.TaskTitle, w.TaskType, w.MachineID,
                   COALESCE(mac.MachineText, w.MachineID) AS MachineName,
                   w.Priority, w.Department,
                   w.RequesterName, w.RequesterEmail, w.RequesterPhone, w.AssignedTo,
                   w.AssignedGroupIDs, w.AssignedGroupNames, w.AssignedEmpIDs,
                   w.Description, w.Solution, w.Status,
                   w.ReportedAt, w.StartedAt, w.CompletedAt, w.DowntimeMinutes, w.CreatedBy, w.CreatedAt, w.UpdatedAt,
                   w.RecurringTemplateID, w.CycleInfo, w.RecurringCount, w.NextDueDate, w.NextTaskIdCreated
            FROM internal_work_orders w
            LEFT JOIN CL_tblMacList mac ON w.MachineID = mac.MachineID
            WHERE {where_sql}
            ORDER BY 
                CASE WHEN w.Status = 'PENDING' THEN 0 WHEN w.Status = 'IN_PROGRESS' THEN 1 ELSE 2 END,
                CASE WHEN w.Priority = 'URGENT' THEN 0 WHEN w.Priority = 'HIGH' THEN 1 ELSE 2 END,
                w.id DESC
        """, params)
        tasks = [dict(r) for r in c.fetchall()]

        for t in tasks:
            c.execute("SELECT id, FileUrl, ImageType, FileName, Caption FROM internal_work_images WHERE TaskID = ? ORDER BY id DESC", (t['id'],))
            t['images'] = [dict(im) for im in c.fetchall()]

            # Parse JSON danh sách GroupID và EmpID
            try:
                t['AssignedGroupIDs'] = json.loads(t['AssignedGroupIDs']) if t.get('AssignedGroupIDs') else []
            except Exception:
                t['AssignedGroupIDs'] = []
            try:
                t['AssignedEmpIDs'] = json.loads(t['AssignedEmpIDs']) if t.get('AssignedEmpIDs') else []
            except Exception:
                t['AssignedEmpIDs'] = []

            c.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN Status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                FROM internal_task_items WHERE TaskID = ?
            """, (t['id'],))
            stat = c.fetchone()
            tot = stat['total'] if stat and stat['total'] else 0
            cmp = stat['completed'] if stat and stat['completed'] else 0
            t['items_count'] = tot
            t['completed_items_count'] = cmp
            t['progress_percent'] = int(round((cmp / tot) * 100)) if tot > 0 else (100 if t['Status'] == 'COMPLETED' else 0)

        return {"tasks": tasks}
    finally:
        conn.close()





def normalize_machine_id(c, raw_val: Optional[str]) -> str:
    if not raw_val or not raw_val.strip():
        return ""
    val = raw_val.strip()
    c.execute("""
        SELECT MachineID FROM CL_tblMacList
        WHERE UPPER(MachineID) = UPPER(?) 
           OR UPPER(MachineText) = UPPER(?) 
           OR UPPER(MachineID || ' - ' || MachineText) = UPPER(?)
        LIMIT 1
    """, (val, val, val))
    row = c.fetchone()
    if row and row[0]:
        return row[0]
    if " - " in val:
        prefix = val.split(" - ")[0].strip()
        c.execute("SELECT MachineID FROM CL_tblMacList WHERE UPPER(MachineID) = UPPER(?) LIMIT 1", (prefix,))
        row = c.fetchone()
        if row and row[0]:
            return row[0]
    return val

@app.post("/api/public/requests")
def create_public_task(
    payload: PublicTaskCreate,
    background_tasks: BackgroundTasks
):
    """Tiếp nhận yêu cầu công việc mới từ cổng Public dành cho các phòng ban khác"""
    if not payload.TaskTitle or not payload.TaskTitle.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập tiêu đề yêu cầu công việc.")
    if not payload.RequesterName or not payload.RequesterName.strip():
        raise HTTPException(status_code=400, detail="Vui lòng nhập họ và tên người yêu cầu.")
    if not payload.Department or not payload.Department.strip():
        raise HTTPException(status_code=400, detail="Vui lòng chọn hoặc nhập phòng ban yêu cầu.")

    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        resolved_dept = normalize_department_name(c, payload.Department)
        resolved_machine = normalize_machine_id(c, payload.MachineID)

        task_code = generate_next_task_code(c, now)

        c.execute("""
            INSERT INTO internal_work_orders
            (TaskCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName,
             RequesterEmail, RequesterPhone, AssignedTo,
             Description, Status, ReportedAt, CreatedBy, CreatedAt, UpdatedAt,
             RecurringTemplateID, CycleInfo, RecurringCount, NextDueDate, NextTaskIdCreated)
            VALUES (?, ?, 'DEPT_REQUEST', ?, ?, ?, ?, ?, ?, '', ?, 'PENDING', ?, ?, ?, ?, NULL, NULL, 1, NULL, 0)
        """, (
            task_code, payload.TaskTitle.strip(), resolved_machine,
            payload.Priority.upper() if payload.Priority else 'NORMAL',
            resolved_dept, payload.RequesterName.strip(),
            payload.RequesterEmail.strip() if payload.RequesterEmail else '',
            payload.RequesterPhone.strip() if payload.RequesterPhone else '',
            payload.Description.strip() if payload.Description else '',
            now_str, creator, now_str, now_str
        ))
        task_id = c.lastrowid

        # Lưu danh sách checklist con nếu có
        raw_items = payload.Items
        if raw_items:
            for idx, itm in enumerate(raw_items, start=1):
                if isinstance(itm, dict):
                    title = itm.get("ItemTitle") or itm.get("title") or ""
                    note = itm.get("Note") or itm.get("note") or ""
                else:
                    title = str(itm)
                    note = ""
                if title.strip():
                    c.execute("""
                        INSERT INTO internal_task_items
                        (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                        VALUES (?, NULL, ?, ?, '', '', ?, 'PENDING', ?, '', '', '', ?, ?)
                    """, (
                        task_id, idx, title.strip(),
                        payload.Department.strip(), note.strip(),
                        now_str, now_str
                    ))

        conn.commit()

        # Gửi email thông báo vòng đời CREATED nếu có email
        if payload.RequesterEmail and "@" in payload.RequesterEmail:
            background_tasks.add_task(send_task_lifecycle_email, task_id, "CREATED")

        return {
            "status": "success",
            "message": f"Gửi yêu cầu công việc {task_code} thành công!",
            "task_id": task_id,
            "task_code": task_code
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi gửi yêu cầu: {str(e)}")
    finally:
        conn.close()


@app.post("/api/public/requests/{task_id}/photos")
async def upload_public_task_photo(
    task_id: int,
    file: UploadFile = File(...)
):
    """Tải ảnh hiện trường sự cố đính kèm cho yêu cầu công việc từ cổng Public"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, TaskCode, RequesterName FROM internal_work_orders WHERE id = ?", (task_id,))
        task = c.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu công việc.")

        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Tệp tải lên rỗng.")

        saved = save_internal_task_image(
            file_bytes=file_bytes,
            original_filename=file.filename or "photo.jpg",
            task_code=task['TaskCode'],
            image_type="BEFORE"
        )

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        uploader = task['RequesterName'] or "Người yêu cầu"
        saved_filename = saved.get("filename") or os.path.basename(saved.get("file_path", "photo.jpg"))

        c.execute("""
            INSERT INTO internal_work_images (TaskID, ImageType, NASFilePath, FileUrl, FileName, Caption, UploadedBy, UploadedAt, TaskItemID)
            VALUES (?, 'BEFORE', ?, ?, ?, 'Ảnh hiện trường từ người yêu cầu', ?, ?, NULL)
        """, (task_id, saved["file_path"], saved["file_url"], saved_filename, uploader, now_str))
        image_id = c.lastrowid
        conn.commit()

        return {
            "status": "success",
            "image_id": image_id,
            "file_url": saved["file_url"],
            "filename": saved_filename
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi tải ảnh hiện trường: {str(e)}")
    finally:
        conn.close()


@app.get("/api/public/requests/track")
def track_public_task(
    code: Optional[str] = Query(None),
    email: Optional[str] = Query(None)
):
    """Tra cứu thông tin tiến độ công việc công khai theo TaskCode hoặc Email người yêu cầu"""
    if not code and not email:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp mã công việc hoặc email.")
    conn = get_connection()
    c = conn.cursor()
    try:
        if code:
            c.execute("""
                SELECT w.*, 
                       (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id) as total_items,
                       (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id AND Status = 'COMPLETED') as completed_items
                FROM internal_work_orders w
                WHERE UPPER(TRIM(w.TaskCode)) = UPPER(TRIM(?))
            """, (code,))
            row = c.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Không tìm thấy yêu cầu công việc với mã '{code}'.")

            task = dict(row)

            # Lấy checklist items
            c.execute("""
                SELECT id, ItemOrder, ItemTitle, Status, Note, CompletedAt
                FROM internal_task_items
                WHERE TaskID = ?
                ORDER BY ItemOrder ASC, id ASC
            """, (task["id"],))
            task["items"] = [dict(r) for r in c.fetchall()]
            return {"task": task}
        elif email:
            c.execute("""
                SELECT w.*, 
                       (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id) as total_items,
                       (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id AND Status = 'COMPLETED') as completed_items
                FROM internal_work_orders w
                WHERE LOWER(TRIM(w.RequesterEmail)) = LOWER(TRIM(?))
                ORDER BY w.id DESC
                LIMIT 50
            """, (email,))
            tasks = [dict(r) for r in c.fetchall()]
            return {"tasks": tasks, "count": len(tasks)}
    finally:
        conn.close()


@app.post("/api/internal-tasks")
def create_internal_task(
    payload: InternalTaskCreate,
    background_tasks: BackgroundTasks,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tạo công việc nội bộ / sự cố máy phát sinh / công việc có chu kỳ kèm các hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        task_code = generate_next_task_code(c, now)

        creator = current_user["full_name"] if current_user else payload.RequesterName

        template_id = payload.RecurringTemplateID
        cycle_info = None
        next_due = None

        # Nếu người dùng chọn lưu làm hạng mục chu kỳ lặp lại
        if payload.IsRecurring:
            cycle_type = payload.CycleType or "INTERVAL_DAYS"
            next_due = compute_next_due_date(
                cycle_type=cycle_type,
                interval_days=payload.IntervalDays or 0,
                monthly_days=payload.MonthlyDays or "",
                from_date=now.date()
            )

            if cycle_type == "MONTHLY_DAYS":
                cycle_info = f"Ngày {payload.MonthlyDays} hàng tháng"
            else:
                cycle_info = f"Mỗi {payload.IntervalDays} ngày"

            # Tự động tạo Template tương ứng
            tpl_code = generate_next_template_code(c)

            c.execute("""
                INSERT INTO internal_task_recurring_templates
                (TemplateCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName, AssignedTo,
                 Description, CycleType, IntervalDays, MonthlyDays, AutoRecreateOnComplete, IsActive,
                 NextDueDate, LastSpawnedAt, CurrentTaskID, CreatedAt, UpdatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)
            """, (
                tpl_code, payload.TaskTitle, payload.TaskType.upper(), payload.MachineID or '',
                payload.Priority.upper(), payload.Department or 'KỸ THUẬT', payload.RequesterName,
                payload.AssignedTo or '', payload.Description or '', cycle_type,
                payload.IntervalDays or 0, (payload.MonthlyDays or '').strip(),
                1 if payload.AutoRecreateOnComplete else 0,
                next_due, now_str, now_str, now_str
            ))
            template_id = c.lastrowid

        # Nhóm thực hiện & danh sách nhân viên
        assigned_group_ids_str = json.dumps(payload.AssignedGroupIDs) if payload.AssignedGroupIDs else ""
        assigned_group_names = payload.AssignedGroupNames or ""
        assigned_emp_ids_str = json.dumps(payload.AssignedEmpIDs) if payload.AssignedEmpIDs else ""

        resolved_dept = normalize_department_name(c, payload.Department)
        resolved_machine = normalize_machine_id(c, payload.MachineID)
        requester = (payload.RequesterName and payload.RequesterName.strip() and payload.RequesterName.strip() != "KỸ THUẬT" and payload.RequesterName.strip()) or creator

        c.execute("""
            INSERT INTO internal_work_orders
            (TaskCode, TaskTitle, TaskType, MachineID, Priority, Department, RequesterName,
             RequesterEmail, RequesterPhone, AssignedTo, AssignedGroupIDs, AssignedGroupNames, AssignedEmpIDs,
             Description, Status, ReportedAt, CreatedBy, CreatedAt, UpdatedAt,
             RecurringTemplateID, CycleInfo, RecurringCount, NextDueDate, NextTaskIdCreated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, 1, ?, 0)
        """, (
            task_code, payload.TaskTitle, payload.TaskType.upper(), resolved_machine,
            payload.Priority.upper(), resolved_dept, requester,
            payload.RequesterEmail or '', payload.RequesterPhone or '',
            payload.AssignedTo or '', assigned_group_ids_str, assigned_group_names, assigned_emp_ids_str,
            payload.Description or '', now_str, creator, now_str, now_str,
            template_id, cycle_info, next_due
        ))
        task_id = c.lastrowid

        if template_id and payload.IsRecurring:
            c.execute("UPDATE internal_task_recurring_templates SET CurrentTaskID = ? WHERE id = ?", (task_id, template_id))

        # Lưu danh sách hạng mục công việc con (Checklist Items)
        raw_items = payload.Items or payload.items
        if raw_items:
            for idx, itm in enumerate(raw_items, start=1):
                note_str = itm.Note or itm.Notes or ''
                order_val = itm.ItemOrder if (itm.ItemOrder is not None and itm.ItemOrder > 0) else idx
                c.execute("""
                    INSERT INTO internal_task_items
                    (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
                """, (
                    task_id, template_id if payload.IsRecurring else None,
                    order_val, itm.ItemTitle.strip(),
                    itm.AssignedEmpID or '', itm.AssignedTo or '',
                    itm.Department or 'Cơ điện', note_str,
                    itm.SampleImageUrl or '', itm.SampleImagePath or '',
                    itm.StandardGuideline or '',
                    now_str, now_str
                ))

                # Nếu là mẫu chu kỳ, lưu mẫu cho các lần sinh tiếp theo
                if template_id and payload.IsRecurring:
                    c.execute("""
                        INSERT INTO internal_task_items
                        (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
                        VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
                    """, (
                        template_id, order_val, itm.ItemTitle.strip(),
                        itm.AssignedEmpID or '', itm.AssignedTo or '',
                        itm.Department or 'Cơ điện', note_str,
                        itm.SampleImageUrl or '', itm.SampleImagePath or '',
                        itm.StandardGuideline or '',
                        now_str, now_str
                    ))

        conn.commit()

        # Gửi email thông báo vòng đời CREATED nếu có email
        if payload.RequesterEmail and "@" in payload.RequesterEmail:
            background_tasks.add_task(send_task_lifecycle_email, task_id, "CREATED")

        msg = f"Tạo công việc {task_code} thành công."
        if payload.IsRecurring:
            msg += f" Đã thiết lập chu kỳ ({cycle_info}, Hạn: {next_due})."

        return {
            "status": "success",
            "task_id": task_id,
            "task_code": task_code,
            "template_id": template_id,
            "next_due_date": next_due,
            "message": msg
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo công việc: {str(e)}")
    finally:
        conn.close()


@app.get("/api/internal-tasks/{task_id}")
def get_internal_task_detail(task_id: int):
    """Chi tiết công việc nội bộ kèm hình ảnh và danh sách hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT w.*, 
                   (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id) as total_items,
                   (SELECT COUNT(*) FROM internal_task_items WHERE TaskID = w.id AND Status = 'COMPLETED') as completed_items
            FROM internal_work_orders w
            WHERE w.id = ?
        """, (task_id,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
        task = dict(row)

        # Checklist items
        c.execute("""
            SELECT * FROM internal_task_items
            WHERE TaskID = ?
            ORDER BY ItemOrder ASC, id ASC
        """, (task_id,))
        task["items"] = [dict(r) for r in c.fetchall()]

        # Images
        c.execute("""
            SELECT * FROM internal_work_images
            WHERE TaskID = ?
            ORDER BY id ASC
        """, (task_id,))
        task["images"] = [dict(r) for r in c.fetchall()]

        return task
    finally:
        conn.close()


@app.post("/api/internal-tasks/{task_id}/items")
def add_task_item(
    task_id: int,
    payload: TaskItemCreate,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Thêm hạng mục con vào công việc nội bộ"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, RecurringTemplateID FROM internal_work_orders WHERE id = ?", (task_id,))
        task = c.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
        
        tpl_id = task["RecurringTemplateID"]

        c.execute("SELECT MAX(ItemOrder) FROM internal_task_items WHERE TaskID = ?", (task_id,))
        max_order = c.fetchone()[0] or 0
        order_val = payload.ItemOrder if (payload.ItemOrder is not None and payload.ItemOrder > 0) else (max_order + 1)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        c.execute("""
            INSERT INTO internal_task_items
            (TaskID, TemplateID, ItemOrder, ItemTitle, AssignedEmpID, AssignedTo, Department, Status, Note, SampleImageUrl, SampleImagePath, StandardGuideline, CreatedAt, UpdatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
        """, (
            task_id, tpl_id, order_val, payload.ItemTitle.strip(),
            payload.AssignedEmpID or '', payload.AssignedTo or '',
            payload.Department or 'Cơ điện', payload.Note or payload.Notes or '',
            payload.SampleImageUrl or '', payload.SampleImagePath or '',
            payload.StandardGuideline or '',
            now_str, now_str
        ))
        item_id = c.lastrowid
        conn.commit()
        return {
            "status": "success",
            "item_id": item_id,
            "message": "Đã thêm hạng mục thành công."
        }
    finally:
        conn.close()


@app.put("/api/internal-tasks/items/{item_id}")
def update_task_item(
    item_id: int,
    payload: TaskItemUpdate,
    background_tasks: BackgroundTasks,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Cập nhật trạng thái hạng mục (PENDING / COMPLETED), người thực hiện, ghi chú, ảnh mẫu"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("SELECT * FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục công việc.")

        item = dict(item)
        fields = ["UpdatedAt = ?"]
        values = [now_str]

        user_name = (payload.AssignedTo or (current_user["full_name"] if current_user else "")).strip() or "Kỹ thuật viên"
        user_empid = (payload.AssignedEmpID or (current_user["emp_id"] if current_user and "emp_id" in current_user else "")).strip()

        if payload.Status is not None:
            new_status = payload.Status.upper()
            fields.append("Status = ?")
            values.append(new_status)
            if new_status == "COMPLETED":
                fields.append("CompletedAt = ?")
                values.append(now_str)
                fields.append("CompletedBy = ?")
                values.append(user_name)
                fields.append("AssignedTo = ?")
                values.append(user_name)
                if user_empid:
                    fields.append("AssignedEmpID = ?")
                    values.append(user_empid)
            elif new_status == "PENDING":
                fields.append("CompletedAt = NULL")
                fields.append("CompletedBy = NULL")

        if payload.ItemTitle is not None:
            fields.append("ItemTitle = ?")
            values.append(payload.ItemTitle.strip())

        if payload.AssignedEmpID is not None and (payload.Status != "COMPLETED" or not user_empid):
            fields.append("AssignedEmpID = ?")
            values.append(payload.AssignedEmpID)

        if payload.AssignedTo is not None and (payload.Status != "COMPLETED" or not user_name):
            fields.append("AssignedTo = ?")
            values.append(payload.AssignedTo)

        if payload.Department is not None:
            fields.append("Department = ?")
            values.append(payload.Department)

        note_val = payload.Note if payload.Note is not None else payload.Notes
        if note_val is not None:
            fields.append("Note = ?")
            values.append(note_val)

        if payload.SampleImageUrl is not None:
            fields.append("SampleImageUrl = ?")
            values.append(payload.SampleImageUrl)

        if payload.StandardGuideline is not None:
            fields.append("StandardGuideline = ?")
            values.append(payload.StandardGuideline)

        if payload.ItemOrder is not None:
            fields.append("ItemOrder = ?")
            values.append(payload.ItemOrder)

        values.append(item_id)
        sql = f"UPDATE internal_task_items SET {', '.join(fields)} WHERE id = ?"
        c.execute(sql, values)

        task_info = None
        if item.get("TaskID"):
            task_id = item["TaskID"]
            c.execute("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN Status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                FROM internal_task_items WHERE TaskID = ?
            """, (task_id,))
            stat = c.fetchone()
            total = stat['total'] if stat and stat['total'] else 0
            completed = stat['completed'] if stat and stat['completed'] else 0
            pct = int(round((completed / total) * 100)) if total > 0 else 0

            c.execute("SELECT Status, StartedAt FROM internal_work_orders WHERE id = ?", (task_id,))
            parent = c.fetchone()
            if parent and parent["Status"] == "PENDING" and (completed > 0 or payload.Status in ["IN_PROGRESS", "COMPLETED"]):
                c.execute("UPDATE internal_work_orders SET Status = 'IN_PROGRESS', StartedAt = COALESCE(StartedAt, ?), UpdatedAt = ? WHERE id = ?", (now_str, now_str, task_id))
                background_tasks.add_task(send_task_lifecycle_email, task_id, "STARTED")

            task_info = {
                "task_id": task_id,
                "total_items": total,
                "completed_items": completed,
                "progress_percent": pct
            }

        conn.commit()
        return {
            "status": "success",
            "message": "Cập nhật hạng mục thành công.",
            "item_id": item_id,
            "task_progress": task_info
        }
    finally:
        conn.close()


@app.delete("/api/internal-tasks/items/{item_id}")
def delete_task_item(item_id: int):
    """Xóa hạng mục con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM internal_task_items WHERE id = ?", (item_id,))
        conn.commit()
        return {"status": "success", "message": "Đã xóa hạng mục thành công."}
    finally:
        conn.close()


@app.get("/api/internal-tasks/items/{item_id}/proof-images")
def get_task_item_proof_images(item_id: int):
    """
    Lấy danh sách ảnh thực tế kỹ thuật viên đã chụp khi thực hiện hạng mục này (hoặc các lần làm trước đó)
    để người dùng có thể xem và chọn làm ảnh mẫu chuẩn SOP.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục.")
        item = dict(item)
        item_title = item.get("ItemTitle", "").strip()

        candidate_images = []
        seen_urls = set()

        if item_title:
            c.execute("""
                SELECT i.id, i.FileUrl, i.FileName, i.UploadedAt, i.UploadedBy, w.TaskCode, w.MachineID
                FROM internal_work_images i
                JOIN internal_work_orders w ON i.TaskID = w.id
                JOIN internal_task_items ti ON i.TaskItemID = ti.id
                WHERE UPPER(TRIM(ti.ItemTitle)) = UPPER(TRIM(?)) AND i.FileUrl IS NOT NULL AND i.FileUrl != ''
                ORDER BY i.id DESC
                LIMIT 20
            """, (item_title,))
            for r in c.fetchall():
                d = dict(r)
                d["Source"] = "internal_task"
                d["SourceTitle"] = f"Công việc {d.get('TaskCode', '')}"
                if d["FileUrl"] not in seen_urls:
                    seen_urls.add(d["FileUrl"])
                    candidate_images.append(d)

            c.execute("""
                SELECT m.id, m.FileUrl, m.FileName, m.CreatedAt as UploadedAt, m.CreatedBy as UploadedBy, m.MachineID, m.Note as Caption
                FROM machine_maintenance_images m
                WHERE m.Note LIKE ? OR m.MachineID IN (
                    SELECT MachineID FROM internal_work_orders WHERE id = ?
                )
                ORDER BY m.id DESC
                LIMIT 20
            """, (f"%{item_title}%", item.get("TaskID") or 0))
            for r in c.fetchall():
                d = dict(r)
                d["Source"] = "maintenance"
                d["SourceTitle"] = f"Bảo dưỡng máy {d.get('MachineID', '')}"
                if d["FileUrl"] not in seen_urls:
                    seen_urls.add(d["FileUrl"])
                    candidate_images.append(d)

        return {
            "status": "success",
            "item_id": item_id,
            "item_title": item_title,
            "current_sample_url": item.get("SampleImageUrl") or "",
            "standard_guideline": item.get("StandardGuideline") or "",
            "images_count": len(candidate_images),
            "images": candidate_images
        }
    finally:
        conn.close()


@app.post("/api/internal-tasks/items/{item_id}/set-sample-from-image")
def set_item_sample_from_image(
    item_id: int,
    payload: dict,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Chọn một ảnh thực tế làm ảnh mẫu chuẩn SOP cho hạng mục"""
    conn = get_connection()
    c = conn.cursor()
    try:
        image_url = payload.get("image_url")
        guideline = payload.get("standard_guideline")
        if not image_url:
            raise HTTPException(status_code=400, detail="Thiếu đường dẫn ảnh mẫu.")

        c.execute("SELECT * FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục.")
        item = dict(item)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        guide_str = guideline if guideline is not None else (item.get("StandardGuideline") or "")

        c.execute("""
            UPDATE internal_task_items
            SET SampleImageUrl = ?, StandardGuideline = ?, UpdatedAt = ?
            WHERE id = ?
        """, (image_url, guide_str, now_str, item_id))

        if item.get("TemplateID"):
            tpl_id = item["TemplateID"]
            c.execute("""
                UPDATE internal_task_items
                SET SampleImageUrl = ?, StandardGuideline = ?, UpdatedAt = ?
                WHERE TemplateID = ? AND (TaskID IS NULL OR TaskID = 0) AND ItemTitle = ?
            """, (image_url, guide_str, now_str, tpl_id, item["ItemTitle"]))

        conn.commit()
        return {
            "status": "success",
            "message": f"Đã lưu ảnh mẫu SOP cho hạng mục '{item['ItemTitle']}' thành công.",
            "item_id": item_id,
            "sample_image_url": image_url
        }
    finally:
        conn.close()


@app.put("/api/internal-tasks/{task_id}")
def update_internal_task(
    task_id: int,
    payload: InternalTaskUpdate,
    background_tasks: BackgroundTasks,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Cập nhật tiến độ / giải pháp / thời gian hoàn thành công việc nội bộ & tự động sinh việc chu kỳ kế tiếp"""
    conn = get_connection()
    c = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        c.execute("SELECT * FROM internal_work_orders WHERE id = ?", (task_id,))
        task_row = c.fetchone()
        if not task_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
        old_task = dict(task_row)
        old_status = old_task.get("Status", "PENDING")
        old_assignee = old_task.get("AssignedTo", "")

        fields = ["UpdatedAt = ?"]
        values = [now_str]

        if payload.TaskTitle is not None:
            fields.append("TaskTitle = ?")
            values.append(payload.TaskTitle)

        if payload.Priority is not None:
            fields.append("Priority = ?")
            values.append(payload.Priority.upper())

        if payload.Department is not None:
            resolved_dept = normalize_department_name(c, payload.Department)
            fields.append("Department = ?")
            values.append(resolved_dept)

        if payload.MachineID is not None:
            resolved_machine = normalize_machine_id(c, payload.MachineID)
            fields.append("MachineID = ?")
            values.append(resolved_machine)

        if payload.Description is not None:
            fields.append("Description = ?")
            values.append(payload.Description)

        if payload.AssignedTo is not None:
            fields.append("AssignedTo = ?")
            values.append(payload.AssignedTo)

        if payload.AssignedGroupIDs is not None:
            gids_str = json.dumps(payload.AssignedGroupIDs) if isinstance(payload.AssignedGroupIDs, list) else str(payload.AssignedGroupIDs)
            fields.append("AssignedGroupIDs = ?")
            values.append(gids_str)

        if payload.AssignedGroupNames is not None:
            fields.append("AssignedGroupNames = ?")
            values.append(payload.AssignedGroupNames)

        if payload.AssignedEmpIDs is not None:
            eids_str = json.dumps(payload.AssignedEmpIDs) if isinstance(payload.AssignedEmpIDs, list) else str(payload.AssignedEmpIDs)
            fields.append("AssignedEmpIDs = ?")
            values.append(eids_str)

        if payload.Solution is not None:
            fields.append("Solution = ?")
            values.append(payload.Solution.strip() if payload.Solution else "")

        if payload.DowntimeMinutes is not None:
            fields.append("DowntimeMinutes = ?")
            values.append(float(payload.DowntimeMinutes) if payload.DowntimeMinutes else 0.0)

        next_spawned = None

        if payload.Status is not None:
            new_st = payload.Status.upper()
            fields.append("Status = ?")
            values.append(new_st)

            if new_st == "IN_PROGRESS" and old_status == "PENDING":
                fields.append("StartedAt = COALESCE(StartedAt, ?)")
                values.append(now_str)
            elif new_st == "COMPLETED" and old_status != "COMPLETED":
                fields.append("CompletedAt = COALESCE(CompletedAt, ?)")
                values.append(now_str)
                fields.append("StartedAt = COALESCE(StartedAt, ?)")
                values.append(now_str)

                tpl_id = old_task.get("RecurringTemplateID")
                if tpl_id:
                    c.execute("SELECT * FROM internal_task_recurring_templates WHERE id = ?", (tpl_id,))
                    tpl_row = c.fetchone()
                    if tpl_row and tpl_row["IsActive"] and tpl_row["AutoRecreateOnComplete"]:
                        tpl = dict(tpl_row)
                        next_spawned = spawn_next_recurring_task(c, tpl, now_str)

        values.append(task_id)
        sql = f"UPDATE internal_work_orders SET {', '.join(fields)} WHERE id = ?"
        c.execute(sql, values)
        conn.commit()

        if payload.AssignedTo is not None:
            new_assignee = payload.AssignedTo.strip()
            if new_assignee and new_assignee != old_assignee:
                background_tasks.add_task(send_task_lifecycle_email, task_id, "ASSIGNED")

        if payload.Status is not None:
            new_st = payload.Status.upper()
            if new_st == "IN_PROGRESS" and old_status != "IN_PROGRESS":
                background_tasks.add_task(send_task_lifecycle_email, task_id, "STARTED")
            elif new_st == "COMPLETED" and old_status != "COMPLETED":
                background_tasks.add_task(send_task_lifecycle_email, task_id, "COMPLETED")

        msg = "Cập nhật công việc thành công."
        if next_spawned:
            msg = f"Đã hoàn tất nghiệm thu! Tự động khởi tạo chu kỳ tiếp theo: {next_spawned['task_code']} (Hạn: {next_spawned['next_due_date']})."

        return {
            "status": "success",
            "message": msg,
            "next_task": next_spawned
        }
    finally:
        conn.close()


@app.post("/api/internal-tasks/{task_id}/photos")
async def upload_internal_task_photo(
    task_id: int,
    image_type: str = Form("BEFORE"),
    caption: Optional[str] = Form(""),
    task_item_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tải ảnh hiện trường sự cố / kết quả sửa chữa lưu vào NAS/Cache"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, TaskCode FROM internal_work_orders WHERE id = ?", (task_id,))
        task = c.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")

        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Tệp tải lên rỗng.")

        saved = save_internal_task_image(
            file_bytes=file_bytes,
            original_filename=file.filename or "photo.jpg",
            task_code=task['TaskCode'],
            image_type=image_type.upper()
        )

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        uploader = current_user["full_name"] if current_user else "Kỹ thuật viên"

        saved_filename = saved.get("filename") or os.path.basename(saved.get("file_path", "photo.jpg"))

        # Nếu chụp cho hạng mục con: Xóa toàn bộ ảnh cũ của hạng mục con này trong mục ảnh chung
        if task_item_id:
            c.execute("SELECT id, NASFilePath, FileUrl FROM internal_work_images WHERE TaskItemID = ?", (task_item_id,))
            old_sub_images = c.fetchall()
            for old_img in old_sub_images:
                try:
                    old_path = old_img['NASFilePath']
                    if old_path and os.path.exists(old_path):
                        os.remove(old_path)
                except Exception as ex_del:
                    logger.warning(f"Lỗi xóa file ảnh cũ #{old_img['id']}: {ex_del}")
            c.execute("DELETE FROM internal_work_images WHERE TaskItemID = ?", (task_item_id,))

        c.execute("""
            INSERT INTO internal_work_images (TaskID, ImageType, NASFilePath, FileUrl, FileName, Caption, UploadedBy, UploadedAt, TaskItemID)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (task_id, image_type.upper(), saved["file_path"], saved["file_url"], saved_filename, caption or "", uploader, now_str, task_item_id))
        image_id = c.lastrowid

        # Update ActualImageUrl in internal_task_items
        if task_item_id:
            c.execute("""
                UPDATE internal_task_items 
                SET ActualImageUrl = ?, 
                    Status = 'COMPLETED', 
                    CompletedAt = COALESCE(CompletedAt, ?), 
                    CompletedBy = COALESCE(CompletedBy, ?), 
                    AssignedTo = COALESCE(AssignedTo, ?) 
                WHERE id = ?
            """, (saved["file_url"], now_str, uploader, uploader, task_item_id))

        conn.commit()
        return {
            "status": "success",
            "image_id": image_id,
            "task_item_id": task_item_id,
            "file_url": saved["file_url"],
            "filename": saved_filename,
            "message": "Tải ảnh thành công."
        }
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Lỗi tải ảnh công việc #{task_id}: {ex}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý ảnh: {str(ex)}")
    finally:
        conn.close()


@app.delete("/api/internal-tasks/photos/{image_id}")
def delete_internal_task_photo(
    image_id: int,
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Xóa ảnh trong mục ảnh chung của công việc"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, TaskID, TaskItemID, NASFilePath, FileUrl FROM internal_work_images WHERE id = ?", (image_id,))
        img = c.fetchone()
        if not img:
            raise HTTPException(status_code=404, detail="Không tìm thấy hình ảnh.")

        # Xóa file vật lý nếu có
        try:
            file_path = img["NASFilePath"]
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
        except Exception as ex_file:
            logger.warning(f"Lỗi xóa file vật lý ảnh #{image_id}: {ex_file}")

        # Xóa bản ghi trong internal_work_images
        c.execute("DELETE FROM internal_work_images WHERE id = ?", (image_id,))

        # Nếu ảnh này liên kết với hạng mục con, cập nhật lại ActualImageUrl của hạng mục con
        if img["TaskItemID"]:
            c.execute("SELECT FileUrl FROM internal_work_images WHERE TaskItemID = ? ORDER BY id DESC LIMIT 1", (img["TaskItemID"],))
            remaining = c.fetchone()
            rem_url = remaining["FileUrl"] if remaining else None
            c.execute("UPDATE internal_task_items SET ActualImageUrl = ? WHERE id = ?", (rem_url, img["TaskItemID"]))

        conn.commit()
        return {"status": "success", "message": "Đã xóa hình ảnh thành công.", "image_id": image_id}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Lỗi xóa ảnh #{image_id}: {ex}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi xóa ảnh: {str(ex)}")
    finally:
        conn.close()



# =========================================================================
# SUPPLEMENTARY APIS FOR FULL SYSTEM CAPABILITY
# =========================================================================

@app.get("/api/categories/machines")
def get_categories_machines():
    """Lấy danh mục các máy từ CL_tblMacList"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT MachineID, MachineText, MacCateID, MacLineID, DepartID, DepartName, ModelID, IsClosed
            FROM CL_tblMacList
            WHERE IsClosed = 0 OR IsClosed IS NULL
            ORDER BY MachineID ASC
        """)
        return {"machines": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()


@app.get("/api/inventory/items")
def get_inventory_items(
    q: Optional[str] = Query(None, description="Tìm theo mã hoặc tên vật tư"),
    wh: Optional[str] = Query(None, description="Lọc theo mã kho"),
    status: Optional[str] = Query("all", description="all, available, out_of_stock, low_stock"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    page: Optional[int] = Query(None)
):
    """Danh sách vật tư tồn kho thực tế từ ERP SQL Server (bảng erp_inventory_stock)"""
    conn = get_connection()
    c = conn.cursor()
    try:
        where = []
        params = []
        if q and q.strip():
            kw = f"%{q.strip()}%"
            where.append("(ItemID LIKE ? OR ItemText LIKE ? OR StorageID LIKE ?)")
            params.extend([kw, kw, kw])
        if wh and wh.strip() and wh.lower() != "all":
            where.append("WHouseID = ?")
            params.append(wh.strip())
        if status == "available":
            where.append("CurrentStock > 0")
        elif status == "out_of_stock":
            where.append("CurrentStock <= 0")
        elif status == "low_stock":
            where.append("(StockStatus = 'LOW_STOCK' OR (CurrentStock > 0 AND CurrentStock <= QtyMin))")

        where_clause = ("WHERE " + " AND ".join(where)) if where else ""
        c.execute(f"SELECT COUNT(*) FROM erp_inventory_stock {where_clause}", params)
        total = c.fetchone()[0]

        if page is not None and page > 0:
            eff_offset = (page - 1) * limit
        else:
            eff_offset = offset

        sql = f"""
            SELECT id, WHouseID, WHouseText, ItemID, ItemText, Unit, StorageID, InvtAcctID, CurrentStock, QtyMin, QtyMax, StockStatus, LastSyncedAt
            FROM erp_inventory_stock
            {where_clause}
            ORDER BY WHouseID ASC, ItemID ASC
            LIMIT ? OFFSET ?
        """
        c.execute(sql, params + [limit, eff_offset])
        items = [dict(r) for r in c.fetchall()]
        return {"items": items, "total": total, "limit": limit, "offset": eff_offset}
    finally:
        conn.close()


@app.get("/api/inventory/summary")
def get_inventory_summary():
    """Thống kê tổng quan tồn kho theo từng kho từ erp_inventory_stock"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT 
                WHouseID,
                MAX(WHouseText) as WHouseText,
                COUNT(*) as total_rows,
                COUNT(DISTINCT ItemID) as distinct_items,
                SUM(CASE WHEN CurrentStock > 0 THEN 1 ELSE 0 END) as positive_rows,
                SUM(CASE WHEN CurrentStock <= 0 THEN 1 ELSE 0 END) as zero_rows,
                SUM(CASE WHEN StockStatus = 'LOW_STOCK' OR (CurrentStock > 0 AND CurrentStock <= QtyMin) THEN 1 ELSE 0 END) as low_stock_rows,
                MAX(LastSyncedAt) as last_synced_at
            FROM erp_inventory_stock
            GROUP BY WHouseID
            ORDER BY total_rows DESC
        """)
        warehouses = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT 
                COUNT(*) as total_rows,
                COUNT(DISTINCT ItemID) as distinct_items,
                SUM(CASE WHEN CurrentStock > 0 THEN 1 ELSE 0 END) as positive_rows,
                SUM(CASE WHEN CurrentStock <= 0 THEN 1 ELSE 0 END) as zero_rows,
                SUM(CASE WHEN StockStatus = 'LOW_STOCK' OR (CurrentStock > 0 AND CurrentStock <= QtyMin) THEN 1 ELSE 0 END) as low_stock_rows,
                MAX(LastSyncedAt) as last_synced_at
            FROM erp_inventory_stock
        """)
        tot = c.fetchone()
        totals = dict(tot) if tot else {}
        return {"warehouses": warehouses, "totals": totals}
    finally:
        conn.close()


@app.get("/api/inventory/requests")
def get_inventory_requests():
    """Lấy danh sách phiếu yêu cầu xuất kho"""
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""
            SELECT r.*,
                   COUNT(CASE WHEN i.IsCancelled IS NULL OR i.IsCancelled = 0 THEN i.id END) as active_item_count,
                   COUNT(i.id) as item_count,
                   SUM(CASE WHEN i.IsCancelled IS NULL OR i.IsCancelled = 0 THEN i.RequestedQty ELSE 0 END) as total_requested_qty
            FROM warehouse_issue_requests r
            LEFT JOIN warehouse_issue_items i ON r.id = i.RequestID
            GROUP BY r.id
            ORDER BY r.id DESC LIMIT 100
        """)
        requests = [dict(r) for r in c.fetchall()]

        for req in requests:
            c.execute("""
                SELECT id, ItemID, ItemText, WHouseID, Unit, StorageID, RequestedQty, IssuedQty, Remark, VoucherCode,
                       IsReceived, ReceivedAt, ReceivedBy, ReceivedPhotoUrl,
                       IsCancelled, CancelledAt, CancelledBy, CancelReason
                FROM warehouse_issue_items
                WHERE RequestID = ?
                ORDER BY id ASC
            """, (req['id'],))
            req['items'] = [dict(it) for it in c.fetchall()]

        return {"requests": requests}
    finally:
        conn.close()


@app.post("/api/inventory/sync")
def sync_inventory_api(current_user: Optional[dict] = Depends(get_current_user_optional)):
    """Kích hoạt đồng bộ tức thời số liệu tồn kho từ SQL Server ERP sang SQLite"""
    try:
        res = sync_erp_inventory()
        return {"status": "success", "message": f"Đã đồng bộ {res.get('rows_inserted', 0)} dòng tồn kho ERP.", "data": res}
    except Exception as e:
        logger.error(f"Lỗi đồng bộ kho: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi đồng bộ tồn kho: {str(e)}")


@app.get("/api/works")
def list_works():
    """Lấy danh mục 161 hạng mục bảo dưỡng lớn từ EM_tblWork1 kèm số lượng công việc con"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT 
                w1.WorkID,
                w1.WorkText,
                w1.ModelID,
                w1.DepartID,
                w1.Stoptime,
                COUNT(w2.Work2RowID) as SubTaskCount,
                COUNT(DISTINCT w2.NodeID) as NodeCount
            FROM EM_tblWork1 w1
            LEFT JOIN EM_tblWork2 w2 ON w1.WorkID = w2.WorkID
            GROUP BY w1.WorkID
            ORDER BY w1.WorkID ASC
        """)
        return {"works": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()


@app.post("/api/sync/works")
def sync_works_api(current_user: dict = Depends(require_role(["admin", "supervisor"]))):
    """Kích hoạt đồng bộ lại danh mục và 1053 chi tiết công việc chuẩn từ ERP SQL Server"""
    try:
        from sync_service import sync_work_templates
        res = sync_work_templates()
        return {"status": "success", "message": "Đồng bộ danh mục công việc thành công.", "data": res}
    except Exception as e:
        logger.error(f"Lỗi đồng bộ danh mục: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi đồng bộ: {str(e)}")


@app.get("/api/templates")
def list_templates(
    search: Optional[str] = None,
    work_id: Optional[str] = None,
    node_id: Optional[str] = None,
    service_id: Optional[str] = None
):
    """Lấy danh mục các hạng mục bảo dưỡng chuẩn và hình ảnh mẫu SOP"""
    conn = get_connection()
    c = conn.cursor()
    try:
        where = []
        params = []
        if search and search.strip():
            kw = f"%{search.strip()}%"
            where.append("(TaskTitle LIKE ? OR WorkText LIKE ? OR NodeText LIKE ? OR ServiceText LIKE ?)")
            params.extend([kw, kw, kw, kw])
        if work_id and work_id.strip():
            where.append("WorkID = ?")
            params.append(work_id.strip())
        if node_id and node_id.strip():
            where.append("NodeID = ?")
            params.append(node_id.strip())
        if service_id and service_id.strip():
            where.append("ServiceID = ?")
            params.append(service_id.strip())

        where_clause = ("WHERE " + " AND ".join(where)) if where else ""
        c.execute(f"""
            SELECT * FROM maintenance_task_templates
            {where_clause}
            ORDER BY WorkID ASC, iRow ASC, id ASC
            LIMIT 500
        """, params)
        return {"templates": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()


@app.get("/api/templates/{template_id}/proof-images")
def get_template_proof_images(template_id: int):
    """Lấy danh sách ảnh thực tế kỹ thuật viên đã chụp khi bảo dưỡng cho hạng mục này"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT id, WorkOrderID, MachineID, ImageType, FileUrl, FileName, Caption, UploadedBy, UploadedAt
            FROM order_proof_images
            WHERE TemplateID = ?
            ORDER BY id DESC
        """, (template_id,))
        return {"images": [dict(r) for r in c.fetchall()]}
    finally:
        conn.close()


@app.post("/api/system/email-settings/test")
def test_system_email_settings(payload: dict = Body(...), current_user: dict = Depends(require_role(["admin", "supervisor"]))):
    """Gửi email thử nghiệm theo thông số cấu hình SMTP"""
    smtp_server = payload.get("SmtpServer")
    smtp_port = int(payload.get("SmtpPort") or 587)
    sender_email = payload.get("SenderEmail")
    sender_password = payload.get("SenderPassword")
    use_tls = bool(payload.get("UseTls", 1))

    if not smtp_server or not sender_email or not sender_password:
        raise HTTPException(status_code=400, detail="Vui lòng điền đủ máy chủ SMTP, email gửi và mật khẩu ứng dụng.")

    recipient = payload.get("WarehouseKeeperEmail") or sender_email
    try:
        msg = MIMEMultipart()
        msg['From'] = f"BOPP Maintenance Test <{sender_email}>"
        msg['To'] = recipient
        msg['Subject'] = "[TEST] Kiểm tra kết nối Email Hệ thống Bảo dưỡng BOPP"
        body = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h3 style="color: #4f46e5;">Thử Nghiệm Kết Nối SMTP Thành Công!</h3>
            <p>Hệ thống Quản lý Lệnh Bảo Dưỡng BOPP đã kết nối và gửi email kiểm tra thành công.</p>
            <p><b>Thời gian gửi:</b> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p><b>Máy chủ:</b> {smtp_server}:{smtp_port}</p>
        </div>
        """
        msg.attach(MIMEText(body, 'html', 'utf-8'))

        server = smtplib.SMTP(smtp_server, smtp_port, timeout=10)
        if use_tls:
            server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()

        return {"status": "success", "message": f"Email thử nghiệm đã được gửi thành công đến {recipient}!"}
    except Exception as e:
        logger.error(f"Lỗi gửi email thử nghiệm: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi gửi email: {str(e)}")


@app.post("/api/internal-tasks/items/{item_id}/sample-image")
async def upload_item_sample_image(
    item_id: int,
    file: UploadFile = File(...),
    guideline: Optional[str] = Form(None),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Tải trực tiếp tệp ảnh mẫu chuẩn SOP cho checklist item"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, TaskID, TemplateID, ItemTitle FROM internal_task_items WHERE id = ?", (item_id,))
        item = c.fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy hạng mục công việc.")

        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Tệp ảnh tải lên rỗng.")

        saved = save_item_sample_image(
            file_bytes=file_bytes,
            original_filename=file.filename or "sample.jpg",
            item_id=item_id,
            item_title=item["ItemTitle"]
        )

        saved_url = saved["file_url"]
        saved_path = saved["file_path"]

        fields = ["SampleImageUrl = ?", "SampleImagePath = ?"]
        vals = [saved_url, saved_path]
        if guideline is not None:
            fields.append("StandardGuideline = ?")
            vals.append(guideline.strip())
        vals.append(item_id)

        c.execute(f"UPDATE internal_task_items SET {', '.join(fields)} WHERE id = ?", vals)
        conn.commit()

        ws_manager.broadcast_sync("TASK_ITEM_UPDATED", {"item_id": item_id, "task_id": item["TaskID"]})

        return {
            "status": "success",
            "message": "Đã lưu ảnh mẫu SOP thành công.",
            "file_url": saved_url,
            "file_path": saved_path
        }
    finally:
        conn.close()


@app.post("/api/auth/users")
def create_user(payload: dict = Body(...), current_user: dict = Depends(require_role(["admin", "supervisor"]))):
    """Tạo tài khoản người dùng mới"""
    username = (payload.get("username") or "").strip()
    password = payload.get("password")
    full_name = (payload.get("full_name") or "").strip()
    employee_id = (payload.get("employee_id") or "").strip() or None
    department = payload.get("department") or "4BP03"
    role = payload.get("role") or "technician"

    if not username or not password or not full_name:
        raise HTTPException(status_code=400, detail="Vui lòng điền đủ tên đăng nhập, họ tên và mật khẩu.")

    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id FROM users WHERE username = ?", (username,))
        if c.fetchone():
            raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{username}' đã tồn tại.")

        perms = payload.get("permissions")
        if not perms:
            perms_str = get_default_permissions_for_user(role, department)
        else:
            perms_str = json.dumps(perms) if isinstance(perms, dict) else str(perms)

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, emp_id, role, depart_id, permissions, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        """, (username, hash_password(password), full_name, employee_id, role, department, perms_str, now_str))
        user_id = c.lastrowid
        conn.commit()
        return {"status": "success", "message": f"Tạo tài khoản @{username} thành công.", "user_id": user_id}
    finally:
        conn.close()


@app.put("/api/auth/users/{user_id}")
def update_user(user_id: int, payload: dict = Body(...), current_user: dict = Depends(require_role(["admin", "supervisor"]))):
    """Cập nhật thông tin & phân quyền tài khoản"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
        target = c.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

        fields = []
        vals = []
        if "full_name" in payload and payload["full_name"]:
            fields.append("full_name = ?")
            vals.append(payload["full_name"].strip())
        if "employee_id" in payload:
            fields.append("emp_id = ?")
            vals.append(payload["employee_id"].strip() if payload["employee_id"] else None)
        if "department" in payload:
            fields.append("depart_id = ?")
            vals.append(payload["department"].strip())
        if "role" in payload:
            fields.append("role = ?")
            vals.append(payload["role"].strip())
        if "is_active" in payload:
            fields.append("is_active = ?")
            vals.append(1 if payload["is_active"] else 0)
        if "permissions" in payload:
            perms = payload["permissions"]
            perms_str = json.dumps(perms) if isinstance(perms, dict) else str(perms)
            fields.append("permissions = ?")
            vals.append(perms_str)

        if fields:
            vals.append(user_id)
            c.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", vals)
            conn.commit()

        return {"status": "success", "message": "Cập nhật tài khoản và phân quyền thành công."}
    finally:
        conn.close()


@app.post("/api/auth/users/{user_id}/reset-password")
def reset_user_password(user_id: int, payload: dict = Body(...), current_user: dict = Depends(require_role(["admin", "supervisor"]))):
    """Đặt lại mật khẩu cho tài khoản"""
    new_password = payload.get("new_password")
    if not new_password or len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải từ 4 ký tự trở lên.")

    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
        if not c.fetchone():
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

        c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
        conn.commit()
        return {"status": "success", "message": "Đặt lại mật khẩu thành công."}
    finally:
        conn.close()


@app.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int, current_user: dict = Depends(require_role(["admin"]))):
    """Xóa tài khoản người dùng"""
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")
        if row["username"] == "admin":
            raise HTTPException(status_code=400, detail="Không thể xóa tài khoản Quản trị viên (admin).")

        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return {"status": "success", "message": f"Đã xóa tài khoản @{row['username']}."}
    finally:
        conn.close()


if __name__ == '__main__':
    import uvicorn
    host = os.getenv("APP_HOST", "0.0.0.0")
    port = int(os.getenv("APP_PORT", "8082"))
    print(f"🚀 Đang khởi động BOPP Maintenance Server tại http://{host}:{port} ...")
    uvicorn.run("server:app", host=host, port=port, reload=True)
