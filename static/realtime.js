/**
 * BOPP Maintenance System - Realtime Client (WebSocket)
 * Tự động kết nối, tự động khôi phục kết nối (Auto Reconnect),
 * lắng nghe sự kiện đồng bộ dữ liệu thời gian thực giữa các thiết bị/người dùng.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RealtimeSync = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    let ws = null;
    let reconnectAttempts = 0;
    let maxReconnectAttempts = 50;
    let reconnectTimeout = null;
    let pingInterval = null;
    let isExplicitlyClosed = false;

    const listeners = new Map();
    const globalListeners = new Set();

    function getWsUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws`;
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            const url = getWsUrl();
            ws = new WebSocket(url);

            ws.onopen = function () {
                reconnectAttempts = 0;
                if (reconnectTimeout) {
                    clearTimeout(reconnectTimeout);
                    reconnectTimeout = null;
                }
                startHeartbeat();
                dispatchCustomEvent('realtime:connected', { connected: true });
                console.log('[Realtime] Đã kết nối WebSocket đồng bộ thời gian thực.');
            };

            ws.onmessage = function (event) {
                if (event.data === 'pong') return;
                try {
                    const message = JSON.parse(event.data);
                    handleIncomingMessage(message);
                } catch (err) {
                    // Raw string message
                }
            };

            ws.onclose = function (event) {
                stopHeartbeat();
                dispatchCustomEvent('realtime:disconnected', { code: event.code });
                if (!isExplicitlyClosed) {
                    scheduleReconnect();
                }
            };

            ws.onerror = function (err) {
                console.warn('[Realtime] WebSocket gặp sự cố kết nối, chuẩn bị thử lại...');
            };
        } catch (e) {
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (reconnectTimeout || isExplicitlyClosed) return;
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, Math.min(reconnectAttempts, 8)), 10000);
        reconnectTimeout = setTimeout(function () {
            reconnectTimeout = null;
            connect();
        }, delay);
    }

    function startHeartbeat() {
        stopHeartbeat();
        pingInterval = setInterval(function () {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send('ping');
                } catch (e) {}
            }
        }, 25000);
    }

    function stopHeartbeat() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }

    function handleIncomingMessage(msg) {
        if (!msg) return;
        const eventType = msg.event || msg.type;
        if (!eventType) return;

        const payload = msg.data || {};

        // 1. Gọi listeners đăng ký theo từng sự kiện
        if (listeners.has(eventType)) {
            listeners.get(eventType).forEach(cb => {
                try { cb(payload, msg); } catch (e) { console.error('[Realtime Listener Error]', e); }
            });
        }

        // 2. Gọi global listeners
        globalListeners.forEach(cb => {
            try { cb(eventType, payload, msg); } catch (e) { console.error('[Realtime Global Listener Error]', e); }
        });

        // 3. Bắn CustomEvent trên window để bất kỳ component nào cũng có thể lắng nghe
        dispatchCustomEvent('realtime:' + eventType.toLowerCase(), { eventType, payload, timestamp: msg.timestamp });
        dispatchCustomEvent('realtime:event', { eventType, payload, timestamp: msg.timestamp });
    }

    function dispatchCustomEvent(name, detail) {
        try {
            const ev = new CustomEvent(name, { detail: detail, bubbles: true });
            window.dispatchEvent(ev);
        } catch (e) {}
    }

    // Tiện ích Debounce: Tránh gọi API refresh quá dồn dập khi có nhiều cập nhật liên tiếp
    function createDebouncedRefresher(callback, wait = 600) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                callback(...args);
            }, wait);
        };
    }

    // Public API
    const api = {
        init: function () {
            isExplicitlyClosed = false;
            connect();
            return this;
        },
        on: function (eventType, callback) {
            if (!listeners.has(eventType)) {
                listeners.set(eventType, new Set());
            }
            listeners.get(eventType).add(callback);
            return () => this.off(eventType, callback);
        },
        off: function (eventType, callback) {
            if (listeners.has(eventType)) {
                listeners.get(eventType).delete(callback);
            }
        },
        onAny: function (callback) {
            globalListeners.add(callback);
            return () => globalListeners.delete(callback);
        },
        debounce: createDebouncedRefresher,
        close: function () {
            isExplicitlyClosed = true;
            stopHeartbeat();
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            if (ws) {
                ws.close();
                ws = null;
            }
        },
        getStatus: function () {
            if (!ws) return 'CLOSED';
            switch (ws.readyState) {
                case WebSocket.CONNECTING: return 'CONNECTING';
                case WebSocket.OPEN: return 'OPEN';
                case WebSocket.CLOSING: return 'CLOSING';
                default: return 'CLOSED';
            }
        }
    };

    // Tự động khởi chạy khi script được nhúng vào trang
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => api.init());
        } else {
            api.init();
        }
    }

    return api;
}));
