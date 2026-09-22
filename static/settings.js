/**
 * BOPP EM Maintenance - System Settings Module
 * File: static/settings.js
 */

let currentUser = null;

function getToken() {
  return localStorage.getItem('token') || localStorage.getItem('bopp_token') || '';
}

function setToken(token) {
  if (token) {
    localStorage.setItem('token', token);
    localStorage.setItem('bopp_token', token);
  } else {
    localStorage.removeItem('token');
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
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error();
    currentUser = await res.json();
    renderUserChip();
    return currentUser;
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
      <button type="button" id="btnOpenProfileModal" class="user-avatar-btn" title="Tài khoản: ${escapeHtml(currentUser.full_name || currentUser.username)} (${label})" style="--avatar-color: ${color};">
        <span class="avatar-letter">${initial}</span>
        <span class="user-status-dot" style="background: ${color};"></span>
      </button>
    `;

    document.getElementById('btnOpenProfileModal')?.addEventListener('click', openUserProfileModal);
  } else {
    chipContainer.innerHTML = `
      <button type="button" id="btnOpenLoginModal" class="user-avatar-btn is-guest" title="Đăng Nhập Quản Trị">
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

function openUserProfileModal() {
  if (!currentUser) {
    openLoginModal();
    return;
  }
  const modal = document.getElementById('userProfileModal');
  if (!modal) return;

  const initial = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();
  const avatarEl = document.getElementById('profileAvatarLarge');
  if (avatarEl) avatarEl.textContent = initial;

  const nameEl = document.getElementById('profileFullName');
  if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.username;

  const roleEl = document.getElementById('profileRoleBadge');
  if (roleEl) {
    const roleLabels = { admin: 'Quản trị viên', supervisor: 'Giám sát viên', technician: 'Kỹ thuật viên' };
    roleEl.textContent = roleLabels[currentUser.role] || currentUser.role;
  }

  const userEl = document.getElementById('profileUsername');
  if (userEl) userEl.textContent = '@' + currentUser.username;

  modal.classList.add('active');
}

function closeUserProfileModal() {
  document.getElementById('userProfileModal')?.classList.remove('active');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Sai tài khoản hoặc mật khẩu');
    }
    const data = await res.json();
    setToken(data.access_token || data.token);
    await checkAuth();
    closeLoginModal();
    showToast('Đăng nhập thành công!', 'success');
  } catch (err) {
    alert(err.message);
  }
}

function logoutUser() {
  if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
    setToken(null);
    currentUser = null;
    renderUserChip();
    closeUserProfileModal();
    showToast('Đã đăng xuất thành công', 'info');
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

async function loadEmailSettings() {
  try {
    const res = await fetch('/api/system/email-settings');
    if (!res.ok) return;
    const data = await res.json();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    setChk('cfgNotifyWarehouse', data.NotifyWarehouseOnCreate);
    set('cfgWarehouseEmails', data.WarehouseKeeperEmails);
    set('cfgBaseAppUrl', data.BaseAppUrl || window.location.origin);
    set('cfgSmtpHost', data.SmtpHost || 'smtp.gmail.com');
    const portEl = document.getElementById('cfgSmtpPort');
    if (portEl) portEl.value = data.SmtpPort || 587;
    set('cfgSmtpUser', data.SmtpUser);
    const pwdEl = document.getElementById('cfgSmtpPassword');
    if (pwdEl) pwdEl.value = data.HasPassword ? '***' : '';
    set('cfgSmtpFromName', data.SmtpFromName || 'BOPP EM Maintenance');
    set('cfgSmtpFromEmail', data.SmtpFromEmail);
    setChk('cfgUseTls', data.UseTls !== 0);
  } catch (e) {
    console.error('Lỗi tải cấu hình email:', e);
  }
}

async function submitEmailSettings(event) {
  if (event) event.preventDefault();
  const btns = [
    document.getElementById('btnSaveEmailSettings'),
    document.getElementById('btnHeaderSaveSettings'),
    document.getElementById('btnStickySaveSettings')
  ].filter(Boolean);

  btns.forEach(b => {
    b.disabled = true;
    b.dataset.originalText = b.innerHTML;
    b.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Đang lưu...';
  });

  try {
    const payload = {
      NotifyWarehouseOnCreate: document.getElementById('cfgNotifyWarehouse')?.checked ? 1 : 0,
      WarehouseKeeperEmails: (document.getElementById('cfgWarehouseEmails')?.value || '').trim(),
      BaseAppUrl: (document.getElementById('cfgBaseAppUrl')?.value || window.location.origin).trim(),
      SmtpHost: (document.getElementById('cfgSmtpHost')?.value || '').trim(),
      SmtpPort: parseInt(document.getElementById('cfgSmtpPort')?.value || '587', 10),
      SmtpUser: (document.getElementById('cfgSmtpUser')?.value || '').trim(),
      SmtpPassword: document.getElementById('cfgSmtpPassword')?.value || '',
      SmtpFromName: (document.getElementById('cfgSmtpFromName')?.value || 'BOPP EM Maintenance').trim(),
      SmtpFromEmail: (document.getElementById('cfgSmtpFromEmail')?.value || '').trim(),
      UseTls: document.getElementById('cfgUseTls')?.checked ? 1 : 0
    };
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/system/email-settings', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi lưu cấu hình Email');
    showToast('Đã lưu cấu hình Email thành công!', 'success');
    setTimeout(loadEmailSettings, 600);
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.innerHTML = b.dataset.originalText || '💾 Lưu Cấu Hình';
    });
  }
}

