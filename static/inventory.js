/**
 * BOPP Maintenance - Inventory Management Frontend
 */

let state = {
  currentWarehouse: 'all',
  currentStatus: 'all',
  searchQuery: '',
  limit: 50,
  offset: 0,
  total: 0,
  warehouses: [],
  currentUser: null,
  activeMode: 'items', // 'items' or 'requests'
  requestsSubMode: 'by_request', // 'by_request' or 'all_items'
  voucherFilter: 'unassigned', // 'unassigned', 'assigned', 'all' (mặc định ẩn các item đã tạo phiếu)
  receiptFilter: 'all', // 'all', 'unreceived', 'received'
  selectedIssueItemIds: new Set(),
  selectedRequestIds: new Set(),
  allIssueItemsList: [],
  requestsList: []
};

let searchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  await loadSummary();
  await loadItems();
  updateInvItemsFilterBadge();
  updateInvReqFilterBadge();
  setupReqItemSearch();

  const searchInput = document.getElementById('invSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value.trim();
        state.offset = 0;
        if (state.activeMode === 'requests') {
          if (state.requestsSubMode === 'all_items') {
            loadIssueItems();
          } else {
            loadRequests();
          }
        } else {
          loadItems();
        }
      }, 300);
    });
  }
});

// 1. Tải thông tin người dùng hiện tại
async function loadCurrentUser() {
  const token = localStorage.getItem('token') || localStorage.getItem('bopp_token');
  const chipContainer = document.getElementById('userProfileChip');
  
  if (!token) {
    state.currentUser = null;
    renderInventoryUserChip();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.user || data;
      renderInventoryUserChip();
    } else {
      state.currentUser = null;
      renderInventoryUserChip();
    }
  } catch (err) {
    console.error('Lỗi lấy thông tin người dùng:', err);
    const stored = localStorage.getItem('bopp_user');
    if (stored) {
      try { state.currentUser = JSON.parse(stored); } catch(e) {}
    }
    renderInventoryUserChip();
  }
}

function renderInventoryUserChip() {
  const chipContainer = document.getElementById('userProfileChip');
  if (!chipContainer) return;

  const user = state.currentUser;
  if (user) {
    const roleColors = { admin: '#EF4444', supervisor: '#F59E0B', technician: '#10B981' };
    const roleLabels = { admin: 'Quản trị', supervisor: 'Giám sát', technician: 'Kỹ thuật viên' };
    const color = roleColors[user.role] || '#6366F1';
    const label = roleLabels[user.role] || user.role;
    const initial = (user.full_name || user.username || 'U').charAt(0).toUpperCase();

    chipContainer.innerHTML = `
      <button type="button" id="btnLogoutUserBtn" class="user-avatar-btn" title="Tài khoản: ${escapeHtml(user.full_name || user.username)} (${label}) - Nhấp để đăng xuất" style="--avatar-color: ${color};">
        <span class="avatar-letter">${initial}</span>
        <span class="user-status-dot" style="background: ${color};"></span>
      </button>
    `;

    document.getElementById('btnLogoutUserBtn')?.addEventListener('click', () => {
      if (confirm(`Đăng xuất khỏi tài khoản "${user.full_name || user.username}"?`)) {
        localStorage.removeItem('token');
        localStorage.removeItem('bopp_token');
        localStorage.removeItem('bopp_user');
        state.currentUser = null;
        renderInventoryUserChip();
      }
    });
  } else {
    chipContainer.innerHTML = `
      <button type="button" class="user-avatar-btn is-guest" title="Đăng Nhập" onclick="window.location.href='/'">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
    `;
  }
}

// 2. Tải tổng quan tồn kho theo từng kho
async function loadSummary() {
  try {
    const res = await fetch('/api/inventory/summary');
    if (!res.ok) return;
    const data = await res.json();

    state.warehouses = data.warehouses || [];
    const totals = data.totals || {};
    state.totalAllRows = totals.total_rows || 0;

    // Cập nhật Ribbon thống kê nếu có
    if (document.getElementById('statTotalItems')) {
      document.getElementById('statTotalItems').textContent = (totals.distinct_items || 0).toLocaleString();
      document.getElementById('statTotalRows').textContent = `${(totals.total_rows || 0).toLocaleString()} vị trí kệ lưu kho`;
      document.getElementById('statPositiveStock').textContent = (totals.positive_rows || 0).toLocaleString();
      document.getElementById('statZeroStock').textContent = (totals.zero_rows || 0).toLocaleString();
      document.getElementById('statLowStock').textContent = (totals.low_stock_rows || 0).toLocaleString();
    }

    if (document.getElementById('tabItemsBadge')) {
      document.getElementById('tabItemsBadge').textContent = (totals.total_rows || 0).toLocaleString();
    }

    if (totals.last_synced_at && document.getElementById('headerLastSync')) {
      document.getElementById('headerLastSync').textContent = totals.last_synced_at.substring(11, 19) + ' ' + totals.last_synced_at.substring(8, 10) + '/' + totals.last_synced_at.substring(5, 7);
    }

    renderWarehouseChips(totals.total_rows || 0);
  } catch (err) {
    console.error('Lỗi tải summary kho:', err);
  }
}

// 3. Render danh sách chips lọc nhanh kho
function renderWarehouseChips(allCount) {
  const container = document.getElementById('warehouseChipsContainer');
  if (!container) return;

  let html = `
    <button class="wh-chip ${state.currentWarehouse === 'all' ? 'active' : ''}" onclick="selectWarehouse('all')">
      Tất Cả Kho
      <span class="chip-count">${allCount.toLocaleString()}</span>
    </button>
  `;

  state.warehouses.forEach(wh => {
    const isAct = state.currentWarehouse === wh.WHouseID ? 'active' : '';
    html += `
      <button class="wh-chip ${isAct}" onclick="selectWarehouse('${wh.WHouseID}')" title="${wh.WHouseText}">
        <span>${wh.WHouseID}</span>
        <span style="font-size: 0.72rem; opacity: 0.8;">${wh.WHouseText.replace('Kho ', '')}</span>
        <span class="chip-count">${wh.total_rows.toLocaleString()}</span>
      </button>
    `;
  });

  container.innerHTML = html;
}

// Rule 1: Mobile Collapsible Filters logic & badges
function toggleInvItemsFilter() {
  const panel = document.getElementById('invItemsFilterPanel');
  const btn = document.getElementById('btnToggleInvItemsFilter');
  if (!panel) return;
  panel.classList.toggle('is-open');
  if (btn) btn.classList.toggle('is-active', panel.classList.contains('is-open'));
}

function updateInvItemsFilterBadge() {
  const badge = document.getElementById('invItemsFilterBadge');
  const btn = document.getElementById('btnToggleInvItemsFilter');
  let count = 0;
  if (state.currentWarehouse && state.currentWarehouse !== 'all') count++;
  if (state.currentStatus && state.currentStatus !== 'all') count++;

  if (badge) {
    if (count > 0) {
      badge.textContent = count.toString();
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
  if (btn) {
    btn.classList.toggle('has-active-filters', count > 0);
  }
}

function toggleInvReqFilter() {
  const panel = document.getElementById('invRequestsFilterPanel');
  const btn = document.getElementById('btnToggleInvReqFilter');
  if (!panel) return;
  panel.classList.toggle('is-open');
  if (btn) btn.classList.toggle('is-active', panel.classList.contains('is-open'));
}

function updateInvReqFilterBadge() {
  const badge = document.getElementById('invReqFilterBadge');
  const btn = document.getElementById('btnToggleInvReqFilter');
  let count = 0;
  // If voucher filter is not 'all', count as 1 filter (default is 'unassigned')
  if (state.voucherFilter && state.voucherFilter !== 'all') count++;
  if (state.receiptFilter && state.receiptFilter !== 'all') count++;

  if (badge) {
    if (count > 0) {
      badge.textContent = count.toString();
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
  if (btn) {
    btn.classList.toggle('has-active-filters', count > 0);
  }
}

function selectWarehouse(whId) {
  state.currentWarehouse = whId;
  state.offset = 0;
  renderWarehouseChips(state.totalAllRows || 0);
  updateInvItemsFilterBadge();
  loadItems();
}

function setStatusFilter(status) {
  state.currentStatus = status;
  state.offset = 0;
  document.querySelectorAll('#invItemsFilterPanel .segmented-control .seg-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-status') === status);
  });
  updateInvItemsFilterBadge();
  loadItems();
}

function clearSearch() {
  const input = document.getElementById('invSearchInput');
  if (input) input.value = '';
  state.searchQuery = '';
  state.offset = 0;
  loadItems();
}

// 4. Tải danh sách vật tư theo bộ lọc (Render cả Bảng Desktop & Thẻ Mobile Rule 2)
async function loadItems() {
  const tbody = document.getElementById('inventoryTableBody');
  const mobileContainer = document.getElementById('itemsMobileCards');
  if (!tbody && !mobileContainer) return;

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);"><span class="status-dot"></span> Đang tải dữ liệu...</td></tr>`;
  }
  if (mobileContainer) {
    mobileContainer.innerHTML = `<div style="text-align: center; padding: 25px; color: var(--text-muted);"><span class="status-dot"></span> Đang tải dữ liệu...</div>`;
  }

  try {
    const params = new URLSearchParams({
      wh: state.currentWarehouse,
      status: state.currentStatus,
      q: state.searchQuery,
      limit: state.limit,
      offset: state.offset
    });

    const res = await fetch(`/api/inventory/items?${params.toString()}`);
    if (!res.ok) throw new Error('Không thể tải danh sách vật tư');
    const data = await res.json();

    const items = data.items || [];
    state.total = data.total || 0;

    updatePagination();

    if (items.length === 0) {
      const emptyMsg = 'Không tìm thấy vật tư nào phù hợp với bộ lọc hiện tại.';
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">${emptyMsg}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">${emptyMsg}</div>`;
      return;
    }

    // Render Bảng Desktop
    if (tbody) {
      tbody.innerHTML = items.map(it => {
        const stock = parseFloat(it.CurrentStock || 0);
        const qmin = parseFloat(it.QtyMin || 0);
        let statusBadge = '';
        let qtyClass = 'positive';

        if (stock === 0) {
          statusBadge = `<span class="badge" style="background: rgba(107, 114, 128, 0.2); color: #9CA3AF; border: 1px solid rgba(107, 114, 128, 0.3);">Hết hàng</span>`;
          qtyClass = 'zero';
        } else if (it.StockStatus === 'LOW_STOCK') {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3);">Sắp hết ⚠️</span>`;
          qtyClass = 'low';
        } else {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3);">Có sẵn</span>`;
        }

        return `
          <tr>
            <td><span class="item-id-badge">${escapeHtml(it.ItemID)}</span></td>
            <td>
              <div style="font-weight: 600; color: var(--text-primary); line-height: 1.3;">${escapeHtml(it.ItemText)}</div>
            </td>
            <td><span class="wh-badge" title="${escapeHtml(it.WHouseText)}">${it.WHouseID}</span></td>
            <td><span class="storage-tag">📍 ${escapeHtml(it.StorageID || 'ZZZ')}</span></td>
            <td style="text-align: right;">
              <span class="stock-qty-val ${qtyClass}">${stock.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 2px;">${escapeHtml(it.Unit || 'Cái')}</span>
            </td>
            <td style="text-align: right; font-size: 0.8rem; color: var(--text-muted);">${qmin > 0 ? qmin.toLocaleString() : '-'}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: center;">
              <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick='quickRequestItem(${JSON.stringify(it)})' title="Tạo yêu cầu xuất vật tư này">
                + Xuất
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render Thẻ Mobile View (Rule 2: Edge-to-Edge card style)
    if (mobileContainer) {
      mobileContainer.innerHTML = items.map(it => {
        const stock = parseFloat(it.CurrentStock || 0);
        const qmin = parseFloat(it.QtyMin || 0);
        let statusBadge = '';
        let qtyClass = 'positive';

        if (stock === 0) {
          statusBadge = `<span class="badge" style="background: rgba(107, 114, 128, 0.2); color: #9CA3AF; border: 1px solid rgba(107, 114, 128, 0.3); font-size: 0.7rem; padding: 1px 6px;">Hết hàng</span>`;
          qtyClass = 'zero';
        } else if (it.StockStatus === 'LOW_STOCK') {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.7rem; padding: 1px 6px;">Sắp hết ⚠️</span>`;
          qtyClass = 'low';
        } else {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.7rem; padding: 1px 6px;">Có sẵn</span>`;
        }

        const itJson = JSON.stringify(it).replace(/"/g, '&quot;');

        return `
          <div class="inv-item-card">
            <div class="inv-item-card-h1">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="item-id-badge">${escapeHtml(it.ItemID)}</span>
                <span class="storage-tag" style="font-size: 0.72rem; padding: 1px 6px;">📍 ${escapeHtml(it.StorageID || 'ZZZ')}</span>
              </div>
              <div style="display: flex; align-items: baseline; gap: 3px;">
                <span class="stock-qty-val ${qtyClass}" style="font-size: 1.05rem; font-weight: 800;">${stock.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.Unit || 'Cái')}</span>
              </div>
            </div>

            <div class="inv-item-card-name">${escapeHtml(it.ItemText)}</div>

            <div class="inv-item-card-footer">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="wh-badge" style="font-size: 0.68rem;">${escapeHtml(it.WHouseID)}</span>
                ${statusBadge}
                ${qmin > 0 ? `<span style="font-size: 0.68rem; color: var(--text-muted);">ĐM: ${qmin.toLocaleString()}</span>` : ''}
              </div>
              <button type="button" class="btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; font-weight: 600; border-radius: 6px; color: #818CF8; border-color: rgba(99, 102, 241, 0.35);" onclick="quickRequestItem(${itJson})" title="Tạo yêu cầu xuất vật tư này">
                + Xuất
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Lỗi render items:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: #EF4444;">Lỗi khi tải dữ liệu: ${err.message}</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: #EF4444;">Lỗi khi tải dữ liệu: ${err.message}</div>`;
  }
}

