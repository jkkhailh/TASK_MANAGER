import os
import shutil
import uuid
import logging
from datetime import datetime
from typing import Optional, Dict, Any
from dotenv import load_dotenv

# Tải cấu hình từ file .env nếu có
load_dotenv(override=True)

# Thiết lập logging
logger = logging.getLogger("nas_storage")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("[%(asctime)s] [NAS_STORAGE] %(levelname)s: %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

def reload_nas_config():
    global STORAGE_MODE, NAS_HOST, NAS_PORT, NAS_USERNAME, NAS_PASSWORD, NAS_KEY_PATH, NAS_REMOTE_ROOT, LOCAL_CACHE_DIR
    load_dotenv(override=True)
    STORAGE_MODE = os.getenv("STORAGE_MODE", "sftp").strip().lower()
    NAS_HOST = os.getenv("NAS_HOST", "192.168.1.249").strip()
    NAS_PORT = int(os.getenv("NAS_PORT", "22").strip() or 22)
    NAS_USERNAME = os.getenv("NAS_USERNAME", "em_").strip()
    NAS_PASSWORD = os.getenv("NAS_PASSWORD", "").strip()
    NAS_KEY_PATH = os.getenv("NAS_KEY_PATH", "").strip()
    NAS_REMOTE_ROOT = os.getenv("NAS_REMOTE_ROOT", "/Maintenance_Storage").strip().rstrip("/\\")

reload_nas_config()

# Thư mục bộ đệm cục bộ (Cache) trên máy chủ Ubuntu / Windows
DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nas_storage")
LOCAL_CACHE_DIR = os.getenv("NAS_LOCAL_CACHE_DIR", DEFAULT_CACHE_DIR)
os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)

# Khởi tạo paramiko nếu có
try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False
    if STORAGE_MODE == "sftp":
        logger.warning("Thư viện 'paramiko' chưa được cài đặt. Hệ thống sẽ tự động chuyển về chế độ 'local'.")
        STORAGE_MODE = "local"


