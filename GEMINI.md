# DỰ ÁN HỆ THỐNG QUẢN LÝ BẢO DƯỠNG (MAINTENANCE_DB)
Tài liệu quy chuẩn kỹ thuật và quy tắc phát triển giao diện người dùng.

---

# QUY CHUẨN GIAO DIỆN MOBILE (MOBILE UI/UX STANDARDS)

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