// 5. Cập nhật phân trang
function updatePagination() {
  const from = state.total === 0 ? 0 : state.offset + 1;
  const to = Math.min(state.offset + state.limit, state.total);
  document.getElementById('paginationInfo').textContent = `Hiển thị ${from.toLocaleString()} - ${to.toLocaleString()} / ${state.total.toLocaleString()} dòng`;

  document.getElementById('btnPrevPage').disabled = state.offset === 0;
  document.getElementById('btnNextPage').disabled = to >= state.total;
}

function changePage(delta) {
  state.offset += delta * state.limit;
  if (state.offset < 0) state.offset = 0;
  loadItems();
}

// 6. Chuyển đổi giữa Chế độ Tra cứu & Chế độ Phiếu yêu cầu
function switchInvMode(mode) {
  state.activeMode = mode;
  document.getElementById('tabModeItems').classList.toggle('active', mode === 'items');
  document.getElementById('tabModeRequests').classList.toggle('active', mode === 'requests');

  document.getElementById('viewItemsSection').style.display = mode === 'items' ? 'block' : 'none';
  document.getElementById('viewRequestsSection').style.display = mode === 'requests' ? 'block' : 'none';

  if (mode === 'requests') {
    if (state.requestsSubMode === 'all_items') {
      loadIssueItems();
    } else {
      loadRequests();
    }
    loadIssueItems(true); // background update count
  }
}

// Chuyển đổi giữa chế độ xem: Theo Phiếu vs Tất Cả Vật Tư Cần Xuất
function switchRequestsSubMode(subMode) {
  state.requestsSubMode = subMode;
  const btnByReq = document.getElementById('subModeByRequest');
  const btnAllItems = document.getElementById('subModeAllItems');
  const viewByReq = document.getElementById('subViewByRequest');
  const viewAllItems = document.getElementById('subViewAllItems');

  if (btnByReq) btnByReq.classList.toggle('active', subMode === 'by_request');
  if (btnAllItems) btnAllItems.classList.toggle('active', subMode === 'all_items');
  if (viewByReq) viewByReq.style.display = subMode === 'by_request' ? 'block' : 'none';
  if (viewAllItems) viewAllItems.style.display = subMode === 'all_items' ? 'block' : 'none';

  if (subMode === 'all_items') {
    loadIssueItems();
  } else {
    loadRequests();
  }
}

