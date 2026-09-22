#!/usr/bin/env bash
# ===================================================================
# SCRIPT KHỞI ĐỘNG HỆ THỐNG BOPP MAINTENANCE TRÊN UBUNTU
# ===================================================================

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "==================================================================="
echo "    HỆ THỐNG QUẢN LÝ BẢO DƯỠNG THIẾT BỊ (BOPP MAINTENANCE EM)"
echo "==================================================================="

# Đọc cấu hình từ .env nếu có
PORT="8082"
HOST="0.0.0.0"
if [ -f "$APP_DIR/.env" ]; then
    PORT_IN_ENV=$(grep -E "^APP_PORT=" "$APP_DIR/.env" | cut -d'=' -f2 | tr -d ' \r\n')
    if [ -n "$PORT_IN_ENV" ]; then
        PORT="$PORT_IN_ENV"
    fi
    HOST_IN_ENV=$(grep -E "^APP_HOST=" "$APP_DIR/.env" | cut -d'=' -f2 | tr -d ' \r\n')
    if [ -n "$HOST_IN_ENV" ]; then
        HOST="$HOST_IN_ENV"
    fi
fi

# Kiểm tra môi trường ảo venv
if [ ! -d "$APP_DIR/venv" ]; then
    echo "[!] Chưa tìm thấy môi trường ảo venv. Đang tự động tạo..."
    python3 -m venv "$APP_DIR/venv"
    "$APP_DIR/venv/bin/pip" install --upgrade pip
    "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="192.168.1.244"
fi

echo ""
echo "  Địa chỉ truy cập Web ứng dụng:"
echo "  -> Truy cập trên máy này : http://localhost:$PORT hoặc http://127.0.0.1:$PORT"
echo "  -> Truy cập từ mạng LAN  : http://$SERVER_IP:$PORT"
echo "==================================================================="
echo ""

# Chạy server với môi trường ảo venv
exec "$APP_DIR/venv/bin/python" -m uvicorn server:app --host "$HOST" --port "$PORT" --reload
