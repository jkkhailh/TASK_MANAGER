// BOPP Maintenance - Categories & SOP Library Logic (Master-Detail & Unified Search)

let allTemplates = [];
let allWorks = [];
let selectedWorkId = null; // null = "Tất cả"
let currentUser = null;
let selectedFile = null;

// High Performance Pagination State
let currentPage = 1;
let pageSize = 50;
let currentFilteredTemplates = [];
// Pre-indexed map for lightning-fast child template lookup
let templatesByWork = new Map();

function debounce(fn, delay = 150) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// =========================================================================
// 1. TOAST & AUTHENTICATION
// =========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span>${message}</span>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function getToken() {
  return localStorage.getItem('bopp_token');
}

function setToken(token) {
  if (token) {
    localStorage.setItem('bopp_token', token);
  } else {
    localStorage.removeItem('bopp_token');
  }
}

async function checkAuth() {
  const token = getToken();
  if (!token) {
    currentUser = null;
    renderUserChip();
    return null;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user || data;
      renderUserChip();
      return currentUser;
    } else {
      setToken(null);
      currentUser = null;
      renderUserChip();
      return null;
    }
  } catch (err) {
    currentUser = null;
    renderUserChip();
    return null;
  }
}

function renderUserChip() {
  const chipContainer = document.getElementById('userProfileChip');
  if (!chipContainer) return;

  if (currentUser) {
    const roleColors = { admin: '#EF4444', supervisor: '#F59E0B', technician: '#10B981' };
    const roleLabels = { admin: 'Quản trị', supervisor: 'Giám sát', technician: 'Kỹ thuật viên' };
    const color = roleColors[currentUser.role] || '#6366F1';
    const label = roleLabels[currentUser.role] || currentUser.role;
    const initial = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();

    chipContainer.innerHTML = `
      <button type="button" id="btnLogoutUserBtn" class="user-avatar-btn" title="Tài khoản: ${escapeHtml(currentUser.full_name || currentUser.username)} (${label}) - Nhấp để đăng xuất" style="--avatar-color: ${color};">
        <span class="avatar-letter">${initial}</span>
        <span class="user-status-dot" style="background: ${color};"></span>
      </button>
    `;

    document.getElementById('btnLogoutUserBtn')?.addEventListener('click', () => {
      if (confirm(`Đăng xuất khỏi tài khoản "${currentUser.full_name || currentUser.username}"?`)) {
        setToken(null);
        currentUser = null;
        renderUserChip();
        showToast('Đã đăng xuất thành công', 'info');
      }
    });
  } else {
    chipContainer.innerHTML = `
      <button type="button" id="btnOpenLoginModal" class="user-avatar-btn is-guest" title="Đăng Nhập">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
    `;
    document.getElementById('btnOpenLoginModal')?.addEventListener('click', openLoginModal);
  }
}

function openLoginModal() {
  document.getElementById('loginModal')?.classList.add('active');
}

function closeLoginModal() {
  document.getElementById('loginModal')?.classList.remove('active');
}

// =========================================================================
// 2. DATA LOADING & IN-MEMORY INITIALIZATION
// =========================================================================

async function loadWorks() {
  try {
    const res = await fetch('/api/works');
    if (!res.ok) throw new Error('Không thể tải danh mục bảo trì');
    const data = await res.json();
    allWorks = data.works || [];
    
    // Update master total badge
    const badge = document.getElementById('masterTotalBadge');
    if (badge) badge.innerText = allWorks.length;
  } catch (err) {
    console.warn('Lỗi khi tải danh mục works:', err);
  }
}

async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    if (!res.ok) throw new Error('Không thể tải danh mục chi tiết công việc');
    const data = await res.json();
    const rawList = Array.isArray(data) ? data : (data.templates || []);
    allTemplates = rawList.map(t => ({
      ...t,
      TemplateID: t.TemplateID !== undefined ? t.TemplateID : t.id,
      CategoryName: t.CategoryName || t.TaskTitle || '',
      NodeName: t.NodeName || t.NodeText || 'Chung',
      ServiceName: t.ServiceName || t.ServiceText || 'Bảo dưỡng',
      SampleImageUrl: t.SampleImageUrl || t.sample_image_url || '',
      ProofCount: Number(t.ProofCount || 0),
      WorkID: t.WorkID || '',
      WorkText: t.WorkText || '',
      ModelID: t.ModelID || '',
      ItemID: t.ItemID || '',
      ItemText: t.ItemText || '',
      Unit0ID: t.Unit0ID || '',
      Unit1Qty: t.Unit1Qty || 0,
      Duration: t.Duration || 0
    }));

    // Build pre-indexed map for lightning-fast O(1) child lookup
    templatesByWork.clear();
    allTemplates.forEach(t => {
      if (t.WorkID) {
        if (!templatesByWork.has(t.WorkID)) templatesByWork.set(t.WorkID, []);
        templatesByWork.get(t.WorkID).push(t);
      }
    });

    // Update all tasks count badge
    const allBadge = document.getElementById('allWorkTasksBadge');
    if (allBadge) allBadge.innerText = `${allTemplates.length} việc`;

    // Populate dynamic filters
    populateServiceFilter(allTemplates);
  } catch (err) {
    console.error('Lỗi loadTemplates:', err);
    showToast(`Lỗi khi tải chi tiết công việc: ${err.message}`, 'error');
  }
}