// Lọc theo trạng thái tạo phiếu ERP: unassigned (chưa tạo - mặc định), assigned (đã tạo), all
function setVoucherFilter(filter) {
  state.voucherFilter = filter;
  state.selectedRequestIds.clear();
  state.selectedIssueItemIds.clear();
  updateSelectedCounters();
  ['vFilterUnassigned', 'vFilterAssigned', 'vFilterAll'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (filter === 'unassigned') document.getElementById('vFilterUnassigned')?.classList.add('active');
  if (filter === 'assigned') document.getElementById('vFilterAssigned')?.classList.add('active');
  if (filter === 'all') document.getElementById('vFilterAll')?.classList.add('active');

  updateInvReqFilterBadge();

  if (state.requestsSubMode === 'all_items') {
    loadIssueItems();
  } else {
    loadRequests();
    loadIssueItems(true);
  }
}

// Lọc theo trạng thái nhận hàng: all (tất cả - mặc định), unreceived (chưa nhận), received (đã nhận)
function setReceiptFilter(filter) {
  state.receiptFilter = filter;
  state.selectedRequestIds.clear();
  state.selectedIssueItemIds.clear();
  updateSelectedCounters();
  ['rFilterAll', 'rFilterUnreceived', 'rFilterReceived'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (filter === 'all') document.getElementById('rFilterAll')?.classList.add('active');
  if (filter === 'unreceived') document.getElementById('rFilterUnreceived')?.classList.add('active');
  if (filter === 'received') document.getElementById('rFilterReceived')?.classList.add('active');

  updateInvReqFilterBadge();

  if (state.requestsSubMode === 'all_items') {
    loadIssueItems();
  } else {
    loadRequests();
    loadIssueItems(true);
  }
}

// 7. Đồng bộ từ ERP
async function handleSyncERP() {
  const btn = document.getElementById('btnSyncERP');
  const icon = document.getElementById('syncIcon');
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = 'spin 1s linear infinite';

  try {
    const res = await fetch('/api/inventory/sync', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      alert(`Đồng bộ thành công!\n${data.message}`);
      await loadSummary();
      await loadItems();
    } else {
      alert(`Lỗi đồng bộ: ${data.detail || 'Không xác định'}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối khi đồng bộ: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = 'none';
  }
}

// 8. Tải danh sách phiếu yêu cầu xuất kho
async function loadRequests() {
  const tbody = document.getElementById('requestsTableBody');
  const mobileContainer = document.getElementById('requestsMobileCards');
  if (!tbody && !mobileContainer) return;
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">Đang tải danh sách phiếu...</td></tr>`;
  if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">Đang tải danh sách phiếu...</div>`;

  try {
    const res = await fetch('/api/inventory/requests');
    if (!res.ok) throw new Error('Không thể tải phiếu yêu cầu');
    const data = await res.json();
    const requests = data.requests || [];
    state.requestsList = requests;

    // Lọc phiếu theo bộ lọc VoucherCode
    let filteredRequests = requests;
    if (state.voucherFilter === 'unassigned') {
      // Giữ lại phiếu có ít nhất 1 item chưa có mã đơn ERP (và chưa bị hủy)
      filteredRequests = requests.filter(r => (r.items || []).some(it => !it.IsCancelled && (!it.VoucherCode || it.VoucherCode.trim() === '')));
    } else if (state.voucherFilter === 'assigned') {
      // Giữ lại phiếu mà tất cả item (chưa bị hủy) đều đã có mã đơn ERP
      filteredRequests = requests.filter(r => {
        const activeItems = (r.items || []).filter(it => !it.IsCancelled);
        return activeItems.length > 0 && activeItems.every(it => it.VoucherCode && it.VoucherCode.trim() !== '');
      });
    }

    // Lọc phiếu theo bộ lọc trạng thái nhận hàng (receiptFilter): all, unreceived, received
    // Quy tắc: Phiếu vừa có hàng chưa nhận và đã nhận thì hiện trong cả 2 bộ lọc
    if (state.receiptFilter === 'unreceived') {
      filteredRequests = filteredRequests.filter(r => 
        (r.items || []).some(it => !it.IsCancelled && (!it.IsReceived || it.IsReceived === 0))
      );
    } else if (state.receiptFilter === 'received') {
      filteredRequests = filteredRequests.filter(r => 
        (r.items || []).some(it => !it.IsCancelled && (it.IsReceived == 1 || it.IsReceived === true))
      );
    }

    // Lọc theo kho (nếu có chọn kho)
    if (state.currentWarehouse && state.currentWarehouse !== 'all') {
      const wh = state.currentWarehouse.trim().toLowerCase();
      filteredRequests = filteredRequests.filter(r => 
        (r.WHouseID || '').toLowerCase() === wh ||
        (r.items || []).some(it => (it.WHouseID || '').toLowerCase() === wh)
      );
    }

    // Lọc tìm kiếm nếu có query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filteredRequests = filteredRequests.filter(r => 
        (r.RequestCode || '').toLowerCase().includes(q) ||
        (r.RequestedBy || '').toLowerCase().includes(q) ||
        (r.Purpose || '').toLowerCase().includes(q) ||
        (r.items || []).some(it => (it.ItemID || '').toLowerCase().includes(q) || (it.ItemText || '').toLowerCase().includes(q))
      );
    }

    state.filteredRequestsList = filteredRequests;

    const badgeTotal = document.getElementById('tabRequestsBadge');
    if (badgeTotal) badgeTotal.textContent = requests.length.toString();
    const subBadge = document.getElementById('subReqBadge');
    if (subBadge) subBadge.textContent = filteredRequests.length.toString();

    // Đồng bộ checkbox Select All Requests
    const chkAll = document.getElementById('chkSelectAllRequests');
    if (chkAll) {
      chkAll.checked = filteredRequests.length > 0 && filteredRequests.every(r => state.selectedRequestIds.has(r.id));
    }

    if (filteredRequests.length === 0) {
      let emptyMsg = 'Chưa có phiếu yêu cầu xuất kho nào phù hợp với bộ lọc.';
      if (state.voucherFilter === 'unassigned' && state.receiptFilter === 'all') {
        emptyMsg = 'Tất cả các phiếu đều đã được tạo phiếu xuất ERP.';
      } else if (state.receiptFilter === 'unreceived') {
        emptyMsg = 'Không có phiếu nào có hàng chưa nhận.';
      } else if (state.receiptFilter === 'received') {
        emptyMsg = 'Không có phiếu nào có hàng đã nhận.';
      }
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--text-muted);">${emptyMsg}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">${emptyMsg}</div>`;
      updateSelectedCounters();
      return;
    }

    if (tbody) {
      tbody.innerHTML = filteredRequests.map(r => {
        let statusBadge = '';
        if (r.Status === 'PENDING') {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3);">Chờ Duyệt</span>`;
        } else if (r.Status === 'APPROVED') {
          statusBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.3);">Đã Duyệt</span>`;
        } else if (r.Status === 'ISSUED') {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3);">Đã Xuất Kho</span>`;
        } else {
          statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3);">Từ Chối</span>`;
        }

        const isReqChecked = state.selectedRequestIds.has(r.id);
        const activeItems = (r.items || []).filter(it => !it.IsCancelled);
        const cancelledItems = (r.items || []).filter(it => it.IsCancelled);
        const itemsDetail = (r.items || []).map(it => {
          if (it.IsCancelled) {
            return `<span style="text-decoration: line-through; opacity: 0.55; color: #EF4444;" title="Đã hủy: ${escapeHtml(it.CancelReason || '')}">• ${escapeHtml(it.ItemText)}: ${it.RequestedQty} ${escapeHtml(it.Unit || 'Cái')} (Đã hủy)</span>`;
          }
          const recBadge = it.IsReceived ? '<span style="color: #34D399; font-size: 0.72rem; margin-left: 4px; font-weight: 600;">[Đã nhận]</span>' : '';
          return `• ${escapeHtml(it.ItemText)}: <strong>${it.RequestedQty}</strong> ${escapeHtml(it.Unit || 'Cái')}${recBadge}`;
        }).join('<br>');
        const receivedPhotos = (r.items || []).filter(it => it.ReceivedPhotoUrl);

        return `
          <tr style="cursor: pointer; background: ${isReqChecked ? 'rgba(99, 102, 241, 0.08)' : 'transparent'};" onclick="openRequestDetail(${r.id})">
            <td style="text-align: center;" onclick="event.stopPropagation();">
              <input type="checkbox" class="inv-check" ${isReqChecked ? 'checked' : ''} onchange="toggleSelectRequest(${r.id}, this.checked)">
            </td>
            <td><span class="item-id-badge" style="color: #60A5FA;">${escapeHtml(r.RequestCode)}</span></td>
            <td style="font-size: 0.8rem; color: var(--text-secondary);">${r.RequestDate}</td>
            <td>
              <div style="font-weight: 600;">${escapeHtml(r.RequestedBy)}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(r.Department || '')}</div>
            </td>
            <td><span class="wh-badge">${escapeHtml(r.WHouseID || 'VT')}</span></td>
            <td>
              <div style="font-weight: 600;">${escapeHtml(r.Purpose)}</div>
              ${r.MachineID ? `<span style="font-size: 0.75rem; color: #FBBF24;">Máy: ${escapeHtml(r.MachineID)}</span>` : ''}
              <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">${itemsDetail}</div>
              ${receivedPhotos.length > 0 ? `
                <div class="req-row-photos-strip">
                  <span style="font-size: 0.68rem; color: #34D399; font-weight: 600; display: flex; align-items: center; gap: 3px;">📷 Ảnh xuất (${receivedPhotos.length}):</span>
                  ${receivedPhotos.map(it => `
                    <div class="req-photo-chip" onclick="event.stopPropagation(); previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="${escapeHtml(it.ItemText || it.ItemID)} (Bấm để phóng to)">
                      <img src="${escapeHtml(it.ReceivedPhotoUrl)}" alt="${escapeHtml(it.ItemText || '')}" loading="lazy">
                      <span>${escapeHtml(it.ItemText || it.ItemID)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </td>
            <td style="text-align: center; font-weight: 700;">
              ${activeItems.length}${cancelledItems.length > 0 ? ` <span style="font-size: 0.7rem; color: #EF4444; font-weight: normal;">(-${cancelledItems.length} hủy)</span>` : ''}
            </td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: center;" onclick="event.stopPropagation();">
              <div style="display: flex; gap: 4px; justify-content: center;">
                <button class="btn-secondary" style="padding: 2px 8px; font-size: 0.72rem;" onclick="openRequestDetail(${r.id})">Chi Tiết</button>
                ${r.Status === 'PENDING' ? `
                  <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.72rem; color: #34D399;" onclick="updateRequestStatus(${r.id}, 'APPROVED')">Duyệt</button>
                  <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.72rem; color: #EF4444;" onclick="updateRequestStatus(${r.id}, 'REJECTED')">Hủy</button>
                ` : ''}
                ${r.Status === 'APPROVED' ? `
                  <button class="btn-primary" style="padding: 2px 8px; font-size: 0.72rem;" onclick="updateRequestStatus(${r.id}, 'ISSUED')">Xuất Kho</button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    if (mobileContainer) {
      mobileContainer.innerHTML = filteredRequests.map(r => {
        let statusBadge = '';
        if (r.Status === 'PENDING') {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3);">Chờ Duyệt</span>`;
        } else if (r.Status === 'APPROVED') {
          statusBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.3);">Đã Duyệt</span>`;
        } else if (r.Status === 'ISSUED') {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3);">Đã Xuất Kho</span>`;
        } else {
          statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3);">Từ Chối</span>`;
        }

        const isReqChecked = state.selectedRequestIds.has(r.id);
        const activeItems = (r.items || []).filter(it => !it.IsCancelled);
        const cancelledItems = (r.items || []).filter(it => it.IsCancelled);
        const itemsSummary = activeItems.slice(0, 3).map(it => `${it.ItemText} (${it.RequestedQty} ${it.Unit || 'Cái'})`).join(', ');
        const moreText = activeItems.length > 3 ? ` và +${activeItems.length - 3} món khác...` : '';
        const receivedPhotos = (r.items || []).filter(it => it.ReceivedPhotoUrl);

        return `
          <div class="req-card" style="border-left: 3px solid ${isReqChecked ? '#6366F1' : '#3B82F6'}; background: ${isReqChecked ? 'rgba(99, 102, 241, 0.08)' : 'rgba(31, 41, 55, 0.4)'};" onclick="openRequestDetail(${r.id})">
            <div class="req-card-header">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 0;" onclick="event.stopPropagation()">
                <input type="checkbox" class="inv-check" ${isReqChecked ? 'checked' : ''} onchange="toggleSelectRequest(${r.id}, this.checked)">
                <span class="req-card-code">${escapeHtml(r.RequestCode)}</span>
              </label>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="wh-badge" style="font-size: 0.68rem;">${escapeHtml(r.WHouseID || 'VT')}</span>
                ${statusBadge}
              </div>
            </div>

            <div class="req-card-purpose">${escapeHtml(r.Purpose || 'Xuất vật tư')}</div>

            <div class="req-card-meta">
              <span>👤 ${escapeHtml(r.RequestedBy || '-')}</span>
              <span>🏢 ${escapeHtml(r.Department || 'KỸ THUẬT')}</span>
              ${r.MachineID ? `<span style="color: #FBBF24;">⚙️ ${escapeHtml(r.MachineID)}</span>` : ''}
              <span style="margin-left: auto; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">${r.RequestDate || ''}</span>
            </div>

            <div class="req-card-items-preview">
              <strong>📦 ${activeItems.length} mặt hàng${cancelledItems.length > 0 ? ` (-${cancelledItems.length} hủy)` : ''}:</strong> ${escapeHtml(itemsSummary)}${moreText}
            </div>

            ${receivedPhotos.length > 0 ? `
              <div class="req-row-photos-strip" onclick="event.stopPropagation();" style="margin-bottom: 6px;">
                <span style="font-size: 0.68rem; color: #34D399; font-weight: 600;">📷 Ảnh xuất (${receivedPhotos.length}):</span>
                <div style="display: flex; gap: 6px; overflow-x: auto; padding: 2px 0;">
                  ${receivedPhotos.map(it => `
                    <div class="receipt-photo-thumb-wrap" style="width: 36px; height: 36px;" onclick="previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="${escapeHtml(it.ItemText || it.ItemID)} (Bấm để xem)">
                      <img src="${escapeHtml(it.ReceivedPhotoUrl)}" class="receipt-photo-thumb" alt="Ảnh vật tư" loading="lazy">
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <div class="req-card-footer">
              <span style="font-size: 0.72rem; color: #818CF8; font-weight: 600;">Xem chi tiết &amp; duyệt phiếu →</span>
              <div style="display: flex; gap: 4px;" onclick="event.stopPropagation();">
                ${r.Status === 'PENDING' ? `
                  <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.72rem; color: #34D399;" onclick="updateRequestStatus(${r.id}, 'APPROVED')">Duyệt</button>
                  <button class="btn-secondary" style="padding: 3px 8px; font-size: 0.72rem; color: #EF4444;" onclick="updateRequestStatus(${r.id}, 'REJECTED')">Hủy</button>
                ` : ''}
                ${r.Status === 'APPROVED' ? `
                  <button class="btn-primary" style="padding: 3px 10px; font-size: 0.72rem;" onclick="updateRequestStatus(${r.id}, 'ISSUED')">Xuất Kho</button>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    updateSelectedCounters();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: #EF4444;">Lỗi: ${err.message}</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: #EF4444;">Lỗi: ${err.message}</div>`;
  }
}

async function updateRequestStatus(id, newStatus) {
  const note = prompt(`Nhập ghi chú cho trạng thái ${newStatus} (tùy chọn):`, '');
  try {
    const res = await fetch(`/api/inventory/requests/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: newStatus, Notes: note || '' })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      await loadRequests();
      if (currentViewingRequest && currentViewingRequest.id === id) {
        openRequestDetail(id);
      }
    } else {
      alert(`Lỗi: ${data.detail || 'Không thể cập nhật'}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối: ${err.message}`);
  }
}

// 8.1 Chi Tiết Phiếu Yêu Cầu Xuất Kho (Full-Screen trên Mobile)
let currentViewingRequest = null;

function openRequestDetail(reqId) {
  const req = (state.requestsList || []).find(r => r.id === reqId);
  if (!req) return;
  currentViewingRequest = req;

  const modal = document.getElementById('requestDetailModal');
  if (!modal) return;

  document.getElementById('reqDetailCode').textContent = req.RequestCode;
  document.getElementById('reqDetailPurpose').textContent = req.Purpose;
  document.getElementById('reqDetailRequester').textContent = req.RequestedBy;
  document.getElementById('reqDetailDept').textContent = req.Department || 'KỸ THUẬT';
  document.getElementById('reqDetailWarehouse').textContent = req.WHouseID || 'Kho Vật Tư';
  document.getElementById('reqDetailDate').textContent = req.RequestDate || '-';

  // Machine badge
  const machineContainer = document.getElementById('reqDetailMachineBadge');
  if (machineContainer) {
    machineContainer.innerHTML = req.MachineID
      ? `<span style="font-size: 0.78rem; font-weight: 700; color: #FBBF24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 4px;">⚙️ Máy: ${escapeHtml(req.MachineID)}</span>`
      : '';
  }

  // Status badge
  let statusBadge = '';
  if (req.Status === 'PENDING') {
    statusBadge = `<span class="badge badge-status-pill" style="background: rgba(245, 158, 11, 0.18); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.35); padding: 5px 14px; font-size: 0.82rem; font-weight: 700; border-radius: 9999px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;">⏳ Chờ Duyệt</span>`;
  } else if (req.Status === 'APPROVED') {
    statusBadge = `<span class="badge badge-status-pill" style="background: rgba(59, 130, 246, 0.18); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.35); padding: 5px 14px; font-size: 0.82rem; font-weight: 700; border-radius: 9999px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;">✓ Đã Duyệt</span>`;
  } else if (req.Status === 'ISSUED') {
    statusBadge = `<span class="badge badge-status-pill" style="background: rgba(16, 185, 129, 0.18); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.35); padding: 5px 14px; font-size: 0.82rem; font-weight: 700; border-radius: 9999px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;">✅ Đã Xuất Kho</span>`;
  } else {
    statusBadge = `<span class="badge badge-status-pill" style="background: rgba(239, 68, 68, 0.18); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.35); padding: 5px 14px; font-size: 0.82rem; font-weight: 700; border-radius: 9999px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;">✕ Từ Chối</span>`;
  }
  const statusBadgeEl = document.getElementById('reqDetailStatusBadge');
  if (statusBadgeEl) statusBadgeEl.innerHTML = statusBadge;

  // Notes box
  const notesBox = document.getElementById('reqDetailNotesBox');
  const notesEl = document.getElementById('reqDetailNotes');
  if (notesBox && notesEl) {
    if (req.Notes) {
      notesBox.style.display = 'block';
      notesEl.textContent = req.Notes;
    } else {
      notesBox.style.display = 'none';
    }
  }

  // Action buttons
  const actionContainer = document.getElementById('reqDetailActionButtons');
  if (actionContainer) {
    let btnsHtml = '';
    if (req.Status === 'PENDING') {
      btnsHtml = `
        <button type="button" class="btn-primary" style="background: #10B981; padding: 6px 14px; font-size: 0.8rem;" onclick="handleDetailStatusAction(${req.id}, 'APPROVED')">✓ Duyệt Phiếu</button>
        <button type="button" class="btn-secondary" style="color: #EF4444; padding: 6px 14px; font-size: 0.8rem;" onclick="handleDetailStatusAction(${req.id}, 'REJECTED')">✕ Hủy / Từ Chối</button>
      `;
    } else if (req.Status === 'APPROVED') {
      btnsHtml = `
        <button type="button" class="btn-primary" style="background: #3B82F6; padding: 6px 16px; font-size: 0.8rem;" onclick="handleDetailStatusAction(${req.id}, 'ISSUED')">📦 Xác Nhận Xuất Kho</button>
      `;
    } else if (req.Status === 'ISSUED') {
      btnsHtml = `<span style="font-size: 0.82rem; color: #34D399; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">✓ Vật tư đã xuất kho hoàn tất</span>`;
    } else {
      btnsHtml = `<span style="font-size: 0.82rem; color: #EF4444; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">✕ Phiếu đã bị hủy</span>`;
    }
    actionContainer.innerHTML = btnsHtml;
  }

  // Header Action Slot (Rule 3: Popup Modal có nút Lưu / Hành động đặt ở Header)
  const headerActionSlot = document.getElementById('reqDetailHeaderActionSlot');
  if (headerActionSlot) {
    let headerBtnHtml = '';
    if (req.Status === 'PENDING') {
      headerBtnHtml = `
        <button type="button" class="btn-primary btn-header-save" style="background: #10B981 !important; border: 1px solid #34D399 !important;" onclick="handleDetailStatusAction(${req.id}, 'APPROVED')" title="Duyệt phiếu xuất kho">
          ✓ Duyệt
        </button>
      `;
    } else if (req.Status === 'APPROVED') {
      headerBtnHtml = `
        <button type="button" class="btn-primary btn-header-save" onclick="handleDetailStatusAction(${req.id}, 'ISSUED')" title="Xác nhận xuất kho">
          📦 Xuất Kho
        </button>
      `;
    }
    headerActionSlot.innerHTML = headerBtnHtml + `
      <button type="button" class="btn-clear desktop-only-close" onclick="closeRequestDetailModal()" style="font-size: 1.5rem; line-height: 1; padding: 2px 6px; cursor: pointer; color: var(--text-muted);">&times;</button>
    `;
  }

  const items = req.items || [];
  const countBadge = document.getElementById('reqDetailItemCountBadge');
  if (countBadge) countBadge.textContent = `${items.length} vật tư`;

  // Render items table for Desktop
  const tbody = document.getElementById('reqDetailItemsTableBody');
  if (tbody) {
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">Không có mặt hàng nào.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(it => {
        if (it.IsCancelled) {
          return `
            <tr style="background: rgba(239, 68, 68, 0.05); opacity: 0.8;">
              <td><span class="item-id-badge" style="background: rgba(239, 68, 68, 0.2); color: #FCA5A5; text-decoration: line-through; white-space: nowrap;">${escapeHtml(it.ItemID)}</span></td>
              <td>
                <div style="font-weight: 600; color: #F87171; text-decoration: line-through;">${escapeHtml(it.ItemText)}</div>
                ${it.ItemSpec ? `<div style="font-size: 0.72rem; color: var(--text-muted); text-decoration: line-through;">${escapeHtml(it.ItemSpec)}</div>` : ''}
                <div style="font-size: 0.7rem; color: #EF4444; margin-top: 2px;">❌ Hủy bởi: <strong>${escapeHtml(it.CancelledBy || 'Người tạo')}</strong> ${it.CancelReason ? `(${escapeHtml(it.CancelReason)})` : ''}</div>
              </td>
              <td>
                <span class="wh-badge" style="font-size: 0.65rem; white-space: nowrap;">${escapeHtml(it.WHouseID || req.WHouseID || 'VT')}</span>
              </td>
              <td style="text-align: right; font-weight: 700; color: #9CA3AF; text-decoration: line-through; font-size: 0.95rem; white-space: nowrap;">
                ${(it.RequestedQty || 0).toLocaleString()}
              </td>
              <td style="font-size: 0.78rem; color: var(--text-muted); text-align: center; white-space: nowrap;">${escapeHtml(it.Unit || 'Cái')}</td>
              <td>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.Remark || '-')}</div>
              </td>
              <td style="text-align: center; white-space: nowrap;">
                <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem; padding: 2px 6px;">❌ Đã Hủy</span>
                <div style="margin-top: 4px;">
                  <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 2px 8px; color: #60A5FA; border: 1px solid rgba(96, 165, 250, 0.3);" onclick="uncancelRequestItem(${it.id}, ${req.id})">↩ Khôi phục</button>
                </div>
              </td>
            </tr>
          `;
        }

        const canReceive = req.Status === 'APPROVED' || req.Status === 'ISSUED';
        let receiptHtml = '';
        if (it.IsReceived) {
          receiptHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span class="receipt-badge-received" style="white-space: nowrap;">✅ Đã Nhận</span>
              ${it.ReceivedPhotoUrl ? `
                <div class="receipt-photo-thumb-wrap" onclick="previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="Bấm để xem ảnh lớn">
                  <img src="${escapeHtml(it.ReceivedPhotoUrl)}" class="receipt-photo-thumb" alt="Ảnh nhận" loading="lazy">
                  <span class="receipt-photo-zoom-icon">🔍</span>
                </div>
              ` : ''}
              <div style="font-size: 0.68rem; color: var(--text-muted); white-space: nowrap;">${escapeHtml(it.ReceivedBy || '')}</div>
              <button type="button" class="btn-unreceive-link" onclick="unreceiveItem(${it.id})">Hủy nhận</button>
            </div>
          `;
        } else if (canReceive) {
          receiptHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <button type="button" class="btn-receive-action" style="white-space: nowrap;" onclick="openReceiveItemModal(${it.id}, '${escapeHtml(it.ItemID)}', '${escapeHtml(it.ItemText || '')}', '${it.RequestedQty} ${escapeHtml(it.Unit || 'Cái')}', '${escapeHtml(it.ReceivedPhotoUrl || '')}')">
                📸 Nhận Hàng
              </button>
              <button type="button" class="btn-secondary" style="font-size: 0.7rem; padding: 2px 8px; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); white-space: nowrap;" onclick="cancelRequestItem(${it.id}, '${escapeHtml(it.ItemText || it.ItemID)}', ${req.id})" title="Đánh dấu hủy mặt hàng này khỏi phiếu">
                ✕ Hủy món
              </button>
            </div>
          `;
        } else {
          receiptHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span class="receipt-badge-unreceived" style="font-size: 0.7rem; white-space: nowrap;">Chờ duyệt phiếu</span>
              <button type="button" class="btn-secondary" style="font-size: 0.7rem; padding: 2px 8px; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); white-space: nowrap;" onclick="cancelRequestItem(${it.id}, '${escapeHtml(it.ItemText || it.ItemID)}', ${req.id})" title="Đánh dấu hủy mặt hàng này khỏi phiếu">
                ✕ Hủy món
              </button>
            </div>
          `;
        }

        return `
          <tr>
            <td><span class="item-id-badge" style="white-space: nowrap; font-family: var(--font-mono); font-weight: 700;">${escapeHtml(it.ItemID)}</span></td>
            <td>
              <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(it.ItemText)}</div>
              ${it.ItemSpec ? `<div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(it.ItemSpec)}</div>` : ''}
            </td>
            <td>
              <span class="wh-badge" style="font-size: 0.65rem; white-space: nowrap;">${escapeHtml(it.WHouseID || req.WHouseID || 'VT')}</span>
              <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; white-space: nowrap;">📍 ${escapeHtml(it.StorageID || 'ZZZ')}</div>
            </td>
            <td style="text-align: right; font-weight: 700; color: var(--accent-primary, #6366F1); font-size: 0.95rem; white-space: nowrap;">
              ${(it.RequestedQty || 0).toLocaleString()}
            </td>
            <td style="font-size: 0.78rem; color: var(--text-secondary); text-align: center; white-space: nowrap;">${escapeHtml(it.Unit || 'Cái')}</td>
            <td>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(it.Remark || '-')}</div>
            </td>
            <td style="text-align: center;">
              ${receiptHtml}
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render items cards for Mobile
  const mobileContainer = document.getElementById('reqDetailItemsMobileCards');
  if (mobileContainer) {
    if (items.length === 0) {
      mobileContainer.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 8px;">Không có mặt hàng nào.</div>`;
    } else {
      mobileContainer.innerHTML = items.map(it => {
        if (it.IsCancelled) {
          return `
            <div class="req-detail-item-card" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; padding: 12px; opacity: 0.85;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <span class="item-id-badge" style="background: rgba(239, 68, 68, 0.2); color: #FCA5A5; text-decoration: line-through; font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; white-space: nowrap;">${escapeHtml(it.ItemID)}</span>
                <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem; padding: 2px 8px;">❌ Đã Hủy</span>
              </div>
              <div style="font-weight: 600; color: #F87171; text-decoration: line-through; font-size: 0.92rem;">${escapeHtml(it.ItemText)}</div>
              <div style="font-size: 0.72rem; color: #EF4444; margin-top: 4px;">❌ Hủy bởi: <strong>${escapeHtml(it.CancelledBy || 'Người tạo')}</strong> ${it.CancelReason ? `(${escapeHtml(it.CancelReason)})` : ''}</div>
              <div style="margin-top: 8px; display: flex; justify-content: flex-end;">
                <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 4px 10px; color: #60A5FA; border: 1px solid rgba(96, 165, 250, 0.3);" onclick="uncancelRequestItem(${it.id}, ${req.id})">↩ Khôi phục</button>
              </div>
            </div>
          `;
        }

        const canReceive = req.Status === 'APPROVED' || req.Status === 'ISSUED';
        let receiptHtmlMobile = '';
        if (it.IsReceived) {
          receiptHtmlMobile = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="receipt-badge-received" style="padding: 3px 10px; font-size: 0.75rem; white-space: nowrap;">✅ Đã Nhận</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.ReceivedBy || '')}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${it.ReceivedPhotoUrl ? `
                  <div class="receipt-photo-thumb-wrap" onclick="previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="Bấm xem ảnh" style="width: 32px; height: 32px;">
                    <img src="${escapeHtml(it.ReceivedPhotoUrl)}" class="receipt-photo-thumb" alt="Ảnh nhận" loading="lazy" style="width: 32px; height: 32px;">
                    <span class="receipt-photo-zoom-icon" style="font-size: 0.65rem;">🔍</span>
                  </div>
                ` : ''}
                <button type="button" class="btn-unreceive-link" onclick="unreceiveItem(${it.id})" style="font-size: 0.75rem;">Hủy nhận</button>
              </div>
            </div>
          `;
        } else if (canReceive) {
          receiptHtmlMobile = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
              <button type="button" class="btn-receive-action" style="flex: 1; padding: 8px 12px; font-size: 0.84rem; justify-content: center; white-space: nowrap;" onclick="openReceiveItemModal(${it.id}, '${escapeHtml(it.ItemID)}', '${escapeHtml(it.ItemText || '')}', '${it.RequestedQty} ${escapeHtml(it.Unit || 'Cái')}', '${escapeHtml(it.ReceivedPhotoUrl || '')}')">
                📸 Xác Nhận Đã Nhận Hàng
              </button>
              <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 7px 10px; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); white-space: nowrap;" onclick="cancelRequestItem(${it.id}, '${escapeHtml(it.ItemText || it.ItemID)}', ${req.id})" title="Hủy món này khỏi phiếu">
                ✕ Hủy
              </button>
            </div>
          `;
        } else {
          receiptHtmlMobile = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
              <span class="receipt-badge-unreceived" style="font-size: 0.75rem; padding: 3px 10px; white-space: nowrap;">Chờ xuất kho</span>
              <button type="button" class="btn-secondary" style="font-size: 0.72rem; padding: 4px 8px; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); white-space: nowrap;" onclick="cancelRequestItem(${it.id}, '${escapeHtml(it.ItemText || it.ItemID)}', ${req.id})" title="Hủy món này khỏi phiếu">
                ✕ Hủy
              </button>
            </div>
          `;
        }

        return `
          <div class="req-detail-item-card">
            <!-- Row 1: Code + Warehouse/Shelf + Quantity -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="item-id-badge" style="font-family: var(--font-mono); font-size: 0.88rem; font-weight: 700; color: #60A5FA; background: rgba(96,165,250,0.15); border: 1px solid rgba(96,165,250,0.3); padding: 2px 8px; border-radius: 4px; white-space: nowrap;">${escapeHtml(it.ItemID)}</span>
                <span class="wh-badge" style="font-size: 0.7rem; padding: 2px 6px; white-space: nowrap;">Kho ${escapeHtml(it.WHouseID || req.WHouseID || 'VT')} • Kệ ${escapeHtml(it.StorageID || 'ZZZ')}</span>
              </div>
              <div style="text-align: right; white-space: nowrap;">
                <span style="font-size: 1.15rem; font-weight: 800; color: #34D399; font-family: var(--font-mono);">${(it.RequestedQty || 0).toLocaleString()}</span>
                <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-left: 2px;">${escapeHtml(it.Unit || 'Cái')}</span>
              </div>
            </div>

            <!-- Row 2: Item Name & Spec -->
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); line-height: 1.35;">${escapeHtml(it.ItemText)}</div>
              ${it.ItemSpec ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Quy cách: ${escapeHtml(it.ItemSpec)}</div>` : ''}
            </div>

            <!-- Row 3: Remark if any -->
            ${(it.Remark || it.ItemRemark) ? `
              <div class="req-remark-tag" style="font-size: 0.76rem; color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; border-left: 3px solid #6366F1;">
                📝 ${escapeHtml(it.Remark || it.ItemRemark)}
              </div>
            ` : ''}

            <!-- Row 4: Receipt action -->
            <div style="margin-top: 4px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
              ${receiptHtmlMobile}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  modal.classList.add('open', 'active');
  try { history.pushState({ modal: 'reqDetail', id: reqId }, ''); } catch (e) {}
}

function closeRequestDetailModal() {
  const modal = document.getElementById('requestDetailModal');
  if (modal) modal.classList.remove('open', 'active');
  currentViewingRequest = null;
}

async function handleDetailStatusAction(id, status) {
  await updateRequestStatus(id, status);
}

function copyReqCode() {
  const codeEl = document.getElementById('reqDetailCode');
  const code = codeEl ? codeEl.textContent.trim() : '';
  if (!code) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code).then(() => {
      alert(`Đã sao chép mã phiếu: ${code}`);
    }).catch(() => fallbackCopy(code));
  } else {
    fallbackCopy(code);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    alert(`Đã sao chép mã phiếu: ${text}`);
  } catch (e) {
    prompt('Sao chép mã phiếu:', text);
  }
  document.body.removeChild(ta);
}

// 9. Modal Tạo Yêu Cầu Xuất Kho & Tìm Kiếm Vật Tư
let reqSearchDebounceTimer = null;
let reqSearchResultsData = [];

function setupReqItemSearch() {
  const searchInput = document.getElementById('reqItemSearchInput');
  const resultsBox = document.getElementById('reqItemSearchResults');
  if (!searchInput || !resultsBox) return;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(reqSearchDebounceTimer);
    const query = e.target.value.trim();
    if (query.length < 1) {
      resultsBox.style.display = 'none';
      resultsBox.innerHTML = '';
      return;
    }

    reqSearchDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory/items?q=${encodeURIComponent(query)}&limit=15`);
        if (!res.ok) return;
        const data = await res.json();
        reqSearchResultsData = data.items || [];
        renderReqSearchResults(reqSearchResultsData);
      } catch (err) {
        console.error('Lỗi tìm kiếm vật tư:', err);
      }
    }, 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (reqSearchResultsData && reqSearchResultsData.length > 0) {
        selectItemForRequest(0, e);
      }
      return false;
    }
    if (e.key === 'Escape') {
      resultsBox.style.display = 'none';
    }
  });

  // Đóng dropdown tìm kiếm khi bấm ra ngoài
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsBox.contains(e.target)) {
      resultsBox.style.display = 'none';
    }
  });
}

