import sys
import socket
import paramiko
from dotenv import load_dotenv
import os

load_dotenv()

host = os.getenv("NAS_HOST", "192.168.1.249")
port = int(os.getenv("NAS_PORT", "22"))
user = os.getenv("NAS_USERNAME", "em_")
password = os.getenv("NAS_PASSWORD", "i:t(m_q4")
remote_root = os.getenv("NAS_REMOTE_ROOT", "/volume1/Maintenance_Storage")

print(f"=== KIỂM TRA KẾT NỐI NAS SYNOLOGY ===")
print(f"Địa chỉ: {host}:{port}")
print(f"Tài khoản: {user}")
print(f"Thư mục gốc: {remote_root}")

# 1. Kiểm tra TCP socket
print("\n1. Đang kiểm tra cổng mạng TCP (Socket)...")
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(5)
result = sock.connect_ex((host, port))
sock.close()

if result == 0:
    print(f"-> Cổng {port} trên {host} đang MỞ (Kết nối TCP thành công)!")
else:
    print(f"-> KHÔNG thể kết nối tới {host}:{port} (Lỗi mã: {result}). Hãy kiểm tra IP hoặc dịch vụ SSH trên NAS.")
    sys.exit(1)

# 2. Kiểm tra xác thực SSH / SFTP
print("\n2. Đang xác thực SSH / SFTP với tài khoản...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    client.connect(
        hostname=host,
        port=port,
        username=user,
        password=password,
        timeout=10,
        banner_timeout=15,
        allow_agent=False,
        look_for_keys=False
    )
    print("-> Đăng nhập SSH thành công!")

    sftp = client.open_sftp()
    print("-> Mở kênh SFTP thành công!")

    # 3. Kiểm tra thư mục gốc từ xa
    print(f"\n3. Kiểm tra thư mục từ xa: {remote_root}")
    try:
        stat = sftp.stat(remote_root)
        print(f"-> Thư mục '{remote_root}' TỒN TẠI trên NAS! (Size: {stat.st_size}, Mode: {oct(stat.st_mode)})")
        
        # Thử liệt kê thư mục
        try:
            files = sftp.listdir(remote_root)
            print(f"-> Danh sách các tệp/thư mục bên trong ({len(files)} mục): {files[:10]}")
        except Exception as e:
            print(f"-> Không thể liệt kê thư mục con: {e}")
            
    except Exception as e:
        print(f"-> Thư mục '{remote_root}' chưa tồn tại hoặc không có quyền: {e}")
        print("-> Thử tạo thư mục thử nghiệm...")
        try:
            sftp.mkdir(remote_root)
            print(f"-> Đã tạo thành công thư mục '{remote_root}' trên NAS!")
        except Exception as mk_err:
            print(f"-> Lỗi khi tạo thư mục: {mk_err}")

    # 4. Thử ghi tệp kiểm tra (Write Test)
    test_file_path = f"{remote_root.rstrip('/')}/test_connection.txt"
    try:
        with sftp.file(test_file_path, "w") as f:
            f.write("BOPP Maintenance EM - NAS Connection Test Successful!\n")
        print(f"-> Ghi tệp kiểm tra thành công: {test_file_path}")
        
        # Đọc lại kiểm tra
        with sftp.file(test_file_path, "r") as f:
            content = f.read().decode("utf-8")
        print(f"-> Đọc lại tệp kiểm tra thành công: {content.strip()}")
        
        # Xóa file test sau khi thử
        sftp.remove(test_file_path)
        print("-> Đã dọn dẹp file kiểm tra tạm.")
    except Exception as e:
        print(f"-> Ghi tệp kiểm tra thất bại: {e}")

    sftp.close()
    client.close()
    print("\n=== KẾT LUẬN: KẾT NỐI SFTP TỚI NAS HOÀN TOÀN TỐT! ===")

except paramiko.AuthenticationException:
    print("-> LỖI XÁC THỰC: Sai tên đăng nhập hoặc mật khẩu trên NAS!")
except Exception as e:
    print(f"-> LỖI KẾT NỐI SFTP: {e}")
