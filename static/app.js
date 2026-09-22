/**
 * BOPP EM Maintenance - Frontend Application Logic
 * Đăng nhập & Phân quyền, Ma trận thực hiện M x N (Thiết Bị x Hạng Mục),
 * Thư viện SOP & Lưu trữ ảnh minh chứng thực tế
 */

// Application State
const state = {
  currentPage: 1,
  limit: 25,
  totalPages: 1,
  totalCount: 0,
  searchQuery: "",
  statusFilter: "all",
  percentFilter: "all",
  percentType: "erp",
  selectedEntryId: null,
  activeTab: "tab-execution", // Mặc định tab Thực Hiện Theo Thiết Bị
  selectedMachineId: null,
  isLoadingMore: false,
  hasMore: true,
  loadedOrdersCount: 0,
  currentUser: null,
  currentExecutionData: null,
  currentOrderDetail: null,
  proofSelectedFile: null
};

// DOM Elements
const el = {
  searchInput: document.getElementById("searchInput"),
  btnClearSearch: document.getElementById("btnClearSearch"),
  segButtons: document.querySelectorAll(".seg-btn"),
  segPctButtons: document.querySelectorAll(".seg-pct-btn"),
  percentTypeSelect: document.getElementById("percentTypeSelect"),
  btnToggleOrdersFilter: document.getElementById("btnToggleOrdersFilter"),
  ordersFilterPanel: document.getElementById("ordersFilterPanel"),
  ordersFilterBadge: document.getElementById("ordersFilterBadge"),
  btnRefresh: document.getElementById("btnRefresh"),
  ordersList: document.getElementById("ordersList"),
  ordersCounter: document.getElementById("ordersCounter"),
  loadedStatus: document.getElementById("loadedStatus"),
  detailContainer: document.getElementById("detailContainer"),
  toastContainer: document.getElementById("toastContainer"),
  userProfileChip: document.getElementById("userProfileChip"),

  // Modals
  sopModal: document.getElementById("sopModal"),
  sopModalTitle: document.getElementById("sopModalTitle"),
  sopModalMeta: document.getElementById("sopModalMeta"),
  sopModalImgWrapper: document.getElementById("sopModalImgWrapper"),
  sopModalGuideline: document.getElementById("sopModalGuideline"),
  btnCloseSopModal: document.getElementById("btnCloseSopModal"),
  btnOkSopModal: document.getElementById("btnOkSopModal"),

  uploadProofModal: document.getElementById("uploadProofModal"),
  proofUploadForm: document.getElementById("proofUploadForm"),
  proofMachineId: document.getElementById("proofMachineId"),
  proofTaskDRowId: document.getElementById("proofTaskDRowId"),
  proofTaskInfo: document.getElementById("proofTaskInfo"),
  proofCaptionInput: document.getElementById("proofCaptionInput"),
  btnTriggerCamera: document.getElementById("btnTriggerCamera"),
  proofCameraInput: document.getElementById("proofCameraInput"),
  proofDropArea: document.getElementById("proofDropArea"),
  proofFileInput: document.getElementById("proofCameraInput"),
  proofFilePreview: document.getElementById("proofFilePreview"),
  proofModalSampleBox: document.getElementById("proofModalSampleBox"),
  proofModalGuideline: document.getElementById("proofModalGuideline"),
  btnCloseProofModal: document.getElementById("btnCloseProofModal"),
  btnCancelProofModal: document.getElementById("btnCancelProofModal"),
  btnSubmitProofModal: document.getElementById("btnSubmitProofModal"),

  lightboxModal: document.getElementById("lightboxModal"),
  lightboxImg: document.getElementById("lightboxImg"),
  lightboxCaption: document.getElementById("lightboxCaption"),
  btnCloseLightbox: document.getElementById("btnCloseLightbox"),

  loginModal: document.getElementById("loginModal"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  btnCloseLoginModal: document.getElementById("btnCloseLoginModal")
};

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  initEventListeners();
  await checkAuth();
  loadOrders(true);
});