async function testSendEmail() {
  const whEmails = (document.getElementById('cfgWarehouseEmails')?.value || '').trim();
  const userEmail = (document.getElementById('cfgSmtpUser')?.value || '').trim();
  const defaultTestEmail = whEmails ? whEmails.split(',')[0].trim() : userEmail;
  const testEmail = prompt('Nhập địa chỉ email nhận thư thử nghiệm:', defaultTestEmail);
  if (!testEmail || !testEmail.includes('@')) {
    if (testEmail !== null) alert('Email không hợp lệ!');
    return;
  }
  const payload = {
    TestEmail: testEmail.trim(),
    SmtpHost: (document.getElementById('cfgSmtpHost')?.value || '').trim(),
    SmtpPort: parseInt(document.getElementById('cfgSmtpPort')?.value || '587', 10),
    SmtpUser: (document.getElementById('cfgSmtpUser')?.value || '').trim(),
    SmtpPassword: document.getElementById('cfgSmtpPassword')?.value || '',
    SmtpFromName: (document.getElementById('cfgSmtpFromName')?.value || 'BOPP EM Maintenance').trim(),
    SmtpFromEmail: (document.getElementById('cfgSmtpFromEmail')?.value || '').trim(),
    UseTls: document.getElementById('cfgUseTls')?.checked ? 1 : 0
  };
  try {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/system/email-settings/test', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Gửi thử nghiệm thất bại');
    showToast('🎉 ' + data.message, 'success');
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

function showToast(msg, type, duration) {
  const toast = document.getElementById('settingsToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'settings-toast ' + (type || 'success');
  toast.style.display = 'flex';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration || 5000);
}

/* =========================================================================
   USER MANAGEMENT & PERMISSIONS MATRIX LOGIC
   ========================================================================= */

let allUsers = [];
let allEmployeesList = [];
let activeSettingsTab = 'users';

const PAGE_LABELS = {
  internal_tasks: 'Công Việc',
  maintenance: 'Bảo Trì',
  categories: 'SOP',
  dashboard: 'Báo Cáo',
  inventory: 'Tồn Kho',
  settings: 'Cấu Hình'
};

const ALL_PAGES = ['internal_tasks', 'maintenance', 'categories', 'dashboard', 'inventory', 'settings'];

function switchSettingsTab(tabName) {
  activeSettingsTab = tabName;
  ['users', 'email', 'system'].forEach(t => {
    const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const pane = document.getElementById(`tabPane${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (pane) pane.classList.toggle('active', t === tabName);
  });

  const stickyBar = document.querySelector('.mobile-sticky-save-bar');
  if (stickyBar) {
    stickyBar.style.display = tabName === 'email' ? 'flex' : 'none';
  }
  const headerSaveBtn = document.getElementById('btnHeaderSaveSettings');
  if (headerSaveBtn) {
    headerSaveBtn.style.display = tabName === 'email' ? 'inline-flex' : 'none';
  }

  if (tabName === 'users' && allUsers.length === 0) {
    loadUsersList();
  }
}

async function loadUsersList() {
  const tbody = document.getElementById('usersTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);"><span class="spinner" style="display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:middle;"></span> Đang tải danh sách tài khoản...</td></tr>`;
  }
  try {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch('/api/auth/users', { headers });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#EF4444;">Vui lòng <button type="button" class="btn-secondary" onclick="openLoginModal()" style="font-size:0.8rem;padding:3px 10px;margin-left:6px;">Đăng Nhập</button> bằng tài khoản Quản trị để quản lý người dùng &amp; phân quyền.</td></tr>`;
        return;
      }
      throw new Error('Không thể tải danh sách tài khoản');
    }
    const data = await res.json();
    allUsers = data.users || [];

    const stats = data.stats || {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val !== undefined ? val : '--'; };
    setVal('statTotalUsers', stats.total ?? allUsers.length);
    setVal('statCoDienUsers', stats.co_dien ?? 0);
    setVal('statKyThuatUsers', stats.ky_thuat ?? 0);
    setVal('statAdminUsers', (stats.admin_count ?? 0) + (stats.supervisor_count ?? 0));

    handleFilterUsers();
  } catch (err) {
    console.error('Lỗi loadUsersList:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#EF4444;">Lỗi: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function handleFilterUsers() {
  const search = (document.getElementById('filterUserSearch')?.value || '').toLowerCase().trim();
  const dept = document.getElementById('filterUserDept')?.value || 'all';
  const role = document.getElementById('filterUserRole')?.value || 'all';

  const filtered = allUsers.filter(u => {
    if (dept !== 'all' && (u.department || '') !== dept) return false;
    if (role !== 'all' && (u.role || '') !== role) return false;
    if (search) {
      const matchU = (u.username || '').toLowerCase().includes(search);
      const matchN = (u.full_name || '').toLowerCase().includes(search);
      const matchE = (u.employee_id || '').toLowerCase().includes(search);
      const matchP = (u.position || '').toLowerCase().includes(search);
      if (!matchU && !matchN && !matchE && !matchP) return false;
    }
    return true;
  });

  renderUsersTable(filtered);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">Không tìm thấy tài khoản phù hợp với bộ lọc.</td></tr>`;
    return;
  }

  const roleLabels = { admin: 'Quản trị (Admin)', supervisor: 'Giám sát', technician: 'Kỹ thuật viên' };
  const deptLabels = { '4BP03': 'Cơ Điện (4BP03)', '4BP06': 'Kỹ Thuật (4BP06)', 'BOPP': 'Ban Quản Trị' };

  tbody.innerHTML = users.map((u, idx) => {
    const roleClass = `role-${u.role || 'technician'}`;
    const roleText = roleLabels[u.role] || u.role;
    const deptText = deptLabels[u.department] || u.dept_name || u.department || '---';
    const positionText = u.position ? `<div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(u.position)}</div>` : '';
    const empIdBadge = u.employee_id ? `<span style="font-size:0.70rem;background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-family:monospace;margin-left:4px;">${escapeHtml(u.employee_id)}</span>` : '';

    const perms = u.permissions || {};
    const permBadgesHtml = Object.keys(PAGE_LABELS).map(key => {
      const p = perms[key] || { view: false, edit: false };
      const label = PAGE_LABELS[key];
      if (p.edit) {
        return `<span class="perm-badge perm-edit" title="${label}: Toàn quyền sửa, tạo, xóa, duyệt">✏️ ${label}</span>`;
      } else if (p.view) {
        return `<span class="perm-badge perm-view" title="${label}: Chỉ được xem">👁️ ${label}</span>`;
      } else {
        return `<span class="perm-badge perm-none" title="${label}: Không có quyền truy cập">🔒 ${label}</span>`;
      }
    }).join('');

    const statusHtml = u.is_active !== 0
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:#34D399;font-weight:600;"><span style="width:7px;height:7px;border-radius:50%;background:#10B981;"></span>Hoạt động</span>`
      : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:#F87171;font-weight:600;"><span style="width:7px;height:7px;border-radius:50%;background:#EF4444;"></span>Khóa</span>`;

    return `
      <tr>
        <td style="text-align:center;color:var(--text-muted);font-weight:600;">${idx + 1}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:30px;height:30px;border-radius:50%;background:rgba(99,102,241,0.2);color:#818CF8;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.78rem;flex-shrink:0;">
              ${(u.full_name || u.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:700;color:var(--text-primary);display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
                <span>${escapeHtml(u.full_name || u.username)}</span>
                ${empIdBadge}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;">@${escapeHtml(u.username)}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight:600;font-size:0.80rem;color:var(--text-primary);">${escapeHtml(deptText)}</div>
          ${positionText}
        </td>
        <td>
          <span class="role-badge ${roleClass}">${escapeHtml(roleText)}</span>
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;max-width:320px;">
            ${permBadgesHtml}
          </div>
        </td>
        <td style="text-align:center;">
          ${statusHtml}
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex;gap:4px;">
            <button type="button" class="btn-secondary" style="padding:4px 8px;font-size:0.76rem;" onclick="openEditUserModal(${u.id})" title="Chỉnh sửa thông tin & phân quyền">
              ✏️ Quyền
            </button>
            <button type="button" class="btn-secondary" style="padding:4px 8px;font-size:0.76rem;color:#F59E0B;" onclick="openResetPasswordModal(${u.id}, '${escapeHtml(u.username)}', '${escapeHtml(u.full_name || '')}')" title="Đặt lại mật khẩu">
              🔑
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openEditUserModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val !== undefined ? val : ''; };
  setVal('editUserId', user.id);
  setVal('editUsername', user.username);
  setVal('editEmployeeId', user.employee_id || '');
  setVal('editFullName', user.full_name || '');
  setVal('editDepartment', user.department || '4BP03');
  setVal('editRole', user.role || 'technician');

  const activeChk = document.getElementById('editIsActive');
  if (activeChk) {
    activeChk.checked = user.is_active !== 0;
    updateEditStatusLabel(activeChk.checked);
  }

  const perms = user.permissions || {};
  ALL_PAGES.forEach(page => {
    const p = perms[page] || { view: false, edit: false };
    const chkView = document.getElementById(`perm_view_${page}`);
    const chkEdit = document.getElementById(`perm_edit_${page}`);
    if (chkView) chkView.checked = Boolean(p.view || p.edit);
    if (chkEdit) chkEdit.checked = Boolean(p.edit);
  });

  const delBtn = document.getElementById('btnDeleteUserInModal');
  if (delBtn) {
    delBtn.style.display = user.username === 'admin' ? 'none' : 'inline-block';
  }

  document.getElementById('userEditModal')?.classList.add('active');
}

function closeUserEditModal() {
  document.getElementById('userEditModal')?.classList.remove('active');
}

function updateEditStatusLabel(isActive) {
  const label = document.getElementById('editStatusLabel');
  if (label) {
    label.textContent = isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa';
    label.style.color = isActive ? '#10B981' : '#EF4444';
  }
}

function onEditPermChange(page) {
  const editChk = document.getElementById(`perm_edit_${page}`);
  const viewChk = document.getElementById(`perm_view_${page}`);
  if (editChk && editChk.checked && viewChk) {
    viewChk.checked = true;
  }
}

function setAllPermissions(view, edit) {
  ALL_PAGES.forEach(page => {
    const chkView = document.getElementById(`perm_view_${page}`);
    const chkEdit = document.getElementById(`perm_edit_${page}`);
    if (chkView) chkView.checked = Boolean(view);
    if (chkEdit) chkEdit.checked = Boolean(edit);
  });
}

function applyRoleDefaultPermissions() {
  const role = document.getElementById('editRole')?.value || 'technician';
  if (role === 'admin') {
    setAllPermissions(true, true);
  } else if (role === 'supervisor') {
    ALL_PAGES.forEach(p => {
      const isSettings = p === 'settings';
      const chkView = document.getElementById(`perm_view_${p}`);
      const chkEdit = document.getElementById(`perm_edit_${p}`);
      if (chkView) chkView.checked = true;
      if (chkEdit) chkEdit.checked = !isSettings;
    });
  } else {
    // technician
    ALL_PAGES.forEach(p => {
      const canEdit = p === 'internal_tasks' || p === 'maintenance' || p === 'inventory';
      const canView = p !== 'settings';
      const chkView = document.getElementById(`perm_view_${p}`);
      const chkEdit = document.getElementById(`perm_edit_${p}`);
      if (chkView) chkView.checked = canView;
      if (chkEdit) chkEdit.checked = canEdit;
    });
  }
}

function handleEditRoleChange() {
  // Option: could notify user or auto suggest defaults
}

async function submitUserEdit(event) {
  if (event) event.preventDefault();
  const userId = document.getElementById('editUserId')?.value;
  if (!userId) return;

  const btn = document.getElementById('btnSaveUserEdit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
  }

  try {
    const permissions = {};
    ALL_PAGES.forEach(p => {
      const v = document.getElementById(`perm_view_${p}`)?.checked || false;
      const e = document.getElementById(`perm_edit_${p}`)?.checked || false;
      permissions[p] = { view: v || e, edit: e };
    });

    const payload = {
      full_name: document.getElementById('editFullName')?.value.trim(),
      employee_id: document.getElementById('editEmployeeId')?.value.trim() || null,
      department: document.getElementById('editDepartment')?.value,
      role: document.getElementById('editRole')?.value,
      is_active: document.getElementById('editIsActive')?.checked ? 1 : 0,
      permissions: permissions
    };

    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(`/api/auth/users/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi cập nhật người dùng');

    showToast('Cập nhật quyền người dùng thành công!', 'success');
    closeUserEditModal();
    await loadUsersList();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Lưu Quyền';
    }
  }
}

/* Password Reset */
function openResetPasswordModal(userId, username, fullName) {
  document.getElementById('resetUserId').value = userId;
  document.getElementById('resetUserDisplay').textContent = `${fullName || username} (@${username})`;
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('resetConfirmPassword').value = '';
  document.getElementById('userResetPwModal')?.classList.add('active');
}

function openResetPasswordModalFromEdit() {
  const userId = document.getElementById('editUserId')?.value;
  const username = document.getElementById('editUsername')?.value;
  const fullName = document.getElementById('editFullName')?.value;
  if (!userId) return;
  closeUserEditModal();
  openResetPasswordModal(userId, username, fullName);
}

function closeResetPwModal() {
  document.getElementById('userResetPwModal')?.classList.remove('active');
}

async function submitResetPassword(event) {
  if (event) event.preventDefault();
  const userId = document.getElementById('resetUserId')?.value;
  const newPass = document.getElementById('resetNewPassword')?.value;
  const confirmPass = document.getElementById('resetConfirmPassword')?.value;

  if (!newPass || newPass.length < 4) {
    alert('Mật khẩu mới phải từ 4 ký tự trở lên');
    return;
  }
  if (newPass !== confirmPass) {
    alert('Xác nhận mật khẩu không khớp!');
    return;
  }

  try {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(`/api/auth/users/${userId}/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ new_password: newPass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi đặt lại mật khẩu');

    showToast('Đã đặt lại mật khẩu thành công!', 'success');
    closeResetPwModal();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function confirmDeleteUserInModal() {
  const userId = document.getElementById('editUserId')?.value;
  const username = document.getElementById('editUsername')?.value;
  if (!userId || username === 'admin') return;

  if (!confirm(`Bạn có chắc chắn muốn XÓA tài khoản @${username}? Thao tác này không thể hoàn tác.`)) {
    return;
  }

  try {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(`/api/auth/users/${userId}`, {
      method: 'DELETE',
      headers
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi xóa tài khoản');

    showToast(`Đã xóa tài khoản @${username}`, 'success');
    closeUserEditModal();
    await loadUsersList();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

/* Create New User */
async function loadEmployeesForCreate() {
  try {
    if (allEmployeesList.length > 0) return;
    const res = await fetch('/api/internal-tasks/employees');
    if (!res.ok) return;
    allEmployeesList = await res.json();
    const select = document.getElementById('createPickEmployee');
    if (!select) return;
    select.innerHTML = '<option value="">-- Hoặc nhập thông tin mới bên dưới --</option>' +
      allEmployeesList.map(emp => {
        const d = emp.DeptCode === '4BP06' ? 'Kỹ Thuật' : 'Cơ Điện';
        return `<option value="${emp.EmpID}">${escapeHtml(emp.EmpName)} (${emp.EmpID}) - ${d}</option>`;
      }).join('');
  } catch (e) {
    console.warn('Không thể tải danh sách nhân viên:', e);
  }
}

function handlePickEmployeeChange() {
  const empId = document.getElementById('createPickEmployee')?.value;
  if (!empId) return;
  const emp = allEmployeesList.find(e => e.EmpID === empId);
  if (!emp) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('createUsername', emp.EmpID);
  setVal('createEmployeeId', emp.EmpID);
  setVal('createFullName', emp.EmpName);
  setVal('createDepartment', emp.DeptCode === '4BP06' ? '4BP06' : '4BP03');
  setVal('createRole', 'technician');
}

function openCreateUserModal() {
  document.getElementById('createUsername').value = '';
  document.getElementById('createEmployeeId').value = '';
  document.getElementById('createFullName').value = '';
  document.getElementById('createDepartment').value = '4BP03';
  document.getElementById('createRole').value = 'technician';
  document.getElementById('createPassword').value = '123456';
  const pick = document.getElementById('createPickEmployee');
  if (pick) pick.value = '';

  loadEmployeesForCreate();
  document.getElementById('userCreateModal')?.classList.add('active');
}

function closeCreateUserModal() {
  document.getElementById('userCreateModal')?.classList.remove('active');
}

async function submitCreateUser(event) {
  if (event) event.preventDefault();
  const username = document.getElementById('createUsername')?.value.trim();
  const password = document.getElementById('createPassword')?.value;
  const fullName = document.getElementById('createFullName')?.value.trim();
  const employeeId = document.getElementById('createEmployeeId')?.value.trim() || null;
  const department = document.getElementById('createDepartment')?.value;
  const role = document.getElementById('createRole')?.value;

  if (!username || !password || !fullName) {
    alert('Vui lòng điền đầy đủ tên đăng nhập, họ tên và mật khẩu');
    return;
  }

  try {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const payload = {
      username,
      password,
      full_name: fullName,
      employee_id: employeeId,
      department,
      role
    };

    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi tạo tài khoản');

    showToast('Đã tạo tài khoản mới thành công!', 'success');
    closeCreateUserModal();
    await loadUsersList();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

/* Initialization */
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadEmailSettings();
  await loadUsersList();

  // Close modals on backdrop click
  document.getElementById('loginModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'loginModal') closeLoginModal();
  });
  document.getElementById('userProfileModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userProfileModal') closeUserProfileModal();
  });
  document.getElementById('userEditModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userEditModal') closeUserEditModal();
  });
  document.getElementById('userResetPwModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userResetPwModal') closeResetPwModal();
  });
  document.getElementById('userCreateModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'userCreateModal') closeCreateUserModal();
  });

  document.getElementById('btnModalLogout')?.addEventListener('click', logoutUser);
  document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);

  // Quick login demo buttons
  document.querySelectorAll('.quick-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = btn.dataset.user;
      const p = btn.dataset.pass;
      const uEl = document.getElementById('loginUsername');
      const pEl = document.getElementById('loginPassword');
      if (u && uEl) uEl.value = u;
      if (p !== undefined && pEl) pEl.value = p;
    });
  });
});


