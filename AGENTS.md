# DỰ ÁN HỆ THỐNG QUẢN LÝ BẢO DƯỠNG (MAINTENANCE_DB)
Tài liệu quy chuẩn kỹ thuật và quy tắc phát triển giao diện người dùng.

---

# I. QUY CHUẨN GIAO DIỆN MOBILE (MOBILE UI/UX STANDARDS)

Bắt buộc tuân thủ 100% khi phát triển hoặc chỉnh sửa bất kỳ màn hình nào trên hệ thống (`index.html`, `internal-tasks.html`, `inventory.html`, `request.html`, `categories.html`, `dashboard.html`):

## 1. Bộ lọc mặc định ẩn trên Mobile (Collapsible Filters)
- **Mặc định**: Trên màn hình di động (`@media (max-width: 900px)`), tất cả các bộ lọc (status filter, date range, filter buttons, search toolbars mở rộng) **bắt buộc mặc định ở trạng thái ẩn (collapsed)**.
- **Trải nghiệm**:
  - Không để các thanh filter chiếm diện tích màn hình khi vừa mở trang.
  - Chỉ hiển thị thanh tìm kiếm nhỏ gọn kèm **nút "Bộ Lọc" (hoặc icon phễu ⚡/🔍 kèm badge số bộ lọc đang chọn)**.
  - Chỉ khi người dùng bấm vào nút "Bộ Lọc" thì panel bộ lọc mới trượt xuống / hiển thị ra.
  - Sau khi chọn hoặc đóng, thu gọn bộ lọc để dành 100% diện tích cho danh sách thẻ hiển thị dữ liệu chính.

## 2. Mở rộng không gian hiển thị 2 bên gần sát viền (Edge-to-Edge Optimization)
- **Mục tiêu**: Tối ưu hóa từng pixel bề ngang màn hình điện thoại (360px - 420px), tránh lãng phí diện tích làm rớt dòng, co cụm chữ.
- **Quy chuẩn Padding & Spacing**:
  - Khung chứa danh sách (`.app-main`, `.workspace-grid`, `.orders-column`, container chính) trên mobile chỉ có padding lề 2 bên từ **6px đến tối đa 8px** (tuyệt đối không để 16px - 24px).
  - Thẻ công việc / thẻ lệnh / thẻ vật tư (`.task-card`, `.order-card`, `.inv-item-card`...): Đạt chiều rộng `width: 100%`, margin 2 bên = 0, padding trong thẻ từ 8px - 10px, bo góc 6px - 8px.
  - Khoảng cách giữa các phần tử (gap): Đặt từ 6px - 8px.
  - Popup Modal: Trên mobile phải mở dạng Fullscreen View (`width: 100vw !important; max-width: 100vw !important; margin: 0 !important; border-radius: 0 !important;`).

## 3. Popup Modal có nút Lưu phải đặt ở trên Header (Top-Right Action Button)
- **Nguyên tắc**: Theo chuẩn trải nghiệm Native Mobile App. Nút hành động chính (Lưu, Xác nhận, Tạo mới) **không được đặt ở chân trang (footer)** vì chân trang sẽ bị che bởi bàn phím ảo (Virtual Keyboard) khi nhập liệu hoặc bắt người dùng phải cuộn xuống đáy.
- **Cấu trúc Header Modal**:
  - **Bên trái**: Nút "Quay lại" (`.btn-modal-back`) hoặc icon `←`.
  - **Ở giữa**: Tiêu đề Modal (`.modal-title`).
  - **Bên phải (BẮT BUỘC)**: Nút **Lưu / Hoàn Tất** (`.btn-header-save`).
  - Toàn bộ thanh Header này luôn ghim cố định (`position: sticky; top: 0; z-index: 10;`) để khi cuộn form nhập liệu bên dưới, nút Lưu luôn sẵn sàng bấm ngay lập tức.

## 4. Quy tắc cỡ chữ & màu sắc: Title và Nút Lưu

### A. Tiêu Đề Modal / Trang (Header Title)
- **Cỡ chữ (Font size)**:
  - Mobile: `0.95rem` - `1.05rem` (khoảng 15px - 17px).
  - Font weight: `700` (Bold) hoặc `800` (Extra Bold).
- **Màu sắc**:
  - Chữ: Trắng tinh `#FFFFFF` hoặc sáng `#F3F4F6` nổi bật với độ tương phản cao trên nền dark `#0B0F19` / `#0F172A`.
  - Không vỡ dòng khi tiêu đề dài: Dùng `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`.
  - Icon tiêu đề (nếu có): Kích thước 18px - 20px, màu nhấn `#60A5FA` hoặc `#818CF8`.

### B. Nút Lưu Trên Header (`.btn-header-save`)
- **Vị trí**: Nằm cố định góc phải thanh Header, `flex-shrink: 0;`.
- **Kích thước & Padding**:
  - Padding: `5px 12px` đến `6px 14px`.
  - Chiều cao (Height / Min-height): `32px` - `34px` (đạt chuẩn touch target trên màn hình cảm ứng).
- **Cỡ chữ & Độ đậm**:
  - Cỡ chữ: `0.80rem` - `0.84rem` (khoảng 13px - 13.5px).
  - Độ đậm: `font-weight: 700` (Bold).
