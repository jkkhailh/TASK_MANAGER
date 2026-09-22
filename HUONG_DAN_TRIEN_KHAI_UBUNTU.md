# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG TRÊN UBUNTU SERVER VỚI BỘ NHỚ LƯU TRỮ SFTP (NAS SYNOLOGY)

Tài liệu này hướng dẫn chi tiết từng bước để đưa hệ thống **BOPP EM Maintenance** lên máy chủ **Ubuntu Server** (Ubuntu 20.04, 22.04 hoặc 24.04 LTS), kết nối lưu trữ hình ảnh bảo dưỡng an toàn tới **NAS Synology** qua giao thức mã hóa **SFTP**.

---

## 1. Chuẩn Bị Trên NAS Synology

### Bước 1.1: Bật Dịch Vụ SFTP trên Synology DSM
1. Đăng nhập vào giao diện web quản trị **Synology DSM** (trên máy tính mở `http://<IP_NAS>:5000`).
2. Mở **Control Panel** $\rightarrow$ chọn **File Services**.
3. Chuyển sang thẻ **FTP** $\rightarrow$ Cuộn xuống mục **SFTP**.
4. Tích chọn **Enable SFTP service**.
5. Cổng kết nối (Port):
   * Mặc định là cổng **22** (cùng cổng với SSH).
   * Hoặc bạn có thể đặt cổng riêng (ví dụ: `2222`) để tăng tính bảo mật.
6. Bấm **Apply** để lưu thiết lập.

### Bước 1.2: Tạo Thư Mục Chia Sẻ (Shared Folder) & Phân Quyền
1. Vào **Control Panel** $\rightarrow$ **Shared Folder** $\rightarrow$ Bấm **Create**.
2. Đặt tên thư mục, ví dụ: `Maintenance_Storage`.
3. Bấm **Next** cho đến bước phân quyền (**Permissions**):
   * Chọn tài khoản người dùng sẽ dùng để kết nối (ví dụ: `bopp_storage` hoặc `admin`).
   * Tích chọn quyền **Read/Write (Đọc/Ghi)**.
4. Bấm **Apply**.

---

## 2. Triển Khai Trên Ubuntu Server

### Bước 2.1: Sao Chép Mã Nguồn Lên Ubuntu Server
Bạn có thể dùng `scp`, `rsync` hoặc `git clone` để đưa thư mục dự án lên máy chủ Ubuntu (ví dụ đặt tại `/opt/bopp-maintenance` hoặc `/home/ubuntu/bopp-maintenance`).

Ví dụ sao chép từ máy tính qua SSH:
```bash
# Trên máy tính quản trị:
scp -r "d:/Khailh/TOOL PY/KQ BAO DUONG DINH KY" ubuntu@192.168.1.244:/home/ubuntu/bopp-maintenance
```

### Bước 2.2: Cấu Hình File Môi Trường `.env`
1. Đăng nhập vào Ubuntu Server qua SSH:
   ```bash
   ssh ubuntu@192.168.1.244
   cd /home/ubuntu/bopp-maintenance
   ```
2. Tạo file cấu hình từ mẫu:
   ```bash
   cp .env.example .env
   nano .env
   ```
3. Điền thông tin NAS Synology của bạn:
   ```ini
   APP_HOST=0.0.0.0
   APP_PORT=8000

   # Bật chế độ SFTP
   STORAGE_MODE=sftp

   # Địa chỉ IP của NAS Synology trong mạng LAN
   NAS_HOST=192.168.1.100

   # Cổng SFTP đã cấu hình ở Bước 1.1 (22 hoặc 2222)
   NAS_PORT=22

   # Tài khoản và mật khẩu trên NAS Synology
   NAS_USERNAME=bopp_storage
   NAS_PASSWORD=Mật_Khẩu_Của_Bạn

   # Thư mục gốc lưu trữ trên NAS (Kiểm tra trong File Station của DSM)
   NAS_REMOTE_ROOT=/volume1/Maintenance_Storage

   # Thư mục cache cục bộ trên Ubuntu (phục vụ ảnh tốc độ cao cho web)
   NAS_LOCAL_CACHE_DIR=./nas_storage
   ```
   *Nhấn `Ctrl + O` để lưu, `Ctrl + X` để thoát nano.*