function renderReqSearchResults(items) {
  const resultsBox = document.getElementById('reqItemSearchResults');
  if (!resultsBox) return;

  if (items.length === 0) {
    resultsBox.innerHTML = `
      <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
        Không tìm thấy vật tư nào khớp với từ khóa.
      </div>
    `;
    resultsBox.style.display = 'block';
    return;
  }

  resultsBox.innerHTML = items.map((it, idx) => {
    const stock = parseFloat(it.CurrentStock || 0);
    const stockColor = stock > 0 ? '#34D399' : '#EF4444';
    return `
      <div class="req-search-item" 
           onpointerdown="event.preventDefault();" 
           onclick="selectItemForRequest(${idx}, event)">
        <div style="min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="item-id-badge" style="font-size: 0.72rem; padding: 2px 6px;">${escapeHtml(it.ItemID)}</span>
            <span style="font-weight: 600; color: var(--text-primary); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(it.ItemText)}</span>
          </div>
          ${it.ItemSpec ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(it.ItemSpec)}</div>` : ''}
        </div>
        <div style="text-align: right; white-space: nowrap; flex-shrink: 0;">
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            <span class="wh-badge" style="font-size: 0.65rem; padding: 1px 5px;">${escapeHtml(it.WHouseID)}</span>
            <span class="storage-tag" style="font-size: 0.65rem; padding: 1px 5px;">📍 ${escapeHtml(it.StorageID || 'ZZZ')}</span>
          </div>
          <div style="font-size: 0.75rem; font-weight: 700; color: ${stockColor}; margin-top: 2px;">
            Tồn: ${stock.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})} ${escapeHtml(it.Unit || 'Cái')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  resultsBox.style.display = 'block';
}

