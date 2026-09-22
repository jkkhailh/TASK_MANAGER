@echo off
title BOPP Maintenance Web Server
chcp 65001 > nul
echo ===================================================================
echo     HE THONG QUAN LY BAO DUONG THIET BI (BOPP MAINTENANCE EM)
echo ===================================================================
echo.
echo IP may chu: 192.168.1.244
echo Cong truy cap: 8000
echo.
echo - Truy cap tren may nay : http://localhost:8000 hoac http://127.0.0.1:8000
echo - Truy cap tu may khac  : http://192.168.1.244:8000
echo.

:: ===================================================================
:: CẤU HÌNH ĐƯỜNG DẪN BỘ NHỚ LƯU TRỮ NAS SYNOLOGY:
:: Cách 1 (Khuyên dùng - Đường dẫn mạng UNC): 
::   set NAS_STORAGE_PATH=\\192.168.1.100\Maintenance_Storage\BOPP_Data
:: Cách 2 (Ổ đĩa mạng đã Map trên Windows):
::   set NAS_STORAGE_PATH=Z:\BOPP_Data
:: Nếu để trống/bỏ qua, hệ thống sẽ lưu tạm vào thư mục cục bộ .\nas_storage
:: ===================================================================
:: set NAS_STORAGE_PATH=\\192.168.1.100\Maintenance_Storage

echo Dang khoi dong Web Server (ho tro tu dong tai lai)...
echo ===================================================================
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
pause