### Bước 2.3: Chạy Script Triển Khai Tự Động (1-Click)
Cấp quyền thực thi và chạy script:
```bash
chmod +x deploy_ubuntu.sh
./deploy_ubuntu.sh
```

Script sẽ tự động thực hiện toàn bộ các việc sau:
* Cài đặt Python3, virtualenv, unixODBC, OpenSSL.
* Tạo môi trường ảo `venv` và cài đặt đầy đủ thư viện từ `requirements.txt`.
* Đăng ký dịch vụ nền **Systemd** (`bopp-maintenance.service`).
* Kích hoạt tự động khởi động cùng Ubuntu khi reboot máy chủ.

---

## 3. Kiểm Tra Kết Nối & Hoạt Động

### 3.1: Kiểm tra trạng thái dịch vụ trên Ubuntu
```bash
sudo systemctl status bopp-maintenance
```
Kết quả hiển thị `Active: active (running)` màu xanh lá là dịch vụ đã hoạt động hoàn hảo.

### 3.2: Xem log hoạt động theo thời gian thực
```bash
sudo journalctl -u bopp-maintenance -f
```
Khi kỹ thuật viên tải ảnh lên, bạn sẽ thấy log:
```text
[NAS_STORAGE] INFO: Đã upload tệp lên NAS Synology qua SFTP: /volume1/Maintenance_Storage/orders/EO2609-0091/SL3/SL3_...jpg
```

### 3.3: Kiểm tra API trạng thái kết nối NAS từ trình duyệt
Mở trình duyệt truy cập:
`http://<IP_UBUNTU_SERVER>:8000/api/nas/status`

Kết quả trả về dạng JSON:
```json
{
  "storage_mode": "sftp",
  "status": "connected",
  "host": "192.168.1.100",
  "port": 22,
  "username": "bopp_storage",
  "remote_root": "/volume1/Maintenance_Storage",
  "message": "Kết nối SFTP an toàn tới NAS Synology đang hoạt động tốt"
}
```

---

## 4. Các Lệnh Quản Lý Thường Dùng Trên Ubuntu

| Lệnh | Mô tả |
| :--- | :--- |
| `sudo systemctl restart bopp-maintenance` | Khởi động lại dịch vụ web server |
| `sudo systemctl stop bopp-maintenance` | Tạm dừng dịch vụ |
| `sudo systemctl start bopp-maintenance` | Bật lại dịch vụ |
| `sudo journalctl -u bopp-maintenance -n 100` | Xem 100 dòng log gần nhất |
| `sudo journalctl -u bopp-maintenance -f` | Theo dõi log trực tiếp khi thao tác |

---

## 5. Cấu Hình Nginx Reverse Proxy (Khuyên dùng khi chạy Production)

Nếu bạn muốn truy cập qua cổng tiêu chuẩn **80** (không cần gõ `:8000`) và bảo vệ máy chủ:
1. Cài đặt Nginx:
   ```bash
   sudo apt install -y nginx
   ```
2. Tạo file cấu hình:
   ```bash
   sudo nano /etc/nginx/sites-available/bopp-maintenance
   ```
   Nội dung:
   ```nginx
   server {
       listen 80;
       server_name _;

       # Cho phép upload file ảnh lớn tới 50MB
       client_max_body_size 50M;

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 300s;
           proxy_connect_timeout 75s;
       }
   }
   ```
3. Kích hoạt cấu hình và khởi động lại Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/bopp-maintenance /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl restart nginx
   ```
Giờ đây kỹ thuật viên chỉ cần gõ địa chỉ IP máy chủ `http://192.168.1.244` là vào được ngay hệ thống!
