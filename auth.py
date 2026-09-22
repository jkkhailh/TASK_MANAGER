import hashlib
import hmac
import base64
import json
import time
from typing import Optional, Dict, Any
from fastapi import HTTPException, Header, Depends

SECRET_KEY = "BOPP_MAINTENANCE_SUPER_SECRET_KEY_2026!@#"
TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 ngày

def hash_password(password: str, salt: str = "BOPP_SALT") -> str:
    """Mã hóa mật khẩu với SHA256 và salt"""
    return hashlib.sha256(f"{salt}{password}".encode("utf-8")).hexdigest()

def verify_password(password: str, hashed: str, salt: str = "BOPP_SALT") -> bool:
    """Xác minh mật khẩu"""
    return hmac.compare_digest(hash_password(password, salt), hashed)

def create_access_token(user_data: Dict[str, Any]) -> str:
    """Tạo JWT Token đơn giản, bảo mật, không cần thư viện ngoài"""
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user_data["username"],
        "username": user_data["username"],
        "user_id": user_data["id"],
        "full_name": user_data.get("full_name", ""),
        "emp_id": user_data.get("emp_id", ""),
        "role": user_data.get("role", "technician"),
        "depart_id": user_data.get("depart_id", ""),
        "permissions": user_data.get("permissions", {}),
        "exp": int(time.time()) + TOKEN_EXPIRE_SECONDS
    }

    def b64_encode(data: dict) -> str:
        s = json.dumps(data, separators=(',', ':')).encode('utf-8')
        return base64.urlsafe_b64encode(s).rstrip(b'=').decode('utf-8')

    header_b64 = b64_encode(header)
    payload_b64 = b64_encode(payload)
    signature_input = f"{header_b64}.{payload_b64}".encode('utf-8')

    signature = hmac.new(SECRET_KEY.encode('utf-8'), signature_input, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b'=').decode('utf-8')

    return f"{header_b64}.{payload_b64}.{sig_b64}"

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Giải mã và xác thực chữ ký JWT Token"""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None

        header_b64, payload_b64, sig_b64 = parts

        # Verify signature
        sig_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), sig_input, hashlib.sha256).digest()
        actual_sig = base64.urlsafe_b64decode(sig_b64 + '=' * (-len(sig_b64) % 4))

        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        # Decode payload
        payload_json = base64.urlsafe_b64decode(payload_b64 + '=' * (-len(payload_b64) % 4)).decode('utf-8')
        payload = json.loads(payload_json)

        if payload.get("exp", 0) < time.time():
            return None  # Token hết hạn

        return payload
    except Exception:
        return None

def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Lấy user hiện tại từ Header Authorization (tùy chọn)"""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return decode_access_token(token)

def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Bắt buộc người dùng phải đăng nhập"""
    user = get_current_user_optional(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Yêu cầu đăng nhập để thực hiện thao tác này.")
    return user

def require_role(allowed_roles: list):
    """Decorator kiểm tra vai trò người dùng"""
    def role_checker(user: Dict[str, Any] = Depends(get_current_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này.")
        return user
    return role_checker