function selectItemForRequest(idx, event) {
  if (event) {
    try {
      event.preventDefault();
      event.stopPropagation();
    } catch (e) {}
  }

  const item = reqSearchResultsData[idx];
  if (!item) return;

  // Kiểm tra vật tư đã có trong danh sách hay chưa
  const existingRows = document.querySelectorAll('.req-item-row');
  let duplicateFound = false;
  for (const row of existingRows) {
    const idInput = row.querySelector('.item-id-input');
    const storageInput = row.querySelector('.item-storage-input');
    const currentId = idInput ? idInput.value.trim() : '';
    const currentStorage = storageInput ? storageInput.value.trim() : '';

    if (currentId === item.ItemID && currentStorage === (item.StorageID || 'ZZZ')) {
      const qtyInput = row.querySelector('.item-qty-input');
      if (qtyInput) {
        qtyInput.value = (parseFloat(qtyInput.value) || 0) + 1;
        if (window.innerWidth >= 768) {
          qtyInput.focus();
          qtyInput.select();
        }
      }
      duplicateFound = true;
      break;
    }
  }

  if (!duplicateFound) {
    addRequestItemRow(item);
  }

  const resultsBox = document.getElementById('reqItemSearchResults');
  const searchInput = document.getElementById('reqItemSearchInput');
  if (resultsBox) resultsBox.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    // Trên điện thoại, trì hoãn blur 120ms để ngón tay kịp nhấc khỏi màn hình
    // tránh hiện tượng co bàn phím đột ngột tạo độ lệch swipe 400px gây kích hoạt pull-to-refresh
    if (window.innerWidth < 768) {
      setTimeout(() => {
        try { searchInput.blur(); } catch (e) {}
      }, 120);
    } else {
      searchInput.focus();
    }
  }
}

function openCreateRequestModal(preselectedItem = null) {
  const modal = document.getElementById('createRequestModal');
  if (!modal) return;

  // Reset ô tìm kiếm
  const searchInput = document.getElementById('reqItemSearchInput');
  const resultsBox = document.getElementById('reqItemSearchResults');
  if (searchInput) searchInput.value = '';
  if (resultsBox) {
    resultsBox.innerHTML = '';
    resultsBox.style.display = 'none';
  }

  // Điền người yêu cầu từ user đăng nhập
  const reqInput = document.getElementById('reqRequester');
  if (reqInput && state.currentUser) {
    reqInput.value = state.currentUser.full_name || '';
  }

  const purposeInput = document.getElementById('reqPurpose');
  if (purposeInput && !purposeInput.value) {
    purposeInput.value = 'Xuất sử dụng bảo trì kỹ thuật';
  }

  const container = document.getElementById('requestItemsContainer');
  if (container) {
    container.innerHTML = '';
    if (preselectedItem) {
      addRequestItemRow(preselectedItem);
    } else {
      checkEmptyItemsHint();
    }
  }

  modal.classList.add('open', 'active');
  try { history.pushState({ modal: 'createRequest' }, ''); } catch (e) {}
  if (!preselectedItem && searchInput && window.innerWidth >= 768) {
    setTimeout(() => searchInput.focus(), 150);
  }
}

function closeCreateRequestModal() {
  const modal = document.getElementById('createRequestModal');
  if (modal) modal.classList.remove('open', 'active');
}

function quickRequestItem(it) {
  openCreateRequestModal(it);
}

function checkEmptyItemsHint() {
  const container = document.getElementById('requestItemsContainer');
  if (!container) return;
  if (container.querySelectorAll('.req-item-row').length === 0) {
    container.innerHTML = `
      <div id="reqEmptyItemsHint" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
        🔍 Chưa có vật tư nào trong phiếu. Hãy gõ vào ô tìm kiếm ở trên hoặc nhấn <strong style="color: #A5B4FC;">"+ Thêm Dòng Thủ Công"</strong>.
      </div>
    `;
  }
}

function addRequestItemRow(item = null) {
  const container = document.getElementById('requestItemsContainer');
  if (!container) return;

  const emptyHint = document.getElementById('reqEmptyItemsHint');
  if (emptyHint) emptyHint.remove();

  const stock = item ? parseFloat(item.CurrentStock || 0) : null;
  const stockDisplay = stock !== null
    ? `<span style="font-weight: 700; color: ${stock > 0 ? '#34D399' : '#EF4444'}; font-size: 0.85rem;">${stock.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>`
    : `<span style="color: var(--text-muted); font-size: 0.75rem;">--</span>`;

  const div = document.createElement('div');
  div.className = 'req-item-row';

  if (item) {
    div.innerHTML = `
      <!-- Hàng 1: Mã + Tên Vật tư -->
      <div class="req-row-h1">
        <span class="req-item-code-badge">${escapeHtml(item.ItemID)}</span>
        <span class="req-item-name" title="${escapeHtml(item.ItemText)}">${escapeHtml(item.ItemText)}</span>
        <input type="hidden" class="item-id-input" value="${escapeHtml(item.ItemID)}">
        <input type="hidden" class="item-name-input" value="${escapeHtml(item.ItemText)}">
        <input type="hidden" class="item-wh-input" value="${escapeHtml(item.WHouseID || '')}">
        <input type="hidden" class="item-storage-input" value="${escapeHtml(item.StorageID || 'ZZZ')}">
      </div>

      <!-- Hàng 2: Mã kho, vị trí, số lượng tồn, số lượng xuất, đơn vị -->
      <div class="req-row-h2">
        <div class="req-h2-loc">
          <span class="wh-badge" style="font-size: 0.7rem; padding: 2px 5px;">${escapeHtml(item.WHouseID || 'VT')}</span>
          <span class="storage-badge" style="font-size: 0.72rem; padding: 2px 5px; border-radius: 4px;">📍 ${escapeHtml(item.StorageID || 'ZZZ')}</span>
        </div>
        <div class="req-h2-stock">
          <span class="req-lbl-xs">Tồn:</span>
          ${stockDisplay}
        </div>
        <div class="req-h2-qty">
          <span class="req-lbl-xs">Xuất:</span>
          <input type="number" step="any" min="0.01" class="form-input item-qty-input" value="1" required autocomplete="off" title="Số lượng xuất">
        </div>
        <div class="req-h2-unit">
          <input type="text" class="form-input item-unit-input" value="${escapeHtml(item.Unit || 'Cái')}" autocomplete="off" title="Đơn vị tính">
        </div>
      </div>

      <!-- Hàng 3: Mục đích và dấu xoá -->
      <div class="req-row-h3">
        <input type="text" class="form-input item-remark-input" 
          placeholder="Mục đích sử dụng cho vật tư này (tùy chọn)..." 
          value="${escapeHtml(item.Remark || '')}" autocomplete="off">
        <button type="button" class="btn-remove-req-item" title="Xóa vật tư này" onclick="removeRequestItemRow(this)">
          &times;
        </button>
      </div>
    `;
  } else {
    div.className = 'req-item-row req-item-row-manual';
    div.innerHTML = `
      <!-- Hàng 1: Mã + Tên Vật tư (Thủ công) -->
      <div class="req-row-h1">
        <div style="display: flex; gap: 6px; width: 100%; align-items: center;">
          <input type="text" class="form-input item-id-input" placeholder="Mã VT (nếu có)" style="width: 105px; font-size: 0.78rem; font-family: var(--font-mono, monospace); padding: 4px 6px; height: 32px;" autocomplete="off">
          <input type="text" class="form-input item-name-input" placeholder="Nhập tên vật tư cần xuất *" required style="flex: 1; min-width: 0; font-size: 0.85rem; font-weight: 600; padding: 4px 8px; height: 32px;" autocomplete="off">
        </div>
        <input type="hidden" class="item-wh-input" value="VT">
      </div>

      <!-- Hàng 2: Mã kho, vị trí, số lượng tồn, số lượng xuất, đơn vị -->
      <div class="req-row-h2">
        <div class="req-h2-loc">
          <span class="wh-badge" style="font-size: 0.7rem; padding: 2px 5px;">VT</span>
          <input type="text" class="form-input item-storage-input" placeholder="Kệ/Vị trí" value="ZZZ" style="width: 58px; font-size: 0.75rem; text-align: center; height: 30px; padding: 2px 4px;" autocomplete="off" title="Kệ / Vị trí">
        </div>
        <div class="req-h2-stock">
          <span class="req-lbl-xs">Tồn:</span>
          <span style="color: var(--text-muted); font-size: 0.8rem;">--</span>
        </div>
        <div class="req-h2-qty">
          <span class="req-lbl-xs">Xuất:</span>
          <input type="number" step="any" min="0.01" class="form-input item-qty-input" value="1" required autocomplete="off" title="Số lượng xuất">
        </div>
        <div class="req-h2-unit">
          <input type="text" class="form-input item-unit-input" value="Cái" autocomplete="off" title="Đơn vị tính">
        </div>
      </div>

      <!-- Hàng 3: Mục đích và dấu xoá -->
      <div class="req-row-h3">
        <input type="text" class="form-input item-remark-input" 
          placeholder="Mục đích sử dụng cho vật tư này (tùy chọn)..." 
          value="" autocomplete="off">
        <button type="button" class="btn-remove-req-item" title="Xóa vật tư này" onclick="removeRequestItemRow(this)">
          &times;
        </button>
      </div>
    `;
  }

  container.appendChild(div);

  // Chỉ tự động focus trên màn hình máy tính để không làm giật viewport hoặc mở bàn phím ảo che khuất trên mobile
  if (window.innerWidth >= 768) {
    if (item) {
      const qtyInput = div.querySelector('.item-qty-input');
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    } else {
      const nameInput = div.querySelector('.item-name-input');
      if (nameInput) {
        nameInput.focus();
      }
    }
  }
}

function addManualRequestItemRow() {
  addRequestItemRow(null);
}

function removeRequestItemRow(btn) {
  const row = btn.closest('.req-item-row');
  if (row) row.remove();
  checkEmptyItemsHint();
}