class SFTPStorageManager:
    """
    Quản lý kết nối SFTP an toàn tới NAS Synology trên Ubuntu/Linux.
    Hỗ trợ tự động kết nối lại, tạo thư mục từ xa, upload và download (cache-miss).
    """
    def __init__(self):
        self.client: Optional[paramiko.SSHClient] = None
        self.sftp: Optional[paramiko.SFTPClient] = None
        self._connected = False

    def is_connected(self) -> bool:
        if not self._connected or not self.client or not self.sftp:
            return False
        try:
            transport = self.client.get_transport()
            return transport is not None and transport.is_active()
        except Exception:
            return False

    def connect(self) -> bool:
        """Thiết lập kết nối SSH / SFTP tới NAS Synology"""
        if not PARAMIKO_AVAILABLE:
            return False

        if self.is_connected():
            return True

        self.close()
        reload_nas_config()

        try:
            logger.info(f"Đang kết nối SFTP tới NAS Synology: {NAS_USERNAME}@{NAS_HOST}:{NAS_PORT}...")
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": NAS_HOST,
                "port": NAS_PORT,
                "username": NAS_USERNAME,
                "timeout": 10,
                "banner_timeout": 15,
                "allow_agent": False,
                "look_for_keys": False
            }

            if NAS_KEY_PATH and os.path.exists(NAS_KEY_PATH):
                connect_kwargs["key_filename"] = NAS_KEY_PATH
            elif NAS_PASSWORD:
                connect_kwargs["password"] = NAS_PASSWORD
            else:
                logger.warning("Không tìm thấy NAS_PASSWORD hoặc NAS_KEY_PATH để xác thực SFTP.")

            client.connect(**connect_kwargs)
            sftp = client.open_sftp()

            self.client = client
            self.sftp = sftp
            self._connected = True
            logger.info(f"Kết nối SFTP tới NAS Synology ({NAS_HOST}) thành công!")
            return True
        except Exception as e:
            logger.error(f"Lỗi kết nối SFTP tới NAS ({NAS_HOST}:{NAS_PORT}): {e}")
            self.close()
            return False

    def close(self):
        self._connected = False
        if self.sftp:
            try:
                self.sftp.close()
            except Exception:
                pass
            self.sftp = None
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None

    def ensure_remote_dir(self, remote_dir: str) -> bool:
        """Đảm bảo thư mục từ xa tồn tại trên NAS (tương đương mkdir -p)"""
        if not self.connect() or not self.sftp:
            return False

        remote_dir = remote_dir.replace("\\", "/")
        parts = [p for p in remote_dir.split("/") if p]
        current = ""
        if remote_dir.startswith("/"):
            current = "/"

        for part in parts:
            current = f"{current}/{part}" if current and current != "/" else f"/{part}"
            try:
                self.sftp.stat(current)
            except IOError:
                try:
                    self.sftp.mkdir(current)
                    logger.debug(f"Đã tạo thư mục từ xa: {current}")
                except Exception as ex:
                    # Có thể thư mục đã tồn tại do tiến trình khác
                    logger.debug(f"Bỏ qua tạo thư mục {current}: {ex}")
        return True

    def upload_file(self, local_path: str, relative_remote_path: str) -> bool:
        """Upload file từ local cache lên NAS Synology qua SFTP"""
        if not self.connect() or not self.sftp:
            return False

        clean_rel = relative_remote_path.replace("\\", "/").lstrip("/")
        full_remote_path = f"{NAS_REMOTE_ROOT}/{clean_rel}"
        remote_dir = os.path.dirname(full_remote_path)

        try:
            self.ensure_remote_dir(remote_dir)
            self.sftp.put(local_path, full_remote_path)
            logger.info(f"Đã upload tệp lên NAS Synology qua SFTP: {full_remote_path}")
            return True
        except Exception as e:
            logger.error(f"Lỗi upload SFTP cho {local_path} -> {full_remote_path}: {e}")
            return False

    def download_file(self, relative_remote_path: str, local_target_path: str) -> bool:
        """Download file từ NAS Synology về local cache khi cache-miss"""
        if not self.connect() or not self.sftp:
            return False

        clean_rel = relative_remote_path.replace("\\", "/").lstrip("/")
        full_remote_path = f"{NAS_REMOTE_ROOT}/{clean_rel}"

        try:
            os.makedirs(os.path.dirname(local_target_path), exist_ok=True)
            self.sftp.get(full_remote_path, local_target_path)
            logger.info(f"Đã tải tệp từ NAS Synology về local cache: {local_target_path}")
            return True
        except Exception as e:
            logger.error(f"Lỗi download SFTP từ {full_remote_path} -> {local_target_path}: {e}")
            return False

    def check_connection(self) -> Dict[str, Any]:
        """Kiểm tra trạng thái kết nối tới NAS"""
        if not PARAMIKO_AVAILABLE:
            return {"status": "error", "message": "Thư viện paramiko chưa được cài đặt"}

        try:
            is_ok = self.connect()
            if is_ok and self.sftp:
                try:
                    self.sftp.stat(NAS_REMOTE_ROOT)
                    root_status = "Tồn tại & có quyền truy cập"
                except Exception:
                    root_status = f"Chưa tìm thấy thư mục gốc '{NAS_REMOTE_ROOT}', sẽ tự động tạo khi lưu tệp"
                return {
                    "status": "connected",
                    "host": NAS_HOST,
                    "port": NAS_PORT,
                    "username": NAS_USERNAME,
                    "remote_root": NAS_REMOTE_ROOT,
                    "root_dir_status": root_status,
                    "message": "Kết nối SFTP an toàn tới NAS Synology đang hoạt động tốt"
                }
            else:
                return {
                    "status": "disconnected",
                    "host": NAS_HOST,
                    "port": NAS_PORT,
                    "message": "Không thể thiết lập kết nối SFTP tới NAS Synology"
                }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Lỗi kiểm tra kết nối: {str(e)}"
            }


# Singleton SFTP Manager
sftp_manager = SFTPStorageManager()


def get_nas_base_path() -> str:
    """Lấy đường dẫn thư mục cache cục bộ"""
    os.makedirs(LOCAL_CACHE_DIR, exist_ok=True)
    return LOCAL_CACHE_DIR