// Toast Notification
function showToast(message, type = "info", duration = 4000) {
  if (!el.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<div class="toast-content">${escapeHtml(message)}</div>`;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("show");
  }, 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Authentication Helpers
function getToken() {
  return localStorage.getItem("bopp_token");
}

function setToken(token) {
  if (token) {
    localStorage.setItem("bopp_token", token);
  } else {
    localStorage.removeItem("bopp_token");
    localStorage.removeItem("bopp_user");
  }
}

async function checkAuth() {
  const token = getToken();
  if (!token) {
    state.currentUser = null;
    renderUserChip();
    return null;
  }
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.user || data;
      localStorage.setItem("bopp_user", JSON.stringify(state.currentUser));
      renderUserChip();
      return state.currentUser;
    } else {
      setToken(null);
      state.currentUser = null;
      renderUserChip();
      return null;
    }
  } catch (err) {
    console.warn("Auth check error:", err);
    state.currentUser = null;
    renderUserChip();
    return null;
  }
}

function renderUserChip() {
  if (!el.userProfileChip) return;

  if (state.currentUser) {
    const roleColors = {
      admin: "#EF4444",
      supervisor: "#F59E0B",
      technician: "#10B981"
    };
    const roleLabels = {
      admin: "Quản trị",
      supervisor: "Giám sát",
      technician: "Kỹ thuật viên"
    };
    const color = roleColors[state.currentUser.role] || "#6366F1";
    const label = roleLabels[state.currentUser.role] || state.currentUser.role;
    const initial = (state.currentUser.full_name || state.currentUser.username || "U").charAt(0).toUpperCase();

    el.userProfileChip.innerHTML = `
      <button type="button" id="btnOpenProfileModal" class="user-avatar-btn" title="Tài khoản: ${escapeHtml(state.currentUser.full_name || state.currentUser.username)} (${label})" style="--avatar-color: ${color};">
        <span class="avatar-letter">${initial}</span>
        <span class="user-status-dot" style="background: ${color};"></span>
      </button>
    `;

    document.getElementById("btnOpenProfileModal")?.addEventListener("click", openUserProfileModal);
  } else {
    el.userProfileChip.innerHTML = `
      <button type="button" id="btnOpenLoginModal" class="user-avatar-btn is-guest" title="Đăng Nhập">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
    `;
    document.getElementById("btnOpenLoginModal")?.addEventListener("click", openLoginModal);
  }
}

function openUserProfileModal() {
  if (!state.currentUser) return;
  const roleColors = {
    admin: "#EF4444",
    supervisor: "#F59E0B",
    technician: "#10B981"
  };
  const roleLabels = {
    admin: "Quản trị",
    supervisor: "Giám sát",
    technician: "Kỹ thuật viên"
  };
  const color = roleColors[state.currentUser.role] || "#6366F1";
  const label = roleLabels[state.currentUser.role] || state.currentUser.role;
  const initial = (state.currentUser.full_name || state.currentUser.username || "U").charAt(0).toUpperCase();

  const avatarEl = document.getElementById("profileAvatarLarge");
  if (avatarEl) {
    avatarEl.textContent = initial;
    avatarEl.style.borderColor = color;
    avatarEl.style.color = color;
    avatarEl.style.background = `${color}25`;
  }

  const nameEl = document.getElementById("profileFullName");
  if (nameEl) nameEl.textContent = state.currentUser.full_name || state.currentUser.username;

  const roleEl = document.getElementById("profileRoleBadge");
  if (roleEl) {
    roleEl.textContent = label;
    roleEl.style.background = `${color}20`;
    roleEl.style.color = color;
    roleEl.style.borderColor = `${color}40`;
  }

  const userTagEl = document.getElementById("profileUsername");
  if (userTagEl) userTagEl.textContent = `Tài khoản: ${state.currentUser.username}`;

  document.getElementById("userProfileModal")?.classList.add("active");
}

function closeUserProfileModal() {
  document.getElementById("userProfileModal")?.classList.remove("active");
}

function logoutUser() {
  setToken(null);
  state.currentUser = null;
  renderUserChip();
  closeUserProfileModal();
  showToast("Đã đăng xuất tài khoản", "info");
}

function openLoginModal() {
  el.loginModal?.classList.add("active");
}

function closeLoginModal() {
  el.loginModal?.classList.remove("active");
}

// Mobile Screen Detection & View State Switching
function isMobileScreen() {
  return window.innerWidth <= 900;
}

function showMobileDetailView() {
  document.body.classList.add("mobile-view-detail");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMobileListView() {
  document.body.classList.remove("mobile-view-detail");
  if (state.selectedEntryId) {
    const activeCard = document.querySelector(`.order-card[data-entry-id="${state.selectedEntryId}"]`);
    if (activeCard) {
      activeCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
}

function updateOrdersFilterBadge() {
  let count = 0;
  if (state.statusFilter !== "all") count++;
  if (state.percentFilter !== "all") count++;
  if (el.ordersFilterBadge) {
    if (count > 0) {
      el.ordersFilterBadge.textContent = count;
      el.ordersFilterBadge.style.display = "inline-flex";
      el.btnToggleOrdersFilter?.classList.add("has-active-filter");
    } else {
      el.ordersFilterBadge.style.display = "none";
      el.btnToggleOrdersFilter?.classList.remove("has-active-filter");
    }
  }
}

// Initialize Global Event Listeners
function initEventListeners() {
  // Search with debounce
  if (el.searchInput) {
    let searchTimeout = null;
    el.searchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (el.btnClearSearch) el.btnClearSearch.style.display = val ? "block" : "none";
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = val.trim();
        loadOrders(true);
      }, 300);
    });
  }

  if (el.btnClearSearch && el.searchInput) {
    el.btnClearSearch.addEventListener("click", () => {
      el.searchInput.value = "";
      el.btnClearSearch.style.display = "none";
      state.searchQuery = "";
      loadOrders(true);
    });
  }

  // Segmented control (Status Filter: Tất cả / Đang Mở / Đã Đóng)
  if (el.segButtons && el.segButtons.length > 0) {
    el.segButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.segButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.statusFilter = btn.dataset.status;
        updateOrdersFilterBadge();
        loadOrders(true);
      });
    });
  }

  // Segmented control (Percent Filter: Tất Cả % / 100% / Dưới 100%)
  if (el.segPctButtons && el.segPctButtons.length > 0) {
    el.segPctButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.segPctButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.percentFilter = btn.dataset.percent;
        updateOrdersFilterBadge();
        loadOrders(true);
      });
    });
  }

  // Chọn tiêu chí %: ERP / NV / Cả hai
  if (el.percentTypeSelect) {
    el.percentTypeSelect.addEventListener("change", (e) => {
      state.percentType = e.target.value;
      if (state.percentFilter !== "all") {
        loadOrders(true);
      }
    });
  }

  // Nút mở/đóng bộ lọc trên Mobile (Tuân thủ rule bộ lọc mặc định ẩn trên mobile)
  if (el.btnToggleOrdersFilter && el.ordersFilterPanel) {
    el.btnToggleOrdersFilter.addEventListener("click", () => {
      const isCollapsed = el.ordersFilterPanel.classList.contains("is-collapsed");
      if (isCollapsed) {
        el.ordersFilterPanel.classList.remove("is-collapsed");
        el.ordersFilterPanel.classList.add("is-expanded");
      } else {
        el.ordersFilterPanel.classList.add("is-collapsed");
        el.ordersFilterPanel.classList.remove("is-expanded");
      }
    });
  }

  // Refresh
  if (el.btnRefresh) {
    el.btnRefresh.addEventListener("click", () => {
      loadOrders(true);
      if (state.selectedEntryId) {
        loadOrderDetail(state.selectedEntryId);
      }
    });
  }

  // Infinite Scroll
  if (el.ordersList) {
    el.ordersList.addEventListener("scroll", () => {
      if (state.isLoadingMore || !state.hasMore) return;
      const threshold = 140;
      const currentScroll = el.ordersList.scrollTop + el.ordersList.clientHeight;
      const totalScroll = el.ordersList.scrollHeight;

      if (totalScroll - currentScroll <= threshold) {
        state.currentPage++;
        loadOrders(false);
      }
    });
  }

  // Modal Closures & Navigation
  el.btnCloseSopModal?.addEventListener("click", closeSopModal);
  el.btnOkSopModal?.addEventListener("click", closeSopModal);
  el.btnCloseProofModal?.addEventListener("click", closeProofModal);
  el.btnCancelProofModal?.addEventListener("click", closeProofModal);
  el.btnCloseLightbox?.addEventListener("click", closeLightbox);
  el.btnCloseLoginModal?.addEventListener("click", closeLoginModal);
  document.getElementById("btnCloseProfileModal")?.addEventListener("click", closeUserProfileModal);
  document.getElementById("btnModalLogout")?.addEventListener("click", logoutUser);
  document.getElementById("btnBackToOrdersList")?.addEventListener("click", showMobileListView);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSopModal();
      closeProofModal();
      closeLightbox();
      closeLoginModal();
      closeUserProfileModal();
    }
  });

  el.sopModal?.addEventListener("click", (e) => {
    if (e.target.id === "sopModal") closeSopModal();
  });
  el.uploadProofModal?.addEventListener("click", (e) => {
    if (e.target.id === "uploadProofModal") closeProofModal();
  });
  el.lightboxModal?.addEventListener("click", (e) => {
    if (e.target.id === "lightboxModal") closeLightbox();
  });
  el.loginModal?.addEventListener("click", (e) => {
    if (e.target.id === "loginModal") closeLoginModal();
  });
  document.getElementById("userProfileModal")?.addEventListener("click", (e) => {
    if (e.target.id === "userProfileModal") closeUserProfileModal();
  });

  // Proof Upload: Camera input change event (Trigger is handled natively via <label for="proofCameraInput">)
  el.proofCameraInput?.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProofFileSelected(e.target.files[0]);
    }
  });

  // Form Upload Proof submit
  el.proofUploadForm?.addEventListener("submit", submitProofUpload);

  // Form Login submit
  el.loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = el.loginUsername.value.trim();
    const password = el.loginPassword.value;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Sai thông tin đăng nhập");
      }

      const data = await res.json();
      setToken(data.access_token || data.token);
      state.currentUser = data.user || data;
      localStorage.setItem("bopp_user", JSON.stringify(state.currentUser));
      renderUserChip();
      closeLoginModal();
      showToast(`Chào mừng ${state.currentUser.full_name || state.currentUser.username} đăng nhập thành công!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Quick user login buttons
  document.querySelectorAll(".quick-user-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.loginUsername.value = btn.dataset.user;
      el.loginPassword.value = btn.dataset.pass;
    });
  });
}