async function submitCreateRequest(event) {
  event.preventDefault();
  const requester = (document.getElementById('reqRequester')?.value || '').trim();
  const department = (document.getElementById('reqDepartment')?.value || 'PHÒNG KỸ THUẬT').trim();
  const purpose = (document.getElementById('reqPurpose')?.value || 'Xuất sử dụng bảo trì kỹ thuật').trim();
  const notes = (document.getElementById('reqNotes')?.value || '').trim();

  const itemRows = document.querySelectorAll('.req-item-row');
  if (itemRows.length === 0) {
    alert('Vui lòng tìm kiếm và chọn ít nhất 1 mặt hàng cần xuất.');
    document.getElementById('reqItemSearchInput')?.focus();
    return;
  }

  const items = [];
  let firstWh = '';

  for (const row of itemRows) {
    const idInput = row.querySelector('.item-id-input');
    const nameInput = row.querySelector('.item-name-input');
    const remarkInput = row.querySelector('.item-remark-input');
    const storageInput = row.querySelector('.item-storage-input');
    const whInput = row.querySelector('.item-wh-input');
    const unitInput = row.querySelector('.item-unit-input');
    const qtyInput = row.querySelector('.item-qty-input');

    const id = idInput ? idInput.value.trim() : '';
    const text = nameInput ? nameInput.value.trim() : '';
    const remark = remarkInput ? remarkInput.value.trim() : '';
    const storage = storageInput ? storageInput.value.trim() : 'ZZZ';
    const wh = whInput ? whInput.value.trim() : '';
    const unit = unitInput ? unitInput.value.trim() : 'Cái';
    const qty = parseFloat(qtyInput ? qtyInput.value : 0);

    if (!id && !text) continue;

    if (isNaN(qty) || qty <= 0) {
      alert(`Vui lòng nhập số lượng xuất hợp lệ (> 0) cho: ${text || id}`);
      if (qtyInput) qtyInput.focus();
      return;
    }

    if (!firstWh && wh) {
      firstWh = wh;
    }

    items.push({
      ItemID: id || 'VT-CUSTOM',
      ItemText: text || id,
      WHouseID: wh || '',
      StorageID: storage || 'ZZZ',
      Unit: unit || 'Cái',
      RequestedQty: qty,
      Remark: remark
    });
  }

  if (items.length === 0) {
    alert('Vui lòng nhập đầy đủ thông tin tên vật tư và số lượng xuất > 0.');
    return;
  }

  const payload = {
    RequestedBy: requester || (state.currentUser?.full_name || 'Kỹ thuật viên'),
    Department: department || 'PHÒNG KỸ THUẬT',
    WHouseID: firstWh || 'VT',
    Purpose: purpose || 'Xuất sử dụng bảo trì kỹ thuật',
    MachineID: '',
    Notes: notes,
    Items: items
  };

  const btn = document.getElementById('btnSubmitRequest');
  const headerBtn = document.getElementById('btnHeaderSaveRequest');
  if (btn) btn.disabled = true;
  if (headerBtn) headerBtn.disabled = true;

  try {
    const res = await fetch('/api/inventory/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      alert(data.message);
      closeCreateRequestModal();
      switchInvMode('requests');
      loadRequests();
    } else {
      alert(`Lỗi tạo phiếu: ${data.detail || 'Không xác định'}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    if (headerBtn) headerBtn.disabled = false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =========================================================================
// SYSTEM LOGO APP LAUNCHER MENU
// =========================================================================
function toggleSystemAppMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('systemAppMenu');
  const trigger = document.getElementById('brandMenuTrigger');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  if (isOpen) {
    closeSystemAppMenu();
  } else {
    menu.classList.add('open');
    if (trigger) trigger.classList.add('active');
  }
}

function closeSystemAppMenu() {
  const menu = document.getElementById('systemAppMenu');
  const trigger = document.getElementById('brandMenuTrigger');
  if (menu) menu.classList.remove('open');
  if (trigger) trigger.classList.remove('active');
}

// Đóng menu khi click ra ngoài
document.addEventListener('click', (e) => {
  const menu = document.getElementById('systemAppMenu');
  const trigger = document.getElementById('brandMenuTrigger');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
      closeSystemAppMenu();
    }
  }
});

// Đóng menu khi bấm phím Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSystemAppMenu();
    closeCreateRequestModal();
    closeRequestDetailModal();
  }
});

// =========================================================================
// 8B. DANH SÁCH CHI TIẾT TẤT CẢ VẬT TƯ CẦN XUẤT (ALL ITEMS TABLE) & EXCEL
// =========================================================================

async function loadIssueItems(silent = false) {
  const tbody = document.getElementById('allIssueItemsTableBody');
  const mobileContainer = document.getElementById('allIssueItemsMobileCards');

  if (!silent) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 25px; color: var(--text-muted);">Đang tải danh sách vật tư cần xuất...</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 25px; color: var(--text-muted);">Đang tải danh sách vật tư...</div>`;
  }

  try {
    const url = `/api/inventory/issue-items?voucher_filter=${state.voucherFilter}&receipt_filter=${state.receiptFilter || 'all'}&whouse_id=${state.currentWarehouse || 'all'}&search=${encodeURIComponent(state.searchQuery || '')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Không thể tải danh sách vật tư xuất');
    const data = await res.json();
    const items = data.items || [];
    state.allIssueItemsList = items;

    // Cập nhật số đếm trên badge
    const badge = document.getElementById('subItemsBadge');
    if (badge) badge.textContent = items.length.toString();

    // Đồng bộ checkbox Select All All-Items
    const chkAll = document.getElementById('chkSelectAllIssueItems');
    if (chkAll) {
      chkAll.checked = items.length > 0 && items.every(it => state.selectedIssueItemIds.has(it.item_id));
    }

    if (silent) return;

    if (items.length === 0) {
      const msg = state.voucherFilter === 'unassigned'
        ? 'Tất cả vật tư đều đã được tạo phiếu xuất ERP.'
        : 'Không có vật tư nào phù hợp với bộ lọc.';
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: var(--text-muted);">${msg}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">${msg}</div>`;
      updateSelectedCounters();
      return;
    }

    if (tbody) {
      tbody.innerHTML = items.map(it => {
        const isCancelled = !!it.IsCancelled;
        const isChecked = !isCancelled && state.selectedIssueItemIds.has(it.item_id);
        const voucherBadge = isCancelled
          ? `<span class="voucher-badge" style="background: rgba(239,68,68,0.12); color: #FCA5A5;">Đã hủy</span>`
          : (it.VoucherCode 
              ? `<span class="voucher-badge">📋 ${escapeHtml(it.VoucherCode)}</span>`
              : `<span class="voucher-badge unassigned">Chưa tạo phiếu</span>`);
        const purposeText = it.ItemRemark || it.RequestPurpose || '-';
        const machineText = it.MachineID ? `<span style="font-size: 0.72rem; color: #FBBF24; margin-left: 4px;">[Máy: ${escapeHtml(it.MachineID)}]</span>` : '';

        let receiptColHtml = '';
        if (isCancelled) {
          receiptColHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 3px;">
              <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.72rem;">❌ Đã Hủy</span>
              <div style="font-size: 0.68rem; color: #EF4444;">${escapeHtml(it.CancelledBy || 'Người tạo')}</div>
            </div>
          `;
        } else if (it.IsReceived) {
          receiptColHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <span class="receipt-badge-received">✅ Đã Nhận</span>
              ${it.ReceivedPhotoUrl ? `
                <div class="receipt-photo-thumb-wrap" onclick="previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="Bấm để xem ảnh lớn">
                  <img src="${escapeHtml(it.ReceivedPhotoUrl)}" class="receipt-photo-thumb" alt="Ảnh nhận" loading="lazy">
                  <span class="receipt-photo-zoom-icon">🔍</span>
                </div>
              ` : ''}
              <div style="font-size: 0.68rem; color: var(--text-muted);">${escapeHtml(it.ReceivedBy || '')}</div>
              <button type="button" class="btn-unreceive-link" onclick="unreceiveItem(${it.item_id})">Hủy nhận</button>
            </div>
          `;
        } else {
          receiptColHtml = `
            <button type="button" class="btn-receive-action" onclick="openReceiveItemModal(${it.item_id}, '${escapeHtml(it.ItemID)}', '${escapeHtml(it.ItemText || '')}', '${it.RequestedQty} ${escapeHtml(it.Unit || 'Cái')}', '${escapeHtml(it.ReceivedPhotoUrl || '')}')">
              📸 Nhận Hàng
            </button>
          `;
        }

        let actionColHtml = '';
        if (isCancelled) {
          actionColHtml = `
            <button class="btn-secondary" style="padding: 2px 7px; font-size: 0.72rem; color: #60A5FA; border: 1px solid rgba(96, 165, 250, 0.3);" onclick="uncancelRequestItem(${it.item_id}, ${it.RequestID})" title="Khôi phục lại mặt hàng này">
              ↩ Khôi phục
            </button>
          `;
        } else {
          actionColHtml = `
            <div style="display: flex; gap: 3px; justify-content: center; align-items: center;">
              <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.72rem;" onclick="quickEditVoucher(${it.item_id}, '${escapeHtml(it.VoucherCode || '')}')" title="Gán hoặc sửa mã đơn ERP">
                ${it.VoucherCode ? 'Sửa' : '+ Đơn'}
              </button>
              ${!it.IsReceived ? `
                <button class="btn-secondary" style="padding: 2px 6px; font-size: 0.72rem; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3);" onclick="cancelRequestItem(${it.item_id}, '${escapeHtml(it.ItemText)}', ${it.RequestID})" title="Hủy món này">
                  ✕
                </button>
              ` : ''}
            </div>
          `;
        }

        return `
          <tr style="background: ${isCancelled ? 'rgba(239, 68, 68, 0.04)' : (isChecked ? 'rgba(99, 102, 241, 0.08)' : 'transparent')}; opacity: ${isCancelled ? '0.75' : '1'};">
            <td style="text-align: center;">
              <input type="checkbox" class="inv-check" ${isChecked ? 'checked' : ''} ${isCancelled ? 'disabled title="Mặt hàng đã hủy"' : `onchange="toggleSelectIssueItem(${it.item_id}, this.checked)"`}>
            </td>
            <td>
              <span class="item-id-badge" style="${isCancelled ? 'text-decoration: line-through; background: rgba(239,68,68,0.2); color: #FCA5A5;' : ''}">${escapeHtml(it.ItemID)}</span>
              ${it.StorageID && it.StorageID !== 'ZZZ' ? `<div style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">Kệ: ${escapeHtml(it.StorageID)}</div>` : ''}
            </td>
            <td>
              <div style="font-weight: 600; line-height: 1.3; ${isCancelled ? 'text-decoration: line-through; color: #F87171;' : ''}">${escapeHtml(it.ItemText)}</div>
              ${isCancelled ? `<div style="font-size: 0.7rem; color: #EF4444; margin-top: 1px;">❌ Đã hủy ${it.CancelReason ? `(${escapeHtml(it.CancelReason)})` : ''}</div>` : ''}
            </td>
            <td style="text-align: center;">
              <span class="wh-badge">${escapeHtml(it.ItemWHouseID || it.RequestWHouseID || 'VT')}</span>
            </td>
            <td style="text-align: right; white-space: nowrap;">
              <span class="stock-qty-val positive" style="${isCancelled ? 'text-decoration: line-through; color: #9CA3AF;' : ''}">${it.RequestedQty}</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.Unit || 'Cái')}</span>
            </td>
            <td>
              <div style="font-size: 0.8rem; color: var(--text-secondary); max-width: 230px; white-space: normal;">
                ${escapeHtml(purposeText)} ${machineText}
              </div>
            </td>
            <td>
              <div style="font-weight: 600; color: #60A5FA; font-size: 0.78rem; cursor: pointer;" onclick="openRequestDetail(${it.RequestID})">
                ${escapeHtml(it.RequestCode)}
              </div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">
                ${it.RequestDate || ''} • ${escapeHtml(it.RequestedBy || '')}
              </div>
            </td>
            <td style="text-align: center;">
              ${voucherBadge}
            </td>
            <td style="text-align: center;">
              ${receiptColHtml}
            </td>
            <td style="text-align: center;">
              ${actionColHtml}
            </td>
          </tr>
        `;
      }).join('');
    }

    if (mobileContainer) {
      mobileContainer.innerHTML = items.map(it => {
        const isCancelled = !!it.IsCancelled;
        const isChecked = !isCancelled && state.selectedIssueItemIds.has(it.item_id);
        const voucherBadge = isCancelled
          ? `<span class="voucher-badge" style="background: rgba(239,68,68,0.12); color: #FCA5A5;">Đã hủy</span>`
          : (it.VoucherCode 
              ? `<span class="voucher-badge">📋 ${escapeHtml(it.VoucherCode)}</span>`
              : `<span class="voucher-badge unassigned">Chưa tạo phiếu</span>`);
        const purposeText = it.ItemRemark || it.RequestPurpose || '-';

        return `
          <div class="req-card" style="border-left: 3px solid ${isCancelled ? '#EF4444' : (isChecked ? '#6366F1' : '#3B82F6')}; background: ${isCancelled ? 'rgba(239, 68, 68, 0.05)' : (isChecked ? 'rgba(99, 102, 241, 0.08)' : 'rgba(31, 41, 55, 0.4)')}; opacity: ${isCancelled ? '0.78' : '1'}; margin-bottom: 6px; padding: 8px 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; margin-bottom: 0;">
                <input type="checkbox" class="inv-check" ${isChecked ? 'checked' : ''} ${isCancelled ? 'disabled' : `onchange="toggleSelectIssueItem(${it.item_id}, this.checked)"`}>
                <span class="item-id-badge" style="font-size: 0.8rem; ${isCancelled ? 'text-decoration: line-through; background: rgba(239,68,68,0.2); color: #FCA5A5;' : ''}">${escapeHtml(it.ItemID)}</span>
              </label>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="wh-badge" style="font-size: 0.68rem;">${escapeHtml(it.ItemWHouseID || it.RequestWHouseID || 'VT')}</span>
                ${voucherBadge}
              </div>
            </div>

            <div style="font-weight: 600; font-size: 0.82rem; margin-bottom: 4px; line-height: 1.3; ${isCancelled ? 'text-decoration: line-through; color: #F87171;' : ''}">
              ${escapeHtml(it.ItemText)}
            </div>
            ${isCancelled ? `<div style="font-size: 0.72rem; color: #EF4444; margin-bottom: 4px;">❌ Đã hủy bởi ${escapeHtml(it.CancelledBy || 'Người tạo')} ${it.CancelReason ? `(${escapeHtml(it.CancelReason)})` : ''}</div>` : ''}

            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.76rem; color: var(--text-muted); margin-bottom: 6px;">
              <span>SL: <strong class="stock-qty-val positive" style="font-size: 0.88rem; ${isCancelled ? 'text-decoration: line-through;' : ''}">${it.RequestedQty}</strong> ${escapeHtml(it.Unit || 'Cái')}</span>
              <span>Phiếu: <strong style="color: #60A5FA; cursor: pointer;" onclick="openRequestDetail(${it.RequestID})">${escapeHtml(it.RequestCode)}</strong> (${escapeHtml(it.RequestedBy || '')})</span>
            </div>

            <div style="font-size: 0.74rem; color: var(--text-secondary); background: rgba(0,0,0,0.2); padding: 5px 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                ${it.IsReceived && it.ReceivedPhotoUrl ? `
                  <div class="receipt-photo-thumb-wrap" style="width: 36px; height: 36px;" onclick="previewReceiptPhoto('${escapeHtml(it.ReceivedPhotoUrl)}', '${escapeHtml(it.ItemText || it.ItemID)}')" title="Bấm để xem ảnh">
                    <img src="${escapeHtml(it.ReceivedPhotoUrl)}" class="receipt-photo-thumb" alt="Ảnh nhận" loading="lazy">
                    <span class="receipt-photo-zoom-icon">🔍</span>
                  </div>
                ` : ''}
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">📝 ${escapeHtml(purposeText)}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                ${isCancelled ? `
                  <button class="btn-secondary" style="padding: 2px 7px; font-size: 0.68rem; color: #60A5FA; border: 1px solid rgba(96, 165, 250, 0.3);" onclick="uncancelRequestItem(${it.item_id}, ${it.RequestID})">
                    ↩ Khôi phục
                  </button>
                ` : (it.IsReceived ? `
                  <span class="receipt-badge-received" style="font-size: 0.68rem; padding: 2px 6px;">✅ Đã nhận</span>
                  <button class="btn-secondary" style="padding: 1px 6px; font-size: 0.68rem;" onclick="quickEditVoucher(${it.item_id}, '${escapeHtml(it.VoucherCode || '')}')">
                    ${it.VoucherCode ? 'Sửa đơn' : '+ Đơn'}
                  </button>
                ` : `
                  <button type="button" class="btn-receive-action" style="font-size: 0.68rem; padding: 2px 6px;" onclick="openReceiveItemModal(${it.item_id}, '${escapeHtml(it.ItemID)}', '${escapeHtml(it.ItemText || '')}', '${it.RequestedQty} ${escapeHtml(it.Unit || 'Cái')}', '${escapeHtml(it.ReceivedPhotoUrl || '')}')">
                    📸 Nhận
                  </button>
                  <button class="btn-secondary" style="padding: 1px 6px; font-size: 0.68rem;" onclick="quickEditVoucher(${it.item_id}, '${escapeHtml(it.VoucherCode || '')}')">
                    ${it.VoucherCode ? 'Sửa đơn' : '+ Đơn'}
                  </button>
                  <button class="btn-secondary" style="padding: 1px 6px; font-size: 0.68rem; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3);" onclick="cancelRequestItem(${it.item_id}, '${escapeHtml(it.ItemText)}', ${it.RequestID})" title="Hủy món">
                    ✕
                  </button>
                `)}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    updateSelectedCounters();
  } catch (err) {
    if (!silent) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: #EF4444;">Lỗi: ${err.message}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: #EF4444;">Lỗi: ${err.message}</div>`;
    }
  }
}

// Xử lý chọn/bỏ chọn checkbox vật tư
function toggleSelectIssueItem(itemId, checked) {
  if (checked) {
    state.selectedIssueItemIds.add(itemId);
  } else {
    state.selectedIssueItemIds.delete(itemId);
  }
  updateSelectedCounters();
}

function toggleSelectAllIssueItems(checked) {
  (state.allIssueItemsList || []).forEach(it => {
    if (it.IsCancelled) return;
    if (checked) {
      state.selectedIssueItemIds.add(it.item_id);
    } else {
      state.selectedIssueItemIds.delete(it.item_id);
    }
  });
  updateSelectedCounters();
  document.querySelectorAll('#allIssueItemsTableBody input[type="checkbox"]:not(:disabled)').forEach(chk => {
    chk.checked = checked;
  });
  document.querySelectorAll('#allIssueItemsMobileCards input[type="checkbox"]:not(:disabled)').forEach(chk => {
    chk.checked = checked;
  });
}

// Xử lý chọn/bỏ chọn checkbox cả phiếu yêu cầu
function toggleSelectRequest(reqId, checked) {
  if (checked) {
    state.selectedRequestIds.add(reqId);
  } else {
    state.selectedRequestIds.delete(reqId);
  }

  // Tự động chọn/bỏ chọn items thuộc phiếu này THỎA MÃN BỘ LỌC HIỆN TẠI VÀ CHƯA BỊ HỦY
  const req = (state.requestsList || []).find(r => r.id === reqId);
  if (req && req.items) {
    req.items.forEach(it => {
      if (it.IsCancelled) {
        state.selectedIssueItemIds.delete(it.id);
        return;
      }

      let matchesReceipt = true;
      if (state.receiptFilter === 'unreceived') matchesReceipt = !it.IsReceived || it.IsReceived === 0;
      else if (state.receiptFilter === 'received') matchesReceipt = it.IsReceived == 1 || it.IsReceived === true;

      let matchesVoucher = true;
      if (state.voucherFilter === 'unassigned') matchesVoucher = !it.VoucherCode || it.VoucherCode.trim() === '';
      else if (state.voucherFilter === 'assigned') matchesVoucher = !!(it.VoucherCode && it.VoucherCode.trim() !== '');

      if (checked && matchesReceipt && matchesVoucher) {
        state.selectedIssueItemIds.add(it.id);
      } else {
        state.selectedIssueItemIds.delete(it.id);
      }
    });
  }
  updateSelectedCounters();
}

function toggleSelectAllRequests(checked) {
  const reqList = state.filteredRequestsList || state.requestsList || [];
  reqList.forEach(r => {
    if (checked) {
      state.selectedRequestIds.add(r.id);
      (r.items || []).forEach(it => {
        if (it.IsCancelled) return;

        let matchesReceipt = true;
        if (state.receiptFilter === 'unreceived') matchesReceipt = !it.IsReceived || it.IsReceived === 0;
        else if (state.receiptFilter === 'received') matchesReceipt = it.IsReceived == 1 || it.IsReceived === true;

        let matchesVoucher = true;
        if (state.voucherFilter === 'unassigned') matchesVoucher = !it.VoucherCode || it.VoucherCode.trim() === '';
        else if (state.voucherFilter === 'assigned') matchesVoucher = !!(it.VoucherCode && it.VoucherCode.trim() !== '');

        if (matchesReceipt && matchesVoucher) {
          state.selectedIssueItemIds.add(it.id);
        }
      });
    } else {
      state.selectedRequestIds.delete(r.id);
      (r.items || []).forEach(it => state.selectedIssueItemIds.delete(it.id));
    }
  });
  updateSelectedCounters();
  document.querySelectorAll('#requestsTableBody input[type="checkbox"]').forEach(chk => {
    chk.checked = checked;
  });
  document.querySelectorAll('#requestsMobileCards input[type="checkbox"]').forEach(chk => {
    chk.checked = checked;
  });
}

function updateSelectedCounters() {
  const count = state.selectedIssueItemIds.size;
  const badge = document.getElementById('badgeSelectedCount');
  if (badge) {
    if (count > 0) {
      badge.textContent = count.toString();
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Xuất file Excel chuẩn mẫu sheet "IM_tmpRequest2" với 18 cột theo đúng filter
function exportSelectedIssueItemsToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Thư viện Excel (XLSX) chưa được tải hoàn tất. Vui lòng tải lại trang.');
    return;
  }

  // 1. Lấy danh sách ứng viên theo chế độ xem và bộ lọc đang áp dụng
  let candidateItems = [];
  if (state.requestsSubMode === 'all_items') {
    candidateItems = (state.allIssueItemsList || []).map(it => ({
      ...it,
      item_id: it.item_id || it.id
    }));
  } else {
    const reqList = state.filteredRequestsList || state.requestsList || [];
    reqList.forEach(r => {
      (r.items || []).forEach(it => {
        candidateItems.push({
          ...it,
          item_id: it.id,
          RequestCode: r.RequestCode,
          RequestDate: r.RequestDate,
          RequestedBy: r.RequestedBy,
          RequestWHouseID: r.WHouseID,
          RequestPurpose: r.Purpose
        });
      });
    });
  }

  // 2. Lọc bỏ tuyệt đối các mặt hàng đã hủy
  candidateItems = candidateItems.filter(it => !it.IsCancelled);

  // 3. Áp dụng filter trạng thái nhận hàng (receiptFilter)
  if (state.receiptFilter === 'unreceived') {
    candidateItems = candidateItems.filter(it => !it.IsReceived || it.IsReceived === 0);
  } else if (state.receiptFilter === 'received') {
    candidateItems = candidateItems.filter(it => it.IsReceived == 1 || it.IsReceived === true);
  }

  // 4. Áp dụng filter mã đơn ERP (voucherFilter)
  if (state.voucherFilter === 'unassigned') {
    candidateItems = candidateItems.filter(it => !it.VoucherCode || it.VoucherCode.trim() === '');
  } else if (state.voucherFilter === 'assigned') {
    candidateItems = candidateItems.filter(it => it.VoucherCode && it.VoucherCode.trim() !== '');
  }

  // 5. Áp dụng filter kho (nếu có chọn)
  if (state.currentWarehouse && state.currentWarehouse !== 'all') {
    const wh = state.currentWarehouse.trim().toLowerCase();
    candidateItems = candidateItems.filter(it => 
      (it.ItemWHouseID || it.WHouseID || it.RequestWHouseID || '').toLowerCase() === wh
    );
  }

  // 6. Áp dụng tìm kiếm (nếu có query)
  if (state.searchQuery && state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    candidateItems = candidateItems.filter(it => 
      (it.ItemID || '').toLowerCase().includes(q) ||
      (it.ItemText || '').toLowerCase().includes(q) ||
      (it.RequestCode || '').toLowerCase().includes(q) ||
      (it.RequestedBy || '').toLowerCase().includes(q)
    );
  }

  let itemsToExport = [];
  if (state.selectedIssueItemIds.size > 0) {
    // Chỉ lấy các món được tick NẰM TRONG danh sách phù hợp bộ lọc hiện tại
    itemsToExport = candidateItems.filter(it => state.selectedIssueItemIds.has(it.item_id));
  }

  // Nếu chưa tick món nào (hoặc các món đã tick không thuộc filter hiện tại)
  if (itemsToExport.length === 0) {
    if (candidateItems.length === 0) {
      alert('Không có vật tư nào phù hợp với bộ lọc hiện tại để xuất Excel!');
      return;
    }

    const filterDescParts = [];
    if (state.voucherFilter === 'unassigned') filterDescParts.push('Chưa tạo phiếu ERP');
    else if (state.voucherFilter === 'assigned') filterDescParts.push('Đã tạo phiếu ERP');
    else filterDescParts.push('Tất cả đơn');

    if (state.receiptFilter === 'unreceived') filterDescParts.push('Chưa nhận');
    else if (state.receiptFilter === 'received') filterDescParts.push('Đã nhận');
    else filterDescParts.push('Tất cả hàng');

    const filterDesc = filterDescParts.join(' | ');

    const confirmAll = confirm(`Bạn chưa tích chọn vật tư nào.\nBạn có muốn xuất toàn bộ ${candidateItems.length} vật tư theo bộ lọc [${filterDesc}] ra file Excel không?`);
    if (!confirmAll) return;
    itemsToExport = candidateItems;
  }

  // 18 Cột chuẩn theo mẫu Bravo ERP
  const headers = [
    'ItemID', 'IdentityID', 'Unit1Qty', 'Unit2Qty', 'Unit3Qty',
    'Unit1Min', 'Unit1Max', 'WHouseID', 'StorageID', 'Purpose',
    'Remark', 'IsImp', 'iRow', 'EntrySO', 'EntryPO',
    'RQdRowID', 'POdRowID', 'SOdRowID'
  ];

  const rows = itemsToExport.map(it => [
    it.ItemID || '',
    '', // IdentityID
    Number(it.RequestedQty) || 0, // Unit1Qty
    '', // Unit2Qty
    '', // Unit3Qty
    '', // Unit1Min
    '', // Unit1Max
    it.ItemWHouseID || it.RequestWHouseID || it.WHouseID || '', // WHouseID
    (it.StorageID && it.StorageID !== 'ZZZ') ? it.StorageID : '', // StorageID
    '', // Purpose (để trống theo mẫu)
    it.ItemRemark || it.Remark || it.RequestPurpose || it.Purpose || '', // Remark
    '', // IsImp
    '', // iRow
    '', // EntrySO
    '', // EntryPO
    '', // RQdRowID
    '', // POdRowID
    ''  // SOdRowID
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Đặt tên sheet là IM_tmpRequest2 chuẩn ERP
  XLSX.utils.book_append_sheet(wb, ws, "IM_tmpRequest2");

  const now = new Date();
  const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const fileName = `IM_tmpRequest2_${timeStr}.xlsx`;

  XLSX.writeFile(wb, fileName);

  // Mở ngay popup nhập mã đơn ERP để gán cho các vật tư vừa xuất
  setTimeout(() => {
    openAssignVoucherModal(itemsToExport);
  }, 450);
}

// Modal Nhập Mã Đơn ERP
let pendingVoucherItemIds = [];

function openAssignVoucherModal(items = null) {
  const modal = document.getElementById('assignVoucherModal');
  if (!modal) return;

  if (items && Array.isArray(items)) {
    pendingVoucherItemIds = items.map(it => it.item_id || it.id);
  } else if (state.selectedIssueItemIds.size > 0) {
    pendingVoucherItemIds = Array.from(state.selectedIssueItemIds);
  } else {
    alert('Vui lòng chọn ít nhất một vật tư để gán mã đơn!');
    return;
  }

  const countEl = document.getElementById('assignVoucherItemCount');
  const tagsContainer = document.getElementById('assignVoucherItemTags');
  const input = document.getElementById('voucherCodeInput');

  if (countEl) countEl.textContent = `Đang gán cho ${pendingVoucherItemIds.length} vật tư đã chọn:`;
  if (tagsContainer) {
    const itemMap = new Map();
    (state.allIssueItemsList || []).forEach(it => itemMap.set(it.item_id, it.ItemID));
    if (state.requestsList) {
      state.requestsList.forEach(r => (r.items || []).forEach(it => itemMap.set(it.id, it.ItemID)));
    }

    tagsContainer.innerHTML = pendingVoucherItemIds.map(id => {
      const code = itemMap.get(id) || `#${id}`;
      return `<span style="font-size: 0.72rem; font-family: var(--font-mono); background: rgba(99, 102, 241, 0.2); color: #C7D2FE; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(99, 102, 241, 0.4);">${escapeHtml(code)}</span>`;
    }).join('');
  }

  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 150);
  }

  modal.classList.add('open');
}

function closeAssignVoucherModal() {
  const modal = document.getElementById('assignVoucherModal');
  if (modal) modal.classList.remove('open');
  pendingVoucherItemIds = [];
}

async function submitAssignVoucher() {
  const input = document.getElementById('voucherCodeInput');
  const voucherCode = input ? input.value.trim().toUpperCase() : '';

  if (!voucherCode) {
    alert('Vui lòng nhập Mã Đơn / Số Phiếu Xuất ERP!');
    if (input) input.focus();
    return;
  }

  if (!pendingVoucherItemIds || pendingVoucherItemIds.length === 0) {
    alert('Không tìm thấy vật tư nào để gán mã!');
    return;
  }

  const btn = document.getElementById('btnSubmitVoucher');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/inventory/issue-items/assign-voucher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_ids: pendingVoucherItemIds,
        voucher_code: voucherCode
      })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      alert(`Thành công: Đã gán mã đơn "${voucherCode}" cho ${data.updated_count} vật tư!`);
      closeAssignVoucherModal();

      // Xóa selection
      pendingVoucherItemIds.forEach(id => state.selectedIssueItemIds.delete(id));
      updateSelectedCounters();

      // Tự động tải lại bảng dữ liệu (các vật tư vừa gán mã sẽ biến mất khỏi danh sách Chưa Tạo Phiếu)
      if (state.requestsSubMode === 'all_items') {
        await loadIssueItems();
      } else {
        await loadRequests();
        loadIssueItems(true);
      }
    } else {
      alert(`Lỗi gán mã đơn: ${data.detail || 'Không xác định'}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function quickEditVoucher(itemId, currentCode) {
  const newCode = prompt(`Nhập Mã Đơn / Số Phiếu Xuất ERP cho vật tư này (để trống để xóa mã):`, currentCode || '');
  if (newCode === null) return;

  try {
    const res = await fetch('/api/inventory/issue-items/assign-voucher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_ids: [itemId],
        voucher_code: newCode.trim().toUpperCase()
      })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      if (state.requestsSubMode === 'all_items') {
        await loadIssueItems();
      } else {
        await loadRequests();
        loadIssueItems(true);
      }
    } else {
      alert(`Lỗi cập nhật: ${data.detail || 'Không xác định'}`);
    }
  } catch (err) {
    alert(`Lỗi kết nối: ${err.message}`);
  }
}

// =========================================================================
// 8C. XÁC NHẬN NHẬN HÀNG & ẢNH CHỤP BẰNG CHỨNG
// =========================================================================

let currentReceiveItemId = null;
let currentReceivePhotoFile = null;

function openReceiveItemModal(itemId, itemCode, itemName, itemQty, existingPhoto = '') {
  currentReceiveItemId = itemId;
  currentReceivePhotoFile = null;

  const modal = document.getElementById('receiveItemModal');
  if (!modal) return;

  document.getElementById('rcvItemId').value = itemId;
  document.getElementById('rcvItemCode').textContent = itemCode;
  document.getElementById('rcvItemName').textContent = itemName;
  document.getElementById('rcvItemQty').textContent = `Số lượng: ${itemQty}`;

  const receiverInput = document.getElementById('rcvReceiverName');
  if (receiverInput) {
    receiverInput.value = (state.currentUser && (state.currentUser.full_name || state.currentUser.username)) || '';
  }

  const fileInput = document.getElementById('rcvPhotoInput');
  if (fileInput) fileInput.value = '';
  const fileNameEl = document.getElementById('rcvPhotoFileName');
  if (fileNameEl) fileNameEl.textContent = existingPhoto ? 'Đã có ảnh (bấm để đổi ảnh mới)' : 'Chưa chọn ảnh';

  const previewBox = document.getElementById('rcvPhotoPreviewBox');
  const previewImg = document.getElementById('rcvPhotoPreviewImg');
  if (existingPhoto && previewImg && previewBox) {
    previewImg.src = existingPhoto;
    previewBox.style.display = 'block';
  } else if (previewBox) {
    previewBox.style.display = 'none';
  }

  modal.classList.add('open', 'active');
  try { history.pushState({ modal: 'receiveItem' }, ''); } catch (e) {}
}

function closeReceiveItemModal() {
  const modal = document.getElementById('receiveItemModal');
  if (modal) modal.classList.remove('open', 'active');
  currentReceiveItemId = null;
  currentReceivePhotoFile = null;
}

function handleReceivePhotoSelected(input) {
  const file = input.files && input.files[0];
  const fileNameEl = document.getElementById('rcvPhotoFileName');
  const previewBox = document.getElementById('rcvPhotoPreviewBox');
  const previewImg = document.getElementById('rcvPhotoPreviewImg');

  if (file) {
    currentReceivePhotoFile = file;
    if (fileNameEl) fileNameEl.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      if (previewImg && previewBox) {
        previewImg.src = e.target.result;
        previewBox.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  }
}

async function submitReceiveItem(event) {
  event.preventDefault();
  if (!currentReceiveItemId) return;

  const receiver = (document.getElementById('rcvReceiverName')?.value || '').trim();
  if (!receiver) {
    alert('Vui lòng nhập họ tên người nhận hàng!');
    return;
  }

  const btn = document.getElementById('btnSubmitReceiveItem');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Đang lưu...';
  }

  try {
    const formData = new FormData();
    formData.append('received_by', receiver);
    if (currentReceivePhotoFile) {
      formData.append('photo', currentReceivePhotoFile);
    }

    const token = localStorage.getItem('token') || localStorage.getItem('bopp_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/inventory/items/${currentReceiveItemId}/receive`, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi ghi nhận nhận hàng');

    closeReceiveItemModal();
    // Reload lại dữ liệu
    await loadIssueItems(true);
    await loadRequests(true);
    if (currentViewingRequest && currentViewingRequest.id) {
      const req = (state.requestsList || []).find(r => r.id === currentViewingRequest.id);
      if (req) openRequestDetail(req.id);
    }
    alert('✅ Đã ghi nhận nhận hàng thành công!');
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ Xác Nhận Đã Nhận';
    }
  }
}