def save_sample_image(file_bytes: bytes, original_filename: str, node_id: str, service_id: str) -> dict:
    """
    Lưu hình ảnh mẫu chuẩn SOP:
    1. Ghi vào thư mục local cache: sample_templates/{node_id}_{service_id}/
    2. Nếu STORAGE_MODE == 'sftp': Upload lên NAS Synology qua SFTP
    """
    base_dir = get_nas_base_path()
    folder_name = f"{node_id.strip()}_{service_id.strip()}".replace("/", "_").replace("\\", "_")
    target_dir = os.path.join(base_dir, "sample_templates", folder_name)
    os.makedirs(target_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1].lower()
    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        ext = '.jpg'

    file_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"sample_{folder_name}_{timestamp}_{file_id}{ext}"
    local_full_path = os.path.join(target_dir, saved_filename)

    # 1. Lưu vào Local Cache
    with open(local_full_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"sample_templates/{folder_name}/{saved_filename}"
    file_url = f"/nas-storage/{relative_path}"

    # 2. Đồng bộ lên NAS qua SFTP nếu bật chế độ sftp
    remote_path = f"{NAS_REMOTE_ROOT}/{relative_path}"
    if STORAGE_MODE == "sftp":
        sftp_ok = sftp_manager.upload_file(local_full_path, relative_path)
        if not sftp_ok:
            logger.warning(f"Chưa thể đồng bộ {saved_filename} lên NAS qua SFTP. Tệp đã lưu an toàn trong local cache.")

    return {
        "file_path": remote_path if STORAGE_MODE == "sftp" else local_full_path,
        "local_cache_path": local_full_path,
        "relative_path": relative_path,
        "file_url": file_url,
        "filename": saved_filename,
        "size": len(file_bytes),
        "storage_mode": STORAGE_MODE
    }


def save_order_proof_image(file_bytes: bytes, original_filename: str, entry_id: str, machine_id: str, task_drow_id: str) -> dict:
    """
    Lưu hình ảnh thực tế của kỹ thuật viên:
    1. Ghi vào thư mục local cache: orders/{entry_id}/{machine_id}/
    2. Nếu STORAGE_MODE == 'sftp': Upload lên NAS Synology qua SFTP
    """
    base_dir = get_nas_base_path()
    clean_entry = entry_id.strip().replace("/", "_").replace("\\", "_")
    clean_machine = machine_id.strip().replace("/", "_").replace("\\", "_")
    clean_task = task_drow_id.strip().replace("/", "_").replace("\\", "_")

    target_dir = os.path.join(base_dir, "orders", clean_entry, clean_machine)
    os.makedirs(target_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1].lower()
    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        ext = '.jpg'

    file_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"{clean_machine}_{clean_task}_{timestamp}_{file_id}{ext}"
    local_full_path = os.path.join(target_dir, saved_filename)

    # 1. Lưu vào Local Cache
    with open(local_full_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"orders/{clean_entry}/{clean_machine}/{saved_filename}"
    file_url = f"/nas-storage/{relative_path}"

    # 2. Đồng bộ lên NAS qua SFTP nếu bật chế độ sftp
    remote_path = f"{NAS_REMOTE_ROOT}/{relative_path}"
    if STORAGE_MODE == "sftp":
        sftp_ok = sftp_manager.upload_file(local_full_path, relative_path)
        if not sftp_ok:
            logger.warning(f"Chưa thể đồng bộ {saved_filename} lên NAS qua SFTP. Tệp đã lưu an toàn trong local cache.")

    return {
        "file_path": remote_path if STORAGE_MODE == "sftp" else local_full_path,
        "local_cache_path": local_full_path,
        "relative_path": relative_path,
        "file_url": file_url,
        "filename": saved_filename,
        "size": len(file_bytes),
        "storage_mode": STORAGE_MODE
    }


def get_file_for_serving(relative_path: str) -> Optional[str]:
    """
    Lấy đường dẫn tệp để phục vụ Web (HTTP Response):
    1. Kiểm tra trong local cache. Nếu có -> Trả về ngay lập tức.
    2. Nếu cache-miss và STORAGE_MODE == 'sftp' -> Tự động tải từ NAS Synology về cache và phục vụ!
    """
    clean_rel = relative_path.replace("\\", "/").lstrip("/")
    local_path = os.path.join(LOCAL_CACHE_DIR, clean_rel)

    # Nếu đã có trong cache
    if os.path.exists(local_path):
        return local_path

    # Nếu cache-miss và đang bật chế độ SFTP: thử kéo từ NAS về
    if STORAGE_MODE == "sftp":
        logger.info(f"Cache miss cho tệp: {clean_rel}. Đang tải từ NAS Synology qua SFTP...")
        ok = sftp_manager.download_file(clean_rel, local_path)
        if ok and os.path.exists(local_path):
            return local_path

    return None


def promote_proof_to_sample(proof_file_url_or_path: str, original_filename: str, node_id: str, service_id: str) -> dict:
    """
    Sao chép một hình ảnh thực tế từ kỹ thuật viên làm ảnh mẫu chuẩn SOP:
    1. Đọc nội dung ảnh từ cache hoặc NAS.
    2. Lưu bản sao chuẩn vào sample_templates/{node_id}_{service_id}/ và đồng bộ lên NAS Synology.
    """
    clean_path = proof_file_url_or_path.replace("\\", "/").strip()
    if "/nas-storage/" in clean_path:
        clean_path = clean_path.split("/nas-storage/", 1)[1]
    elif clean_path.startswith("nas_storage/"):
        clean_path = clean_path[len("nas_storage/"):]
    elif clean_path.startswith("./nas_storage/"):
        clean_path = clean_path[len("./nas_storage/"):]
    elif NAS_REMOTE_ROOT and clean_path.startswith(NAS_REMOTE_ROOT.replace("\\", "/")):
        clean_path = clean_path[len(NAS_REMOTE_ROOT):].lstrip("/")

    local_path = get_file_for_serving(clean_path)
    if not local_path or not os.path.exists(local_path):
        basename = os.path.basename(clean_path)
        found = None
        for root, _, files in os.walk(LOCAL_CACHE_DIR):
            if basename in files:
                found = os.path.join(root, basename)
                break
        if found:
            local_path = found
        else:
            raise FileNotFoundError(f"Không tìm thấy file ảnh thực tế: {proof_file_url_or_path}")

    with open(local_path, "rb") as f:
        file_bytes = f.read()

    return save_sample_image(file_bytes, original_filename or os.path.basename(local_path), node_id, service_id)


def save_internal_task_image(file_bytes: bytes, original_filename: str, task_code: str, image_type: str = "BEFORE") -> dict:
    """
    Lưu hình ảnh công việc nội bộ / sửa chữa phát sinh:
    1. Ghi vào thư mục local cache: internal_tasks/{task_code}/
    2. Nếu STORAGE_MODE == 'sftp': Upload lên NAS Synology qua SFTP
    """
    base_dir = get_nas_base_path()
    clean_code = task_code.strip().replace("/", "_").replace("\\", "_")
    target_dir = os.path.join(base_dir, "internal_tasks", clean_code)
    os.makedirs(target_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1].lower()
    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        ext = '.jpg'

    file_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"{clean_code}_{image_type}_{timestamp}_{file_id}{ext}"
    local_full_path = os.path.join(target_dir, saved_filename)

    with open(local_full_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"internal_tasks/{clean_code}/{saved_filename}"
    file_url = f"/nas-storage/{relative_path}"

    remote_path = f"{NAS_REMOTE_ROOT}/{relative_path}"
    if STORAGE_MODE == "sftp":
        sftp_ok = sftp_manager.upload_file(local_full_path, relative_path)
        if not sftp_ok:
            logger.warning(f"Chưa thể đồng bộ {saved_filename} lên NAS. Tệp đã lưu trong local cache.")

    return {
        "file_path": remote_path if STORAGE_MODE == "sftp" else local_full_path,
        "local_cache_path": local_full_path,
        "relative_path": relative_path,
        "file_url": file_url,
        "filename": saved_filename,
        "size": len(file_bytes),
        "storage_mode": STORAGE_MODE
    }


def save_recurring_template_sample_image(file_bytes: bytes, original_filename: str, template_code: str) -> dict:
    """
    Lưu hình ảnh mẫu chuẩn SOP cho hạng mục công việc định kỳ:
    1. Ghi vào thư mục local cache: recurring_samples/{template_code}/
    2. Nếu STORAGE_MODE == 'sftp': Upload lên NAS Synology qua SFTP
    """
    base_dir = get_nas_base_path()
    clean_code = template_code.strip().replace("/", "_").replace("\\", "_")
    target_dir = os.path.join(base_dir, "recurring_samples", clean_code)
    os.makedirs(target_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1].lower()
    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        ext = '.jpg'

    file_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"sample_{clean_code}_{timestamp}_{file_id}{ext}"
    local_full_path = os.path.join(target_dir, saved_filename)

    with open(local_full_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"recurring_samples/{clean_code}/{saved_filename}"
    file_url = f"/nas-storage/{relative_path}"

    remote_path = f"{NAS_REMOTE_ROOT}/{relative_path}"
    if STORAGE_MODE == "sftp":
        sftp_ok = sftp_manager.upload_file(local_full_path, relative_path)
        if not sftp_ok:
            logger.warning(f"Chưa thể đồng bộ ảnh mẫu {saved_filename} lên NAS qua SFTP. Tệp đã lưu an toàn trong local cache.")

    return {
        "file_path": remote_path if STORAGE_MODE == "sftp" else local_full_path,
        "local_cache_path": local_full_path,
        "relative_path": relative_path,
        "file_url": file_url,
        "filename": saved_filename,
        "size": len(file_bytes),
        "storage_mode": STORAGE_MODE
    }


def save_item_sample_image(file_bytes: bytes, original_filename: str, item_id: int, item_title: str = "") -> dict:
    """
    Lưu hình ảnh mẫu chuẩn SOP cho từng hạng mục công việc con:
    1. Ghi vào thư mục local cache: recurring_samples/items/{item_id}/
    2. Nếu STORAGE_MODE == 'sftp': Upload lên NAS Synology qua SFTP
    """
    base_dir = get_nas_base_path()
    target_dir = os.path.join(base_dir, "recurring_samples", "items", str(item_id))
    os.makedirs(target_dir, exist_ok=True)

    ext = os.path.splitext(original_filename)[1].lower()
    if not ext or ext not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        ext = '.jpg'

    file_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_filename = f"sample_item_{item_id}_{timestamp}_{file_id}{ext}"
    local_full_path = os.path.join(target_dir, saved_filename)

    with open(local_full_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"recurring_samples/items/{item_id}/{saved_filename}"
    file_url = f"/nas-storage/{relative_path}"

    remote_path = f"{NAS_REMOTE_ROOT}/{relative_path}"
    if STORAGE_MODE == "sftp":
        sftp_ok = sftp_manager.upload_file(local_full_path, relative_path)
        if not sftp_ok:
            logger.warning(f"Chưa thể đồng bộ ảnh mẫu hạng mục {saved_filename} lên NAS qua SFTP. Tệp đã lưu an toàn trong local cache.")

    return {
        "file_path": remote_path if STORAGE_MODE == "sftp" else local_full_path,
        "local_cache_path": local_full_path,
        "relative_path": relative_path,
        "file_url": file_url,
        "filename": saved_filename,
        "size": len(file_bytes),
        "storage_mode": STORAGE_MODE
    }


def promote_image_to_item_sample(image_file_url_or_path: str, original_filename: str, item_id: int, item_title: str = "") -> dict:
    """
    Sao chép một hình ảnh thực tế từ kỹ thuật viên làm ảnh mẫu chuẩn SOP cho hạng mục con:
    1. Đọc nội dung ảnh từ cache hoặc NAS.
    2. Lưu bản sao chuẩn vào recurring_samples/items/{item_id}/ và đồng bộ lên NAS Synology.
    """
    clean_path = image_file_url_or_path.replace("\\", "/").strip()
    if "/nas-storage/" in clean_path:
        clean_path = clean_path.split("/nas-storage/", 1)[1]
    elif clean_path.startswith("nas_storage/"):
        clean_path = clean_path[len("nas_storage/"):]
    elif clean_path.startswith("./nas_storage/"):
        clean_path = clean_path[len("./nas_storage/"):]
    elif NAS_REMOTE_ROOT and clean_path.startswith(NAS_REMOTE_ROOT.replace("\\", "/")):
        clean_path = clean_path[len(NAS_REMOTE_ROOT):].lstrip("/")

    local_path = get_file_for_serving(clean_path)
    if not local_path or not os.path.exists(local_path):
        basename = os.path.basename(clean_path)
        found = None
        for root, _, files in os.walk(LOCAL_CACHE_DIR):
            if basename in files:
                found = os.path.join(root, basename)
                break
        if found:
            local_path = found
        else:
            raise FileNotFoundError(f"Không tìm thấy file ảnh thực tế: {image_file_url_or_path}")

    with open(local_path, "rb") as f:
        file_bytes = f.read()

    return save_item_sample_image(file_bytes, original_filename or os.path.basename(local_path), item_id, item_title)


def get_nas_status() -> Dict[str, Any]:
    """Trả về báo cáo trạng thái hệ thống lưu trữ"""
    reload_nas_config()
    base_info = {
        "storage_mode": STORAGE_MODE,
        "local_cache_dir": os.path.abspath(LOCAL_CACHE_DIR),
        "paramiko_available": PARAMIKO_AVAILABLE
    }

    if STORAGE_MODE == "sftp":
        sftp_info = sftp_manager.check_connection()
        base_info.update(sftp_info)
    else:
        base_info.update({
            "status": "active_local",
            "message": "Hệ thống đang hoạt động ở chế độ lưu trữ cục bộ (Local Storage). Hãy cấu hình STORAGE_MODE=sftp trong .env khi chuyển lên Ubuntu Server để kết nối NAS."
        })

    return base_info