// Load Orders List
async function loadOrders(reset = false) {
  if (reset) {
    state.currentPage = 1;
    state.hasMore = true;
    state.isLoadingMore = false;
    state.loadedOrdersCount = 0;
    el.ordersList.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Đang tải dữ liệu lệnh bảo dưỡng...</p>
      </div>
    `;
    el.ordersList.scrollTop = 0;
  } else {
    if (!state.hasMore || state.isLoadingMore) return;
    showScrollLoader();
  }

  state.isLoadingMore = true;

  try {
    const params = new URLSearchParams({
      page: state.currentPage,
      limit: state.limit,
      status: state.statusFilter,
      percent: state.percentFilter,
      percent_type: state.percentType
    });
    if (state.searchQuery) {
      params.append("search", state.searchQuery);
    }

    const res = await fetch(`/api/orders?${params.toString()}`);
    if (!res.ok) throw new Error("Không thể nạp dữ liệu từ máy chủ");
    const data = await res.json();

    hideScrollLoader();

    state.totalPages = data.pages || 1;
    state.totalCount = data.total || 0;

    if (reset) {
      el.ordersList.innerHTML = "";
    }

    if (!data.items || data.items.length === 0) {
      if (reset) {
        el.ordersList.innerHTML = `
          <div class="loading-state">
            <p>Không tìm thấy lệnh bảo dưỡng nào phù hợp.</p>
          </div>
        `;
        if (el.ordersCounter) el.ordersCounter.textContent = "0 lệnh";
        if (el.loadedStatus) el.loadedStatus.textContent = "0 / 0";
      }
      state.hasMore = false;
      return;
    }

    state.loadedOrdersCount += data.items.length;
    renderOrderCards(data.items, reset);

    if (el.ordersCounter) {
      el.ordersCounter.textContent = `${state.totalCount.toLocaleString()} lệnh`;
    }
    if (el.loadedStatus) {
      el.loadedStatus.textContent = `${state.loadedOrdersCount} / ${state.totalCount.toLocaleString()}`;
    }

    if (data.stats) {
      const kpiStaff = document.getElementById("kpiStaffPct");
      const kpiErp = document.getElementById("kpiErpPct");
      if (kpiStaff) {
        kpiStaff.textContent = `${data.stats.staff_percent}%`;
        kpiStaff.title = `Đã hoàn thành ${data.stats.staff_completed_tasks || 0}/${data.stats.staff_total_tasks || 0} việc con trên lệnh`;
      }
      if (kpiErp) {
        kpiErp.textContent = `${data.stats.erp_result_percent}%`;
        kpiErp.title = `Có ${data.stats.erp_result_count || 0}/${data.stats.total_orders || 0} lệnh đã có kết quả trên data ERP`;
      }
    }

    if (state.currentPage >= state.totalPages) {
      state.hasMore = false;
      showEndOfList();
    }

    // Auto select first order if none selected
    if (!state.selectedEntryId && data.items.length > 0) {
      selectOrder(data.items[0].EntryID, false);
    }
  } catch (err) {
    hideScrollLoader();
    if (reset) {
      el.ordersList.innerHTML = `
        <div class="loading-state">
          <p style="color: #EF4444;">Lỗi kết nối: ${escapeHtml(err.message)}</p>
        </div>
      `;
    } else {
      showToast(`Lỗi tải thêm lệnh: ${err.message}`, "error");
    }
  } finally {
    state.isLoadingMore = false;
  }
}

// Render Order Cards (Infinite Scroll)
function renderOrderCards(orders, isReset) {
  orders.forEach((order) => {
    const card = document.createElement("div");
    card.className = `order-card ${order.EntryID === state.selectedEntryId ? "active" : ""}`;
    card.dataset.entryId = order.EntryID;

    // THẺ TRẠNG THÁI: Closed = 1 -> Đã Đóng (Xanh lá) | Closed = 0 -> Đang Mở (Màu Vàng)
    const isClosed = order.Closed === 1;
    const badgeHtml = isClosed
      ? `<span class="badge badge-closed">Đã Đóng</span>`
      : `<span class="badge badge-open">Đang Mở</span>`;

    const machineList = (order.Machines || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const machinesHtml = machineList.length > 0
      ? machineList.slice(0, 4).map((m) => `<span class="machine-tag">${escapeHtml(m)}</span>`).join("") +
      (machineList.length > 4 ? `<span class="machine-tag">+${machineList.length - 4}</span>` : "")
      : `<span class="machine-tag" style="opacity: 0.6">Chưa gán máy</span>`;

    // 1. % công việc: là % số việc đã cập nhật hoàn thành trên lệnh
    // 2. % ERP: là % số máy đã thực hiện có Phiếu kết quả trên data ERP
    const totalTasks = order.TotalTasks || 0;
    const completedTasks = order.CompletedTasks || 0;
    const staffPct = (order.StaffPercent !== undefined)
      ? order.StaffPercent
      : (totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0);

    const totalMachines = order.TotalMachines || 0;
    const erpMachines = order.ErpResultMachines || 0;
    const erpPct = (order.ErpPercent !== undefined)
      ? order.ErpPercent
      : (totalMachines > 0 ? Math.round((erpMachines / totalMachines) * 100) : (order.HasErpResult ? 100 : 0));

    const staffBadgeClass = staffPct === 100 ? "pct-chip-100" : (staffPct > 0 ? "pct-chip-mid" : "pct-chip-zero");
    const erpBadgeClass = erpPct === 100 ? "pct-chip-100" : (erpPct > 0 ? "pct-chip-mid" : "pct-chip-zero");

    const progressChipsHtml = `
      <div class="order-card-pct-group">
        <span class="order-pct-chip ${staffBadgeClass}" title="Tiến độ công việc đã hoàn thành trên lệnh: ${completedTasks}/${totalTasks} việc (${staffPct}%)">
          👷CV: <strong>${staffPct}%</strong>${totalTasks > 0 ? `<small class="pct-chip-sub">(${completedTasks}/${totalTasks})</small>` : ''}
        </span>
        <span class="order-pct-chip ${erpBadgeClass}" title="Tiến độ số máy có Phiếu kết quả trên data ERP: ${erpMachines}/${totalMachines} máy (${erpPct}%)">
          📑 ERP: <strong>${erpPct}%</strong>${totalMachines > 0 ? `<small class="pct-chip-sub">(${erpMachines}/${totalMachines})</small>` : ''}
        </span>
      </div>
    `;

    card.innerHTML = `
      <div class="order-card-header">
        <div class="order-id">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          ${escapeHtml(order.EntryID)}
        </div>
        ${badgeHtml}
      </div>

      <div class="order-title">${escapeHtml(order.WorkText)}</div>

      <div class="machine-tags">${machinesHtml}</div>

      <div class="order-meta-row">
        <div class="order-meta-left">
          <div class="order-date">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            ${escapeHtml(formatDate(order.EntryDate))}
          </div>
          ${order.DepartID ? `<div class="order-depart"><span style="opacity:0.65">BP:</span> ${escapeHtml(order.DepartID)}</div>` : ""}
        </div>
        ${progressChipsHtml}
      </div>
    `;

    card.addEventListener("click", () => {
      selectOrder(order.EntryID, true);
    });

    el.ordersList.appendChild(card);
  });
}

function showScrollLoader() {
  hideScrollLoader();
  const loader = document.createElement("div");
  loader.id = "scrollLoader";
  loader.className = "scroll-loader";
  loader.innerHTML = `
    <div class="spinner"></div>
    <span>Đang tải thêm dữ liệu...</span>
  `;
  el.ordersList.appendChild(loader);
}

function hideScrollLoader() {
  const loader = document.getElementById("scrollLoader");
  if (loader) loader.remove();
}

function showEndOfList() {
  const existing = document.getElementById("endOfListMsg");
  if (existing) existing.remove();
  const endMsg = document.createElement("div");
  endMsg.id = "endOfListMsg";
  endMsg.className = "end-of-list";
  endMsg.textContent = `Đã hiển thị toàn bộ ${state.totalCount.toLocaleString()} lệnh`;
  el.ordersList.appendChild(endMsg);
}

// Select Order Action
function selectOrder(entryId, userInitiated = true) {
  state.selectedEntryId = entryId;

  document.querySelectorAll(".order-card").forEach((c) => {
    c.classList.toggle("active", c.dataset.entryId === entryId);
  });

  if (userInitiated && isMobileScreen()) {
    showMobileDetailView();
  }

  loadOrderDetail(entryId);
}

// Load Full Order Details & Execution Matrix
async function loadOrderDetail(entryId) {
  el.detailContainer.innerHTML = `
    <div class="loading-state" style="height: 450px;">
      <div class="spinner"></div>
      <p>Đang tải chi tiết lệnh ${escapeHtml(entryId)}...</p>
    </div>
  `;

  try {
    const [detailRes, execRes] = await Promise.all([
      fetch(`/api/orders/${encodeURIComponent(entryId)}`),
      fetch(`/api/orders/${encodeURIComponent(entryId)}/execution`)
    ]);

    if (!detailRes.ok) throw new Error("Không thể nạp chi tiết lệnh");
    state.currentOrderDetail = await detailRes.json();
    state.currentExecutionData = execRes.ok ? await execRes.json() : null;

    // Default selected machine to first machine in execution list
    if (state.currentExecutionData && state.currentExecutionData.machines && state.currentExecutionData.machines.length > 0) {
      if (!state.selectedMachineId || !state.currentExecutionData.machines.includes(state.selectedMachineId)) {
        state.selectedMachineId = state.currentExecutionData.machines[0];
      }
    }

    renderOrderDetailView();
  } catch (err) {
    el.detailContainer.innerHTML = `
      <div class="empty-detail-state">
        <h3 style="color: #EF4444;">Lỗi nạp chi tiết</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

// Render Order Detail View
function renderOrderDetailView() {
  const data = state.currentOrderDetail;
  const exec = state.currentExecutionData;
  if (!data) return;

  const { order, machines, tasks_items, results } = data;

  const isClosed = order.Closed === 1;
  const statusBadge = isClosed
    ? `<span class="order-status-pill is-closed">Đã Đóng</span>`
    : `<span class="order-status-pill is-open">Đang Mở</span>`;

  const totalTasks = order.TotalTasks || 0;
  const completedTasks = order.CompletedTasks || 0;
  const staffPct = (order.StaffPercent !== undefined)
    ? order.StaffPercent
    : (totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0);

  const totalMachines = order.TotalMachines !== undefined ? order.TotalMachines : (machines ? machines.length : 0);
  const erpMachines = order.ErpResultMachines !== undefined ? order.ErpResultMachines : (results ? results.length : 0);
  const erpPct = (order.ErpPercent !== undefined)
    ? order.ErpPercent
    : (totalMachines > 0 ? Math.round((erpMachines / totalMachines) * 100) : (order.HasErpResult ? 100 : 0));

  const staffBadgeClass = staffPct === 100 ? "pct-chip-100" : (staffPct > 0 ? "pct-chip-mid" : "pct-chip-zero");
  const erpBadgeClass = erpPct === 100 ? "pct-chip-100" : (erpPct > 0 ? "pct-chip-mid" : "pct-chip-zero");

  const staffBadge = `<span class="order-pct-chip ${staffBadgeClass}" title="Tiến độ công việc đã hoàn thành trên lệnh: ${completedTasks}/${totalTasks} việc (${staffPct}%)">👷 % Việc: <strong>${staffPct}%</strong>${totalTasks > 0 ? `<small class="pct-chip-sub">(${completedTasks}/${totalTasks})</small>` : ''}</span>`;

  const erpBadge = `<span class="order-pct-chip ${erpBadgeClass}" title="Tiến độ số máy có Phiếu kết quả trên data ERP: ${erpMachines}/${totalMachines} máy (${erpPct}%)">📑 % ERP: <strong>${erpPct}%</strong>${totalMachines > 0 ? `<small class="pct-chip-sub">(${erpMachines}/${totalMachines})</small>` : ''}</span>`;

  const html = `
    <div class="detail-wrapper">
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-headline">
          <div class="detail-title-group">
            <span class="detail-entry-id">${escapeHtml(order.EntryID)}</span>
            <span class="detail-title-sep">•</span>
            <span class="detail-work-title">${escapeHtml(order.WorkText || order.WorkID || "Chưa có tên công việc")}</span>
          </div>
          <button type="button" id="btnToggleOrderMeta" class="btn-toggle-meta" title="Bấm để xem thêm hoặc thu gọn chi tiết">
            <span class="meta-toggle-label">Chi tiết</span>
            <svg class="meta-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>

        <div class="detail-status-pills-row">
          ${statusBadge}
          ${staffBadge}
          ${erpBadge}
        </div>

        <!-- Collapsible Secondary Meta Box (Collapsed on Mobile by default) -->
        <div id="orderMetaCollapsible" class="order-meta-collapsible is-collapsed">
          <div class="order-created-time" style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 6px;">
            Tạo lúc: <strong>${escapeHtml(order.CreatedDate || "N/A")}</strong>
          </div>
          ${order.Memo ? `<div class="detail-memo-box"><strong>Nội dung:</strong> ${escapeHtml(order.Memo)}</div>` : ""}

          <!-- Meta Grid -->
          <div class="detail-meta-grid">
            <div class="meta-chip">
              <span class="meta-chip-label">Ngày Lập Lệnh</span>
              <span class="meta-chip-value">${escapeHtml(formatDate(order.EntryDate))}</span>
            </div>
            <div class="meta-chip">
              <span class="meta-chip-label">Mã Công Việc</span>
              <span class="meta-chip-value" style="font-family: var(--font-mono); color: #818CF8;">${escapeHtml(order.WorkID || "---")}</span>
            </div>
            <div class="meta-chip">
              <span class="meta-chip-label">Bộ Phận Phụ Trách</span>
              <span class="meta-chip-value">${escapeHtml(order.DepartID || "---")}</span>
            </div>
            <div class="meta-chip">
              <span class="meta-chip-label">Kỳ Bảo Dưỡng</span>
              <span class="meta-chip-value">${escapeHtml(order.PeriodID || "---")}</span>
            </div>
            <div class="meta-chip">
              <span class="meta-chip-label">Thời Gian Dừng Máy</span>
              <span class="meta-chip-value">${order.Stoptime || 0} giờ</span>
            </div>
            <div class="meta-chip">
              <span class="meta-chip-label">Người Tạo Lệnh</span>
              <span class="meta-chip-value">${escapeHtml(order.CreatorID || "---")}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile Tab Dropdown Select (Visible on Mobile <= 900px) -->
      <div class="mobile-tab-dropdown-row">
        <label for="mobileTabSelect" class="mobile-tab-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          <span>Xem mục:</span>
        </label>
        <div class="mobile-tab-select-box">
          <select id="mobileTabSelect" class="mobile-tab-select">
            <option value="tab-execution" ${state.activeTab === 'tab-execution' ? 'selected' : ''}>⚡ Thực hiện từng thiết bị (${exec ? exec.machines.length : 0} máy)</option>
            <option value="tab-machines" ${state.activeTab === 'tab-machines' ? 'selected' : ''}>📋 Phân công thiết bị (${machines.length})</option>
            <option value="tab-tasks" ${state.activeTab === 'tab-tasks' ? 'selected' : ''}>📦 Hạng mục gốc &amp; Vật tư (${tasks_items.length})</option>
            <option value="tab-results" ${state.activeTab === 'tab-results' ? 'selected' : ''}>✅ Kết quả nghiệm thu (${results.length})</option>
          </select>
          <svg class="mobile-select-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      <!-- Navigation Tabs (Desktop) -->
      <div class="detail-tabs-bar">
        <button class="tab-btn ${state.activeTab === 'tab-execution' ? 'active' : ''}" data-target="tab-execution">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          Thực Hiện Từng Thiết Bị (M×N)
          <span class="tab-badge" style="background: #10B981; color: #FFFFFF;">${exec ? exec.machines.length : 0} máy</span>
        </button>

        <button class="tab-btn ${state.activeTab === 'tab-machines' ? 'active' : ''}" data-target="tab-machines">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
          </svg>
          Phân Công Thiết Bị
          <span class="tab-badge">${machines.length}</span>
        </button>

        <button class="tab-btn ${state.activeTab === 'tab-tasks' ? 'active' : ''}" data-target="tab-tasks">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          Hạng Mục Gốc & Vật Tư
          <span class="tab-badge">${tasks_items.length}</span>
        </button>

        <button class="tab-btn ${state.activeTab === 'tab-results' ? 'active' : ''}" data-target="tab-results">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          Kết Quả Nghiệm Thu
          <span class="tab-badge">${results.length}</span>
        </button>
      </div>

      <!-- Tab Panes -->
      <div class="detail-content">
        <!-- Tab 0: Execution Multi-Machine Matrix -->
        <div id="tab-execution" class="tab-pane ${state.activeTab === 'tab-execution' ? 'active' : ''}">
          ${renderExecutionMatrixPane(exec)}
        </div>

        <!-- Tab 1: Machines & Assignees -->
        <div id="tab-machines" class="tab-pane ${state.activeTab === 'tab-machines' ? 'active' : ''}">
          ${renderMachinesTable(machines)}
        </div>

        <!-- Tab 2: Tasks & Materials -->
        <div id="tab-tasks" class="tab-pane ${state.activeTab === 'tab-tasks' ? 'active' : ''}">
          ${renderTasksItemsTable(tasks_items)}
        </div>

        <!-- Tab 3: Execution Results -->
        <div id="tab-results" class="tab-pane ${state.activeTab === 'tab-results' ? 'active' : ''}">
          ${renderResultsTable(results)}
        </div>
      </div>
    </div>
  `;

  el.detailContainer.innerHTML = html;

  // Bind Collapsible Secondary Metadata Button
  const btnToggleMeta = document.getElementById("btnToggleOrderMeta");
  const metaCollapsible = document.getElementById("orderMetaCollapsible");
  if (btnToggleMeta && metaCollapsible) {
    btnToggleMeta.addEventListener("click", () => {
      const isNowCollapsed = metaCollapsible.classList.toggle("is-collapsed");
      btnToggleMeta.classList.toggle("active", !isNowCollapsed);
      const label = btnToggleMeta.querySelector(".meta-toggle-label");
      const icon = btnToggleMeta.querySelector(".meta-toggle-icon");
      if (label) {
        label.textContent = isNowCollapsed ? "Chi tiết" : "Thu gọn";
      }
      if (icon) {
        icon.innerHTML = isNowCollapsed
          ? '<polyline points="6 9 12 15 18 9"></polyline>'
          : '<polyline points="18 15 12 9 6 15"></polyline>';
      }
    });
  }

  // Bind Mobile Tab Select Dropdown
  const mobileTabSelect = document.getElementById("mobileTabSelect");
  if (mobileTabSelect) {
    mobileTabSelect.addEventListener("change", (e) => {
      const targetId = e.target.value;
      state.activeTab = targetId;

      el.detailContainer.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.target === targetId);
      });
      el.detailContainer.querySelectorAll(".tab-pane").forEach((p) => {
        p.classList.toggle("active", p.id === targetId);
      });
    });
  }

  // Bind tab buttons (Desktop)
  el.detailContainer.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      state.activeTab = targetId;

      el.detailContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      el.detailContainer.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");

      if (mobileTabSelect) mobileTabSelect.value = targetId;
    });
  });

  // Bind machine sub-tabs
  el.detailContainer.querySelectorAll(".machine-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const machineId = btn.dataset.machine;
      state.selectedMachineId = machineId;
      renderOrderDetailView();
    });
  });

  // Bind status change selects
  el.detailContainer.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const machineId = sel.dataset.machine;
      const taskDRowId = sel.dataset.taskDrow;
      const newStatus = sel.value;

      if (!state.currentUser) {
        showToast("Vui lòng đăng nhập để cập nhật tiến độ công việc", "warning");
        openLoginModal();
        sel.value = sel.dataset.originalStatus;
        return;
      }

      await updateTaskStatus(machineId, taskDRowId, newStatus);
    });
  });
}

