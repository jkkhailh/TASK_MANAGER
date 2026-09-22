# Hướng Dẫn & Kết Quả Triển Khai: Xuất Kho Vật Tư & Xuất File Excel IM_tmpRequest2

Đã hoàn tất triển khai toàn bộ các tính năng theo yêu cầu cho trang **Quản Lý Tồn Kho & Xuất Kho** ([inventory.html](file:///home/khailh/MAINTENANCE_DB/static/inventory.html), [inventory.js](file:///home/khailh/MAINTENANCE_DB/static/inventory.js), [server.py](file:///home/khailh/MAINTENANCE_DB/server.py), [database.py](file:///home/khailh/MAINTENANCE_DB/database.py)).

---

## 1. Các Tính Năng Đã Hoàn Thành

### 1.1. Tùy Chọn Xem Dạng Bảng "Tất Cả Vật Tư Cần Xuất"
- Trong tab **Phiếu Xuất Kho**, bổ sung thanh chuyển đổi linh hoạt:
  - **📋 Theo Phiếu**: Xem dạng phiếu cha tổng hợp (kèm danh sách mặt hàng rút gọn).
  - **📦 Tất Cả Vật Tư Cần Xuất**: Bảng phẳng liệt kê chi tiết từng dòng vật tư cần xuất từ tất cả các phiếu.
- Mỗi dòng vật tư hiển thị: Mã vật tư, Tên/Quy cách, Kho xuất, Vị trí kệ, Số lượng cần xuất, Ghi chú/Mục đích (máy sử dụng), Mã phiếu yêu cầu gốc, và Mã đơn ERP đã gán.

### 1.2. Mặc Định Tự Động Lọc Ẩn Các Item Đã Tạo Phiếu
- Bổ sung thanh lọc trạng thái tạo phiếu ERP (Segmented Control):
  - **⏳ Chưa Tạo Phiếu** *(Mặc định được chọn)*: Tự động ẩn các vật tư đã có mã đơn ERP để người dùng tập trung vào các mặt hàng chờ lập phiếu.
  - **✅ Đã Tạo Phiếu**: Xem lại các vật tư đã hoàn tất lập phiếu xuất ERP.
  - **📂 Tất Cả**: Xem toàn bộ lịch sử xuất kho.

### 1.3. Chọn Nhiều Phiếu / Nhiều Mã Vật Tư (Multi-Select Checkboxes)
- Hỗ trợ checkbox ở từng dòng và checkbox **Chọn tất cả (Select All)** trên tiêu đề bảng.
- Khi chọn 1 phiếu ở chế độ *Theo Phiếu*, toàn bộ các vật tư trong phiếu đó sẽ được tự động chọn.
- Ở chế độ *Tất Cả Vật Tư Cần Xuất*, người dùng có thể tích chọn linh hoạt từng mặt hàng cụ thể thuộc các phiếu khác nhau.
- Huy hiệu đếm số lượng mục được chọn hiển thị trực quan ngay trên nút xuất Excel (ví dụ: *Xuất Excel Mẫu [3]*).

### 1.4. Xuất File Excel Chuẩn Mẫu Sheet `IM_tmpRequest2`
- Nhúng thư viện SheetJS ([static/xlsx.full.min.js](file:///home/khailh/MAINTENANCE_DB/static/xlsx.full.min.js)) hoạt động độc lập ngay trên trình duyệt (không phụ thuộc mạng ngoài).
- Tên Sheet Excel bắt buộc: **`IM_tmpRequest2`**.
- Định dạng xuất chuẩn 18 cột theo đúng mẫu import hệ thống ERP:
  1. `ItemID`: Mã vật tư
  2. `IdentityID`: (để trống)
  3. `Unit1Qty`: Số lượng xuất (kiểu số nguyên / thập phân)
  4. `Unit2Qty`: (để trống)
  5. `Unit3Qty`: (để trống)
  6. `Unit1Min`: (để trống)
  7. `Unit1Max`: (để trống)
  8. `WHouseID`: Mã kho (PTBS, VT, TH, DC...)
  9. `StorageID`: Vị trí kệ lưu kho
  10. `Purpose`: (để trống theo mẫu)
  11. `Remark`: Ghi chú hoặc mục đích xuất sử dụng
  12. `IsImp`: (để trống)
  13. `iRow`: (để trống)
  14. `EntrySO`: (để trống)
  15. `EntryPO`: (để trống)
  16. `RQdRowID`: (để trống)
  17. `POdRowID`: (để trống)
  18. `SOdRowID`: (để trống)

### 1.5. Hộp Thoại Nhập Mã Đơn ERP Sau Khi Xuất File
- Ngay sau khi file Excel được tải về máy tính/điện thoại, hộp thoại **"Gán Mã Đơn Xuất Kho ERP"** sẽ tự động mở lên.
- Người dùng chỉ cần nhập số phiếu/mã đơn vừa tạo trên phần mềm ERP (ví dụ: `XK2609-001`, `PXK-1234`...).
- Nhấn **"Lưu & Đánh Dấu"**: Hệ thống gửi API gán mã đơn này cho toàn bộ các vật tư vừa xuất.
- Sau khi lưu, các vật tư này sẽ lập tức biến mất khỏi danh sách *Chưa Tạo Phiếu* (do bộ lọc mặc định), giúp giao diện luôn gọn gàng và không bị trùng lặp.
- Người dùng cũng có thể bấm nút **"Gán Mã Đơn"** hoặc nút **"Sửa"** trực tiếp trên từng dòng để cập nhật/xóa mã đơn bất kỳ lúc nào.

### 1.6. Tối Ưu Hiển Thị Trên Giao Diện Mobile
- Thanh công cụ sub-toolbar tự động chuyển sang layout dạng cột gọn gàng, độ cao nút và cỡ chữ thu nhỏ tương thích màn hình điện thoại.
- Thiết kế tràn sát mép (padding 4px) giúp hiển thị tối đa dữ liệu trên màn hình hẹp.
- Hỗ trợ xem dạng thẻ card trên điện thoại tích hợp checkbox và nút thao tác nhanh.

---

## 2. API Mới Được Bổ Sung Trên Server ([server.py](file:///home/khailh/MAINTENANCE_DB/server.py))

1. **`GET /api/inventory/issue-items`**:
   - Tham số: `voucher_filter` (`unassigned`, `assigned`, `all`), `whouse_id`, `search`.
   - Trả về danh sách chi tiết các dòng vật tư kèm thông tin phiếu cha.
2. **`POST /api/inventory/issue-items/assign-voucher`**:
   - Payload: `{ "item_ids": [1, 2, ...], "voucher_code": "MÃ_ĐƠN" }`.
   - Cập nhật trường `VoucherCode` trong SQLite database.

---

## 3. Quy Trình Thao Tác Mẫu

```mermaid
flowchart TD
    A["Vào tab 'Phiếu Xuất Kho'"] --> B["Bấm chuyển 'Tất Cả Vật Tư Cần Xuất'"]
    B --> C["Tích chọn các vật tư cần xuất (hoặc Chọn Tất Cả)"]
    C --> D["Bấm nút 'Xuất Excel Mẫu'"]
    D --> E["File IM_tmpRequest2_[ThờiGian].xlsx tự động tải về máy"]
    E --> F["Popup 'Gán Mã Đơn Xuất Kho ERP' tự động bật lên"]
    F --> G["Nhập mã phiếu ERP (Ví dụ: XK-2609-001)"]
    G --> H["Bấm 'Lưu & Đánh Dấu'"]
    H --> I["Hệ thống lưu mã và tự động ẩn các vật tư này khỏi danh sách chờ"]
```
