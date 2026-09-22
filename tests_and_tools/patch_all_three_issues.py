import os
import sys
import py_compile
import re

SERVER_PATH = "/home/khailh/MAINTENANCE_DB/server.py"

with open(SERVER_PATH, "r", encoding="utf-8") as f:
    content = f.read()

# =========================================================================
# 1. FIX VẤN ĐỀ 1: MẤT TRANG MAINTENANCE
# =========================================================================
maintenance_route = """
@app.get("/maintenance")
@app.get("/orders")
def read_maintenance():
    idx_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(idx_file):
        return FileResponse(idx_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"})
    return FileResponse(os.path.join(STATIC_DIR, "internal-tasks.html"))
"""

if '@app.get("/maintenance")' not in content:
    content = content.replace('@app.get("/dashboard")', maintenance_route + '\n@app.get("/dashboard")', 1)

# =========================================================================
# 2. BỔ SUNG EMAIL LIFECYCLE FUNCTIONS & send_email_notification
# =========================================================================
email_functions = '''
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
'''

if 'def send_task_lifecycle_email' not in content:
    anchor = '# =========================================================================\n# 1. HTML PAGES ROUTES'
    content = content.replace(anchor, email_functions + '\n\n' + anchor, 1)

# =========================================================================
# 3. SỬA API /api/inventory/items VÀ /api/inventory/summary
# =========================================================================
new_inventory_apis = '''
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
'''

# Thay thế các hàm inventory cũ ở cuối file
old_inv_pattern = r'@app\.get\("/api/inventory/items"\)[\s\S]*?@app\.get\("/api/inventory/summary"\)[\s\S]*?conn\.close\(\)'
if re.search(old_inv_pattern, content):
    content = re.sub(old_inv_pattern, new_inventory_apis.strip(), content, count=1)
else:
    # Nếu không tìm thấy bằng regex, tìm vị trí @app.get("/api/inventory/items")
    idx_inv = content.find('@app.get("/api/inventory/items")')
    if idx_inv != -1:
        idx_sync = content.find('@app.post("/api/inventory/sync")', idx_inv)
        if idx_sync != -1:
            content = content[:idx_inv] + new_inventory_apis.strip() + "\n\n\n" + content[idx_sync:]

# =========================================================================
# 4. SỬA HÀM CANCEL ITEM VÀ ISSUE-ITEMS
# =========================================================================
old_cancel_wrong = '''@app.get("/api/inventory/issue-items")
def get_inventory_issue_items(
    voucher_filter: str = "unassigned",  # 'unassigned', 'assigned', 'all'
    receipt_filter: str = "all",          # 'all', 'unreceived', 'received'
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Đánh dấu hủy mặt hàng đã thêm vào phiếu yêu cầu xuất kho"""'''

new_cancel_correct = '''@app.post("/api/inventory/items/{item_id}/cancel")
def cancel_inventory_issue_item(
    item_id: int,
    payload: Optional[dict] = Body(None),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """Đánh dấu hủy mặt hàng đã thêm vào phiếu yêu cầu xuất kho"""'''

if old_cancel_wrong in content:
    content = content.replace(old_cancel_wrong, new_cancel_correct, 1)

# =========================================================================
# 5. SỬA update_internal_task: THÊM Solution, DowntimeMinutes VÀ WEBSOCKET BROADCAST
# =========================================================================
old_update_tail = '''        msg = "Cập nhật công việc thành công."
        if next_spawned:
            msg = f"Đã hoàn tất nghiệm thu! Tự động khởi tạo chu kỳ tiếp theo: {next_spawned['task_code']} (Hạn: {next_spawned['next_due_date']})."

        return {
            "status": "success",
            "message": msg,
            "next_task": next_spawned
        }'''

new_update_tail = '''        # Gửi thông báo thời gian thực qua WebSocket
        try:
            ws_manager.broadcast_sync("TASK_UPDATED", {"task_id": task_id, "status": payload.Status if payload.Status else old_status})
        except Exception as ws_err:
            logger.warning(f"Lỗi gửi WebSocket broadcast: {ws_err}")

        msg = "Cập nhật công việc thành công."
        if next_spawned:
            msg = f"Đã hoàn tất nghiệm thu! Tự động khởi tạo chu kỳ tiếp theo: {next_spawned['task_code']} (Hạn: {next_spawned['next_due_date']})."

        return {
            "status": "success",
            "message": msg,
            "next_task": next_spawned
        }'''

if old_update_tail in content:
    content = content.replace(old_update_tail, new_update_tail, 1)

# Thêm Solution và DowntimeMinutes vào update_internal_task
if 'if payload.Solution is not None:' not in content:
    old_fields_spot = '        if payload.AssignedEmpIDs is not None:\n            eids_str = json.dumps(payload.AssignedEmpIDs) if isinstance(payload.AssignedEmpIDs, list) else str(payload.AssignedEmpIDs)\n            fields.append("AssignedEmpIDs = ?")\n            values.append(eids_str)'
    new_fields_spot = old_fields_spot + '''

        if payload.Solution is not None:
            fields.append("Solution = ?")
            values.append(payload.Solution.strip() if payload.Solution else "")

        if payload.DowntimeMinutes is not None:
            fields.append("DowntimeMinutes = ?")
            values.append(float(payload.DowntimeMinutes) if payload.DowntimeMinutes else 0.0)'''
    content = content.replace(old_fields_spot, new_fields_spot, 1)

# Ghi lại file
with open(SERVER_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Patched {SERVER_PATH}. Compiling...")
py_compile.compile(SERVER_PATH, doraise=True)
print("SUCCESS: server.py compiled with 0 errors!")