function populateServiceFilter(templates) {
  const serviceSelect = document.getElementById('filterServiceSelect');

  if (serviceSelect) {
    const curVal = serviceSelect.value;
    const svcMap = new Map();
    templates.forEach(t => {
      if (t.ServiceID && !svcMap.has(t.ServiceID)) {
        svcMap.set(t.ServiceID, t.ServiceName);
      }
    });
    let html = '<option value="">-- Tất cả thao tác --</option>';
    svcMap.forEach((name, id) => {
      html += `<option value="${escapeHtml(id)}">${escapeHtml(name || id)}</option>`;
    });
    serviceSelect.innerHTML = html;
    if (curVal && svcMap.has(curVal)) serviceSelect.value = curVal;
  }
}

// =========================================================================
// 3. MASTER CATEGORY SIDEBAR (DANH MỤC LỚN)
// =========================================================================

function renderMasterCategoryList(filteredWorks = null, query = '') {
  const container = document.getElementById('masterWorkList');
  if (!container) return;

  const works = filteredWorks || allWorks;
  const allCard = document.getElementById('btnSelectAllWorks');

  if (allCard) {
    if (!selectedWorkId) {
      allCard.classList.add('active');
    } else {
      allCard.classList.remove('active');
    }
  }

  if (works.length === 0) {
    container.innerHTML = `
      <div class="master-empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span>Không tìm thấy hạng mục lớn nào khớp từ khóa</span>
      </div>
    `;
    return;
  }

  container.innerHTML = works.map(w => {
    const isActive = selectedWorkId === w.WorkID;
    const taskCount = w.TaskCount !== undefined ? w.TaskCount : ((templatesByWork.get(w.WorkID) || []).length);
    
    // Check search matches if query is active
    let matchBadgeHtml = '';
    if (query && w.matchingTaskCount !== undefined) {
      if (w.matchingTaskCount > 0) {
        matchBadgeHtml = `<span class="master-match-badge">${w.matchingTaskCount} việc khớp</span>`;
      } else if (w.isNameMatch) {
        matchBadgeHtml = `<span class="master-match-badge" style="background: rgba(16, 185, 129, 0.2); color: #34D399;">Khớp tên</span>`;
      }
    }

    const titleHtml = query ? highlightText(w.WorkText || w.WorkID, query) : escapeHtml(w.WorkText || w.WorkID);
    const codeHtml = query ? highlightText(w.WorkID, query) : escapeHtml(w.WorkID);

    return `
      <div class="master-card ${isActive ? 'active' : ''}" data-work-id="${escapeHtml(w.WorkID)}" onclick="selectCategory('${escapeHtml(w.WorkID)}')">
        <div class="master-card-header">
          <span class="badge-workid">[${codeHtml}]</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            ${matchBadgeHtml}
            <span class="master-task-badge">${taskCount} việc</span>
          </div>
        </div>
        <div class="master-card-title">${titleHtml}</div>
        <div class="master-card-meta">
          <span>Kiểu: <strong>${escapeHtml(w.ModelID || '---')}</strong></span>
          ${w.CycleHour > 0 ? `<span>• Chu kỳ: <strong>${w.CycleHour.toLocaleString()}h</strong></span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function selectCategory(workId) {
  selectedWorkId = workId || null;
  currentPage = 1;

  // Re-filter and render
  filterTemplates(true);

  // Scroll active card into view if needed
  if (selectedWorkId) {
    const activeEl = document.querySelector(`.master-card[data-work-id="${selectedWorkId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

// =========================================================================
// 4. DETAIL BANNER & STATS
// =========================================================================

function updateCategoryDetailCard(workId, currentTemplates = []) {
  const card = document.getElementById('categoryDetailCard');
  const thParent = document.getElementById('thParentWork');
  if (!card) return;

  if (!workId) {
    // Mode "Tất Cả"
    card.style.display = 'none';
    if (thParent) thParent.style.display = '';
    return;
  }

  // Hide the "Hạng Mục Lớn" column in table when a specific category is active
  if (thParent) thParent.style.display = 'none';

  const work = allWorks.find(w => w.WorkID === workId);
  if (work) {
    card.style.display = 'block';
    document.getElementById('cardWorkID').innerText = work.WorkID;
    document.getElementById('cardModelID').innerText = `Kiểu máy: ${work.ModelID || '---'}`;
    document.getElementById('cardWorkType').innerText = `Phân loại: ${work.WorkType || '1BT'}`;
    document.getElementById('cardWorkText').innerText = work.WorkText || work.WorkID;
    document.getElementById('cardCycleHour').innerText = work.CycleHour ? `${work.CycleHour.toLocaleString()} giờ` : '---';
    document.getElementById('cardCycleDay').innerText = work.CycleDay || 0;
    
    // Tasks stats for this category from pre-indexed map
    const categoryTasks = templatesByWork.get(workId) || [];
    const sampleCount = categoryTasks.filter(t => !!t.SampleImageUrl).length;
    const proofCount = categoryTasks.filter(t => t.ProofCount > 0).length;

    document.getElementById('cardTaskCount').innerText = `${categoryTasks.length} công việc`;
    document.getElementById('bannerStatSampleCount').innerText = `${sampleCount} / ${categoryTasks.length}`;
    document.getElementById('bannerStatProofCount').innerText = `${proofCount} việc có ảnh`;
  } else {
    card.style.display = 'none';
    if (thParent) thParent.style.display = '';
  }
}

// =========================================================================
// 5. UNIFIED SEARCH & FILTER ENGINE
// =========================================================================

function filterTemplates(resetPage = true) {
  if (resetPage) {
    currentPage = 1;
  }
  const searchInput = document.getElementById('tmplSearchInput');
  const query = (searchInput?.value || '').trim().toLowerCase();
  const selectedService = document.getElementById('filterServiceSelect')?.value || '';
  const imageStatus = document.getElementById('filterImageStatus')?.value || '';
  const searchBadge = document.getElementById('searchMatchCount');

  // 1. Filter Major Works (for Sidebar)
  let matchingWorks = allWorks.map(w => {
    // Child templates under this work via fast pre-indexed map
    const childTemplates = templatesByWork.get(w.WorkID) || [];
    
    // Check work header match
    const isNameMatch = query ? (
      (w.WorkID && w.WorkID.toLowerCase().includes(query)) ||
      (w.WorkText && w.WorkText.toLowerCase().includes(query)) ||
      (w.ModelID && w.ModelID.toLowerCase().includes(query)) ||
      (w.WorkType && w.WorkType.toLowerCase().includes(query))
    ) : false;

    // Count matching child tasks
    let matchingTasks = 0;
    if (query) {
      matchingTasks = childTemplates.filter(t => isTemplateMatchQuery(t, query)).length;
    }

    return {
      ...w,
      isNameMatch,
      matchingTaskCount: matchingTasks,
      isRelevant: !query || isNameMatch || matchingTasks > 0
    };
  });

  if (query) {
    matchingWorks = matchingWorks.filter(w => w.isRelevant);
  }

  // Render left sidebar with match badges
  renderMasterCategoryList(matchingWorks, query);

  // 2. Filter Detail Templates (for Right Table)
  currentFilteredTemplates = allTemplates.filter(t => {
    // If a work is selected in sidebar, strictly filter by that work
    if (selectedWorkId && t.WorkID !== selectedWorkId) return false;

    // Filter by Service
    if (selectedService && t.ServiceID !== selectedService) return false;

    // Filter by Image Status
    if (imageStatus === 'has_sample' && !t.SampleImageUrl) return false;
    if (imageStatus === 'no_sample' && t.SampleImageUrl) return false;
    if (imageStatus === 'has_proof' && (!t.ProofCount || t.ProofCount <= 0)) return false;

    // Filter by Search Query
    if (query && !isTemplateMatchQuery(t, query)) return false;

    return true;
  });

  // Update Search Counter Badge
  if (searchBadge) {
    if (query) {
      searchBadge.style.display = 'inline-block';
      searchBadge.innerText = `${currentFilteredTemplates.length} việc khớp`;
    } else {
      searchBadge.style.display = 'none';
    }
  }

  // Update Category Detail Card Banner
  updateCategoryDetailCard(selectedWorkId, currentFilteredTemplates);

  // Calculate high-performance pagination slice
  const totalItems = currentFilteredTemplates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pagedList = currentFilteredTemplates.slice(startIndex, endIndex);

  // Render Right Table with paged slice
  renderTemplatesTable(pagedList, query, startIndex, totalItems);

  // Update Pagination Controls
  updatePaginationControls(totalItems, totalPages, startIndex, endIndex);
}

function updatePaginationControls(totalItems, totalPages, startIndex, endIndex) {
  const paginationWrap = document.getElementById('tmplPaginationWrap');
  if (!paginationWrap) return;

  if (totalItems === 0) {
    paginationWrap.style.display = 'none';
    return;
  }

  paginationWrap.style.display = 'flex';

  const infoText = document.getElementById('paginationInfoText');
  if (infoText) {
    infoText.innerHTML = `Hiển thị <strong>${startIndex + 1} - ${endIndex}</strong> trong tổng số <strong>${totalItems.toLocaleString()}</strong> công việc`;
  }

  const pageNum = document.getElementById('paginationPageNum');
  if (pageNum) {
    pageNum.innerText = `Trang ${currentPage} / ${totalPages}`;
  }

  const btnFirst = document.getElementById('btnPageFirst');
  const btnPrev = document.getElementById('btnPagePrev');
  const btnNext = document.getElementById('btnPageNext');
  const btnLast = document.getElementById('btnPageLast');

  if (btnFirst) btnFirst.disabled = (currentPage <= 1);
  if (btnPrev) btnPrev.disabled = (currentPage <= 1);
  if (btnNext) btnNext.disabled = (currentPage >= totalPages);
  if (btnLast) btnLast.disabled = (currentPage >= totalPages);
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(currentFilteredTemplates.length / pageSize));
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  if (page === currentPage) return;
  currentPage = page;
  filterTemplates(false);
  const tableWrap = document.querySelector('.master-detail-table-wrap');
  if (tableWrap) tableWrap.scrollTop = 0;
}

function isTemplateMatchQuery(t, query) {
  if (!query) return true;
  return (
    (t.CategoryName && t.CategoryName.toLowerCase().includes(query)) ||
    (t.WorkID && t.WorkID.toLowerCase().includes(query)) ||
    (t.WorkText && t.WorkText.toLowerCase().includes(query)) ||
    (t.NodeName && t.NodeName.toLowerCase().includes(query)) ||
    (t.ServiceName && t.ServiceName.toLowerCase().includes(query)) ||
    (t.ItemID && t.ItemID.toLowerCase().includes(query)) ||
    (t.ItemText && t.ItemText.toLowerCase().includes(query)) ||
    (t.StandardGuideline && t.StandardGuideline.toLowerCase().includes(query))
  );
}

function highlightText(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const escaped = escapeHtml(text);
  return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =========================================================================
// 6. DETAIL TASKS TABLE RENDERING
// =========================================================================

function renderTemplatesTable(templates, query = '', startIndex = 0, totalCount = null) {
  const list = Array.isArray(templates) ? templates : [];
  const tbody = document.getElementById('tmplTableBody');
  const counter = document.getElementById('tmplCounter');
  const isViewingAll = !selectedWorkId;

  if (counter) {
    const displayTotal = totalCount !== null ? totalCount : list.length;
    if (selectedWorkId) {
      const work = allWorks.find(w => w.WorkID === selectedWorkId);
      counter.innerText = `${displayTotal} công việc chi tiết của [${selectedWorkId}] ${work?.WorkText || ''}`;
    } else {
      counter.innerText = `${displayTotal.toLocaleString()} công việc chi tiết (${allWorks.length} danh mục lớn)`;
    }
  }

  if (!tbody) return;

  if (list.length === 0) {
    const isFiltered = !!query || !!document.getElementById('filterServiceSelect')?.value || !!document.getElementById('filterImageStatus')?.value;
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 50px 20px; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 10px;">🔍</div>
          <div style="font-size: 15px; font-weight: 600; color: #E2E8F0; margin-bottom: 6px;">Không tìm thấy hạng mục nào phù hợp</div>
          <div style="font-size: 13px;">Hãy thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc để xem đầy đủ danh mục.</div>
          ${isFiltered ? `
            <div style="margin-top: 14px;">
              <button type="button" class="btn-secondary" style="font-size: 12px; padding: 6px 14px; display: inline-flex; align-items: center; gap: 6px;" onclick="resetAllFilters()">
                <span>↺ Xóa tất cả bộ lọc &amp; từ khóa</span>
              </button>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map((t, idx) => {
    const hasSample = !!t.SampleImageUrl;
    const proofCount = Number(t.ProofCount || 0);
    const itemNumber = startIndex + idx + 1;

    // 1. Column Sample Image
    const sampleImgHtml = hasSample ? `
      <div class="tmpl-thumb-wrapper" onclick="openLightbox('${t.SampleImageUrl}', '${escapeHtml(t.CategoryName)} - Ảnh Mẫu SOP')">
        <img src="${t.SampleImageUrl}" alt="Ảnh mẫu SOP" class="tmpl-thumb-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/static/placeholder-camera.svg';">
        <span class="tmpl-thumb-badge">Ảnh mẫu</span>
      </div>
    ` : `
      <div class="tmpl-no-img">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        <span>Chưa có ảnh</span>
      </div>
    `;

    // 2. Column Technician Proof Images Button
    const proofBtnHtml = proofCount > 0 ? `
      <button class="btn-proof-history has-proof" onclick="openProofHistoryModal(${t.TemplateID})" title="Xem ${proofCount} hình ảnh kỹ thuật viên đã chụp khi thực hiện">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>${proofCount} ảnh</span>
      </button>
    ` : `
      <button class="btn-proof-history" onclick="openProofHistoryModal(${t.TemplateID})" title="Xem lịch sử ảnh chụp thực tế">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>0 ảnh</span>
      </button>
    `;

    // 3. Column Material / Spare parts
    let itemHtml = '';
    if (t.ItemID && t.ItemID.trim()) {
      itemHtml = `
        <div style="font-weight: 600; color: #F59E0B; font-size: 11px; font-family: 'JetBrains Mono', monospace;">${highlightText(t.ItemID, query)}</div>
        <div style="font-size: 12px; color: #E2E8F0;">${highlightText(t.ItemText || '', query)}</div>
        ${t.Unit1Qty > 0 ? `<div style="font-size: 11px; color: #34D399; font-weight: 600;">SL: ${t.Unit1Qty} ${escapeHtml(t.Unit0ID || '')}</div>` : ''}
      `;
    } else {
      itemHtml = `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">Không có vật tư</span>`;
    }

    const guidelineText = t.StandardGuideline ? highlightText(t.StandardGuideline, query) : '<span style="color: var(--text-muted); font-style: italic;">Chưa có hướng dẫn SOP chuẩn</span>';

    // 4. Parent Work Column (shown when viewing All categories)
    const parentWorkTd = isViewingAll ? `
      <td>
        <div style="font-weight: 700; color: #818CF8; font-size: 12px; font-family: 'JetBrains Mono', monospace;">${highlightText(t.WorkID || '---', query)}</div>
        <div style="font-size: 12px; color: var(--text-muted); line-height: 1.3;">${highlightText(t.WorkText || '', query)}</div>
      </td>
    ` : '';

    return `
      <tr>
        <td style="text-align: center; font-weight: 600; color: var(--text-muted); font-size: 12px;">${itemNumber}</td>
        ${parentWorkTd}
        <td>
          <span class="badge-node">${highlightText(t.NodeName || 'Chung', query)}</span>
        </td>
        <td>
          <span class="badge-service">${highlightText(t.ServiceName || 'Bảo dưỡng', query)}</span>
        </td>
        <td style="font-weight: 500;">
          <div style="color: #F8FAFC; line-height: 1.4;">${highlightText(t.CategoryName, query)}</div>
          ${t.Duration > 0 ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">Thời gian: <strong>${t.Duration}h</strong></div>` : ''}
        </td>
        <td>${itemHtml}</td>
        <td style="text-align: center;">${sampleImgHtml}</td>
        <td style="text-align: center;">${proofBtnHtml}</td>
        <td class="guideline-cell">${guidelineText}</td>
        <td style="text-align: center;">
          <button class="btn-action-edit" onclick="openSampleUploadModal(${t.TemplateID})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            ${hasSample ? 'Đổi Ảnh' : 'Thêm Ảnh'}
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// 7. TECHNICIAN PROOF IMAGES MODAL & PROMOTE TO SOP SAMPLE
// =========================================================================

window.openProofHistoryModal = async function(templateId) {
  const modal = document.getElementById('proofHistoryModal');
  const titleEl = document.getElementById('modalProofTitle');
  const subEl = document.getElementById('modalProofSub');
  const container = document.getElementById('proofGridContainer');

  if (!modal || !container) return;

  const tmpl = allTemplates.find(t => (t.TemplateID === templateId || t.id === templateId || String(t.TemplateID) === String(templateId)));
  if (!tmpl) return;

  titleEl.innerText = `Ảnh Thực Tế: ${tmpl.CategoryName}`;
  subEl.innerText = `[${tmpl.WorkID}] ${tmpl.WorkText} • Cụm: ${tmpl.NodeName} • Thao tác: ${tmpl.ServiceName}`;

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
      <div class="spinner" style="margin: 0 auto 12px;"></div>
      Đang tải toàn bộ ảnh thực tế của kỹ thuật viên...
    </div>
  `;

  modal.classList.add('active');

  try {
    const res = await fetch(`/api/templates/${templateId}/proof-images`);
    if (!res.ok) throw new Error('Không thể tải ảnh thực tế');
    const data = await res.json();
    const images = data.images || [];

    if (images.length === 0) {
      container.innerHTML = `
        <div class="proof-empty-state">
          <div style="font-size: 38px; margin-bottom: 8px;">📷</div>
          <div style="font-size: 15px; font-weight: 600; color: #E2E8F0;">Chưa có hình ảnh thực tế từ kỹ thuật viên</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
            Khi nhân viên kỹ thuật thực hiện lệnh bảo dưỡng trên máy và chụp ảnh tải lên, hình ảnh sẽ tự động xuất hiện tại đây.
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = images.map(img => {
      const typeLabel = img.ImageType === 'AFTER' ? 'Sau bảo dưỡng (Hoàn thành)' : (img.ImageType === 'BEFORE' ? 'Trước bảo dưỡng' : img.ImageType);
      const isCurrentSample = tmpl.SampleImageUrl && tmpl.SampleImageUrl === img.FileUrl;

      return `
        <div class="proof-photo-card ${isCurrentSample ? 'is-current-sample' : ''}">
          <div class="proof-photo-preview" onclick="openLightbox('${img.FileUrl}', '${escapeHtml(tmpl.CategoryName)} - Chụp bởi ${escapeHtml(img.UploadedBy || '')} ngày ${img.UploadedAt}')">
            <img src="${img.FileUrl}" alt="Ảnh thực tế" onerror="this.onerror=null;this.src='/static/placeholder-camera.svg';">
            <span class="proof-zoom-hint">🔍 Phóng to</span>
            ${isCurrentSample ? '<span class="current-sample-tag">★ Đang là ảnh mẫu SOP</span>' : ''}
          </div>

          <div class="proof-photo-details">
            <div class="proof-meta-row">
              <span class="proof-meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <strong>${img.UploadedAt || '---'}</strong>
              </span>
            </div>

            <div class="proof-meta-row">
              <span class="proof-meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                KTV: <strong>${escapeHtml(img.UploadedBy || 'Kỹ thuật viên')}</strong>
              </span>
            </div>

            <div class="proof-meta-row">
              <span class="proof-meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                Máy: <strong>${escapeHtml(img.MachineID || '---')}</strong> • Lệnh: <strong>#${escapeHtml(img.EntryID || '')}</strong>
              </span>
            </div>

            <div class="proof-type-badge">${typeLabel}</div>
            ${img.Caption ? `<div class="proof-caption">"${escapeHtml(img.Caption)}"</div>` : ''}

            <div class="proof-card-actions">
              <button class="btn-set-sample" onclick="promoteProofAsSample(${tmpl.TemplateID}, ${img.id}, '${escapeHtml(img.UploadedBy || '')}', '${img.UploadedAt || ''}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <span>⭐ Chọn Làm Ảnh Mẫu SOP</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: #EF4444; padding: 30px;">
        Lỗi tải ảnh thực tế: ${err.message}
      </div>
    `;
  }
};

function closeProofHistoryModal() {
  document.getElementById('proofHistoryModal')?.classList.remove('active');
}

window.promoteProofAsSample = async function(templateId, imageId, uploader, uploadDate) {
  if (!currentUser) {
    showToast('Vui lòng đăng nhập quyền Quản trị hoặc Giám sát để thiết lập ảnh mẫu', 'warning');
    openLoginModal();
    return;
  }

  const confirmMsg = `Bạn có chắc chắn muốn chọn ảnh chụp ngày ${uploadDate} của KTV ${uploader} làm Ảnh Mẫu Chuẩn SOP cho hạng mục này?`;
  if (!confirm(confirmMsg)) return;

  const token = getToken();
  try {
    const res = await fetch(`/api/templates/${templateId}/set-sample-from-proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        image_id: imageId
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Lỗi khi đặt ảnh mẫu SOP');
    }

    const data = await res.json();
    showToast(data.message || 'Đã đặt ảnh thực tế làm ảnh mẫu chuẩn SOP thành công!', 'success');

    // Update in-memory allTemplates
    const tmplIdStr = String(templateId);
    const idx = allTemplates.findIndex(t => (String(t.TemplateID) === tmplIdStr || String(t.id) === tmplIdStr));
    if (idx !== -1) {
      allTemplates[idx].SampleImageUrl = data.sample_image_url || data.SampleImageUrl || '';
      if (data.standard_guideline) {
        allTemplates[idx].StandardGuideline = data.standard_guideline;
      }
    }

    closeProofHistoryModal();
    filterTemplates();
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, 'error');
  }
};

// =========================================================================
// 8. MANUAL SAMPLE UPLOAD MODAL (EXISTING FEATURE)
// =========================================================================

window.openSampleUploadModal = function(templateId) {
  if (!currentUser) {
    showToast('Vui lòng đăng nhập để cập nhật ảnh mẫu chuẩn SOP', 'warning');
    openLoginModal();
    return;
  }

  const tmpl = allTemplates.find(t => (t.TemplateID === templateId || t.id === templateId || String(t.TemplateID) === String(templateId)));
  if (!tmpl) return;

  const tId = tmpl.TemplateID !== undefined ? tmpl.TemplateID : tmpl.id;
  document.getElementById('modalTmplId').value = tId;
  document.getElementById('modalTmplTitle').innerText = `Ảnh Mẫu SOP: ${tmpl.CategoryName}`;
  
  let subText = `[${tmpl.WorkID}] ${tmpl.WorkText} • Cụm: ${tmpl.NodeName || 'Bộ phận'} • Thao tác: ${tmpl.ServiceName || 'Bảo dưỡng'}`;
  if (tmpl.ItemID) {
    subText += ` • Vật tư: ${tmpl.ItemText} (${tmpl.Unit1Qty} ${tmpl.Unit0ID})`;
  }
  document.getElementById('modalTmplSub').innerText = subText;
  document.getElementById('modalGuidelineInput').value = tmpl.StandardGuideline || '';

  // Reset file selection
  selectedFile = null;
  const fileInput = document.getElementById('sampleFileInput');
  if (fileInput) fileInput.value = '';

  const previewBox = document.getElementById('sampleFilePreview');
  if (tmpl.SampleImageUrl) {
    previewBox.style.display = 'block';
    previewBox.innerHTML = `
      <div class="current-preview-wrap">
        <span style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Ảnh mẫu hiện tại:</span>
        <img src="${tmpl.SampleImageUrl}" alt="Ảnh hiện tại" style="max-height: 120px; border-radius: 8px; border: 1px solid var(--border-glass);">
      </div>
    `;
  } else {
    previewBox.style.display = 'none';
    previewBox.innerHTML = '';
  }

  document.getElementById('sampleUploadModal')?.classList.add('active');
};

function closeSampleUploadModal() {
  document.getElementById('sampleUploadModal')?.classList.remove('active');
  selectedFile = null;
}

// =========================================================================
// 9. LIGHTBOX
// =========================================================================

window.openLightbox = function(imgSrc, caption) {
  const modal = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (modal && img) {
    img.src = imgSrc;
    if (cap) cap.innerText = caption || '';
    modal.classList.add('active');
  }
};

function closeLightbox() {
  document.getElementById('lightboxModal')?.classList.remove('active');
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =========================================================================
// 10. SETUP EVENT LISTENERS
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadWorks();
  await loadTemplates();

  // Render Initial View
  filterTemplates();

  // Select "Tất Cả Hạng Mục" Button
  document.getElementById('btnSelectAllWorks')?.addEventListener('click', () => {
    selectCategory(null);
  });

  // Clear Selected Work Header Button
  document.getElementById('btnClearSelectedWork')?.addEventListener('click', () => {
    selectCategory(null);
  });

  // Unified Search Input Event with Debounce
  const searchInput = document.getElementById('tmplSearchInput');
  searchInput?.addEventListener('input', debounce(() => {
    filterTemplates(true);
  }, 150));

  // Keyboard shortcut '/' to focus search input
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  document.getElementById('btnClearTmplSearch')?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      filterTemplates(true);
      searchInput.focus();
    }
  });

  window.resetAllFilters = function() {
    const searchInput = document.getElementById('tmplSearchInput');
    if (searchInput) searchInput.value = '';
    const serviceSelect = document.getElementById('filterServiceSelect');
    if (serviceSelect) serviceSelect.value = '';
    const imageStatus = document.getElementById('filterImageStatus');
    if (imageStatus) imageStatus.value = '';
    filterTemplates(true);
  };

  // Service & Image Status Dropdowns Change
  document.getElementById('filterServiceSelect')?.addEventListener('change', () => filterTemplates(true));
  document.getElementById('filterImageStatus')?.addEventListener('change', () => filterTemplates(true));

  // Pagination Navigation Buttons
  document.getElementById('btnPageFirst')?.addEventListener('click', () => goToPage(1));
  document.getElementById('btnPagePrev')?.addEventListener('click', () => goToPage(currentPage - 1));
  document.getElementById('btnPageNext')?.addEventListener('click', () => goToPage(currentPage + 1));
  document.getElementById('btnPageLast')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(currentFilteredTemplates.length / pageSize));
    goToPage(totalPages);
  });
  document.getElementById('pageSizeSelect')?.addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value, 10) || 50;
    currentPage = 1;
    filterTemplates(false);
  });

  // Refresh Button
  document.getElementById('btnRefreshTmpl')?.addEventListener('click', async () => {
    showToast('Đang làm mới danh mục...', 'info');
    await loadWorks();
    await loadTemplates();
    filterTemplates();
    showToast('Đã làm mới dữ liệu thành công!', 'success');
  });

  // Sync ERP Button
  const btnSync = document.getElementById('btnSyncERPWorks');
  btnSync?.addEventListener('click', async () => {
    btnSync.disabled = true;
    const oldHtml = btnSync.innerHTML;
    btnSync.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; margin: 0 auto;"></div> Đang đồng bộ...';
    showToast('Đang kết nối ERP để đồng bộ danh mục & chi tiết công việc...', 'info');

    try {
      const res = await fetch('/api/sync/works?t=' + Date.now());
      const data = await res.json();
      if (data.status === 'success') {
        showToast(`Đồng bộ thành công ${data.total_works} danh mục và ${data.total_tasks} chi tiết công việc!`, 'success');
        await loadWorks();
        await loadTemplates();
        filterTemplates();
      } else {
        throw new Error(data.error || 'Lỗi không xác định khi đồng bộ');
      }
    } catch (err) {
      showToast(`Lỗi đồng bộ ERP: ${err.message}`, 'error');
    } finally {
      btnSync.disabled = false;
      btnSync.innerHTML = oldHtml;
    }
  });

  // Modal close buttons
  document.getElementById('btnCloseProofModal')?.addEventListener('click', closeProofHistoryModal);
  document.getElementById('btnDismissProofModal')?.addEventListener('click', closeProofHistoryModal);
  document.getElementById('btnCloseSampleModal')?.addEventListener('click', closeSampleUploadModal);
  document.getElementById('btnCancelSampleModal')?.addEventListener('click', closeSampleUploadModal);
  document.getElementById('btnCloseLoginModal')?.addEventListener('click', closeLoginModal);
  document.getElementById('btnCloseLightbox')?.addEventListener('click', closeLightbox);

  // Close modals on escape key or backdrop click
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProofHistoryModal();
      closeSampleUploadModal();
      closeLoginModal();
      closeLightbox();
    }
  });

  document.getElementById('proofHistoryModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'proofHistoryModal') closeProofHistoryModal();
  });

  document.getElementById('lightboxModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'lightboxModal') closeLightbox();
  });

  document.getElementById('sampleUploadModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'sampleUploadModal') closeSampleUploadModal();
  });

  document.getElementById('loginModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'loginModal') closeLoginModal();
  });

  // File drop / select for Sample Image
  const dropArea = document.getElementById('sampleDropArea');
  const fileInput = document.getElementById('sampleFileInput');

  dropArea?.addEventListener('click', () => fileInput?.click());

  dropArea?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('drag-over');
  });

  dropArea?.addEventListener('dragleave', () => {
    dropArea.classList.remove('drag-over');
  });

  dropArea?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  async function compressImageForUpload(file, maxDimension = 1600, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return file;
    if (file.size <= 350 * 1024) return file;

    const blobUrl = URL.createObjectURL(file);
    try {
      let sourceWidth, sourceHeight, drawSource;
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
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

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(drawSource, 0, 0, targetWidth, targetHeight);

      if (drawSource && typeof drawSource.close === 'function') {
        drawSource.close();
      }

      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });

      if (!blob) return file;
      const cleanName = (file.name || 'sample_photo.jpg').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], cleanName, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (err) {
      console.warn('Lỗi nén ảnh phía client, sử dụng tệp gốc:', err);
      return file;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  let currentSamplePreviewUrl = null;

  async function handleFileSelected(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Vui lòng chọn file hình ảnh (JPG, PNG, WEBP)', 'warning');
      return;
    }

    const previewBox = document.getElementById('sampleFilePreview');
    previewBox.style.display = 'block';
    previewBox.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; color: #93C5FD; padding: 10px;">
        <div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>
        <span style="font-size: 0.82rem;">Đang nén tối ưu ảnh chuẩn SOP...</span>
      </div>
    `;

    try {
      const compressed = await compressImageForUpload(file, 1600, 0.85);
      selectedFile = compressed;
      if (currentSamplePreviewUrl) URL.revokeObjectURL(currentSamplePreviewUrl);
      currentSamplePreviewUrl = URL.createObjectURL(compressed);

      previewBox.innerHTML = `
        <div class="current-preview-wrap">
          <span style="font-size: 0.8rem; color: #10B981; display: block; margin-bottom: 4px; font-weight: 600;">
            ✓ Ảnh đã tối ưu: ${(compressed.size / 1024).toFixed(0)} KB (gốc ${(file.size / (1024 * 1024)).toFixed(1)} MB)
          </span>
          <img src="${currentSamplePreviewUrl}" alt="Xem trước" style="max-height: 120px; border-radius: 8px; border: 2px solid #10B981;">
        </div>
      `;
    } catch (err) {
      selectedFile = file;
      if (currentSamplePreviewUrl) URL.revokeObjectURL(currentSamplePreviewUrl);
      currentSamplePreviewUrl = URL.createObjectURL(file);
      previewBox.innerHTML = `
        <div class="current-preview-wrap">
          <span style="font-size: 0.8rem; color: #10B981; display: block; margin-bottom: 4px;">
            Ảnh đã chọn: ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)
          </span>
          <img src="${currentSamplePreviewUrl}" alt="Xem trước" style="max-height: 120px; border-radius: 8px; border: 1px solid var(--accent-blue);">
        </div>
      `;
    }
  }

  // Submit Sample Image Form
  document.getElementById('sampleUploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) {
      showToast('Vui lòng đăng nhập trước khi tải ảnh', 'warning');
      openLoginModal();
      return;
    }

    const templateId = document.getElementById('modalTmplId').value;
    const guideline = document.getElementById('modalGuidelineInput').value;

    const submitBtn = document.getElementById('btnSubmitSampleModal');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; margin: 0 auto;"></div> Đang lưu ảnh...';

    try {
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('guideline', guideline);

        const res = await fetch(`/api/templates/${templateId}/sample-image`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Lỗi khi lưu ảnh');
        }

        const data = await res.json();
        showToast('Đã lưu ảnh mẫu SOP thành công!', 'success');
        
        const tmplIdStr = String(templateId);
        const idx = allTemplates.findIndex(t => (String(t.TemplateID) === tmplIdStr || String(t.id) === tmplIdStr));
        if (idx !== -1) {
          allTemplates[idx].SampleImageUrl = data.SampleImageUrl || data.sample_image_url || '';
          allTemplates[idx].StandardGuideline = data.StandardGuideline || guideline;
        }
      } else {
        const res = await fetch(`/api/templates/${templateId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ standard_guideline: guideline })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Lỗi khi cập nhật hướng dẫn');
        }

        showToast('Đã cập nhật hướng dẫn SOP thành công!', 'success');
        const tmplIdStr = String(templateId);
        const idx = allTemplates.findIndex(t => (String(t.TemplateID) === tmplIdStr || String(t.id) === tmplIdStr));
        if (idx !== -1) {
          allTemplates[idx].StandardGuideline = guideline;
        }
      }

      closeSampleUploadModal();
      filterTemplates();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  // Login form submit
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Tên đăng nhập hoặc mật khẩu không chính xác');
      }

      const data = await res.json();
      setToken(data.access_token || data.token);
      currentUser = data.user || data;
      renderUserChip();
      closeLoginModal();
      showToast(`Chào mừng ${currentUser.full_name || currentUser.username} đăng nhập thành công!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Quick user login buttons
  document.querySelectorAll('.quick-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = btn.dataset.user;
      const pass = btn.dataset.pass;
      document.getElementById('loginUsername').value = user;
      document.getElementById('loginPassword').value = pass;
    });
  });
});
