# Quy Chuẩn Thiết Kế Giao Diện Mobile (Mobile UI/UX Standards)

Quy định bắt buộc áp dụng cho toàn bộ các trang giao diện (Desktop & Mobile) trong hệ thống Quản Lý Bảo Dưỡng (`index.html`, `internal-tasks.html`, `inventory.html`, `request.html`, `categories.html`, `dashboard.html`).

---

## 1. Ẩn Mặc Định Các Bộ Lọc Trên Mobile (Collapsible Filters)
* **Nguyên tắc**: Màn hình điện thoại có chiều dọc hạn chế. Toàn bộ khu vực lọc (toolbar filters, segmented controls, status dropdowns, date filters) không được chiếm dụng không gian hiển thị dữ liệu chính khi mới vào trang.
* **Quy chuẩn**:
  * Trên màn hình di động (`@media (max-width: 900px)`), các bộ lọc nâng cao **mặc định ở trạng thái ẩn (collapsed)**.
  * Chỉ giữ thanh tìm kiếm chính kèm nút bấm **"Bộ Lọc" / "Lọc"** (có icon phễu ⚡/🔍 và badge hiển thị số lượng điều kiện lọc đang kích hoạt).
  * Khi người dùng chạm nút "Bộ Lọc", panel bộ lọc trượt xuống mượt mà.
  * Khi người dùng chọn xong điều kiện hoặc bấm "Đóng bộ lọc", panel tự động thu gọn để nhường 100% chiều dọc cho danh sách thẻ công việc / lệnh / vật tư.

---

## 2. Mở Rộng Không Gian Hiển Thị 2 Bên Sát Viền (Edge-to-Edge Optimization)
* **Nguyên tắc**: Màn hình di động có chiều rộng rất hẹp (360px - 420px). Phải tối ưu hóa từng pixel bề ngang để thông tin không bị co cụm, rớt dòng hoặc vỡ layout.
* **Quy chuẩn**:
  * **Lề hai bên (Horizontal Padding)**: Khung chứa chính (`.app-main`, `.workspace-grid`, `.orders-column`, `.inv-modal-content`) trên mobile chỉ để padding từ **6px đến tối đa 8px** (tuyệt đối không để 16px - 24px gây lãng phí không gian).
  * **Thẻ dữ liệu (Cards)**: Các thẻ (`.task-card`, `.order-card`, `.inv-item-card`, `.req-detail-item-card`) chiếm trọn chiều ngang (`width: 100%`, margin 0), viền bo nhẹ 6px - 8px, padding bên trong 8px - 10px.
  * **Modal toàn màn hình (Fullscreen Modals)**: Trên mobile, modal mở ra dạng App View toàn màn hình (`width: 100vw !important; max-width: 100vw !important; margin: 0 !important; border-radius: 0 !important;`).
  * **Khoảng cách giữa các cột**: Thu hẹp `gap` về 6px - 8px trên mobile.

---

## 3. Nút Lưu Đặt Trên Header Của Popup Modal (Top-Right Action Button)
* **Nguyên tắc**: Theo tiêu chuẩn trải nghiệm Native Mobile App (iOS / Android). Nút hành động chính không được đặt ở đáy modal vì sẽ bị bàn phím ảo (Virtual Keyboard) che khuất khi nhập liệu, hoặc bắt người dùng phải cuộn xuống tận cuối trang mới tìm thấy nút Lưu.
* **Quy chuẩn**:
  * Mọi Modal biểu mẫu chỉnh sửa / tạo mới / cập nhật (`#createTaskModal`, `#taskDetailModal`, `#createRequestModal`, `#assignVoucherModal`, `#receiveItemModal`):
    * **Góc trên bên trái**: Nút `Quay lại` (`.btn-modal-back`) hoặc `Hủy`.
    * **Ở giữa**: Tiêu đề chức năng (`.modal-title` / `.inv-modal-title`).
    * **Góc trên bên phải (BẮT BUỘC)**: Nút **Lưu / Hoàn Tất** (`.btn-header-save` hoặc `.btn-primary` trên header).
  * Nút Lưu trên header luôn `position: sticky; top: 0;` cố định cùng thanh Header khi cuộn nội dung form bên dưới.

---

## 4. Quy Tắc Cỡ Chữ & Màu Sắc Tiêu Đề (Title) và Nút Lưu (Save Button)

### A. Tiêu Đề Modal / Header Title
* **Cỡ chữ (Font size)**: `0.95rem` - `1.05rem` (15px - 17px) trên mobile.
* **Độ đậm (Font weight)**: `700` (Bold) hoặc `800` (Extra Bold).
* **Màu sắc (Color)**: Trắng tinh `#FFFFFF` hoặc `#F3F4F6` nổi bật với độ tương phản cao trên nền tối `#0B0F19` / `#0F172A`.
* **Căn chỉnh**: Căn giữa hoặc căn đều, hỗ trợ cắt chữ an toàn khi tiêu đề dài:
  ```css
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  ```
* **Icon tiêu đề**: Kích thước 18px - 20px, màu nhấn thương hiệu (`#60A5FA` hoặc `#818CF8`).

### B. Nút Lưu Trên Header (`.btn-header-save`)
* **Vị trí**: Nằm cố định góc phải thanh Header, `flex-shrink: 0;`.
* **Kích thước & Padding**:
  * `padding: 5px 12px` đến `6px 14px`.
  * Chiều cao: ~32px - 34px (đạt chuẩn touch target vừa ngón tay cái).
* **Cỡ chữ & Độ đậm**:
  * `font-size: 0.80rem` - `0.84rem` (13px - 13.5px).
  * `font-weight: 700` (Bold).
* **Màu sắc & Hiệu ứng**:
  * **Nền (Background)**:
    * Hành động Lưu/Tạo: Xanh Indigo `#6366F1` hoặc Blue `#3B82F6`.
    * Xác nhận/Nghiệm thu: Xanh ngọc Emerald `#10B981`.
  * **Chữ**: Trắng tinh `#FFFFFF`.
  * **Bo góc**: `border-radius: 6px` - `8px`.
  * **Đổ bóng (Box Shadow)**: `box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4)`. Không dùng viền thô (border: none).
  * **Phản hồi khi chạm (Active State)**:
    ```css
    .btn-header-save:active {
      transform: scale(0.96);
      opacity: 0.9;
    }
    ```

---

## 5. Ẩn Head Menu Bar Trên Mobile (Hide Header Navigation Menu Bar)
* **Nguyên tắc**: Tiết kiệm tối đa diện tích dọc màn hình điện thoại. Các thanh điều hướng menu dàn ngang chiếm quá nhiều diện tích sticky trên đầu trang.
* **Quy chuẩn**:
  * Trên di động (`@media (max-width: 900px)`), toàn bộ thanh điều hướng menu trên đầu trang (`.main-nav`, `.sub-nav-bar`) **mặc định ẩn hoàn toàn (`display: none !important;`)**.
  * Header di động thu gọn thành một thanh ngang tối giản (~38px - 40px) chỉ gồm Logo + Tiêu đề bên trái và Avatar người dùng bên phải.
  * Người dùng chuyển đổi giữa các phân hệ thông qua nút chạm vào Logo thương hiệu / nút "MENU ▾" (`#brandMenuTrigger`) để mở popup BOPP HUB (`#systemAppMenu`).
  * Toàn bộ không gian phía dưới được dành trọn vẹn cho thanh tìm kiếm và danh sách dữ liệu.

