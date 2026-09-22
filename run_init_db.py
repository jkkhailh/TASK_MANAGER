from database import init_sqlite_db

if __name__ == '__main__':
    print("[*] Đang khởi tạo cấu trúc các bảng mới...")
    init_sqlite_db()
    print("[+] Hoàn tất khởi tạo bảng trong local_maintenance.db!")