- **Màu sắc & Style**:
  - **Nền (Background)**:
    - Nút Lưu / Tạo việc: Gradient hoặc màu Indigo `#6366F1` hoặc Blue `#3B82F6` (`linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)`).
    - Nút Duyệt / Nghiệm thu: Xanh ngọc Emerald `#10B981`.
  - **Màu chữ**: Trắng tinh `#FFFFFF`.
  - **Bo góc**: `border-radius: 6px` - `8px`.
  - **Viền**: Không viền thô, có thể dùng `border: 1px solid rgba(255, 255, 255, 0.2);`.
  - **Đổ bóng (Box shadow)**: `box-shadow: 0 2px 8px rgba(79, 70, 229, 0.35);`.
  - **Hiệu ứng chạm (Touch Feedback / Active)**:
    ```css
    .btn-header-save:active {
      transform: scale(0.96);
      opacity: 0.9;
    }
    ```

## 5. Ẩn Head Menu Bar Trên Mobile (Hide Header Navigation Menu Bar)
- **Quy chuẩn**: Trên giao diện di động (`@media (max-width: 900px)`), toàn bộ thanh điều hướng menu trên đầu trang (`.main-nav`, `.sub-nav-bar`) **bắt buộc ẩn hoàn toàn (`display: none !important;`)**.
- **Trải nghiệm**:
  - Header trên mobile thu gọn tối đa thành 1 thanh mỏng (~38px - 40px) chỉ chứa Logo thương hiệu bên trái và Avatar người dùng bên phải.
  - Người dùng chuyển đổi giữa các phân hệ thông qua nút bấm Logo / "MENU ▾" (`#brandMenuTrigger`) để mở danh mục phân hệ BOPP HUB (`#systemAppMenu`).
  - Tiết kiệm 40px - 80px chiều dọc màn hình, nhường trọn vẹn không gian hiển thị cho thanh tìm kiếm, bộ lọc và danh sách dữ liệu chính.

---

# II. QUY CHUẨN CẤU TRÚC THƯ MỤC & QUẢN LÝ FILE TEST, CHECK, SCRIPT PHỤ TRỢ (TOOLS & SCRIPTS STANDARDS)

Bắt buộc tuân thủ 100% khi phát triển, gỡ lỗi (debug) hoặc bảo trì hệ thống:

## 1. Nguyên Tắc Thư Mục Gốc Sạch (Clean Root Directory)
- **Quy định**: Thư mục gốc (`/home/khailh/MAINTENANCE_DB/`) **chỉ được chứa** các tệp tin vận hành chính thức của hệ thống (Production Runtime Files) và tài liệu cốt lõi:
  - Backend runtime: `server.py`, `database.py`, `auth.py`, `sync_service.py`, `nas_storage.py`, `websocket_manager.py`.
  - Cron & Deployment scripts: `run_init_db.py`, `run_inventory_sync.py`, `run_sync_works.py`, `start_server.sh`, `start_server.bat`, `deploy_ubuntu.sh`, `bopp-maintenance.service`.
  - Cấu hình & Tài liệu: `requirements.txt`, `.gitignore`, `.env.example`, `AGENTS.md`, `GEMINI.md`, `CAU_TRUC_CSDL_BAO_DUONG_EM.md`, `HUONG_DAN_TRIEN_KHAI_UBUNTU.md`.
  - Các thư mục chuẩn: `static/`, `nas_storage/`, `tests_and_tools/`, `venv/`.
- **Tuyệt đối cấm**: Không tự ý tạo, lưu trữ các file `test_*.py`, `check_*.py`, `patch_*.py`, `inspect_*.py`, `find_*.py` hoặc các file kết quả tạm `*.json`, `*.log` ở thư mục gốc.

## 2. Thư Mục Riêng Cho Công Cụ Kiểm Tra & Thử Nghiệm (`tests_and_tools/`)
- **Vị trí bắt buộc**: Mọi script kiểm thử tính năng mới, kiểm tra cú pháp, gỡ lỗi database, thăm dò bảng dữ liệu ERP SQL Server, script patch vá lỗi hoặc file JSON kết quả **bắt buộc phải nằm trong thư mục `tests_and_tools/`**.
- **Quy chuẩn import module từ thư mục gốc**:
  Mọi script chạy trong `tests_and_tools/` nếu cần import các module chính (`database`, `server`, `auth`, `sync_service`, `nas_storage`, `websocket_manager`) phải bổ sung đoạn code chuẩn hóa đường dẫn ở đầu file:
  ```python
  import os
  import sys
  sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
  ```
- **Quy chuẩn thực thi lệnh (Execution Rule)**:
  Khi chạy các file kiểm tra/thử nghiệm, luôn chạy với đường dẫn rõ ràng từ thư mục gốc:
  ```bash
  venv/bin/python tests_and_tools/<ten_script>.py
  # hoặc
  python3 tests_and_tools/<ten_script>.py
  ```
- **Dọn dẹp**: Các file nháp tạm thời phục vụ gỡ lỗi 1 lần không cần lưu lại lịch sử Git nên đưa vào `scratch/` (đã được ignore bởi Git).
