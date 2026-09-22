"""
WebSocket Connection Manager for BOPP EM Maintenance
File: websocket_manager.py
"""

import asyncio
import logging
import time
from typing import Set, Dict, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("uvicorn.error")

class ConnectionManager:
    """Quản lý kết nối WebSocket và phát tán sự kiện thời gian thực (Real-time Broadcast)"""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._lock: Optional[asyncio.Lock] = None
        self.main_loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def set_event_loop(self, loop: asyncio.AbstractEventLoop):
        """Lưu lại main asyncio loop để hỗ trợ phát tán từ worker thread (threadpool)"""
        self.main_loop = loop
        self._lock = asyncio.Lock()
        logger.info("WebSocketManager: Đã gắn kết main asyncio loop thành công.")

    async def connect(self, websocket: WebSocket):
        """Chấp nhận kết nối và thêm vào danh sách client đang hoạt động"""
        await websocket.accept()
        lock = self._get_lock()
        async with lock:
            self.active_connections.add(websocket)
        logger.info(f"WebSocket: Client đã kết nối. Hiện có {len(self.active_connections)} client đang online.")

    async def disconnect(self, websocket: WebSocket):
        """Xóa client khỏi danh sách kết nối khi ngắt kết nối"""
        lock = self._get_lock()
        async with lock:
            self.active_connections.discard(websocket)
        logger.info(f"WebSocket: Client đã ngắt kết nối. Còn lại {len(self.active_connections)} client online.")

    async def broadcast(self, event_type: str, data: Optional[Dict[str, Any]] = None):
        """Gửi gói tin JSON sự kiện bất đồng bộ tới tất cả client đang kết nối"""
        if not self.active_connections:
            return

        message = {
            "type": event_type,
            "event": event_type,
            "data": data or {},
            "timestamp": int(time.time() * 1000)
        }

        lock = self._get_lock()
        async with lock:
            connections = list(self.active_connections)

        dead_connections = []
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"WebSocket: Lỗi gửi gói tin tới client ({e}), đưa vào danh sách dọn dẹp.")
                dead_connections.append(connection)

        if dead_connections:
            async with lock:
                for dc in dead_connections:
                    self.active_connections.discard(dc)

    def broadcast_sync(self, event_type: str, data: Optional[Dict[str, Any]] = None):
        """
        Phương thức đồng bộ (thread-safe): Cho phép các route FastAPI thông thường (def route)
        gọi phát tán sự kiện WebSocket mà không bị lỗi Runtime 'No running event loop'.
        """
        try:
            target_loop = self.main_loop
            if not target_loop or target_loop.is_closed():
                try:
                    target_loop = asyncio.get_running_loop()
                except RuntimeError:
                    pass

            if target_loop and target_loop.is_running():
                asyncio.run_coroutine_threadsafe(self.broadcast(event_type, data), target_loop)
            else:
                # Fallback nếu chưa khởi tạo loop
                asyncio.run(self.broadcast(event_type, data))
        except Exception as ex:
            logger.error(f"WebSocketManager.broadcast_sync error: {ex}", exc_info=False)


# Khởi tạo singleton dùng chung toàn hệ thống
ws_manager = ConnectionManager()