// Render Execution Matrix (Multi-Machine Tabs & Task checklist)
function renderExecutionMatrixPane(exec) {
  if (!exec || !exec.machines || exec.machines.length === 0) {
    return `<div class="loading-state"><p>Không tìm thấy danh sách máy trong lệnh bảo dưỡng này.</p></div>`;
  }

  const activeMachine = state.selectedMachineId || exec.machines[0];
  const machineNames = exec.machine_names || {};
  const activeMachineName = machineNames[activeMachine] || activeMachine;
  const stats = exec.machine_stats[activeMachine] || { total: 0, completed: 0, in_progress: 0, issues: 0, percent: 0 };
  const tasks = exec.tasks_by_machine[activeMachine] || [];
  const machineHours = exec.machine_hours || {};
  const machineHoursDetails = exec.machine_hours_details || {};
  const activeHours = machineHours[activeMachine] != null ? Number(machineHours[activeMachine]) : 0;
  const activeHoursDetail = machineHoursDetails[activeMachine] || null;

  // Render Machine Selector Bar
  const machineTabsHtml = exec.machines.map((mId) => {
    const mStat = exec.machine_stats[mId] || { percent: 0, completed: 0, total: 0 };
    const mHours = machineHours[mId] != null ? Number(machineHours[mId]) : 0;
    const isActive = mId === activeMachine;
    const mName = machineNames[mId] || mId;
    return `
      <button class="machine-nav-btn ${isActive ? 'active' : ''}" data-machine="${escapeHtml(mId)}" title="${escapeHtml(mId)}: ${escapeHtml(mName)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        </svg>
        <span style="font-weight: 600;">${escapeHtml(mName)}</span>
        ${mHours > 0 ? `<span class="machine-hours-pill" title="Số giờ chạy máy: ${formatNumber(mHours)} giờ">⏱️ ${formatNumber(mHours)}h</span>` : ''}
        <span class="machine-nav-badge">${mStat.completed}/${mStat.total} (${mStat.percent}%)</span>
      </button>
    `;
  }).join("");

  // Render Task rows for active machine
  const rowsHtml = tasks.map((t, idx) => {
    const hasSample = !!t.sample_image_url;

    // Hiển thị ảnh mẫu SOP bên ngoài (chỉ hiển thị ảnh, không kèm chữ)
    const sampleImgHtml = hasSample ? `
      <div class="sop-sample-preview-cell" onclick="openSopModal('${escapeHtml(t.node_text || '')}', '${escapeHtml(t.service_text || '')}', '${escapeHtml(t.task_title || '')}', '${t.sample_image_url}', '${escapeHtml(t.standard_guideline || '')}')" title="Bấm để phóng to ảnh mẫu & xem tiêu chuẩn">
        <img src="${t.sample_image_url}" class="sop-sample-thumb-img" alt="Ảnh mẫu" onerror="this.onerror=null;this.src='/static/placeholder-camera.svg';">
      </div>
    ` : `
      <button class="btn-view-sop" onclick="openSopModal('${escapeHtml(t.node_text || '')}', '${escapeHtml(t.service_text || '')}', '${escapeHtml(t.task_title || '')}', '', '${escapeHtml(t.standard_guideline || '')}')" title="Xem tiêu chuẩn SOP">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span>SOP</span>
      </button>
    `;

    // Dropdown Trạng Thái
    const statusOptions = `
      <select class="status-select ${t.status}" data-machine="${escapeHtml(activeMachine)}" data-task-drow="${t.task_drow_id}" data-original-status="${t.status}">
        <option value="PENDING" ${t.status === 'PENDING' ? 'selected' : ''}>Chưa làm</option>
        <option value="IN_PROGRESS" ${t.status === 'IN_PROGRESS' ? 'selected' : ''}>Đang làm</option>
        <option value="COMPLETED" ${t.status === 'COMPLETED' ? 'selected' : ''}>Hoàn thành</option>
        <option value="ISSUE" ${t.status === 'ISSUE' ? 'selected' : ''}>Sự cố / Lỗi</option>
      </select>
    `;

    // Khung preview ảnh thực tế của kỹ thuật viên
    const proofThumbs = (t.proof_images || []).map((img) => {
      return `
        <div class="proof-thumb-box" title="${escapeHtml(img.Caption || 'Ảnh minh chứng')}">
          <img src="${img.FileUrl}" class="proof-thumb-img" alt="Minh chứng" onclick="openLightbox('${img.FileUrl}', '${escapeHtml(img.Caption || activeMachine)}')">
          <button class="proof-thumb-del" onclick="deleteProofImage(${img.id})" title="Xóa ảnh">&times;</button>
        </div>
      `;
    }).join("");

    const proofCellHtml = proofThumbs ? `
      <div class="proof-thumbs-gallery-centered">${proofThumbs}</div>
    ` : `<span class="proof-empty-hint">-</span>`;

    // Nút chụp ảnh
    const addProofBtn = `
      <button class="btn-add-proof-compact" onclick="openUploadProofModal('${escapeHtml(activeMachine)}', '${t.task_drow_id}', '${escapeHtml(t.task_title)}', '${escapeHtml(t.node_text || '')}', '${escapeHtml(t.service_text || '')}', '${t.sample_image_url || ''}', '${escapeHtml(t.standard_guideline || '')}')" title="Chụp hoặc tải ảnh minh chứng">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>Chụp ảnh</span>
      </button>
    `;

    return `
      <tr>
        <td style="color: var(--text-muted); text-align: center; width: 35px;">${idx + 1}</td>
        <td>
          <div style="font-weight: 600; color: #E0E7FF;">${escapeHtml(t.node_text || t.node_id || "Bộ phận")}</div>
          <span class="tag-service" style="margin-top: 4px; display: inline-block;">${escapeHtml(t.service_text || t.service_id || "Thao tác")}</span>
        </td>
        <td>
          <div style="font-weight: 500;">${escapeHtml(t.task_title)}</div>
          ${t.item_id ? `<div style="font-size: 0.75rem; color: #FBBF24; margin-top: 2px;">Vật tư: ${escapeHtml(t.item_id)} (SL: ${t.unit1_qty || 1})</div>` : ''}
          ${t.completed_by ? `<div style="font-size: 0.72rem; color: #34D399; margin-top: 2px;">KTV: ${escapeHtml(t.completed_by)} ${t.completed_at ? `(${escapeHtml(t.completed_at)})` : ''}</div>` : ''}
        </td>
        <td style="text-align: center;">${statusOptions}</td>
        <td style="text-align: center;">${sampleImgHtml}</td>
        <td style="text-align: center;">${proofCellHtml}</td>
        <td style="text-align: center;">${addProofBtn}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="execution-wrapper">
      <!-- Machine Tabs Bar -->
      <div class="machine-nav-bar">
        ${machineTabsHtml}
      </div>

      <!-- Unified Active Machine Progress & Running Hours Card -->
      <div class="machine-summary-card">
        <!-- Row 1: Active Machine Progress Bar -->
        <div class="summary-progress-row">
          <div class="summary-machine-title">
            <h4 style="font-size: 0.92rem; font-weight: 700; color: #FFFFFF; margin: 0; display: inline-flex; align-items: center; gap: 6px;">
              <span>Tiến độ thực hiện:</span>
              <span style="color: #60A5FA;">${escapeHtml(activeMachineName)}</span>
              ${activeMachine !== activeMachineName ? `<span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">(${escapeHtml(activeMachine)})</span>` : ''}
            </h4>
            <span class="machine-progress-desc" style="font-size: 0.75rem; color: var(--text-muted); margin-left: 8px;">Mỗi thiết bị độc lập thực hiện tất cả ${stats.total} hạng mục trong danh mục bảo dưỡng</span>
          </div>

          <div class="progress-info">
            <div class="progress-track" title="${stats.percent}%">
              <div class="progress-fill" style="width: ${stats.percent}%;"></div>
            </div>
            <span style="font-family: var(--font-mono); font-weight: 700; color: #34D399; font-size: 0.92rem;">${stats.percent}%</span>
            <span class="progress-stat-pill pill-comp">${stats.completed} xong</span>
            <span class="progress-stat-pill pill-prog">${stats.in_progress} đang làm</span>
            ${stats.issues > 0 ? `<span class="progress-stat-pill pill-issue">${stats.issues} sự cố</span>` : ''}
          </div>
        </div>

        <div class="summary-card-divider"></div>

        <!-- Row 2: Machine Running Hours (Odo) Input & Badge -->
        <div class="summary-hours-row">
          <div class="machine-hours-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>Số giờ chạy máy (Odo):</span>
          </div>
          <div class="machine-hours-controls">
            <div class="machine-hours-input-wrapper">
              <input 
                type="number" 
                id="input_hours_${escapeHtml(activeMachine)}" 
                class="machine-hours-input" 
                value="${activeHours > 0 ? activeHours : ''}" 
                placeholder="Nhập số giờ..." 
                step="any" 
                min="0"
                onkeydown="if(event.key==='Enter') saveMachineHours('${escapeHtml(activeMachine)}')"
              />
              <span class="machine-hours-suffix">giờ</span>
            </div>
            <button id="btn_save_hours_${escapeHtml(activeMachine)}" class="btn-save-machine-hours" onclick="saveMachineHours('${escapeHtml(activeMachine)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>Lưu giờ</span>
            </button>
            ${activeHours > 0 ? `
              <span class="machine-hours-saved-badge">
                <span class="saved-dot"></span>
                Đã ghi: <strong>${formatNumber(activeHours)}h</strong>
                ${activeHoursDetail && activeHoursDetail.UpdatedAt ? `<span class="saved-time">(${activeHoursDetail.UpdatedAt.slice(5, 16)})</span>` : ''}
              </span>
            ` : `
              <span class="machine-hours-empty-hint">Chưa ghi nhận số giờ</span>
            `}
          </div>
        </div>
      </div>

      <!-- Machine Tasks Table -->
      <div class="table-scroll-hint-mobile">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
        <span>Vuốt sang trái để xem Ảnh Mẫu &amp; Chụp Ảnh minh chứng ➔</span>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="text-align: center; width: 35px;">STT</th>
              <th style="width: 160px;">Cụm Máy &amp; Thao Tác</th>
              <th>Hạng Mục Thực Hiện</th>
              <th style="width: 125px; text-align: center;">Trạng Thái</th>
              <th style="width: 75px; text-align: center;">Ảnh Mẫu</th>
              <th style="width: 110px; text-align: center;">Ảnh Thực Tế</th>
              <th style="width: 105px; text-align: center;">Chụp Ảnh</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Update Task Status
async function updateTaskStatus(machineId, taskDRowId, status) {
  const token = getToken();
  if (!token) {
    showToast("Vui lòng đăng nhập trước khi thao tác", "warning");
    openLoginModal();
    return;
  }

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/task-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        machine_id: machineId,
        task_drow_id: taskDRowId,
        status: status,
        actual_hours: 0,
        remark: ""
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Không thể cập nhật trạng thái");
    }

    showToast(`Đã cập nhật trạng thái hạng mục thành công!`, "success");

    // Reload execution data to refresh stats and progress bar
    const execRes = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/execution`);
    if (execRes.ok) {
      state.currentExecutionData = await execRes.json();
      renderOrderDetailView();
    }
  } catch (err) {
    showToast(err.message, "error");
    renderOrderDetailView();
  }
}

// Upload Proof Photo Modal Handlers
window.openUploadProofModal = function (machineId, taskDRowId, taskTitle, nodeText = '', serviceText = '', sampleImageUrl = '', standardGuideline = '') {
  if (!state.currentUser) {
    showToast("Vui lòng đăng nhập để tải ảnh minh chứng", "warning");
    openLoginModal();
    return;
  }

  // Hiển thị modal ngay lập tức (0ms phản hồi trên mobile)
  el.uploadProofModal?.classList.add("active");

  el.proofMachineId.value = machineId;
  el.proofTaskDRowId.value = taskDRowId;
  const machineNames = state.currentExecutionData?.machine_names || {};
  const macDisplayName = machineNames[machineId] || machineId;
  el.proofTaskInfo.innerText = `${macDisplayName} • ${taskTitle}`;
  el.proofCaptionInput.value = "";
  state.proofSelectedFile = null;

  if (el.proofCameraInput) el.proofCameraInput.value = "";
  if (state.currentPreviewUrl) {
    URL.revokeObjectURL(state.currentPreviewUrl);
    state.currentPreviewUrl = null;
  }
  if (el.proofFilePreview) {
    el.proofFilePreview.style.display = "flex";
    el.proofFilePreview.innerHTML = `
      <div class="actual-placeholder">
        <div class="camera-icon-circle">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </div>
        <div class="actual-prompt-main">Chạm vào đây để chụp ảnh thực tế</div>
        <div class="actual-prompt-sub">Camera hiện trường • Tự động nén tối ưu</div>
      </div>
    `;
  }

  // Hiển thị ảnh mẫu SOP tham khảo trong modal (khung lớn, trực quan rõ nét)
  if (el.proofModalSampleBox) {
    if (sampleImageUrl) {
      el.proofModalSampleBox.innerHTML = `
        <div class="sop-ref-img-wrap-large" onclick="openLightbox('${sampleImageUrl}', 'Ảnh Mẫu SOP: ${escapeHtml(taskTitle)}')" title="Nhấp để phóng to ảnh mẫu">
          <img src="${sampleImageUrl}" alt="Ảnh mẫu SOP" class="sop-large-img" loading="eager" decoding="async">
          <span class="zoom-hint-pill">🔍 Bấm phóng to ảnh mẫu</span>
        </div>
      `;
    } else {
      el.proofModalSampleBox.innerHTML = `
        <div class="sop-ref-no-img-large">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <div style="font-weight: 600; color: #94A3B8;">Chưa có ảnh mẫu SOP cho hạng mục này</div>
        </div>
      `;
    }
  }

  // Hướng dẫn chụp ảnh kỹ thuật (hiện hướng dẫn mặc định nếu chưa có)
  if (el.proofModalGuideline) {
    const defaultGuide = `Tiêu chuẩn chụp ảnh minh chứng: Chụp cận cảnh rõ nét cụm ${nodeText || 'thiết bị'} (${taskTitle || 'hạng mục'}) khi thực hiện ${serviceText || 'bảo dưỡng'}. Thể hiện rõ hiện trạng trước/sau khi bảo dưỡng, độ sạch sẽ, bề mặt tiếp xúc, khe hở kỹ thuật hoặc mối nối bu lông.`;
    const finalGuide = (standardGuideline && standardGuideline.trim()) ? standardGuideline : defaultGuide;
    el.proofModalGuideline.innerHTML = escapeHtml(finalGuide).replace(/\n/g, "<br>");
  }
};

window.closeProofModal = function closeProofModal() {
  el.uploadProofModal?.classList.remove("active");
  state.proofSelectedFile = null;
  if (state.currentPreviewUrl) {
    URL.revokeObjectURL(state.currentPreviewUrl);
    state.currentPreviewUrl = null;
  }
};

/**
 * Nén & Tối ưu hóa ảnh chụp điện thoại thông minh (Non-blocking & Zero-Lag)
 * - Giải phóng bộ nhớ RAM bằng URL.createObjectURL và createImageBitmap
 * - Giảm kích thước ảnh gốc từ 10MB-30MB (48MP) xuống chuẩn HD 1600px (~250KB - 450KB)
 * - Tốc độ nén chỉ mất ~100ms, không làm đơ giật giao diện điện thoại
 * - Tốc độ upload và lưu trữ ảnh tăng gấp 30-50 lần
 */
async function compressImageForUpload(file, maxDimension = 1600, quality = 0.82) {
  if (!file || !file.type.startsWith("image/")) return file;

  // Nếu ảnh đã rất nhẹ (< 350KB) thì giữ nguyên
  if (file.size <= 350 * 1024) return file;

  const blobUrl = URL.createObjectURL(file);
  try {
    let sourceWidth, sourceHeight, drawSource;

    // Sử dụng createImageBitmap nếu trình duyệt hỗ trợ (chạy trên background thread, tự xử lý EXIF xoay ảnh)
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        drawSource = bitmap;
      } catch (err) {
        const bitmap = await createImageBitmap(file);
        sourceWidth = bitmap.width;
        sourceHeight = bitmap.height;
        drawSource = bitmap;
      }
    } else {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = blobUrl;
      });
      sourceWidth = img.naturalWidth;
      sourceHeight = img.naturalHeight;
      drawSource = img;
    }

    // Tính toán kích thước thu nhỏ theo tỷ lệ
    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    if (sourceWidth > maxDimension || sourceHeight > maxDimension) {
      if (sourceWidth >= sourceHeight) {
        targetWidth = maxDimension;
        targetHeight = Math.round((sourceHeight * maxDimension) / sourceWidth);
      } else {
        targetHeight = maxDimension;
        targetWidth = Math.round((sourceWidth * maxDimension) / sourceHeight);
      }
    }

    // Vẽ lên Canvas off-screen
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawSource, 0, 0, targetWidth, targetHeight);

    // Thu hồi bộ nhớ bitmap ngay lập tức
    if (drawSource && typeof drawSource.close === "function") {
      drawSource.close();
    }

    // Xuất ra Blob JPEG chất lượng cao
    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });

    if (!blob) return file;

    const cleanName = (file.name || "proof_photo.jpg").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], cleanName, {
      type: "image/jpeg",
      lastModified: Date.now()
    });
  } catch (err) {
    console.warn("Lỗi nén ảnh phía client, sử dụng tệp gốc:", err);
    return file;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function handleProofFileSelected(file) {
  if (!file.type.startsWith("image/")) {
    showToast("Vui lòng chọn định dạng file hình ảnh (JPG, PNG, WEBP)", "warning");
    return;
  }

  const originalSize = file.size;

  // Hiển thị trạng thái nén tối ưu ngay trong khung ảnh thực tế
  el.proofFilePreview.style.display = "flex";
  el.proofFilePreview.innerHTML = `
    <div class="actual-processing-box">
      <div class="spinner" style="width: 22px; height: 22px; border-width: 2.5px;"></div>
      <span style="font-size: 0.85rem; font-weight: 600; color: #93C5FD;">Đang xử lý &amp; nén tối ưu ảnh chụp siêu tốc...</span>
    </div>
  `;

  try {
    const compressedFile = await compressImageForUpload(file, 1600, 0.82);
    state.proofSelectedFile = compressedFile;

    // Dùng URL.createObjectURL để xem trước mượt mà, không tốn RAM heap base64
    if (state.currentPreviewUrl) {
      URL.revokeObjectURL(state.currentPreviewUrl);
    }
    const previewUrl = URL.createObjectURL(compressedFile);
    state.currentPreviewUrl = previewUrl;

    const compressedKb = (compressedFile.size / 1024).toFixed(0);

    el.proofFilePreview.innerHTML = `
      <div class="actual-preview-inner">
        <img src="${previewUrl}" alt="Ảnh chụp thực tế" class="actual-preview-img">
        <div class="actual-preview-overlay">
          <div class="actual-status-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Đã chụp • ${compressedKb} KB</span>
          </div>
          <div class="actual-action-pills">
            <span class="actual-retake-pill">🔄 Chạm để chụp lại</span>
            <button type="button" class="actual-zoom-pill" onclick="event.stopPropagation(); event.preventDefault(); openLightbox('${previewUrl}', 'Ảnh chụp minh chứng: ${escapeHtml(el.proofTaskInfo?.innerText || '')}')" title="Xem ảnh lớn">
              🔍 Xem lớn
            </button>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    state.proofSelectedFile = file;
    const fallbackUrl = URL.createObjectURL(file);
    state.currentPreviewUrl = fallbackUrl;
    el.proofFilePreview.innerHTML = `
      <div class="actual-preview-inner">
        <img src="${fallbackUrl}" alt="Xem trước" class="actual-preview-img">
        <div class="actual-preview-overlay">
          <div class="actual-status-pill">
            <span>Đã chọn ảnh: ${(file.size / 1024).toFixed(0)} KB</span>
          </div>
          <div class="actual-action-pills">
            <span class="actual-retake-pill">🔄 Chạm để chọn lại</span>
          </div>
        </div>
      </div>
    `;
  }
}

async function submitProofUpload(e) {
  e.preventDefault();
  const token = getToken();
  if (!token) {
    showToast("Vui lòng đăng nhập trước khi tải ảnh", "warning");
    openLoginModal();
    return;
  }

  if (!state.proofSelectedFile) {
    showToast("Vui lòng chạm vào khung ảnh để chụp ảnh trước khi lưu", "warning");
    return;
  }

  const machineId = el.proofMachineId.value;
  const taskDRowId = el.proofTaskDRowId.value;
  const caption = el.proofCaptionInput.value.trim();

  const submitBtn = el.btnSubmitProofModal;
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; margin: 0 auto;"></div> Đang lưu ảnh...';

  try {
    const formData = new FormData();
    formData.append("file", state.proofSelectedFile);
    formData.append("machine_id", machineId);
    formData.append("task_drow_id", taskDRowId);
    formData.append("caption", caption);

    const res = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/upload-proof`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Lỗi khi lưu ảnh ");
    }

    showToast("Đã lưu ảnh thành công!", "success");
    closeProofModal();

    // Reload execution to display new photo
    const execRes = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/execution`);
    if (execRes.ok) {
      state.currentExecutionData = await execRes.json();
      renderOrderDetailView();
    }
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

// Delete Proof Image
window.deleteProofImage = async function (imageId) {
  const token = getToken();
  if (!token) {
    showToast("Vui lòng đăng nhập để xóa ảnh", "warning");
    openLoginModal();
    return;
  }

  if (!confirm("Bạn có chắc chắn muốn xóa ảnh minh chứng này?")) return;

  try {
    const res = await fetch(`/api/orders/proof-images/${imageId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Không thể xóa ảnh");
    }

    showToast("Đã xóa ảnh minh chứng", "info");
    const execRes = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/execution`);
    if (execRes.ok) {
      state.currentExecutionData = await execRes.json();
      renderOrderDetailView();
    }
  } catch (err) {
    showToast(err.message, "error");
  }
};

// SOP Modal
window.openSopModal = function (nodeText, serviceText, taskTitle, sampleImageUrl, standardGuideline) {
  el.sopModalTitle.innerText = `SOP Chuẩn: ${taskTitle}`;
  el.sopModalMeta.innerText = `Cụm máy: ${nodeText} • Thao tác kỹ thuật: ${serviceText}`;

  if (sampleImageUrl) {
    el.sopModalImgWrapper.innerHTML = `
      <div style="text-align: center; margin-bottom: 14px;">
        <span style="font-size: 0.75rem; color: #60A5FA; display: block; margin-bottom: 6px; font-weight: 600;">
          ẢNH MẪU CHUẨN (Bấm vào để phóng to)
        </span>
        <img src="${sampleImageUrl}" alt="Ảnh mẫu SOP" style="max-height: 240px; max-width: 100%; border-radius: 8px; border: 1px solid var(--accent-primary); cursor: pointer;" onclick="openLightbox('${sampleImageUrl}', '${escapeHtml(taskTitle)}')">
      </div>
    `;
  } else {
    el.sopModalImgWrapper.innerHTML = `
      <div class="tmpl-no-img" style="width: 100%; height: 90px; margin-bottom: 14px; border-radius: 8px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        <span style="font-size: 0.8rem;">Hạng mục này chưa cập nhật ảnh mẫu chuẩn</span>
        <a href="/categories" style="color: #818CF8; font-size: 0.75rem; margin-top: 4px;">Tới Thư Viện Hạng Mục để thêm ảnh mẫu</a>
      </div>
    `;
  }

  const defaultGuide = `Tiêu chuẩn kỹ thuật: Kiểm tra, bảo dưỡng cụm ${nodeText || 'thiết bị'} (${taskTitle || 'hạng mục'}) theo đúng quy trình ${serviceText || 'bảo dưỡng'}. Chụp ảnh cận cảnh thể hiện rõ kết quả sau khi hoàn thành, đảm bảo bề mặt sạch sẽ, các bu lông được siết chặt và các khe hở kỹ thuật đạt tiêu chuẩn.`;
  const finalGuide = (standardGuideline && standardGuideline.trim()) ? standardGuideline : defaultGuide;
  el.sopModalGuideline.innerHTML = escapeHtml(finalGuide).replace(/\n/g, "<br>");

  el.sopModal?.classList.add("active");
};

function closeSopModal() {
  el.sopModal?.classList.remove("active");
}

// Lightbox
window.openLightbox = function (imgSrc, caption) {
  if (el.lightboxModal && el.lightboxImg) {
    el.lightboxImg.src = imgSrc;
    if (el.lightboxCaption) el.lightboxCaption.innerText = caption || "";
    el.lightboxModal.classList.add("active");
  }
};

function closeLightbox() {
  el.lightboxModal?.classList.remove("active");
}

// Render Machines Table (Tab Phân Công Thiết Bị gốc)
function renderMachinesTable(machines) {
  if (!machines || machines.length === 0) {
    return `<div class="loading-state"><p>Lệnh này chưa gán máy hoặc phân công nhân sự cụ thể.</p></div>`;
  }

  const rowsHtml = machines.map((m, idx) => {
    const techList = [m.Emp1ID, m.Emp2ID, m.Emp3ID, m.Emp4ID, m.Emp5ID]
      .filter(Boolean)
      .join(", ");
    const hOdo = m.HourOdo != null ? Number(m.HourOdo) : 0;
    const macDisplayName = m.MachineText || m.MachineName || m.MachineID;
    return `
      <tr>
        <td style="color: var(--text-muted); text-align: center; width: 40px;">${idx + 1}</td>
        <td>
          <div style="font-weight: 700; color: #60A5FA; font-size: 0.92rem;">${escapeHtml(macDisplayName)}</div>
          ${m.MachineID && m.MachineID !== macDisplayName ? `<div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">Mã: ${escapeHtml(m.MachineID)}</div>` : ''}
        </td>
        <td>
          ${hOdo > 0 ? `<span class="machine-hours-pill" style="font-size:0.78rem; padding: 2px 8px;">⏱️ ${formatNumber(hOdo)} h</span>` : '<span style="color: var(--text-muted); font-size:0.75rem;">Chưa nhập</span>'}
        </td>
        <td>${escapeHtml(formatDate(m.WorkDate))}</td>
        <td>${techList ? `<span style="font-weight: 600; color: #34D399;">${escapeHtml(techList)}</span>` : '<span style="color: var(--text-muted)">Chưa phân công</span>'}</td>
        <td>${escapeHtml(m.Remark || "---")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: center; width: 40px;">STT</th>
            <th>Tên Thiết Bị / Máy Móc</th>
            <th style="width: 140px;">Số Giờ Chạy Máy</th>
            <th>Ngày Bảo Dưỡng Dự Kiến</th>
            <th>Kỹ Thuật Viên Phân Công</th>
            <th>Ghi Chú Phân Công</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

// Render Tasks & Materials Table (Tab Hạng Mục Gốc)
function renderTasksItemsTable(items) {
  if (!items || items.length === 0) {
    return `<div class="loading-state"><p>Chưa có chi tiết hạng mục hoặc vật tư cho lệnh này.</p></div>`;
  }

  const rowsHtml = items.map((it, idx) => {
    return `
      <tr>
        <td style="color: var(--text-muted); text-align: center; width: 40px;">${idx + 1}</td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(it.NodeText || it.NodeID || "Bộ phận chung")}</div>
          ${it.NodeID ? `<div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(it.NodeID)}</div>` : ''}
        </td>
        <td>
          <span class="tag-service">${escapeHtml(it.ServiceText || it.ServiceID || "Thao tác")}</span>
        </td>
        <td>${it.Duration ? `${it.Duration}h` : '---'}</td>
        <td>
          ${it.ItemID ? `<span style="font-family: var(--font-mono); color: #FBBF24;">${escapeHtml(it.ItemID)}</span>` : '<span style="color: var(--text-muted);">---</span>'}
        </td>
        <td>
          ${it.Unit1Qty ? `<span class="qty-val">${it.Unit1Qty}</span>` : '<span style="color: var(--text-muted);">0</span>'}
        </td>
        <td>${escapeHtml(it.Remark || "---")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: center; width: 40px;">STT</th>
            <th>Cụm / Bộ Phận Máy</th>
            <th>Thao Tác Bảo Dưỡng</th>
            <th>Thời Gian</th>
            <th>Mã Phụ Tùng / Vật Tư</th>
            <th>Số Lượng</th>
            <th>Nội Dung Thao Tác Chi Tiết</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

// Render Results Table (Tab Kết Quả Nghiệm Thu)
function renderResultsTable(results) {
  if (!results || results.length === 0) {
    return `
      <div class="loading-state">
        <p>Chưa có biên bản kết quả nghiệm thu bảo dưỡng cho lệnh này.</p>
        <span style="font-size: 0.8rem; color: var(--text-muted);">Phiếu sẽ được cập nhật tự động khi bộ phận kỹ thuật nghiệm thu trên hệ thống.</span>
      </div>
    `;
  }

  const rowsHtml = results.map((r, idx) => {
    return `
      <tr>
        <td style="color: var(--text-muted); text-align: center; width: 40px;">${idx + 1}</td>
        <td><strong style="font-family: var(--font-mono); color: #818CF8;">${escapeHtml(r.EntryID)}</strong></td>
        <td>${escapeHtml(formatDate(r.EntryDate))}</td>
        <td><strong style="font-family: var(--font-mono); color: #93C5FD;">${escapeHtml(r.MachineID || "---")}</strong></td>
        <td>
          ${r.HourOdo ? `<span style="font-family: var(--font-mono); font-weight: 700; color: #34D399;">${r.HourOdo.toLocaleString()} h</span>` : '---'}
        </td>
        <td><strong>${escapeHtml(r.RevName || r.RevEmpID || "---")}</strong></td>
        <td>${escapeHtml(r.Memo || r.RevText || "Đã hoàn thành")}</td>
        <td>
          ${r.Approved === 3 ? `<span class="badge badge-approved">Đã duyệt</span>` : `<span class="badge badge-pending">Chờ duyệt</span>`}
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: center; width: 40px;">STT</th>
            <th>Số Nghiệm Thu</th>
            <th>Ngày Nghiệm Thu</th>
            <th>Mã Máy</th>
            <th>Số Giờ Máy (ODO)</th>
            <th>Người Nghiệm Thu</th>
            <th>Đánh Giá / Kết Quả</th>
            <th>Trạng Thái</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

// Utility: Format Date
function formatDate(dateStr) {
  if (!dateStr) return "---";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  } catch (e) { }
  return dateStr;
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Utility: Format Number
function formatNumber(num) {
  if (num == null || isNaN(num)) return "0";
  return Number(num).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

// Lưu số giờ chạy máy (HourOdo / Odometer)
async function saveMachineHours(machineId) {
  if (!state.selectedEntryId || !machineId) return;

  const inputEl = document.getElementById(`input_hours_${machineId}`);
  if (!inputEl) return;

  const rawVal = inputEl.value.trim();
  if (rawVal === "") {
    showToast("Vui lòng nhập số giờ chạy máy", "warning");
    inputEl.focus();
    return;
  }

  const hours = parseFloat(rawVal);
  if (isNaN(hours) || hours < 0) {
    showToast("Số giờ chạy máy phải lớn hơn hoặc bằng 0", "warning");
    inputEl.focus();
    return;
  }

  const btn = document.getElementById(`btn_save_hours_${machineId}`);
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Lưu...`;
  }

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(state.selectedEntryId)}/machines/${encodeURIComponent(machineId)}/hours`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.currentUser && state.currentUser.token ? { "Authorization": `Bearer ${state.currentUser.token}` } : {})
      },
      body: JSON.stringify({
        hour_odo: hours
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Không thể lưu số giờ chạy máy");
    }

    const resJson = await res.json();
    showToast(resJson.message || `Đã lưu ${formatNumber(hours)} giờ cho máy ${machineId}`, "success");

    // Cập nhật local state
    if (!state.currentExecutionData) state.currentExecutionData = {};
    if (!state.currentExecutionData.machine_hours) state.currentExecutionData.machine_hours = {};
    if (!state.currentExecutionData.machine_hours_details) state.currentExecutionData.machine_hours_details = {};

    state.currentExecutionData.machine_hours[machineId] = hours;
    state.currentExecutionData.machine_hours_details[machineId] = {
      MachineID: machineId,
      HourOdo: hours,
      UpdatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      UpdatedBy: (state.currentUser && state.currentUser.full_name) || "KỸ THUẬT VIÊN"
    };

    if (state.orderDetail && state.orderDetail.machines) {
      const found = state.orderDetail.machines.find(m => m.MachineID === machineId);
      if (found) found.HourOdo = hours;
    }

    // Giữ nguyên scroll và re-render giao diện chi tiết
    renderOrderDetailView();
  } catch (err) {
    console.error("saveMachineHours error:", err);
    showToast(err.message || "Lỗi khi lưu số giờ máy", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}
window.saveMachineHours = saveMachineHours;
window.formatNumber = formatNumber;

