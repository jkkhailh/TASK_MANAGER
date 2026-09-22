#!/usr/bin/env bash
# ===================================================================
# SCRIPT TRIỂN KHAI TỰ ĐỘNG HỆ THỐNG BOPP MAINTENANCE TRÊN UBUNTU SERVER
# Hỗ trợ: Ubuntu 20.04 / 22.04 / 24.04 LTS
# ===================================================================

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="bopp-maintenance"

echo "==================================================================="
echo "  BẮT ĐẦU TRIỂN KHAI BOPP EM MAINTENANCE TRÊN UBUNTU SERVER"
echo "  Thư mục ứng dụng: $APP_DIR"
echo "==================================================================="

# 1. Cập nhật hệ thống & cài đặt các gói phụ thuộc cần thiết
echo "[1/6] Cài đặt các gói hệ thống (Python3, venv, unixODBC, OpenSSL)..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv python3-dev build-essential \
    unixodbc unixodbc-dev libssl-dev libffi-dev curl openssl

# 2. Tạo môi trường ảo Python (Virtual Environment)
echo "[2/6] Khởi tạo môi trường ảo Python venv..."
if [ ! -d "$APP_DIR/venv" ]; then
    python3 -m venv "$APP_DIR/venv"
fi

# Kích hoạt venv và nâng cấp pip
source "$APP_DIR/venv/bin/activate"
pip install --upgrade pip

# 3. Cài đặt các thư viện từ requirements.txt
echo "[3/6] Cài đặt các thư viện Python (FastAPI, Uvicorn, Paramiko SFTP)..."
pip install -r "$APP_DIR/requirements.txt"

# 4. Kiểm tra file cấu hình .env
echo "[4/6] Kiểm tra cấu hình môi trường (.env)..."
if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$APP_DIR/.env.example" ]; then
        cp "$APP_DIR/.env.example" "$APP_DIR/.env"
        echo "--> Đã tạo file .env từ .env.example. Vui lòng kiểm tra và cập nhật IP NAS Synology trong file .env!"
    fi
fi

# Tạo thư mục cache lưu trữ
mkdir -p "$APP_DIR/nas_storage"

# 5. Cấu hình dịch vụ Systemd tự động chạy cùng hệ điều hành
echo "[5/6] Đăng ký dịch vụ nền Systemd ($SERVICE_NAME.service)..."
CURRENT_USER=$(whoami)

PORT=$(grep -E "^APP_PORT=" "$APP_DIR/.env" | cut -d'=' -f2 | tr -d ' \r\n')
if [ -z "$PORT" ]; then
    PORT="8082"
fi

# Tạo file service tùy biến theo đường dẫn và user hiện tại
cat <<EOF | sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null
[Unit]
Description=BOPP EM Maintenance System - FastAPI Application Service
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port $PORT --workers 4
Restart=always
RestartSec=5s
KillMode=process
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME.service
sudo systemctl restart $SERVICE_NAME.service

# 6. Kiểm tra trạng thái dịch vụ
echo "[6/6] Kiểm tra trạng thái dịch vụ..."
sleep 2

if sudo systemctl is-active --quiet $SERVICE_NAME.service; then
    SERVER_IP=$(hostname -I | awk '{print $1}')
    echo "==================================================================="
    echo "  TRIỂN KHAI THÀNH CÔNG!"
    echo "  Dịch vụ: $SERVICE_NAME đang chạy ở chế độ nền (Active: running)"
    echo ""
    echo "  Địa chỉ truy cập Web ứng dụng:"
    echo "  -> http://$SERVER_IP:$PORT"
    echo "  -> http://localhost:$PORT"
    echo ""
    echo "  Các lệnh quản lý dịch vụ tiện ích:"
    echo "  - Xem log trực tiếp : sudo journalctl -u $SERVICE_NAME -f"
    echo "  - Khởi động lại     : sudo systemctl restart $SERVICE_NAME"
    echo "  - Dừng dịch vụ      : sudo systemctl stop $SERVICE_NAME"
    echo "==================================================================="
else
    echo "CẢNH BÁO: Dịch vụ chưa khởi động được. Xem chi tiết lỗi bằng lệnh:"
    echo "sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
fi