async function unreceiveItem(itemId) {
  if (!confirm('Bạn có chắc chắn muốn hủy trạng thái đã nhận của vật tư này?')) return;

  try {
    const token = localStorage.getItem('token') || localStorage.getItem('bopp_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/inventory/items/${itemId}/unreceive`, {
      method: 'POST',
      headers
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi hủy nhận hàng');

    await loadIssueItems(true);
    await loadRequests(true);
    if (currentViewingRequest && currentViewingRequest.id) {
      const req = (state.requestsList || []).find(r => r.id === currentViewingRequest.id);
      if (req) openRequestDetail(req.id);
    }
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  }
}

// Người tạo hoặc người phụ trách đánh dấu hủy mặt hàng đã thêm
async function cancelRequestItem(itemId, itemText, reqId) {
  const reason = prompt(`Nhập lý do hủy mặt hàng "${itemText}":`, 'Không còn nhu cầu sử dụng');
  if (reason === null) return; // Người dùng bấm Hủy

  try {
    const token = localStorage.getItem('token') || localStorage.getItem('bopp_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/inventory/items/${itemId}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: reason.trim() || 'Người tạo đánh dấu hủy' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể hủy mặt hàng');

    // Bỏ chọn nếu món này đang được chọn
    state.selectedIssueItemIds.delete(itemId);
    updateSelectedCounters();

    await loadRequests(true);
    await loadIssueItems(true);

    const targetReqId = reqId || (currentViewingRequest && currentViewingRequest.id);
    if (targetReqId) {
      const req = (state.requestsList || []).find(r => r.id === targetReqId);
      if (req) openRequestDetail(req.id);
    }
    alert(data.message || 'Đã đánh dấu hủy mặt hàng.');
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  }
}

// Khôi phục mặt hàng đã bị hủy
async function uncancelRequestItem(itemId, reqId) {
  if (!confirm('Bạn có chắc chắn muốn khôi phục lại mặt hàng này vào phiếu yêu cầu xuất kho?')) return;

  try {
    const token = localStorage.getItem('token') || localStorage.getItem('bopp_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/inventory/items/${itemId}/uncancel`, {
      method: 'POST',
      headers
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể khôi phục mặt hàng');

    await loadRequests(true);
    await loadIssueItems(true);

    const targetReqId = reqId || (currentViewingRequest && currentViewingRequest.id);
    if (targetReqId) {
      const req = (state.requestsList || []).find(r => r.id === targetReqId);
      if (req) openRequestDetail(req.id);
    }
    alert(data.message || 'Đã khôi phục mặt hàng thành công.');
  } catch (err) {
    alert(`❌ Lỗi: ${err.message}`);
  }
}

function previewReceiptPhoto(photoUrl, title = 'Ảnh Bằng Chứng Nhận Hàng') {
  const modal = document.getElementById('photoPreviewModal');
  const img = document.getElementById('photoPreviewImg');
  const titleEl = document.getElementById('photoPreviewTitle');
  if (!modal || !img) return;

  img.src = photoUrl;
  if (titleEl) titleEl.textContent = `Ảnh Nhận Hàng: ${title}`;
  modal.classList.add('open', 'active');
  try { history.pushState({ modal: 'photoPreview' }, ''); } catch (e) {}
}

function closePhotoPreviewModal() {
  const modal = document.getElementById('photoPreviewModal');
  if (modal) modal.classList.remove('open', 'active');
}


// Window Bindings for Mobile App & Desktop
window.openRequestDetail = openRequestDetail;
window.closeRequestDetailModal = closeRequestDetailModal;
window.copyReqCode = copyReqCode;
window.handleDetailStatusAction = handleDetailStatusAction;
window.openCreateRequestModal = openCreateRequestModal;
window.closeCreateRequestModal = closeCreateRequestModal;
window.addManualRequestItemRow = addManualRequestItemRow;
window.removeRequestItemRow = removeRequestItemRow;
window.submitCreateRequest = submitCreateRequest;
window.switchRequestsSubMode = switchRequestsSubMode;
window.setVoucherFilter = setVoucherFilter;
window.setReceiptFilter = setReceiptFilter;
window.toggleSelectIssueItem = toggleSelectIssueItem;
window.toggleSelectAllIssueItems = toggleSelectAllIssueItems;
window.toggleSelectRequest = toggleSelectRequest;
window.toggleSelectAllRequests = toggleSelectAllRequests;
window.exportSelectedIssueItemsToExcel = exportSelectedIssueItemsToExcel;
window.openAssignVoucherModal = openAssignVoucherModal;
window.closeAssignVoucherModal = closeAssignVoucherModal;
window.submitAssignVoucher = submitAssignVoucher;
window.quickEditVoucher = quickEditVoucher;
window.openReceiveItemModal = openReceiveItemModal;
window.closeReceiveItemModal = closeReceiveItemModal;
window.handleReceivePhotoSelected = handleReceivePhotoSelected;
window.submitReceiveItem = submitReceiveItem;
window.unreceiveItem = unreceiveItem;
window.cancelRequestItem = cancelRequestItem;
window.uncancelRequestItem = uncancelRequestItem;
window.previewReceiptPhoto = previewReceiptPhoto;
window.closePhotoPreviewModal = closePhotoPreviewModal;

// Mobile app back button handler (Android back button / swipe back gesture)
window.addEventListener('popstate', (e) => {
  const reqDetail = document.getElementById('requestDetailModal');
  if (reqDetail && reqDetail.classList.contains('open')) {
    closeRequestDetailModal();
    return;
  }
  const createReq = document.getElementById('createRequestModal');
  if (createReq && createReq.classList.contains('open')) {
    closeCreateRequestModal();
    return;
  }
  const rcvModal = document.getElementById('receiveItemModal');
  if (rcvModal && rcvModal.classList.contains('open')) {
    closeReceiveItemModal();
    return;
  }
  const photoModal = document.getElementById('photoPreviewModal');
  if (photoModal && photoModal.classList.contains('open')) {
    closePhotoPreviewModal();
    return;
  }
});
