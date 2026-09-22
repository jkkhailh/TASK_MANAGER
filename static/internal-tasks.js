/**
 * BOPP EM Maintenance - Quản Lý Công Việc Nội Bộ & Sự Cố Phát Sinh
 * File: static/internal-tasks.js
 */

// State
let allTasks = [];
let filteredTasks = [];
let activeFilterType = 'all';
let currentEditingTask = null;
let selectedPhotoFile = null;

// Recurring templates & items state (Master-Detail layout)
let allRecurringTemplates = [];
let filteredRecurringTemplates = [];
let allRecurringItems = [];
let filteredRecurringItems = [];
let selectedRecurringTplId = null; // null = "Tất cả"
let itemsByRecurringTemplate = new Map();
let currentTabMode = 'active'; // 'active' | 'recurring'
let newTaskCycleType = 'INTERVAL_DAYS'; // 'INTERVAL_DAYS' | 'MONTHLY_DAYS'
let tplModalCycleType = 'INTERVAL_DAYS'; // 'INTERVAL_DAYS' | 'MONTHLY_DAYS'

// Task Scope & Master-Detail Inspection State
let currentTaskScope = 'all'; // 'all' | 'group' | 'my'
let allGroups = [];
let activeGroupId = null;
let selectedTaskId = null;
let quickPickerTargetTaskId = null;

// Active tasks view mode (cards view vs excel table view)
let activeTaskViewMode = 'cards';
let taskSortColumn = 'ReportedAt';
let taskSortDirection = 'desc';

// Employees directory state (Cơ điện & Kỹ thuật)
let allEmployees = [];
let groupedEmployees = {};

// Screen helper
function isMobileScreen() {
  return window.innerWidth <= 900;
}

// =========================================================================
// APPLICATION INITIALIZATION (Supports both DOMContentLoaded and post-load)
// =========================================================================
function initApp() {
  initUserProfile();
  initTaskStatsState();
  loadEmployees();
  loadGroups();
  loadMachinesAndDepartments();
  loadTasks();
  loadRecurringTemplates();
  setupSearchDebounce();
  setupRecurringSearchDebounce();
  setupPriorityPickerEvents();
  updateStickyHeaderOffset();
}

window.addEventListener('resize', updateStickyHeaderOffset);
window.addEventListener('orientationchange', updateStickyHeaderOffset);

let allMachines = [];
let allDepartments = [];

async function loadMachinesAndDepartments() {
  try {
    const [deptRes, macRes] = await Promise.all([
      fetch('/api/categories/departments'),
      fetch('/api/categories/machines')
    ]);
    if (deptRes.ok) {
      const data = await deptRes.json();
      allDepartments = data.departments || [];
      const list = document.getElementById('deptListOptions');
      if (list && allDepartments.length > 0) {
        // Chỉ hiển thị 1 dòng: Mã - Tên
        list.innerHTML = allDepartments.map(d => {
          const text = d.DepartID ? `${d.DepartID} - ${d.DepartName}` : d.DepartName;
          return `<option value="${escapeHtml(text)}"></option>`;
        }).join('');
      }
    }
    if (macRes.ok) {
      const data = await macRes.json();
      allMachines = data.machines || [];
      const list = document.getElementById('machineListOptions');
      if (list && allMachines.length > 0) {
        // Chỉ hiển thị 1 dòng: Mã máy - Tên máy
        list.innerHTML = allMachines.map(m => {
          const text = m.MachineText ? `${m.MachineID} - ${m.MachineText}` : m.MachineID;
          return `<option value="${escapeHtml(text)}"></option>`;
        }).join('');
      }
    }

    setupInternalSmartInputs();
  } catch (err) {
    console.warn('Lỗi tải danh mục máy móc/phòng ban:', err);
  }
}

function bindSmartMachineBehavior(inputEl, hintEl) {
  if (!inputEl) return;
  const handler = () => {
    const raw = (inputEl.value || '').trim();
    if (!raw) {
      inputEl.dataset.machineId = '';
      inputEl.dataset.machineText = '';
      if (hintEl) hintEl.innerHTML = '';
      return;
    }
    const match = allMachines.find(m => {
      const combo = m.MachineText ? `${m.MachineID} - ${m.MachineText}` : m.MachineID;
      return combo.toLowerCase() === raw.toLowerCase() ||
        m.MachineID.toLowerCase() === raw.toLowerCase() ||
        (m.MachineText && m.MachineText.toLowerCase() === raw.toLowerCase());
    });
    if (match) {
      // Khi chọn máy xong thì hiển thị TÊN MÁY thay vì mã máy
      const nameToShow = match.MachineText || match.MachineID;
      inputEl.value = nameToShow;
      inputEl.dataset.machineId = match.MachineID;
      inputEl.dataset.machineText = match.MachineText || '';
      if (hintEl) {
        hintEl.innerHTML = `<span style="color: #60A5FA; font-weight: 600;">⚙️ Mã máy: <code style="background: rgba(96,165,250,0.15); padding: 2px 6px; border-radius: 4px; color: #93C5FD;">${escapeHtml(match.MachineID)}</code></span>`;
      }
    } else {
      inputEl.dataset.machineId = raw;
      if (hintEl) hintEl.innerHTML = '';
    }
  };
  inputEl.addEventListener('input', handler);
  inputEl.addEventListener('change', handler);
}

function bindSmartDeptBehavior(inputEl, hintEl) {
  if (!inputEl) return;
  const handler = () => {
    const raw = (inputEl.value || '').trim();
    if (!raw) {
      inputEl.dataset.deptId = '';
      inputEl.dataset.deptName = '';
      if (hintEl) hintEl.innerHTML = '';
      return;
    }
    const match = allDepartments.find(d => {
      const combo = d.DepartID ? `${d.DepartID} - ${d.DepartName}` : d.DepartName;
      return combo.toLowerCase() === raw.toLowerCase() ||
        (d.DepartID && d.DepartID.toLowerCase() === raw.toLowerCase()) ||
        d.DepartName.toLowerCase() === raw.toLowerCase();
    });
    if (match) {
      inputEl.value = match.DepartName;
      inputEl.dataset.deptId = match.DepartID || '';
      inputEl.dataset.deptName = match.DepartName;
      if (hintEl && match.DepartID) {
        hintEl.innerHTML = `<span style="color: #94A3B8; font-size: 0.75rem;">Mã bộ phận: <code>${escapeHtml(match.DepartID)}</code></span>`;
      }
    } else {
      inputEl.dataset.deptId = '';
      inputEl.dataset.deptName = raw;
      if (hintEl) hintEl.innerHTML = '';
    }
  };
  inputEl.addEventListener('input', handler);
  inputEl.addEventListener('change', handler);
}

function setupInternalSmartInputs() {
  bindSmartMachineBehavior(document.getElementById('newTaskMachine'), document.getElementById('newTaskMachineHint'));
  bindSmartMachineBehavior(document.getElementById('tplMachine'), document.getElementById('tplMachineHint'));
  bindSmartDeptBehavior(document.getElementById('newTaskDept'), document.getElementById('newTaskDeptHint'));
  bindSmartDeptBehavior(document.getElementById('tplDept'), document.getElementById('tplDeptHint'));
}

async function loadEmployees() {
  try {
    const res = await fetch('/api/internal-tasks/employees');
    if (!res.ok) throw new Error('Không thể tải danh bạ nhân sự');
    const data = await res.json();
    allEmployees = data.employees || [];
    groupedEmployees = data.grouped || {};
    populateEmployeeDropdowns();
  } catch (err) {
    console.warn('Lỗi tải nhân sự:', err);
  }
}

function buildEmployeeSelectOptions(selectedValue = '', placeholder = '-- Chọn nhân viên thực hiện --') {
  let html = `<option value="">${placeholder}</option>`;

  const codien = groupedEmployees['Cơ điện'] || [];
  if (codien.length > 0) {
    html += `<optgroup label="⚡ Bộ Phận Cơ Điện (${codien.length} nhân viên)">`;
    for (const emp of codien) {
      const isSel = (selectedValue === emp.EmpName || selectedValue === emp.EmpID) ? 'selected' : '';
      const pos = emp.PositionText ? ` - ${emp.PositionText}` : '';
      html += `<option value="${escapeHtml(emp.EmpName)}" data-empid="${escapeHtml(emp.EmpID)}" data-dept="Cơ điện" ${isSel}>${escapeHtml(emp.EmpName)}${escapeHtml(pos)}</option>`;
    }
    html += `</optgroup>`;
  }

  const kythuat = groupedEmployees['Kỹ thuật'] || [];
  if (kythuat.length > 0) {
    html += `<optgroup label="🛠️ Phòng Kỹ Thuật (${kythuat.length} nhân sự)">`;
    for (const emp of kythuat) {
      const isSel = (selectedValue === emp.EmpName || selectedValue === emp.EmpID) ? 'selected' : '';
      const pos = emp.PositionText ? ` - ${emp.PositionText}` : '';
      html += `<option value="${escapeHtml(emp.EmpName)}" data-empid="${escapeHtml(emp.EmpID)}" data-dept="Kỹ thuật" ${isSel}>${escapeHtml(emp.EmpName)}${escapeHtml(pos)}</option>`;
    }
    html += `</optgroup>`;
  }

  return html;
}

function populateEmployeeDropdowns() {
  const newAssignee = document.getElementById('newTaskAssignee');
  if (newAssignee) newAssignee.innerHTML = buildEmployeeSelectOptions(newAssignee.value, '-- Chọn kỹ thuật viên phụ trách --');

  const tplAssignee = document.getElementById('tplAssignee');
  if (tplAssignee) tplAssignee.innerHTML = buildEmployeeSelectOptions(tplAssignee.value, '-- Chọn kỹ thuật viên phụ trách --');

  const detailAssignee = document.getElementById('modalDetailAssignedTo');
  if (detailAssignee) detailAssignee.innerHTML = buildEmployeeSelectOptions(detailAssignee.value, '-- Chọn kỹ thuật viên --');

  const detailNewItemAssignee = document.getElementById('detailNewItemAssignee');
  if (detailNewItemAssignee) detailNewItemAssignee.innerHTML = buildEmployeeSelectOptions('', '-- Chọn nhân viên thực hiện --');
}

// =========================================================================
// EMPLOYEE GROUPS MANAGEMENT & ASSIGNMENT
// =========================================================================
async function loadGroups() {
  try {
    const res = await fetch('/api/internal-tasks/groups');
    if (!res.ok) throw new Error('Không thể tải danh sách nhóm');
    const data = await res.json();
    allGroups = data.groups || [];
    populateGroupDropdowns();
  } catch (err) {
    console.warn('Lỗi tải nhóm nhân sự:', err);
  }
}

function buildGroupSelectOptions(selectedGroupId = '', placeholder = '-- Phân công cho nhóm --') {
  let html = `<option value="">${placeholder}</option>`;
  allGroups.forEach(g => {
    const isSel = (String(selectedGroupId) === String(g.id)) ? 'selected' : '';
    html += `<option value="${g.id}" ${isSel}>👥 ${escapeHtml(g.GroupName)} (${g.members_count || (g.members ? g.members.length : 0)} TV)</option>`;
  });
  return html;
}

function buildAssigneeOptionsForGroup(groupId, selectedAssignee = '', placeholder = '-- Chọn KTV phụ trách --') {
  if (!groupId) {
    return buildEmployeeSelectOptions(selectedAssignee, placeholder);
  }
  const group = allGroups.find(g => String(g.id) === String(groupId));
  if (!group || !group.members || group.members.length === 0) {
    return buildEmployeeSelectOptions(selectedAssignee, placeholder);
  }

  let html = `<option value="">${placeholder}</option>`;
  html += `<optgroup label="👥 Thành Viên Nhóm ${escapeHtml(group.GroupName)} (${group.members.length})">`;
  group.members.forEach(m => {
    const isSel = (selectedAssignee === m.EmpName || selectedAssignee === m.EmpID) ? 'selected' : '';
    const leaderTag = m.IsLeader ? ' ⭐ [Trưởng nhóm]' : '';
    html += `<option value="${escapeHtml(m.EmpName)}" data-empid="${escapeHtml(m.EmpID)}" data-dept="${escapeHtml(m.Department || 'Cơ điện')}" ${isSel}>${escapeHtml(m.EmpName)}${leaderTag}</option>`;
  });
  html += `</optgroup>`;

  html += `<optgroup label="🌐 Tất Cả Nhân Sự Khác">`;
  allEmployees.forEach(emp => {
    if (!group.members.some(m => m.EmpID === emp.EmpID)) {
      const isSel = (selectedAssignee === emp.EmpName || selectedAssignee === emp.EmpID) ? 'selected' : '';
      html += `<option value="${escapeHtml(emp.EmpName)}" data-empid="${escapeHtml(emp.EmpID)}" data-dept="${escapeHtml(emp.Department || '')}" ${isSel}>${escapeHtml(emp.EmpName)}</option>`;
    }
  });
  html += `</optgroup>`;
  return html;
}

function populateGroupDropdowns() {
  const newTaskGroup = document.getElementById('newTaskGroup');
  if (newTaskGroup) {
    newTaskGroup.innerHTML = buildGroupSelectOptions(newTaskGroup.value, '-- Phân công cho nhóm --');
  }
}

function onTaskGroupSelectChange() {
  const grpSelect = document.getElementById('newTaskGroup');
  const assigneeSelect = document.getElementById('newTaskAssignee');
  if (!grpSelect || !assigneeSelect) return;
  assigneeSelect.innerHTML = buildAssigneeOptionsForGroup(grpSelect.value, assigneeSelect.value, '-- Chọn kỹ thuật viên phụ trách --');
}

function onDesktopDetailGroupChange() {
  const grpSelect = document.getElementById('desktopDetailGroup');
  const assigneeSelect = document.getElementById('desktopDetailAssignee');
  if (!grpSelect || !assigneeSelect) return;
  assigneeSelect.innerHTML = buildAssigneeOptionsForGroup(grpSelect.value, assigneeSelect.value, '-- Chọn kỹ thuật viên --');
}

// Group Manager Modal
async function openManageGroupsModal() {
  const modal = document.getElementById('manageGroupsModal');
  if (!modal) return;
  showModal(modal);
  if (allEmployees.length === 0) {
    await loadEmployees();
  }
  await loadGroups();
  renderGroupManager();
}

function closeManageGroupsModal() {
  const modal = document.getElementById('manageGroupsModal');
  if (modal) hideModal(modal);
}

function renderGroupManager() {
  const listContainer = document.getElementById('groupListContainer');
  const addEmpSelect = document.getElementById('selectAddGroupEmployee');
  if (!listContainer) return;

  // Populate Add Employee dropdown
  if (addEmpSelect) {
    let optHtml = '<option value="">-- Chọn nhân viên để thêm vào nhóm này --</option>';
    allEmployees.forEach(emp => {
      optHtml += `<option value="${escapeHtml(emp.EmpID)}">${escapeHtml(emp.EmpName)} (${escapeHtml(emp.EmpID)} - ${escapeHtml(emp.Department || '')})</option>`;
    });
    addEmpSelect.innerHTML = optHtml;
  }

  if (!activeGroupId && allGroups.length > 0) {
    activeGroupId = allGroups[0].id;
  }

  // Render group list in sidebar
  listContainer.innerHTML = allGroups.map(g => {
    const isSel = g.id === activeGroupId;
    return `
      <div class="group-nav-item ${isSel ? 'active' : ''}" onclick="selectGroupInManager(${g.id})" style="padding: 10px 12px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: ${isSel ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)'}; border: 1px solid ${isSel ? '#6366F1' : 'var(--border-subtle)'}; transition: all 0.15s ease;">
        <div>
          <div style="font-weight: 700; font-size: 0.88rem; color: ${isSel ? '#818CF8' : 'var(--text-primary)'};">👥 ${escapeHtml(g.GroupName)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(g.GroupCode || '')}</div>
        </div>
        <span class="badge" style="font-size: 0.72rem; font-weight: 700; background: ${isSel ? '#6366F1' : 'rgba(255,255,255,0.06)'}; color: #FFF;">${g.members_count || 0} TV</span>
      </div>
    `;
  }).join('');

  renderGroupMembers();
}

function selectGroupInManager(groupId) {
  activeGroupId = groupId;
  renderGroupManager();
}

function renderGroupMembers() {
  const g = allGroups.find(x => x.id === activeGroupId);
  const nameEl = document.getElementById('groupSelectedName');
  const descEl = document.getElementById('groupSelectedDesc');
  const countBadge = document.getElementById('groupMemberCountBadge');
  const membersList = document.getElementById('groupMembersList');

  if (!g) {
    if (nameEl) nameEl.textContent = 'Chưa chọn nhóm';
    if (descEl) descEl.textContent = '';
    if (countBadge) countBadge.textContent = '0 thành viên';
    if (membersList) membersList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 20px; text-align: center;">Chưa có nhóm nào được chọn.</div>';
    return;
  }

  if (nameEl) nameEl.textContent = `👥 ${g.GroupName}`;
  if (descEl) descEl.textContent = g.Description || `Mã nhóm: ${g.GroupCode || '-'}`;
  if (countBadge) countBadge.textContent = `${g.members_count || (g.members ? g.members.length : 0)} thành viên`;

  if (!membersList) return;
  const members = g.members || [];

  if (members.length === 0) {
    membersList.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.85rem; padding: 30px; text-align: center; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px dashed var(--border-subtle);">
        Nhóm này hiện chưa có thành viên. Hãy chọn nhân viên ở thanh phía trên và bấm <strong>'Thêm Vào Nhóm'</strong>.
      </div>
    `;
    return;
  }

  membersList.innerHTML = members.map(m => {
    const isLeader = !!m.IsLeader;
    return `
      <div class="group-member-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: ${isLeader ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.02)'}; border: 1px solid ${isLeader ? 'rgba(245, 158, 11, 0.25)' : 'var(--border-subtle)'}; border-radius: 6px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: ${isLeader ? '#F59E0B' : '#6366F1'}; color: #FFF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem;">
            ${(m.EmpName || 'N').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
              <span>${escapeHtml(m.EmpName)}</span>
              ${isLeader ? '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #F59E0B; font-size: 0.68rem; font-weight: 800; border: 1px solid rgba(245, 158, 11, 0.35);">⭐ TRƯỞNG NHÓM</span>' : ''}
            </div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">
              Mã: <code style="color: #93C5FD;">${escapeHtml(m.EmpID)}</code> ${m.Department ? `• ${escapeHtml(m.Department)}` : ''} ${m.PositionText ? `• ${escapeHtml(m.PositionText)}` : ''}
            </div>
          </div>
        </div>

        <button type="button" class="btn-clear" onclick="removeEmployeeFromCurrentGroup('${escapeHtml(m.EmpID)}')" style="color: #EF4444; font-size: 0.82rem; font-weight: 700; padding: 4px 8px; border-radius: 4px; cursor: pointer;" title="Xóa nhân viên khỏi nhóm">
          ✕ Xóa
        </button>
      </div>
    `;
  }).join('');
}

async function addEmployeeToCurrentGroup() {
  if (!activeGroupId) {
    showToast('Vui lòng chọn một nhóm trước!', 'warning');
    return;
  }
  const sel = document.getElementById('selectAddGroupEmployee');
  const empId = sel ? sel.value : '';
  if (!empId) {
    showToast('Vui lòng chọn nhân viên để thêm vào nhóm!', 'warning');
    return;
  }
  const isLeader = document.getElementById('chkIsGroupLeader')?.checked ? 1 : 0;

  try {
    const res = await fetch(`/api/internal-tasks/groups/${activeGroupId}/members`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ EmpID: empId, IsLeader: isLeader })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể thêm nhân viên vào nhóm');

    showToast('Đã thêm nhân viên vào nhóm thành công!', 'success');
    if (sel) sel.value = '';
    const chk = document.getElementById('chkIsGroupLeader');
    if (chk) chk.checked = false;

    await loadGroups();
    renderGroupManager();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function removeEmployeeFromCurrentGroup(empId) {
  if (!activeGroupId || !empId) return;
  if (!confirm(`Bạn có chắc muốn xóa nhân viên này khỏi nhóm?`)) return;

  try {
    const res = await fetch(`/api/internal-tasks/groups/${activeGroupId}/members/${empId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể xóa nhân viên khỏi nhóm');

    showToast('Đã xóa nhân viên khỏi nhóm.', 'info');
    await loadGroups();
    renderGroupManager();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function promptCreateNewGroup() {
  const groupName = prompt('Nhập tên nhóm làm việc mới (ví dụ: "Nhóm Bảo Dưỡng Ca 3"):');
  if (!groupName || !groupName.trim()) return;

  const groupCode = prompt('Nhập mã định danh nhóm (ví dụ: "NHOM_3", viết liền không dấu):', groupName.trim().toUpperCase().replace(/\s+/g, '_'));
  if (!groupCode || !groupCode.trim()) return;

  const desc = prompt('Nhập mô tả nhóm (tùy chọn):', '');

  try {
    const res = await fetch('/api/internal-tasks/groups', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        GroupName: groupName.trim(),
        GroupCode: groupCode.trim().toUpperCase(),
        Description: desc ? desc.trim() : ''
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể tạo nhóm mới');

    showToast(`Đã tạo nhóm "${groupName.trim()}" thành công!`, 'success');
    await loadGroups();
    if (data.group && data.group.id) {
      activeGroupId = data.group.id;
    }
    renderGroupManager();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteCurrentGroup() {
  if (!activeGroupId) {
    showToast('Chưa chọn nhóm nào để xóa!', 'warning');
    return;
  }
  const g = allGroups.find(x => x.id === activeGroupId);
  const groupName = g ? g.GroupName : `ID ${activeGroupId}`;
  const memberCount = g ? (g.members_count || (g.members ? g.members.length : 0)) : 0;

  const confirmMsg = memberCount > 0
    ? `Bạn có chắc muốn XÓA nhóm "${groupName}"?\n\nNhóm này còn ${memberCount} thành viên. Xóa nhóm sẽ KHÔNG xóa nhân viên, chỉ giải thể nhóm.`
    : `Bạn có chắc muốn XÓA nhóm "${groupName}"?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`/api/internal-tasks/groups/${activeGroupId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Không thể xóa nhóm');

    showToast(`Đã xóa nhóm "${groupName}" thành công.`, 'info');
    activeGroupId = null;
    await loadGroups();
    if (allGroups.length > 0) activeGroupId = allGroups[0].id;
    renderGroupManager();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// =========================================================================
// MODAL HELPER FUNCTIONS - FORCE SHOW/HIDE VIA INLINE STYLE + CLASS
// Level 1 (50000): Base Modals (taskDetailModal, recurringTemplateModal, createTaskModal)
// Level 2 (60000): Child Modals (quickSubItemModal, itemSampleModal, subItemCompareModal)
// Level 3 (70000): Lightbox Image Viewer (lightboxModal)
// =========================================================================
function showModal(modalEl) {
  if (!modalEl) return;
  document.body.classList.add('modal-open');
  modalEl.classList.add('open', 'active');
  modalEl.style.setProperty('display', 'flex', 'important');
  modalEl.style.setProperty('opacity', '1', 'important');
  modalEl.style.setProperty('visibility', 'visible', 'important');
  modalEl.style.setProperty('pointer-events', 'auto', 'important');

  // Layering hierarchy (z-index only):
  if (modalEl.id === 'lightboxModal') {
    modalEl.style.setProperty('z-index', '70000', 'important');
  } else if (['subItemCompareModal', 'itemSampleModal', 'quickSubItemModal', 'subItemNoteModal', 'taskCancelModal'].includes(modalEl.id)) {
    modalEl.style.setProperty('z-index', '60000', 'important');
  } else {
    modalEl.style.setProperty('z-index', '50000', 'important');
  }
}

function hideModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('open', 'active');
  modalEl.style.removeProperty('opacity');
  modalEl.style.removeProperty('visibility');
  modalEl.style.removeProperty('pointer-events');
  modalEl.style.removeProperty('z-index');
  modalEl.style.setProperty('display', 'none', 'important');

  // Revert dropdown if taskCancelModal closed without confirm
  if (modalEl.id === 'taskCancelModal') {
    const source = document.getElementById('cancelTriggerSource')?.value;
    const prevStatus = document.getElementById('cancelPreviousStatus')?.value || 'PENDING';
    if (source === 'desktop') {
      const sel = document.getElementById('desktopDetailStatusSelect');
      if (sel && sel.value === 'CANCELLED') {
        sel.value = prevStatus;
        sel.dataset.prevStatus = prevStatus;
        updateStatusDropdownStyle(sel, prevStatus);
      }
    } else if (source === 'modal') {
      const sel = document.getElementById('modalDetailStatusSelect');
      if (sel && sel.value === 'CANCELLED') {
        sel.value = prevStatus;
        updateStatusDropdownStyle(sel, prevStatus);
      }
    }
  }

  // Check if any other modal is still active
  setTimeout(() => {
    const anyOpen = document.querySelector('.modal-overlay.open, .modal-overlay.active, .lightbox-overlay.open, .lightbox-overlay.active');
    if (!anyOpen) {
      document.body.classList.remove('modal-open');
    }
  }, 50);
}

// Global modal backdrop close
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList && (e.target.classList.contains('modal-overlay') || e.target.classList.contains('lightbox-overlay'))) {
    hideModal(e.target);
  }
});

// Global Escape key to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open, .modal-overlay.active, .lightbox-overlay.open, .lightbox-overlay.active').forEach(m => {
      hideModal(m);
    });
  }
});


// =========================================================================
// USER PROFILE & AUTHENTICATION INITIALIZATION
// =========================================================================
let currentUser = null;

async function checkAuth() {
  const token = localStorage.getItem('bopp_token') || sessionStorage.getItem('bopp_token') || localStorage.getItem('token');
  const storedUser = localStorage.getItem('bopp_user') || sessionStorage.getItem('bopp_user');

  if (storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
    } catch (e) {
      console.warn('Cannot parse stored user:', e);
    }
  }

  if (token) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user || data;
        localStorage.setItem('bopp_user', JSON.stringify(currentUser));
      } else if (res.status === 401) {
        currentUser = null;
        localStorage.removeItem('bopp_token');
        localStorage.removeItem('bopp_user');
      }
    } catch (err) {
      console.warn('checkAuth error:', err);
    }
  }

  renderUserProfileChip();
  return currentUser;
}

function getAuthHeaders(customHeaders = {}) {
  const token = localStorage.getItem('bopp_token') || sessionStorage.getItem('bopp_token') || localStorage.getItem('token');
  const headers = { ...customHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function initUserProfile() {
  checkAuth();

  // Quick user login buttons in modal
  document.querySelectorAll('#loginModal .quick-user-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uInput = document.getElementById('loginUsername');
      const pInput = document.getElementById('loginPassword');
      if (uInput && pInput) {
        uInput.value = btn.dataset.user || '';
        pInput.value = btn.dataset.pass || '';
        uInput.focus();
      }
    });
  });
}

function renderUserProfileChip() {
  const chipContainer = document.getElementById('userProfileChip');
  if (!chipContainer) return;

  if (currentUser) {
    const roleColors = { admin: '#EF4444', supervisor: '#F59E0B', technician: '#10B981' };
    const roleLabels = { admin: 'Quản trị', supervisor: 'Giám sát', technician: 'Kỹ thuật viên' };
    const color = roleColors[currentUser.role] || '#6366F1';
    const label = roleLabels[currentUser.role] || currentUser.role;
    const initial = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();

    chipContainer.innerHTML = `
      <button type="button" id="btnOpenProfileModal" class="user-avatar-btn" title="Tài khoản: ${escapeHtml(currentUser.full_name || currentUser.username)} (${label}) - Bấm xem thông tin" style="--avatar-color: ${color};">
        <span class="avatar-letter">${initial}</span>
        <span class="user-status-dot" style="background: ${color};"></span>
      </button>
    `;
    document.getElementById('btnOpenProfileModal')?.addEventListener('click', openUserProfileModal);
  } else {
    chipContainer.innerHTML = `
      <button type="button" id="btnOpenLoginModal" class="user-avatar-btn is-guest" title="Bấm để đăng nhập tài khoản">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </button>
    `;
    document.getElementById('btnOpenLoginModal')?.addEventListener('click', openLoginModal);
  }
}

function openUserProfileModal() {
  if (!currentUser) return;
  const modal = document.getElementById('userProfileModal');
  if (!modal) return;

  const roleColors = { admin: '#EF4444', supervisor: '#F59E0B', technician: '#10B981' };
  const roleLabels = { admin: 'Quản trị viên', supervisor: 'Giám sát viên', technician: 'Kỹ thuật viên' };
  const color = roleColors[currentUser.role] || '#6366F1';
  const label = roleLabels[currentUser.role] || currentUser.role;
  const initial = (currentUser.full_name || currentUser.username || 'U').charAt(0).toUpperCase();

  const avatarLarge = document.getElementById('profileAvatarLarge');
  if (avatarLarge) {
    avatarLarge.textContent = initial;
    avatarLarge.style.background = color;
  }
  const nameEl = document.getElementById('profileFullName');
  if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.username;
  const roleEl = document.getElementById('profileRoleBadge');
  if (roleEl) {
    roleEl.textContent = label;
    roleEl.style.color = color;
    roleEl.style.borderColor = color;
  }
  const userTagEl = document.getElementById('profileUsername');
  if (userTagEl) {
    userTagEl.textContent = currentUser.emp_id ? `Mã NV: ${currentUser.emp_id}` : `Tài khoản: ${currentUser.username}`;
  }

  showModal(modal);
}

function closeUserProfileModal() {
  const modal = document.getElementById('userProfileModal');
  if (modal) hideModal(modal);
}

function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) showModal(modal);
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) hideModal(modal);
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');
  if (!uInput || !pInput) return;
  const username = uInput.value.trim();
  const password = pInput.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Sai thông tin đăng nhập');
    }
    const data = await res.json();
    const token = data.access_token || data.token;
    localStorage.setItem('bopp_token', token);
    currentUser = data.user || data;
    localStorage.setItem('bopp_user', JSON.stringify(currentUser));
    renderUserProfileChip();
    closeLoginModal();
    showToast(`Chào mừng ${currentUser.full_name || currentUser.username} đăng nhập thành công!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logoutUser() {
  localStorage.removeItem('bopp_token');
  localStorage.removeItem('bopp_user');
  currentUser = null;
  renderUserProfileChip();
  closeUserProfileModal();
  showToast('Đã đăng xuất tài khoản', 'info');
}

function initTaskStatsState() {
  const savedState = localStorage.getItem('bopp_tasks_stats_collapsed');
  const wrapper = document.getElementById('taskStatsCollapsible');
  const toggleText = document.getElementById('taskStatsToggleText');
  const chevron = document.getElementById('taskStatsToggleChevron');
  const isCollapsed = savedState === 'true';
  if (wrapper) {
    wrapper.classList.toggle('is-collapsed', isCollapsed);
  }
  if (toggleText) {
    toggleText.textContent = isCollapsed ? 'Xem Thống Kê' : 'Thu Gọn Thống Kê';
  }
  if (chevron) {
    chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
    chevron.style.transition = 'transform 0.2s ease';
  }
}

window.toggleTaskStats = function () {
  const wrapper = document.getElementById('taskStatsCollapsible');
  const toggleText = document.getElementById('taskStatsToggleText');
  const chevron = document.getElementById('taskStatsToggleChevron');
  if (!wrapper) return;

  const isCollapsed = wrapper.classList.toggle('is-collapsed');
  if (isCollapsed) {
    if (toggleText) toggleText.textContent = 'Xem Thống Kê';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    localStorage.setItem('bopp_tasks_stats_collapsed', 'true');
  } else {
    if (toggleText) toggleText.textContent = 'Thu Gọn Thống Kê';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    localStorage.setItem('bopp_tasks_stats_collapsed', 'false');
  }
};

// =========================================================================
// MAIN VIEW MODE SWITCHER (Công Việc Hiện Hành vs Hạng Mục Định Kỳ)
// =========================================================================
function switchTaskTabMode(mode) {
  // Đóng mọi modal/popup đang mở để tránh chồng chéo giao diện giữa các tab
  document.querySelectorAll('.modal-overlay.open, .modal-overlay.active, .lightbox-overlay.open, .lightbox-overlay.active').forEach(m => {
    hideModal(m);
  });

  currentTabMode = mode;
  const tabActive = document.getElementById('tabModeActiveTasks');
  const tabRecurring = document.getElementById('tabModeRecurring');
  const viewActive = document.getElementById('viewActiveTasksSection');
  const viewRecurring = document.getElementById('viewRecurringSection');
  const btnTopCreate = document.getElementById('btnTopCreateTask');
  const btnTopAddRec = document.getElementById('btnTopAddRecurring');

  if (mode === 'active') {
    if (tabActive) tabActive.classList.add('active');
    if (tabRecurring) tabRecurring.classList.remove('active');
    if (viewActive) viewActive.style.display = 'block';
    if (viewRecurring) viewRecurring.style.display = 'none';
    if (btnTopCreate) btnTopCreate.style.display = 'inline-flex';
    if (btnTopAddRec) btnTopAddRec.style.display = 'none';
    updateStickyHeaderOffset();
  } else {
    if (tabActive) tabActive.classList.remove('active');
    if (tabRecurring) tabRecurring.classList.add('active');
    if (viewActive) viewActive.style.display = 'none';
    if (viewRecurring) viewRecurring.style.display = 'block';
    if (btnTopCreate) btnTopCreate.style.display = 'none';
    if (btnTopAddRec) btnTopAddRec.style.display = 'inline-flex';
    loadRecurringTemplates();
  }
}

// =========================================================================
// LOAD TASKS & SUMMARY METRICS
// =========================================================================
async function loadTasks() {
  try {
    const res = await fetch('/api/internal-tasks');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    allTasks = data.tasks || [];
    allTasks.sort((a, b) => b.id - a.id);

    updateSummaryMetrics();
    applyFilters();
  } catch (err) {
    console.error('Lỗi tải danh sách công việc nội bộ:', err);
    showToast('Không thể kết nối đến máy chủ để tải công việc!', 'error');
    const tbody = document.getElementById('excelTaskTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="14" style="text-align: center; padding: 40px; color: #EF4444;">
            <p style="font-weight: 600;">Lỗi tải dữ liệu công việc nội bộ!</p>
            <button class="btn-secondary" style="margin-top: 10px;" onclick="loadTasks()">Thử Lại</button>
          </td>
        </tr>
      `;
    }
  }
}

function updateSummaryMetrics() {
  const total = allTasks.length;
  let urgent = 0;
  let active = 0;
  let completed = 0;
  let totalDowntime = 0;

  allTasks.forEach(t => {
    if (t.Priority === 'URGENT' || t.TaskType === 'BREAKDOWN') urgent++;
    if (t.Status === 'PENDING' || t.Status === 'IN_PROGRESS') active++;
    if (t.Status === 'COMPLETED') completed++;
    if (t.DowntimeMinutes && t.DowntimeMinutes > 0) totalDowntime += Number(t.DowntimeMinutes);
  });

  const elTotal = document.getElementById('statTotalTasks');
  const elUrgent = document.getElementById('statUrgentTasks');
  const elActive = document.getElementById('statActiveTasks');
  const elCompleted = document.getElementById('statCompletedTasks');
  const elDowntime = document.getElementById('statDowntimeMin');
  const elBadgeActive = document.getElementById('badgeActiveTasksCount');

  if (elTotal) elTotal.textContent = total.toLocaleString();
  if (elUrgent) elUrgent.textContent = urgent.toLocaleString();
  if (elActive) elActive.textContent = active.toLocaleString();
  if (elCompleted) elCompleted.textContent = completed.toLocaleString();
  if (elDowntime) elDowntime.textContent = `${totalDowntime.toLocaleString()}'`;
  if (elBadgeActive) elBadgeActive.textContent = active.toLocaleString();
}

// =========================================================================
// FILTERS & SEARCH FOR ACTIVE TASKS
// =========================================================================
function setupSearchDebounce() {
  const input = document.getElementById('taskSearchInput');
  const btnClear = document.getElementById('btnClearTaskSearch');
  if (!input) return;
  let timeout = null;
  input.addEventListener('input', () => {
    if (btnClear) btnClear.style.display = input.value.trim() ? 'block' : 'none';
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      applyFilters();
    }, 250);
  });
}

function clearTaskSearch() {
  const input = document.getElementById('taskSearchInput');
  const btnClear = document.getElementById('btnClearTaskSearch');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (btnClear) btnClear.style.display = 'none';
  applyFilters();
}

function toggleTaskFilters() {
  const grid = document.getElementById('taskFiltersGrid');
  const btn = document.getElementById('btnToggleTaskFilters');
  if (!grid) return;
  const isShown = grid.classList.toggle('show-filters');
  if (btn) {
    btn.classList.toggle('active', isShown);
  }
}

function toggleRecurringFilters() {
  const row = document.getElementById('recurringFiltersRow');
  const btn = document.getElementById('btnToggleRecurringFilters');
  if (!row) return;
  const isShown = row.classList.toggle('show-filters');
  if (btn) {
    btn.classList.toggle('active', isShown);
  }
}

function updateStickyHeaderOffset() {
  const header = document.querySelector('.app-header');
  if (header) {
    const h = header.offsetHeight;
    if (h > 0) {
      document.documentElement.style.setProperty('--app-header-h', `${h}px`);
    }
  }
}

function resetAllTaskFilters() {
  const input = document.getElementById('taskSearchInput');
  const btnClear = document.getElementById('btnClearTaskSearch');
  if (input) input.value = '';
  if (btnClear) btnClear.style.display = 'none';

  const fType = document.getElementById('filterTaskType');
  if (fType) fType.value = 'all';
  const fStatus = document.getElementById('filterStatus');
  if (fStatus) fStatus.value = 'UNCOMPLETED';
  const fRec = document.getElementById('filterRecurring');
  if (fRec) fRec.value = 'all';
  const fPrio = document.getElementById('filterPriority');
  if (fPrio) fPrio.value = 'all';

  activeFilterType = 'all';
  applyFilters();
}

function filterByType(type, btnElement) {
  activeFilterType = type;
  const sel = document.getElementById('filterTaskType');
  if (sel) sel.value = type;
  applyFilters();
}

// =========================================================================
// METADATA & SCOPE DEFINITIONS
// =========================================================================
const typeMeta = {
  BREAKDOWN: { text: 'Sự Cố Máy', class: 'badge-type-breakdown' },
  DEPT_REQUEST: { text: 'Yêu Cầu P.Ban', class: 'badge-type-dept' },
  IMPROVEMENT: { text: 'Cải Tiến', class: 'badge-type-improvement' },
  INTERNAL: { text: 'Nội Bộ Kỹ Thuật', class: 'badge-type-internal' }
};

const priorityMeta = {
  URGENT: { text: 'Khẩn Cấp', icon: '🔥', class: 'prio-urgent' },
  HIGH: { text: 'Ưu Tiên Cao', icon: '⚠️', class: 'prio-high' },
  NORMAL: { text: 'Bình Thường', icon: '📋', class: 'prio-normal' },
  LOW: { text: 'Thấp', icon: '☕', class: 'prio-low' }
};

const statusMeta = {
  PENDING: { text: 'Chờ Tiếp Nhận', icon: '⏳', class: 'badge-status-pending' },
  IN_PROGRESS: { text: 'Đang Xử Lý', icon: '⚡', class: 'badge-status-inprogress' },
  HOLD: { text: 'Tạm Hoãn', icon: '⏸️', class: 'badge-status-hold' },
  COMPLETED: { text: 'Đã Hoàn Tất', icon: '✅', class: 'badge-status-completed' },
  CANCELLED: { text: 'Hủy', icon: '🚫', class: 'badge-status-cancelled' }
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr.split(' ')[0] || '';
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 60) return 'Vừa xong';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}' trước`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h trước`;
    const diffDays = Math.floor(diffSec / 86400);
    if (diffDays === 1) return 'Hôm qua';
    if (diffDays < 7) return `${diffDays} ngày trước`;
    const parts = dateStr.split(' ')[0].split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
    return dateStr.split(' ')[0];
  } catch (e) {
    return dateStr;
  }
}

function updateScopeBadges() {
  const userEmpId = currentUser?.emp_id || currentUser?.username || '';
  const userFullName = (currentUser?.full_name || '').trim().toLowerCase();
  const userGroupIds = currentUser?.group_ids || [];

  let countAll = 0;
  let countGroup = 0;
  let countMy = 0;

  allTasks.forEach(task => {
    if (task.Status !== 'COMPLETED' && task.Status !== 'CANCELLED') {
      countAll++;

      // Check Group
      let taskGroupIds = task.AssignedGroupIDs || [];
      if (typeof taskGroupIds === 'string') {
        try { taskGroupIds = JSON.parse(taskGroupIds); } catch (e) { taskGroupIds = []; }
      }
      if (userGroupIds.length > 0) {
        if (taskGroupIds.some(gid => userGroupIds.includes(Number(gid)))) countGroup++;
      } else if (taskGroupIds.length > 0 || task.AssignedGroupNames) {
        countGroup++;
      }

      // Check My
      let taskEmpIds = task.AssignedEmpIDs || [];
      if (typeof taskEmpIds === 'string') {
        try { taskEmpIds = JSON.parse(taskEmpIds); } catch (e) { taskEmpIds = []; }
      }
      const matchEmpId = userEmpId && taskEmpIds.includes(userEmpId);
      const matchAssignee = userFullName && (task.AssignedTo || '').toLowerCase().includes(userFullName);
      const matchUsername = userEmpId && (task.AssignedTo || '').toLowerCase().includes(userEmpId.toLowerCase());
      let matchItem = false;
      if (task.items && Array.isArray(task.items)) {
        matchItem = task.items.some(i => (userEmpId && i.AssignedEmpID === userEmpId) || (userFullName && (i.AssignedTo || '').toLowerCase().includes(userFullName)));
      }
      if (matchEmpId || matchAssignee || matchUsername || matchItem) {
        countMy++;
      }
    }
  });

  const bAll = document.getElementById('badgeScopeAllCount');
  const bGroup = document.getElementById('badgeScopeGroupCount');
  const bMy = document.getElementById('badgeScopeMyCount');

  if (bAll) bAll.textContent = countAll;
  if (bGroup) bGroup.textContent = countGroup;
  if (bMy) bMy.textContent = countMy;
}

function switchTaskScope(scope) {
  currentTaskScope = scope;

  const btnAll = document.getElementById('tabScopeAll');
  const btnGroup = document.getElementById('tabScopeGroup');
  const btnMy = document.getElementById('tabScopeMy');

  if (btnAll) btnAll.classList.toggle('active', scope === 'all');
  if (btnGroup) btnGroup.classList.toggle('active', scope === 'group');
  if (btnMy) btnMy.classList.toggle('active', scope === 'my');

  const titleEl = document.getElementById('tasksColumnTitle');
  if (titleEl) {
    if (scope === 'group') titleEl.textContent = 'Công Việc Của Nhóm';
    else if (scope === 'my') titleEl.textContent = 'Công Việc Của Tôi';
    else titleEl.textContent = 'Danh Sách Công Việc';
  }

  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('taskSearchInput')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('filterTaskType')?.value || activeFilterType || 'all';
  activeFilterType = typeFilter;
  const statusFilter = document.getElementById('filterStatus')?.value || 'UNCOMPLETED';
  const priorityFilter = document.getElementById('filterPriority')?.value || 'all';
  const recurringFilter = document.getElementById('filterRecurring')?.value || 'all';

  // Toggle active filter highlights and reset button style
  const filterIds = ['filterTaskType', 'filterStatus', 'filterRecurring', 'filterPriority'];
  let hasActiveFilter = !!search || (typeFilter !== 'all') || (priorityFilter !== 'all') || (recurringFilter !== 'all') || (statusFilter !== 'UNCOMPLETED');
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === 'filterStatus') {
        if (el.value && el.value !== 'UNCOMPLETED') {
          el.classList.add('active-filter');
        } else {
          el.classList.remove('active-filter');
        }
      } else {
        if (el.value && el.value !== 'all') {
          el.classList.add('active-filter');
        } else {
          el.classList.remove('active-filter');
        }
      }
    }
  });

  const btnReset = document.getElementById('btnResetTaskFilters');
  if (btnReset) {
    if (hasActiveFilter) {
      btnReset.style.color = '#FCA5A5';
      btnReset.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btnReset.style.background = 'rgba(239, 68, 68, 0.12)';
    } else {
      btnReset.style.color = 'var(--text-muted)';
      btnReset.style.borderColor = 'var(--border-subtle)';
      btnReset.style.background = 'rgba(255, 255, 255, 0.04)';
    }
  }

  const btnClear = document.getElementById('btnClearTaskSearch');
  if (btnClear) {
    btnClear.style.display = search ? 'block' : 'none';
  }

  // Update badge & active styling for mobile filter toggle button
  let activeDropdownCount = 0;
  if (typeFilter !== 'all') activeDropdownCount++;
  if (statusFilter !== 'UNCOMPLETED') activeDropdownCount++;
  if (recurringFilter !== 'all') activeDropdownCount++;
  if (priorityFilter !== 'all') activeDropdownCount++;

  const badge = document.getElementById('activeFilterBadge');
  const btnToggle = document.getElementById('btnToggleTaskFilters');
  if (badge) {
    if (activeDropdownCount > 0) {
      badge.textContent = activeDropdownCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
  if (btnToggle) {
    if (activeDropdownCount > 0) {
      btnToggle.classList.add('has-filters');
    } else {
      btnToggle.classList.remove('has-filters');
    }
  }

  const userEmpId = currentUser?.emp_id || currentUser?.username || '';
  const userFullName = (currentUser?.full_name || '').trim().toLowerCase();
  const userGroupIds = currentUser?.group_ids || [];

  filteredTasks = allTasks.filter(task => {
    // 1. Scope filter
    if (currentTaskScope === 'group') {
      let taskGroupIds = task.AssignedGroupIDs || [];
      if (typeof taskGroupIds === 'string') {
        try { taskGroupIds = JSON.parse(taskGroupIds); } catch (e) { taskGroupIds = []; }
      }
      if (userGroupIds.length > 0) {
        const hasOverlap = taskGroupIds.some(gid => userGroupIds.includes(Number(gid)));
        if (!hasOverlap) return false;
      } else {
        if (taskGroupIds.length === 0 && !task.AssignedGroupNames) return false;
      }
    } else if (currentTaskScope === 'my') {
      let taskEmpIds = task.AssignedEmpIDs || [];
      if (typeof taskEmpIds === 'string') {
        try { taskEmpIds = JSON.parse(taskEmpIds); } catch (e) { taskEmpIds = []; }
      }
      const matchEmpId = userEmpId && taskEmpIds.includes(userEmpId);
      const matchAssignee = userFullName && (task.AssignedTo || '').toLowerCase().includes(userFullName);
      const matchUsername = userEmpId && (task.AssignedTo || '').toLowerCase().includes(userEmpId.toLowerCase());
      let matchItem = false;
      if (task.items && Array.isArray(task.items)) {
        matchItem = task.items.some(i => (userEmpId && i.AssignedEmpID === userEmpId) || (userFullName && (i.AssignedTo || '').toLowerCase().includes(userFullName)));
      }
      if (!matchEmpId && !matchAssignee && !matchUsername && !matchItem) {
        return false;
      }
    }

    // 2. Filter by type
    if (typeFilter !== 'all' && task.TaskType !== typeFilter) {
      return false;
    }

    // 3. Filter by status
    if (statusFilter === 'UNCOMPLETED') {
      if (task.Status === 'COMPLETED' || task.Status === 'CANCELLED') return false;
    } else if (statusFilter !== 'all' && task.Status !== statusFilter) {
      return false;
    }

    // 4. Filter by priority
    if (priorityFilter !== 'all' && task.Priority !== priorityFilter) {
      return false;
    }

    // 5. Filter by recurring
    if (recurringFilter === 'recurring' && !task.RecurringTemplateID) {
      return false;
    }
    if (recurringFilter === 'one_off' && task.RecurringTemplateID) {
      return false;
    }

    // 6. Filter by text search
    if (search) {
      const matchCode = (task.TaskCode || '').toLowerCase().includes(search);
      const matchTitle = (task.TaskTitle || '').toLowerCase().includes(search);
      const matchMachine = ((task.MachineName || '') + ' ' + (task.MachineID || '')).toLowerCase().includes(search);
      const matchReq = (task.RequesterName || '').toLowerCase().includes(search);
      const matchAssign = (task.AssignedTo || '').toLowerCase().includes(search);
      const matchGroup = (task.AssignedGroupNames || '').toLowerCase().includes(search);
      const matchDesc = (task.Description || '').toLowerCase().includes(search);
      const matchCycle = (task.CycleInfo || '').toLowerCase().includes(search);
      if (!matchCode && !matchTitle && !matchMachine && !matchReq && !matchAssign && !matchGroup && !matchDesc && !matchCycle) {
        return false;
      }
    }

    return true;
  });

  updateScopeBadges();
  renderTaskCards();
  renderTaskExcelTable();
}

// =========================================================================
// RENDER 4-LINE TASK CARDS & MASTER-DETAIL INSPECTOR
// =========================================================================
function renderTaskCards() {
  const container = document.getElementById('tasksCardsList') || document.getElementById('taskCardsGrid');
  const counter = document.getElementById('tasksCounter');
  if (counter) {
    counter.textContent = `${filteredTasks.length} việc`;
  }
  if (!container) return;

  if (filteredTasks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-subtle);">
        <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
        <p style="font-size: 0.92rem; font-weight: 700; color: var(--text-secondary); margin: 0 0 6px 0;">Không tìm thấy công việc nào phù hợp</p>
        <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0 0 12px 0;">Thử đổi bộ lọc hoặc tạo công việc mới</p>
        <button class="btn-primary" style="padding: 6px 14px; font-size: 0.8rem; font-weight: 700;" onclick="openCreateTaskModal()">
          + Ghi Nhận Công Việc Mới
        </button>
      </div>
    `;

    if (!isMobileScreen()) {
      const emptyDetail = document.getElementById('taskEmptyDetailState');
      const activeDetail = document.getElementById('taskActiveDetailContent');
      if (emptyDetail) emptyDetail.style.display = 'block';
      if (activeDetail) activeDetail.style.display = 'none';
    }
    return;
  }

  container.innerHTML = filteredTasks.map(task => {
    const typeInfo = typeMeta[task.TaskType] || { text: task.TaskType, class: 'badge-type-internal' };
    const prioInfo = priorityMeta[task.Priority] || { text: task.Priority, icon: '📋', class: 'prio-normal' };
    const statusInfo = statusMeta[task.Status] || { text: task.Status, icon: '⏳', class: 'badge-status-pending' };

    // Machine tag
    const macLabel = task.MachineName || task.MachineID;
    const machineHtml = macLabel ? `
      <span class="task-machine-tag" title="${escapeHtml(task.MachineID || macLabel)}">
        ⚙️ ${escapeHtml(macLabel)}
      </span>
    ` : `<span class="task-machine-tag" style="opacity: 0.5;">⚙️ Chưa gán máy</span>`;

    // Department tag
    const deptHtml = task.Department ? `
      <span class="task-dept-tag">[${escapeHtml(task.Department)}]</span>
    ` : '';

    // Recurring badge
    const recurringHtml = task.RecurringTemplateID ? `
      <span class="badge badge-recurring" style="font-size: 0.65rem; padding: 1px 5px;" title="Chu kỳ: ${escapeHtml(task.CycleInfo || '')}">
        🔁 #${task.RecurringCount || 1}
      </span>
    ` : '';

    // Checklist mini progress
    let checklistMiniHtml = '';
    if (task.items_count && task.items_count > 0) {
      const pct = task.progress_percent || 0;
      const isComplete = pct === 100;
      checklistMiniHtml = `
        <div class="task-checklist-mini" title="Hạng mục hoàn thành: ${task.completed_items_count || 0}/${task.items_count} (${pct}%)">
          <span style="color: ${isComplete ? '#10B981' : '#818CF8'}; font-weight: 700; font-size: 0.70rem;">📋 ${task.completed_items_count}/${task.items_count}</span>
          <div style="width: 38px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; display: inline-block;">
            <div style="width: ${pct}%; height: 100%; background: ${isComplete ? '#10B981' : '#6366F1'};"></div>
          </div>
        </div>
      `;
    }

    // Group pill
    let groupHtml = '';
    if (task.AssignedGroupNames) {
      groupHtml = `<span class="task-group-pill">👥 ${escapeHtml(task.AssignedGroupNames)}</span>`;
    }

    const isSelected = task.id === selectedTaskId;

    return `
      <div class="internal-task-card ${isSelected ? 'selected' : ''}" data-task-id="${task.id}" onclick="selectInternalTask(${task.id})">
        <!-- Dòng 1: Header (Mã + Loại | Ưu tiên + Giờ) -->
        <div class="task-card-row-1">
          <div class="task-card-meta-left">
            <span class="task-code-badge">${escapeHtml(task.TaskCode)}</span>
            ${recurringHtml}
          </div>
          <div class="task-card-meta-right">
            <span class="priority-pill-interactive ${prioInfo.class}" onclick="openPriorityPicker(event, ${task.id})" title="Bấm để đổi mức độ ưu tiên">
              ${prioInfo.icon} ${prioInfo.text} <span class="prio-caret">▾</span>
            </span>
            <span class="task-time-text">${timeAgo(task.ReportedAt)}</span>
          </div>
        </div>

        <!-- Dòng 2: Tiêu đề công việc -->
        <div class="task-card-row-2">
          <h4 class="task-card-title">${escapeHtml(task.TaskTitle)}</h4>
        </div>

        <!-- Dòng 3: Máy/TB + Bộ phận + Tiến độ checklist -->
        <div class="task-card-row-3">
          <div class="task-machine-dept">
            ${machineHtml}
            ${deptHtml}
          </div>
          ${checklistMiniHtml}
        </div>

        <!-- Dòng 4: Phân công (Nhóm + KTV) + Trạng thái -->
        <div class="task-card-row-4">
          <div class="task-assignment-info">
            ${groupHtml}
            <span class="task-assignee-text">👷 ${escapeHtml(task.AssignedTo || 'Chưa phân công')}</span>
          </div>
          <span class="task-status-pill ${statusInfo.class}">
            ${statusInfo.icon} ${statusInfo.text}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Auto select first task on desktop if none selected
  if (!isMobileScreen() && (!selectedTaskId || !filteredTasks.some(t => t.id === selectedTaskId))) {
    if (filteredTasks.length > 0) {
      selectInternalTask(filteredTasks[0].id, false);
    }
  }
}

// Select Task (Master-Detail Handler)
function selectInternalTask(taskId, userInitiated = true) {
  selectedTaskId = taskId;

  document.querySelectorAll('.internal-task-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.taskId == taskId);
  });

  const mobileCodeEl = document.getElementById('mobileDetailTaskCode');
  const task = allTasks.find(t => t.id == taskId);
  if (mobileCodeEl && task) {
    mobileCodeEl.textContent = task.TaskCode || `#${task.id}`;
  }

  renderDesktopTaskDetail(taskId);

  if (isMobileScreen() && userInitiated) {
    showMobileDetailView();
  }
}

function showMobileDetailView() {
  document.body.classList.add('mobile-view-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    history.pushState({ view: 'taskDetail', id: selectedTaskId }, '');
  } catch (e) { }
}

function showMobileTasksListView() {
  document.body.classList.remove('mobile-view-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('popstate', (e) => {
  if (document.body.classList.contains('mobile-view-detail')) {
    document.body.classList.remove('mobile-view-detail');
  }
});

// Desktop & Mobile Task Detail Inspector (Directly Editable)
async function renderDesktopTaskDetail(taskId) {
  const container = document.getElementById('taskActiveDetailContent');
  const emptyState = document.getElementById('taskEmptyDetailState');
  if (!container) return;

  if (emptyState) emptyState.style.display = 'none';
  container.style.display = 'block';

  let task = allTasks.find(t => t.id == taskId);
  if (!task) return;

  try {
    const res = await fetch(`/api/internal-tasks/${taskId}`);
    if (res.ok) {
      const fullTask = await res.json();
      task = { ...task, ...fullTask };
      currentEditingTask = task;
      const idx = allTasks.findIndex(t => t.id == taskId);
      if (idx !== -1) allTasks[idx] = task;
    }
  } catch (e) {
    console.warn('Lỗi fetch chi tiết task cho panel:', e);
  }

  currentEditingTask = task;

  const prioInfo = priorityMeta[task.Priority] || { text: task.Priority, icon: '📋', class: 'prio-normal' };
  const statusInfo = statusMeta[task.Status] || { text: task.Status, icon: '⏳', class: 'badge-status-pending' };

  // Determine selected group ID
  let curGroupId = '';
  if (Array.isArray(task.AssignedGroupIDs) && task.AssignedGroupIDs.length > 0) {
    curGroupId = task.AssignedGroupIDs[0];
  } else if (typeof task.AssignedGroupIDs === 'string' && task.AssignedGroupIDs.startsWith('[')) {
    try {
      const parsed = JSON.parse(task.AssignedGroupIDs);
      if (parsed.length > 0) curGroupId = parsed[0];
    } catch (e) { }
  } else if (task.AssignedGroupIDs) {
    curGroupId = task.AssignedGroupIDs;
  }



  // Checklist items
  const items = task.items || [];
  const completedCount = items.filter(i => i.Status === 'COMPLETED').length;
  const totalCount = items.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : (task.Status === 'COMPLETED' ? 100 : 0);
  const images = task.images || [];

  let checklistHtml = `
    <!-- KHỐI 3: 📋 HẠNG MỤC KIỂM TRA -->
    <div class="desktop-detail-section" style="margin-bottom: 8px;">
      <div class="detail-sec-header">
        <div class="detail-sec-title title-checklist">
          <span>📋</span> HẠNG MỤC KIỂM TRA
        </div>
        <span class="checklist-progress-badge">
          ${completedCount}/${totalCount} (${progressPct}%)
        </span>
      </div>

      <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; margin-bottom: 10px; box-sizing: border-box;">
        <div style="width: ${progressPct}%; height: 100%; background: ${progressPct === 100 ? '#10B981' : 'linear-gradient(90deg, #6366F1, #10B981)'}; transition: width 0.3s ease;"></div>
      </div>

      <div class="desktop-checklist-items-wrap" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
        ${items.length === 0 ? `<div style="font-size: 0.78rem; color: var(--text-muted); font-style: italic; padding: 8px 0; text-align: center;">Chưa có hạng mục con nào. Nhập tên bên dưới để thêm mới.</div>` : ''}
        ${items.map((item, itemIdx) => {
    const isDone = item.Status === 'COMPLETED';
    const hasIssue = (item.HasIssue == 1 || item.HasIssue === true);
    const matchedPhoto = images.find(img => img.TaskItemID == item.id) || (item.ActualImageUrl ? { FileUrl: item.ActualImageUrl } : null);
    const actualImgUrl = (item.ActualImageUrl) || (matchedPhoto ? matchedPhoto.FileUrl : '');
    const hasActualPhoto = !!actualImgUrl;
    const sampleUrl = item.SampleImageUrl || '';
    const guideline = (item.StandardGuideline || '').trim();
    let execNote = (item.Note || item.Notes || '').trim();
    if (guideline && execNote === guideline) {
      execNote = '';
    }
    const isSingleTask = !task.RecurringTemplateID;
    const hasSample = !isSingleTask && !!sampleUrl;
    const performerName = item.CompletedBy || item.AssignedTo || '';

    return `
            <div class="subitem-card ${isDone ? 'is-completed' : ''} ${hasIssue ? 'has-issue' : ''}" style="margin-bottom: 8px;">
              <!-- DÒNG 1: Checkbox, Số thứ tự, Tên hạng mục + Hướng dẫn chi tiết + Nút xóa -->
              <div class="subitem-line-1" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                <label style="display: flex; align-items: flex-start; gap: 8px; flex: 1; cursor: pointer; margin: 0; min-width: 0;">
                  <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleItemCompleted(${item.id}, this.checked)" style="width: 18px; height: 18px; accent-color: #10B981; cursor: pointer; flex-shrink: 0; margin-top: 2px;">
                  <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                      <span class="subitem-order-tag" style="font-weight: 800; color: #64748B; font-size: 0.82rem;">#${itemIdx + 1}.</span>
                      <span class="subitem-title-text" style="line-height: 1.35; font-weight: 700; font-size: 0.90rem; color: var(--text-primary);">
                        ${escapeHtml(item.ItemTitle)}
                      </span>
                    </div>
                    ${guideline ? `
                      <div class="subitem-guideline-box" style="font-size: 0.76rem; color: #60A5FA; margin-top: 3px; word-break: break-word; line-height: 1.35; background: rgba(59, 130, 246, 0.08); padding: 3px 6px; border-radius: 4px; border-left: 2.5px solid #3B82F6;">
                        📖 <span style="font-weight: 700; color: #93C5FD;">Hướng dẫn:</span> ${escapeHtml(guideline)}
                      </div>
                    ` : ''}
                  </div>
                </label>
                <button type="button" class="btn-clear" onclick="deleteDesktopChecklistItem(${task.id}, ${item.id})" title="Xóa hạng mục" style="color: #EF4444; font-size: 0.85rem; padding: 2px 6px; cursor: pointer; line-height: 1; opacity: 0.6; flex-shrink: 0;">✕</button>
              </div>

              <!-- DÒNG 2: Nút sự cố, Text box nhập trực tiếp ghi chú kiểm tra -->
              <div class="subitem-line-2" style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn-sub-issue ${hasIssue ? 'active-issue' : ''}" onclick="toggleSubItemIssueQuick(${item.id}, ${hasIssue ? 0 : 1})" title="${hasIssue ? 'Đang đánh dấu có sự cố. Bấm để tắt' : 'Bấm để đánh dấu hạng mục có sự cố'}" style="flex-shrink: 0; height: 32px; padding: 0 10px; font-size: 0.75rem;">
                  <span>⚠️</span>
                  <span>${hasIssue ? 'Có sự cố' : 'Báo sự cố'}</span>
                </button>
                <div style="flex: 1; min-width: 0;">
                  <input type="text" class="subitem-direct-note-input" value="${escapeHtml(execNote)}" placeholder="Nhập ghi chú kiểm tra..." onchange="saveSubItemDirectNote(${item.id}, this.value)" onkeydown="if(event.key==='Enter'){this.blur();}">
                </div>
              </div>

              <!-- DÒNG 3: Hình ảnh mẫu, Hình ảnh thực tế kế bên, Nút chụp / chụp lại tách riêng -->
              <div class="subitem-line-3" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
                ${hasSample ? `
                  <div class="subitem-photo-thumb thumb-sop" onclick="openLightbox('${sampleUrl}', 'Ảnh mẫu chuẩn SOP: ${escapeHtml(item.ItemTitle)}')" title="Bấm để xem ảnh mẫu chuẩn SOP">
                    <img src="${sampleUrl}" alt="Ảnh SOP">
                    <span class="thumb-badge-sop">SOP</span>
                  </div>
                ` : (!isSingleTask ? `
                  <div class="subitem-photo-thumb thumb-sop-placeholder" onclick="triggerSubItemCapture(${item.id}, false, '${escapeHtml(item.ItemTitle)}', '', '${escapeHtml(guideline)}', '${actualImgUrl}')" title="Chưa có ảnh SOP. Bấm để mở cửa sổ đối chiếu / chụp">
                    <span style="font-size: 0.68rem; color: #94A3B8; text-align: center; padding: 4px; line-height: 1.2;">📋 SOP Chưa có</span>
                  </div>
                ` : '')}

                ${hasActualPhoto ? `
                  <div class="subitem-photo-thumb thumb-actual" onclick="openChecklistPhotoViewer(${item.id})" title="Bấm để xem ảnh phóng to">
                    <img src="${actualImgUrl}" alt="Ảnh thực tế">
                    <span class="thumb-badge-zoom" title="Phóng to">🔍</span>
                  </div>
                ` : ''}

                <!-- Nút Chụp Ảnh / Chụp Lại tách riêng -->
                ${hasActualPhoto ? `
                  <button type="button" class="btn-sub-camera btn-camera-retake" onclick="triggerSubItemCapture(${item.id}, ${isSingleTask ? 'true' : 'false'}, '${escapeHtml(item.ItemTitle)}', '${sampleUrl}', '${escapeHtml(guideline)}', '${actualImgUrl}')" title="Chụp lại ảnh cho hạng mục này">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                    <span>Chụp Lại</span>
                  </button>
                ` : `
                  <button type="button" class="btn-sub-camera btn-camera-new" onclick="triggerSubItemCapture(${item.id}, ${isSingleTask ? 'true' : 'false'}, '${escapeHtml(item.ItemTitle)}', '${sampleUrl}', '${escapeHtml(guideline)}', '')" title="${isSingleTask ? 'Mở camera chụp ảnh trực tiếp' : 'Mở cửa sổ chụp ảnh có ảnh mẫu SOP'}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                    <span>Chụp Ảnh</span>
                  </button>
                `}
              </div>

              <!-- DÒNG 4: Hàng cuối là Tên người thực hiện, phân công KTV, thời gian -->
              <div class="subitem-line-4" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); font-size: 0.74rem; color: var(--text-muted); flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 140px;">
                  <span style="font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0;">👷 Phân công:</span>
                  <select class="subitem-assignee-select" onchange="assignSubItemKTV(${item.id}, this.value, ${task.id})"
                    style="background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border-subtle); color: #E2E8F0; border-radius: 4px; padding: 2px 6px; font-size: 0.73rem; outline: none; max-width: 180px; text-overflow: ellipsis; cursor: pointer;"
                    title="Bấm để phân công nhân viên kỹ thuật thực hiện hạng mục này">
                    ${buildAssigneeOptionsForGroup(curGroupId, item.AssignedTo || item.CompletedBy || '', '-- Chưa gán KTV --')}
                  </select>
                </div>
                <div>
                  ${isDone && item.CompletedAt ? `
                    <span class="badge-comp-time" style="font-size: 0.74rem; padding: 2px 6px;">
                      ✓ ${formatDateTime(item.CompletedAt)}
                    </span>
                  ` : (item.UpdatedAt ? `
                    <span style="font-size: 0.72rem; color: var(--text-muted);">
                      ⏱️ ${formatDateTime(item.UpdatedAt)}
                    </span>
                  ` : '')}
                </div>
              </div>
            </div>
          `;
  }).join('')}
      </div>

      <!-- Inline add item -->
      <div class="desktop-add-subitem-box" style="display: flex; flex-direction: column; gap: 7px; background: rgba(15, 23, 42, 0.45); border: 1px dashed rgba(99, 102, 241, 0.4); border-radius: 8px; padding: 10px 10px 8px 10px; margin-top: 6px;">
        <div style="font-size: 0.75rem; font-weight: 700; color: #818CF8; display: flex; align-items: center; gap: 5px;">
          <span>➕</span> Thêm nhanh hạng mục con
        </div>
        <input type="text" id="desktopAddChecklistInput" class="form-input" style="width: 100%; height: 35px; font-size: 0.84rem; padding: 6px 10px; box-sizing: border-box;" placeholder="Nhập tên hạng mục con cần làm *..." onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('desktopAddChecklistDescInput')?.focus();}">
        <input type="text" id="desktopAddChecklistDescInput" class="form-input" style="width: 100%; height: 35px; font-size: 0.84rem; padding: 6px 10px; box-sizing: border-box;" placeholder="Mô tả / Hướng dẫn thực hiện (không bắt buộc)..." onkeydown="if(event.key==='Enter'){event.preventDefault();addDesktopChecklistItem(${task.id});}">
        <button type="button" class="btn-primary" style="height: 35px; width: 100%; font-size: 0.82rem; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; border-radius: 6px; margin-top: 2px;" onclick="addDesktopChecklistItem(${task.id})">
          <span>＋</span> Thêm hạng mục con
        </button>
      </div>
    </div>
  `;

  // Photos section
  let photosHtml = `
    <!-- KHỐI 5: 📸 THƯ VIỆN ẢNH CÔNG VIỆC TỔNG THỂ -->
    <div class="desktop-detail-section">
      <div class="detail-sec-header">
        <div class="detail-sec-title title-photos">
          <span>📸</span> ẢNH HIỆN TRƯỜNG &amp; XỬ LÝ (${images.length})
        </div>
        <div>
          <input type="file" id="desktopPhotoUploadInput" accept="image/*" style="display: none;" onchange="uploadDesktopPhoto(event, ${task.id})">
          <button type="button" class="btn-secondary" style="padding: 4px 12px; font-size: 0.76rem; font-weight: 700; border-radius: 5px;" onclick="document.getElementById('desktopPhotoUploadInput').click()">
            + Tải Ảnh
          </button>
        </div>
      </div>
      ${images.length > 0 ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); gap: 8px;">
          ${images.map(img => `
            <div style="position: relative; height: 80px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle); cursor: pointer; background: #000;" onclick="openTaskGeneralPhotoViewer(${img.id}, ${task.id})">
              <img src="${img.FileUrl}" style="width: 100%; height: 100%; object-fit: cover;">
              <span style="position: absolute; bottom: 2px; left: 2px; font-size: 0.62rem; font-weight: 700; background: rgba(0,0,0,0.75); color: #FFF; padding: 1px 4px; border-radius: 2px;">
                ${img.ImageType === 'BEFORE' ? 'TRƯỚC' : 'SAU'}
              </span>
              <button type="button" onclick="event.stopPropagation(); deleteGeneralPhoto(${img.id}, ${task.id})" title="Xóa ảnh này khỏi mục chung"
                style="position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; border-radius: 50%; background: rgba(239, 68, 68, 0.9); color: #FFF; border: none; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.6); z-index: 5; line-height: 1; transition: transform 0.15s ease;"
                onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                ✕
              </button>
            </div>
          `).join('')}
        </div>
      ` : `<div style="font-size: 0.78rem; color: var(--text-muted); font-style: italic; text-align: center; padding: 8px 0;">Chưa có ảnh hiện trường nào được tải lên.</div>`}
    </div>
  `;

  const groupOptions = buildGroupSelectOptions(curGroupId, '-- Chọn Nhóm Phụ Trách --');
  const assigneeOptions = buildAssigneeOptionsForGroup(curGroupId, task.AssignedTo || '', '-- Chọn KTV Phụ Trách --');

  container.innerHTML = `
    <!-- KHỐI THÔNG TIN ĐƠN (ĐƯA LÊN ĐẦU, BỎ THÔNG TIN TRÙNG LẶP) -->
    <div class="desktop-detail-section" style="margin-bottom: 8px;">
      <!-- Hàng 1: Tên hạng mục (TaskTitle) + Nút Lưu & Nút Xóa -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
        <div class="task-title-text" style="font-size: 1.05rem; font-weight: 800; line-height: 1.35; margin: 0; word-break: break-word; color: var(--text-primary); flex: 1; min-width: 0;">
          ${escapeHtml(task.TaskTitle || 'Chi tiết công việc')}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button type="button" class="btn-primary btn-save desktop-inspector-save-btn" onclick="saveDesktopTaskDetail(${task.id})" style="padding: 5px 12px; font-size: 0.80rem; font-weight: 700; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
            💾 Lưu
          </button>
        </div>
      </div>

      <!-- Hàng 2: Mã đơn, ngày giờ và nút xem chi tiết -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed var(--border-subtle);">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="task-code-badge" style="font-size: 0.62rem; font-weight: 800; padding: 2px 7px;">${escapeHtml(task.TaskCode)}</span>
          <span style="font-size: 0.74rem; color: var(--text-muted); font-family: var(--font-mono);">⏱️ ${formatDateTime(task.ReportedAt || task.CreatedAt)}</span>
        </div>
        <button type="button" class="btn-toggle-info" onclick="toggleDesktopGeneralInfo()" id="btnToggleGeneralInfo" title="Bấm để ẩn / hiện thông tin tiếp nhận chi tiết" style="padding: 2px 8px; font-size: 0.74rem;">
          <span>Chi Tiết</span>
          <span id="generalInfoArrow" style="font-size: 0.68rem;">▾</span>
        </button>
      </div>

      <!-- Lưới thông tin tiếp nhận chi tiết (MẶC ĐỊNH ẨN - Chứa thẻ Phân loại/Nội bộ, Máy, Bộ phận, Người báo, SĐT) -->
      <div class="reception-info-box" id="desktopGeneralInfoBox" style="display: none; margin-bottom: 8px;">
        <div style="min-width: 0;">
          <span class="reception-cell-label">🏷️ Phân Loại</span>
          <span class="reception-cell-val">
            <span class="badge-type-tag" style="display: inline-block;">
              ${escapeHtml(task.TaskType === 'CORRECTIVE' ? 'Đột xuất' : (task.TaskType === 'PREVENTIVE' ? 'Định kỳ' : (task.TaskType === 'INTERNAL' ? 'Nội bộ' : (task.TaskType || 'Nội bộ'))))}
            </span>
          </span>
        </div>
        <div style="min-width: 0;">
          <span class="reception-cell-label">⚙️ Máy / Dây Chuyền</span>
          <span class="reception-cell-val val-machine">${escapeHtml(task.MachineName || task.MachineID || 'Chưa gán máy')}</span>
        </div>
        <div style="min-width: 0;">
          <span class="reception-cell-label">🏢 Bộ Phận Tiếp Nhận</span>
          <span class="reception-cell-val">${escapeHtml(task.Department || 'KỸ THUẬT')}</span>
        </div>
        <div style="min-width: 0;">
          <span class="reception-cell-label">👤 Người Báo / Yêu Cầu</span>
          <span class="reception-cell-val">${escapeHtml(task.RequesterName || 'N/A')}</span>
        </div>
        <div style="min-width: 0;">
          <span class="reception-cell-label">📞 SĐT / Liên Hệ</span>
          <span class="reception-cell-val">${task.RequesterPhone ? `<a href="tel:${escapeHtml(task.RequesterPhone)}" style="color: #3B82F6; text-decoration: none; font-weight: 700;">${escapeHtml(task.RequesterPhone)}</a>` : '---'}</span>
        </div>
      </div>

      <!-- Mô tả hiện tượng sự cố (MẶC ĐỊNH HIỂN THỊ) -->
      ${task.Description ? `
        <div class="task-desc-box" style="margin-top: 4px; margin-bottom: 6px;">
          <span class="desc-box-label" style="font-weight: 700; font-size: 0.70rem; text-transform: uppercase; display: block; margin-bottom: 2px; color: var(--text-muted);">📝 Nội dung / Hiện tượng tiếp nhận:</span>
          <div style="word-break: break-word; font-size: 0.84rem; line-height: 1.4; color: var(--text-primary); font-weight: 500;">${escapeHtml(task.Description)}</div>
        </div>
      ` : ''}

      <!-- Ghi chú chu kỳ hạng mục nếu có (1 dòng duy nhất) -->
      ${task.RecurringTemplateID || task.CycleInfo ? `
        <div style="margin-top: 6px; padding: 5px 8px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 5px; font-size: 0.75rem; color: #818CF8; display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: nowrap; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            🔁 <strong>Việc định kỳ:</strong> ${escapeHtml(task.CycleInfo || 'Theo chu kỳ')} (Lần #${task.RecurringCount || 1})
          </span>
          ${task.NextDueDate ? `<span style="color: #FBBF24; font-weight: 600; flex-shrink: 0;">📅 Hạn: ${formatDateTime(task.NextDueDate)}</span>` : ''}
        </div>
      ` : ''}

      <!-- Hidden inputs để lưu giữ thông tin phục vụ cập nhật -->
      <input type="hidden" id="desktopDetailTaskTitle" value="${escapeHtml(task.TaskTitle || '')}">
      <input type="hidden" id="desktopDetailMachine" value="${escapeHtml(task.MachineID || '')}">
      <input type="hidden" id="desktopDetailDept" value="${escapeHtml(task.Department || '')}">
      <input type="hidden" id="desktopDetailRequester" value="${escapeHtml(task.RequesterName || '')}">
      <input type="hidden" id="desktopDetailRequesterPhone" value="${escapeHtml(task.RequesterPhone || '')}">
      <input type="hidden" id="desktopDetailDesc" value="${escapeHtml(task.Description || '')}">
    </div>

    <!-- KHỐI 2: ⚡ PHÂN CÔNG & TRẠNG THÁI XỬ LÝ (Sắp xếp gọn, bỏ mũi tên background) -->
    <div class="desktop-detail-section">
      <div class="detail-sec-header" style="margin-bottom: 8px;">
        <div class="detail-sec-title title-assign">
          <span>⚡</span> PHÂN CÔNG &amp; TRẠNG THÁI XỬ LÝ
        </div>
      </div>

      <!-- Hàng 1: Trạng thái & Mức độ ưu tiên -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <div class="form-group" style="margin: 0; min-width: 0;">
          <label class="form-label" style="font-size: 0.68rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; display: block;">Trạng Thái Xử Lý</label>
          <select id="desktopDetailStatusSelect" class="detail-form-select" data-prev-status="${task.Status || 'PENDING'}" onchange="handleDesktopStatusChange(this, ${task.id})">
            <option value="PENDING" ${task.Status === 'PENDING' ? 'selected' : ''}>⏳ Chờ Tiếp Nhận</option>
            <option value="IN_PROGRESS" ${task.Status === 'IN_PROGRESS' ? 'selected' : ''}>⚡ Đang Xử Lý</option>
            <option value="HOLD" ${task.Status === 'HOLD' ? 'selected' : ''}>⏸️ Tạm Hoãn</option>
            <option value="COMPLETED" ${task.Status === 'COMPLETED' ? 'selected' : ''}>✅ Đã Hoàn Tất</option>
            <option value="CANCELLED" ${task.Status === 'CANCELLED' ? 'selected' : ''}>🚫 Hủy</option>
          </select>
        </div>
        <div class="form-group" style="margin: 0; min-width: 0;">
          <label class="form-label" style="font-size: 0.68rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; display: block;">Mức Độ Ưu Tiên</label>
          <select id="desktopDetailPrioritySelect" class="detail-form-select">
            <option value="URGENT" ${task.Priority === 'URGENT' ? 'selected' : ''}>🔥 Khẩn Cấp (Urgent)</option>
            <option value="HIGH" ${task.Priority === 'HIGH' ? 'selected' : ''}>⚠️ Ưu Tiên Cao (High)</option>
            <option value="NORMAL" ${task.Priority === 'NORMAL' ? 'selected' : ''}>📋 Bình Thường (Normal)</option>
            <option value="LOW" ${task.Priority === 'LOW' ? 'selected' : ''}>☕ Thấp (Low)</option>
          </select>
        </div>
      </div>

      <!-- Hàng 2: Nhóm Phụ Trách & KTV Phụ Trách -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div class="form-group" style="margin: 0; min-width: 0;">
          <label class="form-label" style="font-size: 0.68rem; font-weight: 700; color: #10B981; margin-bottom: 3px; display: block;">👥 Nhóm Phụ Trách</label>
          <select id="desktopDetailGroup" class="detail-form-select" onchange="onDesktopDetailGroupChange()">
            ${groupOptions}
          </select>
        </div>
        <div class="form-group" style="margin: 0; min-width: 0;">
          <label class="form-label" style="font-size: 0.68rem; font-weight: 700; color: #10B981; margin-bottom: 3px; display: block;">👷 KTV Phụ Trách</label>
          <select id="desktopDetailAssignee" class="detail-form-select">
            ${assigneeOptions}
          </select>
        </div>
      </div>
    </div>

    <!-- KHỐI 3: CHECKLIST HẠNG MỤC KIỂM TRA -->
    ${checklistHtml}

    <!-- KHỐI 4: 📝 KẾT QUẢ XỬ LÝ & DỪNG MÁY (Đem xuống dưới checklist, Thời gian & nội dung cùng 1 hàng) -->
    <div class="desktop-detail-section">
      <div class="detail-sec-header" style="margin-bottom: 8px;">
        <div class="detail-sec-title title-solution">
          <span>📝</span> KẾT QUẢ XỬ LÝ &amp; DỪNG MÁY
        </div>
      </div>
      <div style="display: flex; gap: 10px; align-items: flex-start;">
        <div class="form-group" style="margin: 0; width: 130px; flex-shrink: 0;">
          <label class="form-label" style="font-size: 0.68rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; display: block; white-space: nowrap;">⏱️ Dừng máy (phút)</label>
          <input type="number" id="desktopDetailDowntime" class="form-input" style="height: 38px; width: 100%; font-weight: 700; font-size: 0.9rem;" value="${task.DowntimeMinutes || 0}" min="0">
        </div>
        <div class="form-group" style="margin: 0; flex: 1; min-width: 0;">
          <label class="form-label" style="font-size: 0.68rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; display: block;">🔧 Nội Dung Thực Hiện</label>
          <textarea id="desktopDetailSolution" class="form-textarea" rows="1" placeholder="Ghi nhận giải pháp, nguyên nhân hoặc vật tư đã thay thế..." style="height: 38px; min-height: 38px; resize: vertical; font-size: 0.84rem; border-radius: 6px; width: 100%; padding: 7px 10px; line-height: 1.3;">${escapeHtml(task.Solution || '')}</textarea>
        </div>
      </div>
    </div>

    ${photosHtml}

    <button type="button" class="btn-primary" style="width: 100%; padding: 10px; font-weight: 800; font-size: 0.88rem; border-radius: 6px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4); margin-top: 14px;" onclick="saveDesktopTaskDetail(${task.id})">
      💾 Lưu Cập Nhật Công Việc
    </button>
  `;

  // Bind smart input helpers
  const inputMac = document.getElementById('desktopDetailMachine');
  if (inputMac && inputMac.type !== 'hidden') bindSmartMachineBehavior(inputMac);
  const inputDept = document.getElementById('desktopDetailDept');
  if (inputDept && inputDept.type !== 'hidden') bindSmartDeptBehavior(inputDept);
}

// Quick Save Desktop Detail
async function saveDesktopTaskDetail(targetTaskId = null) {
  const taskId = targetTaskId || selectedTaskId || currentEditingTask?.id;
  if (!taskId) {
    showToast('Chưa chọn công việc để lưu', 'warning');
    return;
  }

  const title = document.getElementById('desktopDetailTaskTitle')?.value?.trim();
  if (!title) {
    showToast('Tiêu đề công việc không được để trống', 'warning');
    return;
  }

  const priority = document.getElementById('desktopDetailPrioritySelect')?.value;
  const status = document.getElementById('desktopDetailStatusSelect')?.value;
  const machine = document.getElementById('desktopDetailMachine')?.value?.trim() || '';
  const dept = document.getElementById('desktopDetailDept')?.value?.trim() || '';
  const requester = document.getElementById('desktopDetailRequester')?.value?.trim() || '';
  const phone = document.getElementById('desktopDetailRequesterPhone')?.value?.trim() || '';
  const desc = document.getElementById('desktopDetailDesc')?.value?.trim() || '';
  const downtime = Number(document.getElementById('desktopDetailDowntime')?.value || 0);
  const solution = document.getElementById('desktopDetailSolution')?.value?.trim() || '';

  if (status === 'CANCELLED' && !solution) {
    showToast('Vui lòng nhập nội dung thực hiện cho công việc hủy', 'warning');
    openCancelTaskModal(taskId, currentEditingTask?.Status || 'IN_PROGRESS', 'desktop');
    return;
  }

  // Phân công nhóm
  const grpSelect = document.getElementById('desktopDetailGroup');
  let assignedGroupIds = [];
  let assignedGroupNames = '';
  if (grpSelect && grpSelect.value) {
    assignedGroupIds = [Number(grpSelect.value)];
    const selectedGroup = allGroups.find(g => String(g.id) === String(grpSelect.value));
    if (selectedGroup) assignedGroupNames = selectedGroup.GroupName;
  }

  // Phân công người thực hiện
  const assigneeSelect = document.getElementById('desktopDetailAssignee');
  let assignedEmpIds = [];
  let assignedTo = assigneeSelect ? assigneeSelect.value.trim() : '';
  if (assigneeSelect && assigneeSelect.selectedIndex >= 0) {
    const opt = assigneeSelect.options[assigneeSelect.selectedIndex];
    if (opt && opt.dataset && opt.dataset.empid) {
      assignedEmpIds = [opt.dataset.empid];
    }
  }

  const payload = {
    TaskTitle: title,
    Priority: priority,
    Status: status,
    MachineID: machine,
    Department: dept,
    RequesterName: requester,
    RequesterPhone: phone,
    Description: desc,
    AssignedGroupIDs: assignedGroupIds,
    AssignedGroupNames: assignedGroupNames,
    AssignedTo: assignedTo,
    AssignedEmpIDs: assignedEmpIds,
    DowntimeMinutes: downtime,
    Solution: solution
  };

  try {
    const res = await fetch(`/api/internal-tasks/${taskId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi cập nhật công việc');

    showToast('Đã lưu cập nhật công việc thành công!', 'success');
    await loadTasks();
    selectInternalTask(taskId, false);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addDesktopChecklistItem(taskId) {
  const input = document.getElementById('desktopAddChecklistInput');
  const descInput = document.getElementById('desktopAddChecklistDescInput');
  const title = (input?.value || '').trim();
  const desc = (descInput?.value || '').trim();
  if (!title) {
    showToast('Vui lòng nhập tên hạng mục', 'warning');
    input?.focus();
    return;
  }
  try {
    const payload = {
      ItemTitle: title,
      StandardGuideline: desc,
      Department: 'Cơ điện'
    };
    if (currentUser) {
      if (currentUser.full_name) payload.AssignedTo = currentUser.full_name;
      if (currentUser.emp_id) payload.AssignedEmpID = currentUser.emp_id;
    }
    const res = await fetch(`/api/internal-tasks/${taskId}/items`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Không thể thêm hạng mục');
    showToast('Đã thêm hạng mục kiểm tra', 'success');
    if (input) input.value = '';
    if (descInput) descInput.value = '';
    await loadTasks();
    renderDesktopTaskDetail(taskId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteDesktopChecklistItem(taskId, itemId) {
  if (!confirm('Bạn có chắc muốn xóa hạng mục này?')) return;
  try {
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Không thể xóa hạng mục');
    showToast('Đã xóa hạng mục', 'success');
    await loadTasks();
    renderDesktopTaskDetail(taskId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Toggle General Info Section in Desktop Inspector
function toggleDesktopGeneralInfo() {
  const box = document.getElementById('desktopGeneralInfoBox');
  const arrow = document.getElementById('generalInfoArrow');
  if (!box) return;
  if (box.style.display === 'none' || !box.style.display) {
    box.style.display = 'grid';
    if (arrow) arrow.textContent = '▴';
  } else {
    box.style.display = 'none';
    if (arrow) arrow.textContent = '▾';
  }
}

// =========================================================================
// GHI CHÚ & BÁO SỰ CỐ HẠNG MỤC CON (SUB-ITEMS)
// =========================================================================
function openSubItemNoteModal(itemId) {
  let item = null;
  if (currentEditingTask && currentEditingTask.items) {
    item = currentEditingTask.items.find(i => i.id == itemId);
  }
  if (!item && allTasks) {
    for (const t of allTasks) {
      if (t.items) {
        item = t.items.find(i => i.id == itemId);
        if (item) {
          currentEditingTask = t;
          break;
        }
      }
    }
  }
  if (!item) {
    showToast('Không tìm thấy thông tin hạng mục', 'warning');
    return;
  }

  const modal = document.getElementById('subItemNoteModal');
  const titleEl = document.getElementById('subItemModalItemTitle');
  const idEl = document.getElementById('subItemModalItemId');
  const issueEl = document.getElementById('subItemModalHasIssue');
  const noteEl = document.getElementById('subItemModalNote');
  const guidelineWrap = document.getElementById('subItemModalGuidelineWrap');
  const guidelineText = document.getElementById('subItemModalGuidelineText');

  if (titleEl) titleEl.textContent = item.ItemTitle || 'Hạng mục kiểm tra';
  if (idEl) idEl.value = itemId;
  if (issueEl) issueEl.checked = (item.HasIssue == 1 || item.HasIssue === true);

  const guideStr = (item.StandardGuideline || '').trim();
  if (guidelineWrap && guidelineText) {
    if (guideStr) {
      guidelineWrap.style.display = 'block';
      guidelineText.textContent = guideStr;
    } else {
      guidelineWrap.style.display = 'none';
      guidelineText.textContent = '';
    }
  }

  let noteVal = (item.Note || item.Notes || '').trim();
  if (guideStr && noteVal === guideStr) {
    noteVal = '';
  }
  if (noteEl) noteEl.value = noteVal;

  if (modal) {
    showModal(modal);
  }
}

function closeSubItemNoteModal() {
  const modal = document.getElementById('subItemNoteModal');
  if (modal) hideModal(modal);
}

function appendSubItemQuickNote(text) {
  const noteEl = document.getElementById('subItemModalNote');
  if (!noteEl) return;
  const curVal = noteEl.value.trim();
  if (curVal.length > 0) {
    noteEl.value = curVal + ' - ' + text;
  } else {
    noteEl.value = text;
  }
  noteEl.focus();
}

async function saveSubItemNoteModal() {
  const idEl = document.getElementById('subItemModalItemId');
  const issueEl = document.getElementById('subItemModalHasIssue');
  const noteEl = document.getElementById('subItemModalNote');
  if (!idEl || !idEl.value) return;

  const itemId = parseInt(idEl.value, 10);
  const hasIssue = issueEl && issueEl.checked ? 1 : 0;
  const note = noteEl ? noteEl.value.trim() : '';

  try {
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        HasIssue: hasIssue,
        Note: note
      })
    });

    if (res.ok) {
      if (currentEditingTask && currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.HasIssue = hasIssue;
          it.Note = note;
          it.Notes = note;
        }
      }
      showToast(hasIssue ? '⚠️ Đã lưu ghi chú & đánh dấu có sự cố' : '✅ Đã lưu ghi chú hạng mục', 'success');
      closeSubItemNoteModal();
      if (currentEditingTask && currentEditingTask.id) {
        await renderDesktopTaskDetail(currentEditingTask.id);
        const containerChecklist = document.getElementById('modalDetailItemsContainer');
        if (containerChecklist && typeof renderDetailChecklist === 'function' && currentEditingTask.items) {
          renderDetailChecklist(currentEditingTask.items);
        }
      }
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('Lỗi cập nhật: ' + (err.detail || 'Không thành công'), 'error');
    }
  } catch (e) {
    console.error('Lỗi lưu ghi chú hạng mục:', e);
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

async function toggleSubItemIssueQuick(itemId, newHasIssue) {
  try {
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        HasIssue: newHasIssue ? 1 : 0
      })
    });

    if (res.ok) {
      if (currentEditingTask && currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.HasIssue = newHasIssue ? 1 : 0;
        }
      }
      showToast(newHasIssue ? '⚠️ Đã đánh dấu hạng mục CÓ SỰ CỐ' : '✅ Đã bỏ đánh dấu sự cố', newHasIssue ? 'warning' : 'success');
      if (currentEditingTask && currentEditingTask.id) {
        renderDesktopTaskDetail(currentEditingTask.id);
        const containerChecklist = document.getElementById('modalDetailItemsContainer');
        if (containerChecklist && typeof renderDetailChecklist === 'function' && currentEditingTask.items) {
          renderDetailChecklist(currentEditingTask.items);
        }
      }
    } else {
      showToast('Không thể cập nhật trạng thái sự cố', 'error');
    }
  } catch (e) {
    console.error('Lỗi toggle sự cố:', e);
    showToast('Lỗi kết nối máy chủ', 'error');
  }
}

async function saveSubItemDirectNote(itemId, noteValue) {
  try {
    const trimmed = (noteValue || '').trim();
    if (currentEditingTask && currentEditingTask.items) {
      const it = currentEditingTask.items.find(i => i.id == itemId);
      if (it && (it.Note || it.Notes || '').trim() === trimmed) {
        return; // Không đổi, không cần gọi API
      }
    }

    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        Note: trimmed
      })
    });

    if (res.ok) {
      if (currentEditingTask && currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.Note = trimmed;
          it.Notes = trimmed;
        }
      }
      showToast('Đã lưu ghi chú kiểm tra', 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('Lỗi lưu ghi chú: ' + (err.detail || 'Không thành công'), 'error');
    }
  } catch (e) {
    console.error('Lỗi saveSubItemDirectNote:', e);
    showToast('Lỗi kết nối khi lưu ghi chú', 'error');
  }
}

// Nén giảm dung lượng ảnh phía Client (Canvas Resizing & JPEG Compression)
async function compressImageFile(file, maxWidth = 1600, maxHeight = 1600, quality = 0.82) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file;
  }
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            if (width / height > maxWidth / maxHeight) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(file);
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const newName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
            const compressedFile = new File([blob], newName, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          }, 'image/jpeg', quality);
        } catch (err) {
          console.warn('Lỗi nén ảnh, sử dụng ảnh gốc:', err);
          resolve(file);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadDesktopPhoto(event, taskId) {
  let file = event.target.files?.[0];
  if (!file || !taskId) return;

  try {
    file = await compressImageFile(file);
  } catch (e) {
    console.warn('Lỗi nén ảnh desktop:', e);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('image_type', 'BEFORE');
  formData.append('caption', 'Ảnh hiện trường');

  showToast('Đang nén & tải ảnh lên...', 'info');
  try {
    const res = await fetch(`/api/internal-tasks/${taskId}/photos`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể tải ảnh lên');
    showToast('Tải ảnh thành công!', 'success');
    await loadTasks();
    renderDesktopTaskDetail(taskId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteGeneralPhoto(imageId, taskId) {
  if (!imageId) return;
  if (!confirm('Bạn có chắc chắn muốn xóa hình ảnh này khỏi mục ảnh chung không?')) return;

  showToast('Đang xóa ảnh...', 'info');
  try {
    const res = await fetch(`/api/internal-tasks/photos/${imageId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể xóa ảnh');

    showToast('Đã xóa ảnh thành công!', 'success');

    if (currentEditingTask) {
      if (currentEditingTask.images) {
        currentEditingTask.images = currentEditingTask.images.filter(img => img.id != imageId);
      }
      if (taskId) {
        await renderDesktopTaskDetail(taskId);
      }
      if (typeof renderTaskPhotos === 'function' && currentEditingTask.images) {
        renderTaskPhotos(currentEditingTask.images);
      }
    }
    await loadTasks();
  } catch (err) {
    console.error('Lỗi xóa ảnh:', err);
    showToast(err.message || 'Lỗi xóa ảnh', 'error');
  }
}

async function deleteInternalTask(taskId) {
  showToast('Hệ thống không cho phép xóa công việc. Vui lòng chuyển trạng thái sang "Hủy" nếu không thực hiện.', 'warning');
}

// =========================================================================
// CANCEL TASK MODAL WORKFLOW (NHẬP NỘI DUNG THỰC HIỆN KHI HỦY)
// =========================================================================
function openCancelTaskModal(taskId, prevStatus, source = 'desktop') {
  const modal = document.getElementById('taskCancelModal');
  if (!modal) return;

  const task = allTasks.find(t => t.id == taskId) || currentEditingTask;
  const targetTaskId = taskId || task?.id;
  if (!targetTaskId) return;

  const targetIdInput = document.getElementById('cancelTargetTaskId');
  const prevStatusInput = document.getElementById('cancelPreviousStatus');
  const sourceInput = document.getElementById('cancelTriggerSource');
  if (targetIdInput) targetIdInput.value = targetTaskId;
  if (prevStatusInput) prevStatusInput.value = prevStatus || task?.Status || 'PENDING';
  if (sourceInput) sourceInput.value = source;

  const titleEl = document.getElementById('cancelTaskCodeTitle');
  if (titleEl && task) {
    titleEl.textContent = `Hủy công việc [${task.TaskCode || ''}]: ${task.TaskTitle || ''}`;
  }

  const solutionInput = document.getElementById('cancelTaskSolutionInput');
  const curSol = document.getElementById('desktopDetailSolution')?.value?.trim() || task?.Solution || '';
  if (solutionInput) {
    solutionInput.value = curSol;
  }

  showModal(modal);
  setTimeout(() => solutionInput?.focus(), 150);
}

function closeCancelTaskModal() {
  const modal = document.getElementById('taskCancelModal');
  const source = document.getElementById('cancelTriggerSource')?.value;
  const prevStatus = document.getElementById('cancelPreviousStatus')?.value || 'PENDING';

  if (source === 'desktop') {
    const sel = document.getElementById('desktopDetailStatusSelect');
    if (sel) {
      sel.value = prevStatus;
      sel.dataset.prevStatus = prevStatus;
      updateStatusDropdownStyle(sel, prevStatus);
    }
  } else if (source === 'modal') {
    const sel = document.getElementById('modalDetailStatusSelect');
    if (sel) {
      sel.value = prevStatus;
      updateStatusDropdownStyle(sel, prevStatus);
    }
  }

  if (modal) {
    hideModal(modal);
    modal.style.display = 'none';
  }
}

async function confirmCancelTask() {
  const taskId = document.getElementById('cancelTargetTaskId')?.value;
  const solutionInput = document.getElementById('cancelTaskSolutionInput');
  const solutionText = (solutionInput?.value || '').trim();

  if (!solutionText) {
    alert('Vui lòng nhập nội dung thực hiện / lý do hủy công việc!');
    solutionInput?.focus();
    return;
  }

  try {
    const payload = {
      Status: 'CANCELLED',
      Solution: solutionText
    };
    const res = await fetch(`/api/internal-tasks/${taskId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể hủy công việc');

    // Update local task cache
    const t = allTasks.find(item => item.id == taskId);
    if (t) {
      t.Status = 'CANCELLED';
      t.Solution = solutionText;
    }
    if (currentEditingTask && currentEditingTask.id == taskId) {
      currentEditingTask.Status = 'CANCELLED';
      currentEditingTask.Solution = solutionText;
    }

    const desktopSol = document.getElementById('desktopDetailSolution');
    if (desktopSol) desktopSol.value = solutionText;

    const desktopStatus = document.getElementById('desktopDetailStatusSelect');
    if (desktopStatus) {
      desktopStatus.value = 'CANCELLED';
      desktopStatus.dataset.prevStatus = 'CANCELLED';
      updateStatusDropdownStyle(desktopStatus, 'CANCELLED');
    }

    const modal = document.getElementById('taskCancelModal');
    if (modal) {
      hideModal(modal);
      modal.style.display = 'none';
    }

    showToast('Đã chuyển trạng thái công việc sang Hủy', 'success');
    await loadTasks();
    if (selectedTaskId == taskId) {
      renderDesktopTaskDetail(taskId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleDesktopStatusChange(selectEl, taskId) {
  const newStatus = selectEl.value;
  const prevStatus = selectEl.dataset.prevStatus || 'PENDING';
  if (newStatus === 'CANCELLED') {
    openCancelTaskModal(taskId, prevStatus, 'desktop');
  } else {
    selectEl.dataset.prevStatus = newStatus;
    updateStatusDropdownStyle(selectEl, newStatus);
  }
}

function handleModalStatusChange(selectEl) {
  const newStatus = selectEl.value;
  const taskId = currentEditingTask?.id || selectedTaskId;
  const prevStatus = currentEditingTask?.Status || selectEl.dataset.prevStatus || 'PENDING';
  if (newStatus === 'CANCELLED') {
    openCancelTaskModal(taskId, prevStatus, 'modal');
  } else {
    selectEl.dataset.prevStatus = newStatus;
    updateStatusDropdownStyle(selectEl, newStatus);
    quickUpdateStatus(newStatus);
  }
}

// Quick Priority Picker Logic
function openPriorityPicker(event, taskId) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  quickPickerTargetTaskId = taskId;
  const popover = document.getElementById('priorityQuickPickerPopover');
  if (!popover) return;

  const targetEl = event ? event.currentTarget : null;
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    popover.style.display = 'flex';
    popover.style.top = `${rect.bottom + window.scrollY + 4}px`;
    const leftPos = Math.max(8, Math.min(window.innerWidth - 180, rect.left + window.scrollX - 20));
    popover.style.left = `${leftPos}px`;
  } else {
    popover.style.display = 'flex';
    popover.style.top = '50%';
    popover.style.left = '50%';
    popover.style.transform = 'translate(-50%, -50%)';
  }
}

async function selectPriorityQuick(priority, targetTaskId = null) {
  const popover = document.getElementById('priorityQuickPickerPopover');
  if (popover) popover.style.display = 'none';

  const taskId = targetTaskId || quickPickerTargetTaskId;
  if (!taskId) return;

  try {
    const res = await fetch(`/api/internal-tasks/${taskId}/priority`, {
      method: 'PATCH',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ Priority: priority })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể đổi mức độ ưu tiên');

    showToast(data.message || 'Đã cập nhật mức độ ưu tiên!', 'success');

    // Update in memory
    const t = allTasks.find(x => x.id === taskId);
    if (t) t.Priority = priority;
    if (currentEditingTask && currentEditingTask.id === taskId) {
      currentEditingTask.Priority = priority;
      const modalPrio = document.getElementById('modalDetailPriorityBadge');
      if (modalPrio) {
        const pInfo = priorityMeta[priority] || { text: priority, icon: '📋', class: 'prio-normal' };
        modalPrio.innerHTML = `
          <span class="priority-pill-interactive ${pInfo.class}" onclick="openPriorityPicker(event, ${taskId})" title="Bấm để đổi mức độ ưu tiên">
            ${pInfo.icon} ${pInfo.text} <span class="prio-caret">▾</span>
          </span>
        `;
      }
    }

    applyFilters();
    if (selectedTaskId === taskId && !isMobileScreen()) {
      renderDesktopTaskDetail(selectedTaskId);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function setupPriorityPickerEvents() {
  document.addEventListener('click', (e) => {
    const popover = document.getElementById('priorityQuickPickerPopover');
    if (popover && popover.style.display !== 'none') {
      if (!popover.contains(e.target) && !e.target.closest('.priority-pill-interactive')) {
        popover.style.display = 'none';
      }
    }
  });
}

// Toggle View Mode: Cards Master-Detail vs Excel Table
function toggleTaskViewMode() {
  const grid = document.getElementById('tasksWorkspaceGrid');
  const table = document.getElementById('taskExcelTableWrapper');
  const txt = document.getElementById('txtToggleViewMode');
  if (!grid || !table) return;

  if (table.style.display === 'none' || !table.style.display) {
    grid.style.display = 'none';
    table.style.display = 'block';
    if (txt) txt.textContent = 'Xem Thẻ';
    renderTaskExcelTable();
  } else {
    table.style.display = 'none';
    grid.style.display = '';
    if (txt) txt.textContent = 'Xem Bảng';
    renderTaskCards();
  }
}

// =========================================================================
// RENDER EXCEL DATA GRID TABLE VIEW
// =========================================================================
function switchActiveTaskViewMode(mode) {
  activeTaskViewMode = mode;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('internal_tasks_view_mode', mode);
    }
  } catch (e) {
    console.warn('localStorage error:', e);
  }

  const grid = document.getElementById('tasksWorkspaceGrid');
  const table = document.getElementById('taskExcelTableWrapper');
  const txt = document.getElementById('txtToggleViewMode');

  if (mode === 'excel') {
    if (grid) grid.style.display = 'none';
    if (table) table.style.display = 'block';
    if (txt) txt.textContent = 'Xem Thẻ';
    renderTaskExcelTable();
  } else {
    if (table) table.style.display = 'none';
    if (grid) grid.style.display = '';
    if (txt) txt.textContent = 'Xem Bảng';
    renderTaskCards();
  }
}

function renderTaskExcelTable() {
  const tbody = document.getElementById('excelTaskTableBody');
  const counter = document.getElementById('excelTaskCounter');
  if (!tbody) return;

  if (counter) {
    counter.innerHTML = `<span class="counter-badge"><span class="counter-full">Đang hiển thị ${filteredTasks.length} / ${allTasks.length} công việc</span><span class="counter-short">${filteredTasks.length}/${allTasks.length} việc</span></span>`;
  }
  const badgeActive = document.getElementById('badgeActiveTasksCount');
  if (badgeActive) {
    badgeActive.textContent = filteredTasks.length === allTasks.length ? `${allTasks.length}` : `${filteredTasks.length} / ${allTasks.length}`;
  }

  const query = (document.getElementById('taskSearchInput')?.value || '').trim().toLowerCase();

  if (filteredTasks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
          <div style="font-size: 28px; margin-bottom: 8px;">📋</div>
          <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Không tìm thấy công việc nào phù hợp</div>
          <div style="font-size: 0.8rem;">Hãy thử thay đổi từ khóa tìm kiếm hoặc các tiêu chí lọc.</div>
        </td>
      </tr>
    `;
    return;
  }

  const typeLabels = {
    BREAKDOWN: { text: 'Sự Cố', class: 'badge-type-breakdown' },
    DEPT_REQUEST: { text: 'Yêu Cầu', class: 'badge-type-dept' },
    IMPROVEMENT: { text: 'Cải Tiến', class: 'badge-type-improvement' },
    INTERNAL: { text: 'Nội Bộ', class: 'badge-type-internal' }
  };

  const priorityLabels = {
    URGENT: { text: '🔥 Khẩn', class: 'badge-prio-urgent' },
    HIGH: { text: '⚠️ Cao', class: 'badge-prio-high' },
    NORMAL: { text: '📋 Thường', class: 'badge-prio-normal' },
    LOW: { text: '☕ Thấp', class: 'badge-prio-normal' }
  };

  const statusLabels = {
    PENDING: { text: 'Chờ Nhận', class: 'badge-status-pending' },
    IN_PROGRESS: { text: 'Đang Xử Lý', class: 'badge-status-inprogress' },
    HOLD: { text: 'Tạm Hoãn', class: 'badge-status-hold' },
    COMPLETED: { text: 'Hoàn Tất', class: 'badge-status-completed' },
    CANCELLED: { text: 'Hủy', class: 'badge-status-cancelled' }
  };

  tbody.innerHTML = filteredTasks.map((task, idx) => {
    const typeInfo = typeLabels[task.TaskType] || { text: task.TaskType, class: 'badge-type-internal' };
    const prioInfo = priorityLabels[task.Priority] || { text: task.Priority, class: 'badge-prio-normal' };
    const statusInfo = statusLabels[task.Status] || { text: task.Status, class: 'badge-status-pending' };
    const isUrgent = task.Priority === 'URGENT' || task.TaskType === 'BREAKDOWN';
    const isCompleted = task.Status === 'COMPLETED';

    // Checklist mini progress
    let checklistMini = '<span style="color: var(--text-muted);">-</span>';
    if (task.items_count && task.items_count > 0) {
      checklistMini = `
        <div style="min-width: 75px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <span style="font-weight: 700; color: ${task.progress_percent === 100 ? '#10B981' : '#A5B4FC'};">
              ${task.completed_items_count || 0}/${task.items_count} (${task.progress_percent || 0}%)
            </span>
          </div>
          <div style="width: 100%; height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; overflow: hidden;">
            <div style="width: ${task.progress_percent || 0}%; height: 100%; background: ${task.progress_percent === 100 ? '#10B981' : 'linear-gradient(90deg, #6366F1, #10B981)'};"></div>
          </div>
        </div>
      `;
    }

    // Photos badge
    const images = task.images || [];
    let photoBadge = '<span style="color: var(--text-muted);">-</span>';
    if (images.length > 0) {
      photoBadge = `
        <button type="button" class="btn-proof-history has-proof" style="padding: 2px 7px; font-size: 11px; margin: 0 auto; display: flex;" onclick="event.stopPropagation(); openTaskGeneralPhotoViewer(${images[0].id}, ${task.id})">
          📸 ${images.length}
        </button>
      `;
    }

    // Downtime display
    const downtimeText = (task.DowntimeMinutes && task.DowntimeMinutes > 0) ?
      `<span style="color: #EF4444; font-weight: 700;">${task.DowntimeMinutes}'</span>` :
      `<span style="color: var(--text-muted);">-</span>`;

    return `
      <tr class="${isUrgent ? 'row-urgent' : ''} ${isCompleted ? 'row-completed' : ''}" onclick="selectTaskFromTable(${task.id})" style="cursor: pointer;" title="Bấm vào hàng để xem chi tiết công việc [${escapeHtml(task.TaskCode)}]">
        <td class="col-stt" style="text-align: center; color: var(--text-muted); font-weight: 600; font-size: 11px;">${idx + 1}</td>
        <td class="col-task-code">
          <span class="excel-code-link">${highlightText(task.TaskCode || '', query).replace(/IWO-/g, 'IWO-<wbr>')}</span>
        </td>
        <td class="col-task-title">
          <div class="task-title-text" style="font-weight: 700; color: #F8FAFC; line-height: 1.35;">
            ${highlightText(task.TaskTitle || '', query)}
          </div>
          ${task.Description ? `<div class="task-desc-subtext" style="font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(task.Description)}">${highlightText(task.Description, query)}</div>` : ''}
        </td>
        <td class="col-task-machine">
          <span style="font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #38BDF8;">
            ${highlightText(task.MachineName || task.MachineID || '-', query)}
          </span>
        </td>
        <td class="col-task-dept">
          <span style="color: var(--text-secondary); font-size: 11.5px;">${highlightText(task.Department || '-', query)}</span>
        </td>
        <td class="col-task-priority" style="text-align: center;">
          <span class="badge ${prioInfo.class}">${prioInfo.text}</span>
        </td>
        <td class="col-task-type" style="text-align: center;">
          <span class="badge ${typeInfo.class}">${typeInfo.text}</span>
        </td>
        <td class="col-task-status" style="text-align: center;">
          <span class="badge ${statusInfo.class}">${statusInfo.text}</span>
        </td>
        <td class="col-task-progress">${checklistMini}</td>
        <td class="col-task-assigned">
          ${task.AssignedTo ? `<span style="color: #93C5FD; font-weight: 600; font-size: 11.5px;">👤 ${highlightText(task.AssignedTo, query)}</span>` : '<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Chưa phân công</span>'}
        </td>
        <td class="col-task-requester">
          <span style="color: var(--text-secondary); font-size: 11.5px;">${highlightText(task.RequesterName || '-', query)}</span>
        </td>
        <td class="col-task-time">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);">
            ${task.ReportedAt ? formatDateTime(task.ReportedAt) : '-'}
          </span>
        </td>
        <td class="col-task-downtime" style="text-align: center;">${downtimeText}</td>
        <td class="col-task-photos" style="text-align: center;">${photoBadge}</td>
      </tr>
    `;
  }).join('');
}

function selectTaskFromTable(taskId) {
  if (activeTaskViewMode === 'excel' || activeTaskViewMode === 'table') {
    switchActiveTaskViewMode('cards');
  }
  selectInternalTask(taskId, true);
}

function sortExcelTasks(column) {
  if (taskSortColumn === column) {
    taskSortDirection = taskSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    taskSortColumn = column;
    taskSortDirection = 'asc';
  }

  // Update header sort indicators
  const sortIcons = {
    TaskCode: 'sortIcon_TaskCode',
    TaskType: 'sortIcon_TaskType',
    TaskTitle: 'sortIcon_TaskTitle',
    MachineID: 'sortIcon_MachineID',
    Department: 'sortIcon_Department',
    Priority: 'sortIcon_Priority',
    Status: 'sortIcon_Status',
    progress_percent: 'sortIcon_progress_percent',
    AssignedTo: 'sortIcon_AssignedTo',
    RequesterName: 'sortIcon_RequesterName',
    ReportedAt: 'sortIcon_ReportedAt',
    DowntimeMinutes: 'sortIcon_DowntimeMinutes'
  };

  Object.values(sortIcons).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '↕';
  });

  const activeIcon = document.getElementById(sortIcons[column]);
  if (activeIcon) {
    activeIcon.textContent = taskSortDirection === 'asc' ? '▲' : '▼';
  }

  document.querySelectorAll('.excel-grid-table th.sortable-th').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
  });
  const activeTh = document.querySelector(`.excel-grid-table th[onclick*="'${column}'"]`);
  if (activeTh) {
    activeTh.classList.add(taskSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
  }

  // Sort filteredTasks
  filteredTasks.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (column === 'progress_percent' || column === 'DowntimeMinutes') {
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
    } else if (column === 'Priority') {
      const prioOrder = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };
      valA = prioOrder[valA] || 0;
      valB = prioOrder[valB] || 0;
    } else if (column === 'Status') {
      const statusOrder = { PENDING: 0, IN_PROGRESS: 1, HOLD: 2, COMPLETED: 3 };
      valA = statusOrder[valA] || 0;
      valB = statusOrder[valB] || 0;
    } else if (typeof valA === 'string' || typeof valB === 'string') {
      valA = (valA || '').toLowerCase();
      valB = (valB || '').toLowerCase();
    }

    if (valA < valB) return taskSortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return taskSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  renderTaskExcelTable();
}

function exportTasksToExcel() {
  if (!filteredTasks || filteredTasks.length === 0) {
    showToast('Không có dữ liệu công việc để xuất file!', 'warning');
    return;
  }

  const typeMap = {
    BREAKDOWN: 'Sự Cố Máy',
    DEPT_REQUEST: 'Yêu Cầu P.Ban',
    IMPROVEMENT: 'Cải Tiến Kaizen',
    INTERNAL: 'Nội Bộ Kỹ Thuật'
  };

  const prioMap = {
    URGENT: 'Khẩn Cấp',
    HIGH: 'Ưu Tiên Cao',
    NORMAL: 'Bình Thường',
    LOW: 'Thấp'
  };

  const statusMap = {
    PENDING: 'Chờ Tiếp Nhận',
    IN_PROGRESS: 'Đang Xử Lý',
    HOLD: 'Tạm Hoãn',
    COMPLETED: 'Đã Nghiệm Thu'
  };

  const headers = [
    'STT',
    'Mã Công Việc',
    'Phân Loại',
    'Tiêu Đề Công Việc',
    'Máy / Dây Chuyền',
    'Phòng Ban',
    'Mức Độ Ưu Tiên',
    'Trạng Thái',
    'Tiến Độ (%)',
    'Việc Con Hoàn Thành',
    'Tổng Việc Con',
    'KTV Phụ Trách',
    'Người Yêu Cầu',
    'Thời Điểm Báo',
    'Hạn Xử Lý Lần Tới',
    'Dừng Máy (Phút)',
    'Giải Pháp Xử Lý',
    'Mô Tả Chi Tiết'
  ];

  const rows = filteredTasks.map((t, idx) => [
    idx + 1,
    t.TaskCode || '',
    typeMap[t.TaskType] || t.TaskType || '',
    t.TaskTitle || '',
    t.MachineID || '',
    t.Department || '',
    prioMap[t.Priority] || t.Priority || '',
    statusMap[t.Status] || t.Status || '',
    t.progress_percent || 0,
    t.completed_items_count || 0,
    t.items_count || 0,
    t.AssignedTo || '',
    t.RequesterName || '',
    t.ReportedAt ? formatDateTime(t.ReportedAt) : '',
    t.NextDueDate ? formatDateTime(t.NextDueDate) : '',
    t.DowntimeMinutes || 0,
    t.Solution || '',
    t.Description || ''
  ]);

  // Format as CSV with UTF-8 BOM
  const csvRows = [];
  csvRows.push(headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','));

  rows.forEach(row => {
    csvRows.push(row.map(col => `"${String(col ?? '').replace(/"/g, '""')}"`).join(','));
  });

  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  a.href = url;
  a.download = `Cong_Viec_Noi_Bo_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Đã xuất ${filteredTasks.length} công việc ra tệp Excel (.csv) thành công!`, 'success');
}

// =========================================================================
// CREATE TASK WORKFLOW (Có tích hợp tùy chọn Lặp Lại Định Kỳ)
// =========================================================================
async function openCreateTaskModal() {
  const modal = document.getElementById('createTaskModal');
  if (!modal) return;

  if (allEmployees.length === 0) {
    await loadEmployees();
  }

  // Đảm bảo thông tin user đăng nhập đã được tải
  if (!currentUser) {
    await checkAuth();
  }
  const loggedUser = currentUser || (() => {
    try {
      const s = localStorage.getItem('bopp_user') || sessionStorage.getItem('bopp_user');
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  })();

  const userFullName = loggedUser ? (loggedUser.full_name || loggedUser.username || '') : '';

  // Populate employee select - tự động chọn KTV nếu user trùng khớp nhân sự
  const selAssignee = document.getElementById('newTaskAssignee');
  if (selAssignee) {
    selAssignee.innerHTML = buildEmployeeSelectOptions(userFullName, '-- Chọn kỹ thuật viên phụ trách --');
  }

  // Clear & reset sub-items container
  const itemsContainer = document.getElementById('newTaskItemsContainer');
  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    addNewTaskItemRow();
  }

  // Tự động điền Người Yêu Cầu từ thông tin người đang đăng nhập
  const reqInput = document.getElementById('newTaskRequester');
  if (reqInput) {
    reqInput.value = userFullName;
  }

  // Tự động điền Bộ Phận / Phòng Ban nếu có
  const deptInput = document.getElementById('newTaskDept');
  if (deptInput && loggedUser) {
    const uDept = loggedUser.depart_id || loggedUser.department || loggedUser.dept;
    if (uDept) deptInput.value = uDept;
  }

  // Tự động điền Email nếu có
  const emailInput = document.getElementById('newTaskEmail');
  if (emailInput && loggedUser && loggedUser.email) {
    emailInput.value = loggedUser.email;
  }

  // Tự động điền Số điện thoại nếu có
  const phoneInput = document.getElementById('newTaskPhone');
  if (phoneInput && loggedUser && (loggedUser.phone || loggedUser.phone_number)) {
    phoneInput.value = loggedUser.phone || loggedUser.phone_number;
  }

  // Reset recurring toggle in task modal
  const chk = document.getElementById('newTaskIsRecurring');
  if (chk) {
    chk.checked = false;
    toggleNewTaskRecurringFields(false);
  }
  selectNewTaskCycleType('INTERVAL_DAYS');
  setNewTaskInterval(15);
  const autoRec = document.getElementById('newTaskAutoRecreate');
  if (autoRec) autoRec.checked = true;

  const macEl = document.getElementById('newTaskMachine');
  if (macEl) {
    macEl.value = '';
    macEl.dataset.machineId = '';
    macEl.dataset.machineText = '';
  }
  const macHint = document.getElementById('newTaskMachineHint');
  if (macHint) macHint.innerHTML = '';
  const deptHint = document.getElementById('newTaskDeptHint');
  if (deptHint) deptHint.innerHTML = '';

  showModal(modal);
  document.body.classList.add('mobile-view-detail');
  try { history.pushState({ modal: 'createTask' }, ''); } catch (e) { }
}

function addNewTaskItemRow(itemData = {}) {
  const container = document.getElementById('newTaskItemsContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'task-item-row';

  const hasSample = !!itemData.SampleImageUrl;

  row.innerHTML = `
    <input type="text" class="form-input new-item-title task-item-col-title" style="padding: 6px 8px; font-size: 0.82rem;" placeholder="Nội dung việc..." value="${escapeHtml(itemData.ItemTitle || '')}">
    <select class="form-select new-item-assignee task-item-col-assignee" style="padding: 6px 6px; font-size: 0.8rem;">
      ${buildEmployeeSelectOptions(itemData.AssignedTo || '', '-- KTV thực hiện --')}
    </select>
    <input type="text" class="form-input new-item-note task-item-col-note" style="padding: 6px 8px; font-size: 0.8rem;" placeholder="Ghi chú / yêu cầu..." value="${escapeHtml(itemData.Note || itemData.Notes || '')}">
    <input type="hidden" class="new-item-sample-url" value="${escapeHtml(itemData.SampleImageUrl || '')}">
    <div class="task-item-col-sample" style="display: flex; align-items: center; gap: 4px;">
      <div class="item-sample-thumb-box" style="width: 28px; height: 28px; border-radius: 4px; overflow: hidden; border: 1px solid #38BDF8; background: #000; cursor: pointer; flex-shrink: 0; display: ${hasSample ? 'block' : 'none'};" onclick="openLightbox('${itemData.SampleImageUrl || ''}', 'Ảnh Mẫu SOP')" title="Xem ảnh mẫu chuẩn SOP">
        ${hasSample ? `<img src="${itemData.SampleImageUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : ''}
      </div>
    </div>
    <button type="button" class="btn-clear task-item-col-delete" style="color: #EF4444; padding: 4px 6px; font-size: 0.85rem;" title="Xóa dòng này" onclick="this.closest('.task-item-row').remove()">
      ✕
    </button>
  `;
  container.appendChild(row);
}

function closeCreateTaskModal() {
  const modal = document.getElementById('createTaskModal');
  if (modal) hideModal(modal);
  document.body.classList.remove('mobile-view-detail');
  document.getElementById('formCreateTask')?.reset();
}

function toggleNewTaskRecurringFields(checked) {
  const box = document.getElementById('newTaskRecurringBox');
  if (box) box.style.display = checked ? 'block' : 'none';
}

function selectNewTaskCycleType(type) {
  newTaskCycleType = type;
  const pillInterval = document.getElementById('pillTaskCycleInterval');
  const pillMonthly = document.getElementById('pillTaskCycleMonthly');
  const panelInterval = document.getElementById('panelTaskCycleInterval');
  const panelMonthly = document.getElementById('panelTaskCycleMonthly');

  if (type === 'INTERVAL_DAYS') {
    pillInterval?.classList.add('active');
    pillMonthly?.classList.remove('active');
    if (panelInterval) panelInterval.style.display = 'block';
    if (panelMonthly) panelMonthly.style.display = 'none';
  } else {
    pillInterval?.classList.remove('active');
    pillMonthly?.classList.add('active');
    if (panelInterval) panelInterval.style.display = 'none';
    if (panelMonthly) panelMonthly.style.display = 'block';
  }
}

function setNewTaskInterval(days) {
  const inp = document.getElementById('newTaskIntervalDays');
  if (inp) inp.value = days;
}

function setNewTaskMonthlyDays(daysStr) {
  const inp = document.getElementById('newTaskMonthlyDays');
  if (inp) inp.value = daysStr;
}

async function submitCreateTask(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitCreateTask');
  const headerBtn = document.getElementById('btnHeaderSaveCreateTask');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang Lưu...';
  }
  if (headerBtn) {
    headerBtn.disabled = true;
    headerBtn.textContent = 'Đang Lưu...';
  }

  const isRecurring = document.getElementById('newTaskIsRecurring')?.checked || false;

  // Collect sub-items checklist
  const itemRows = document.querySelectorAll('#newTaskItemsContainer .task-item-row');
  const items = [];
  itemRows.forEach((r, idx) => {
    const title = (r.querySelector('.new-item-title')?.value || '').trim();
    if (title) {
      const sel = r.querySelector('.new-item-assignee');
      const opt = sel ? sel.options[sel.selectedIndex] : null;
      items.push({
        ItemTitle: title,
        AssignedTo: sel ? sel.value : '',
        AssignedEmpID: opt ? opt.dataset.empid || '' : '',
        Department: opt ? opt.dataset.dept || 'Cơ điện' : 'Cơ điện',
        Note: (r.querySelector('.new-item-note')?.value || '').trim(),
        SampleImageUrl: (r.querySelector('.new-item-sample-url')?.value || '').trim(),
        ItemOrder: idx + 1
      });
    }
  });

  const grpSelect = document.getElementById('newTaskGroup');
  let assignedGroupIds = [];
  let assignedGroupNames = '';
  if (grpSelect && grpSelect.value) {
    assignedGroupIds = [Number(grpSelect.value)];
    const selectedGroup = allGroups.find(g => g.id == grpSelect.value);
    if (selectedGroup) {
      assignedGroupNames = selectedGroup.GroupName;
    }
  }

  const assigneeSelect = document.getElementById('newTaskAssignee');
  let assignedEmpIds = [];
  let assignedTo = assigneeSelect ? assigneeSelect.value.trim() : '';
  if (assigneeSelect && assigneeSelect.selectedIndex >= 0) {
    const opt = assigneeSelect.options[assigneeSelect.selectedIndex];
    if (opt && opt.dataset && opt.dataset.empid) {
      assignedEmpIds = [opt.dataset.empid];
    }
  }

  const payload = {
    TaskTitle: document.getElementById('newTaskTitle').value.trim(),
    TaskType: document.getElementById('newTaskType').value,
    Priority: document.getElementById('newTaskPriority').value,
    MachineID: (document.getElementById('newTaskMachine')?.dataset?.machineId) || document.getElementById('newTaskMachine').value.trim(),
    Department: (document.getElementById('newTaskDept')?.dataset?.deptName) || document.getElementById('newTaskDept').value.trim(),
    RequesterName: document.getElementById('newTaskRequester').value.trim(),
    RequesterEmail: (document.getElementById('newTaskEmail')?.value || '').trim(),
    RequesterPhone: (document.getElementById('newTaskPhone')?.value || '').trim(),
    AssignedTo: assignedTo,
    Description: document.getElementById('newTaskDesc').value.trim(),
    IsRecurring: isRecurring,
    Items: items.length > 0 ? items : undefined
  };

  if (assignedGroupIds.length > 0) payload.AssignedGroupIDs = assignedGroupIds;
  if (assignedGroupNames) payload.AssignedGroupNames = assignedGroupNames;
  if (assignedEmpIds.length > 0) payload.AssignedEmpIDs = assignedEmpIds;

  if (isRecurring) {
    payload.CycleType = newTaskCycleType;
    if (newTaskCycleType === 'INTERVAL_DAYS') {
      payload.IntervalDays = Number(document.getElementById('newTaskIntervalDays').value) || 15;
    } else {
      const monthlyVal = (document.getElementById('newTaskMonthlyDays')?.value || '').trim();
      if (!monthlyVal) {
        showToast('Vui lòng nhập các ngày trong tháng (ví dụ: 11, 21, 31)!', 'warning');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '💾 Lưu Công Việc';
        }
        if (headerBtn) {
          headerBtn.disabled = false;
          headerBtn.textContent = '💾 Lưu';
        }
        return;
      }
      payload.MonthlyDays = monthlyVal;
    }
    payload.AutoRecreateOnComplete = document.getElementById('newTaskAutoRecreate')?.checked ? 1 : 0;
  }

  try {
    const res = await fetch('/api/internal-tasks', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi tạo công việc');

    showToast(`Đã tạo thành công công việc: ${data.task_code}`, 'success');
    closeCreateTaskModal();
    await loadTasks();
    if (data.task_id) {
      selectInternalTask(data.task_id);
    }
    if (isRecurring) {
      await loadRecurringTemplates();
    }
  } catch (err) {
    console.error('Lỗi tạo công việc:', err);
    showToast(err.message || 'Không thể tạo công việc mới', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Lưu Công Việc';
    }
    if (headerBtn) {
      headerBtn.disabled = false;
      headerBtn.textContent = '💾 Lưu';
    }
  }
}

// =========================================================================
// RECURRING TEMPLATES MANAGEMENT (Quản lý các hạng mục có chu kỳ)
// =========================================================================
// =========================================================================
// RECURRING TEMPLATES & SUB-ITEMS (Master-Detail SOP Library)
// =========================================================================

async function loadRecurringData() {
  try {
    const [resTpl, resItems] = await Promise.all([
      fetch('/api/internal-tasks/recurring-templates'),
      fetch('/api/internal-tasks/recurring-items')
    ]);

    if (resTpl.ok) {
      const dataTpl = await resTpl.json();
      allRecurringTemplates = dataTpl.templates || [];
    }

    if (resItems.ok) {
      const dataItems = await resItems.json();
      allRecurringItems = dataItems.items || [];
    }

    // Index sub-items by recurring template
    itemsByRecurringTemplate.clear();
    allRecurringTemplates.forEach(t => itemsByRecurringTemplate.set(t.id, []));
    allRecurringItems.forEach(item => {
      if (item.TemplateID && itemsByRecurringTemplate.has(item.TemplateID)) {
        itemsByRecurringTemplate.get(item.TemplateID).push(item);
      }
    });

    // Update master counters & badges
    const badgeTop = document.getElementById('badgeRecurringTemplatesCount');
    if (badgeTop) badgeTop.textContent = allRecurringTemplates.length.toLocaleString();

    const badgeMaster = document.getElementById('recurringMasterTotalBadge');
    if (badgeMaster) badgeMaster.textContent = allRecurringTemplates.length.toLocaleString();

    const badgeAllItems = document.getElementById('allRecurringItemsBadge');
    if (badgeAllItems) badgeAllItems.textContent = `${allRecurringItems.length} mục con`;

    const textAllTpl = document.getElementById('allRecurringTplCountText');
    if (textAllTpl) textAllTpl.textContent = `Toàn bộ ${allRecurringTemplates.length} danh mục`;

    filterRecurringItems();
  } catch (err) {
    console.error('Lỗi tải dữ liệu định kỳ:', err);
    const tbody = document.getElementById('recurringItemsTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 30px; color: #EF4444;">
            Không thể tải dữ liệu hạng mục định kỳ. 
            <button class="btn-secondary" style="margin-left: 8px;" onclick="loadRecurringData()">Thử Lại</button>
          </td>
        </tr>
      `;
    }
  }
}

// Backward compatibility alias
async function loadRecurringTemplates() {
  return await loadRecurringData();
}

function setupRecurringSearchDebounce() {
  const input = document.getElementById('recurringSearchInput');
  if (!input) return;
  let timeout = null;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      filterRecurringItems();
    }, 200);
  });
}

function clearRecurringSearch() {
  const input = document.getElementById('recurringSearchInput');
  if (input) input.value = '';
  filterRecurringItems();
}

function selectRecurringTemplate(templateId, isPopState = false) {
  selectedRecurringTplId = templateId;

  // Update left sidebar active state
  const btnAll = document.getElementById('btnSelectAllRecurring');
  const masterCards = document.querySelectorAll('#recurringMasterList .master-card');

  if (templateId === null) {
    btnAll?.classList.add('active');
    masterCards.forEach(c => c.classList.remove('active'));
  } else {
    btnAll?.classList.remove('active');
    masterCards.forEach(c => {
      if (c.dataset.tplId == templateId) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
  }

  // Master-Detail Mobile View Switcher
  const layoutContainer = document.querySelector('.category-layout-container');
  const viewRecurringSection = document.getElementById('viewRecurringSection');
  const mobileBadge = document.getElementById('recurringMobileDetailCode');

  if (templateId !== null) {
    if (layoutContainer) layoutContainer.classList.add('mobile-detail-active');
    if (viewRecurringSection) viewRecurringSection.classList.add('mobile-detail-active');
    const tpl = allRecurringTemplates.find(t => t.id == templateId);
    if (mobileBadge && tpl) {
      mobileBadge.textContent = tpl.TemplateCode || 'REC';
    }
    if (!isPopState) {
      try {
        history.pushState({ recurringDetail: templateId }, '');
      } catch (e) { }
    }
    if (window.innerWidth <= 768) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } else {
    if (layoutContainer) layoutContainer.classList.remove('mobile-detail-active');
    if (viewRecurringSection) viewRecurringSection.classList.remove('mobile-detail-active');
    if (window.innerWidth <= 768) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  updateRecurringDetailBanner(templateId);
  filterRecurringItems(false);
}

function updateRecurringDetailBanner(templateId) {
  const banner = document.getElementById('recurringDetailBanner');
  const thParent = document.getElementById('thParentRecurring');
  const counter = document.getElementById('recurringItemCounter');
  if (!banner) return;

  const typeLabels = {
    BREAKDOWN: 'Sự cố định kỳ',
    DEPT_REQUEST: 'Yêu cầu P.Ban',
    IMPROVEMENT: 'Cải tiến định kỳ',
    INTERNAL: 'Nội bộ Kỹ thuật'
  };

  if (!templateId) {
    banner.style.display = 'none';
    if (thParent) thParent.style.display = '';
    if (counter) {
      counter.textContent = '';
      counter.style.display = 'none';
    }
    return;
  }

  if (thParent) thParent.style.display = 'none';

  const tpl = allRecurringTemplates.find(t => t.id == templateId);
  if (!tpl) {
    banner.style.display = 'none';
    if (thParent) thParent.style.display = '';
    return;
  }

  banner.style.display = 'block';
  const tplItems = itemsByRecurringTemplate.get(templateId) || [];
  const sampleCount = tplItems.filter(i => !!i.SampleImageUrl).length;
  const proofCount = tplItems.filter(i => (Number(i.ProofCount) || 0) > 0).length;

  document.getElementById('bannerTplCode').textContent = tpl.TemplateCode || 'REC';
  document.getElementById('bannerTplMachine').textContent = `Máy: ${tpl.MachineID || 'Chung'}`;
  document.getElementById('bannerTplType').textContent = `Loại: ${typeLabels[tpl.TaskType] || tpl.TaskType}`;

  const statusEl = document.getElementById('bannerTplStatus');
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.style.display = 'none';
  }

  const statusDropdown = document.getElementById('bannerTplStatusDropdown');
  if (statusDropdown) {
    statusDropdown.value = tpl.IsActive ? '1' : '0';
    statusDropdown.className = tpl.IsActive ? 'banner-status-dropdown status-active' : 'banner-status-dropdown status-paused';
  }

  document.getElementById('bannerTplTitle').textContent = tpl.TaskTitle;

  const cycleText = tpl.CycleType === 'INTERVAL_DAYS' ?
    `Mỗi ${tpl.IntervalDays} ngày` :
    `Ngày ${tpl.MonthlyDays} hàng tháng`;
  document.getElementById('bannerTplCycle').textContent = cycleText;
  document.getElementById('bannerTplAssignee').textContent = tpl.AssignedTo || 'Chưa phân công';
  document.getElementById('bannerTplNextDue').textContent = tpl.NextDueDate ? formatDateTime(tpl.NextDueDate) : '-';
  document.getElementById('bannerTplSpawned').textContent = `${tpl.TotalSpawned || 0} lần`;

  document.getElementById('bannerStatItemsCount').textContent = `${tplItems.length} việc`;
  document.getElementById('bannerStatSampleCount').textContent = `${sampleCount} / ${tplItems.length}`;
  document.getElementById('bannerStatProofCount').textContent = `${proofCount} việc có ảnh`;

  const btnToggle = document.getElementById('bannerBtnToggleActive');
  if (btnToggle) {
    btnToggle.textContent = tpl.IsActive ? 'Tạm Dừng' : 'Kích Hoạt';
    btnToggle.style.color = tpl.IsActive ? '#F59E0B' : '#10B981';
  }

  if (counter) {
    counter.textContent = '';
    counter.style.display = 'none';
  }
}

function filterRecurringItems(refreshBanner = true) {
  const query = (document.getElementById('recurringSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('filterRecurringStatus')?.value || '';
  const imageStatus = document.getElementById('filterRecurringImageStatus')?.value || '';
  const matchBadge = document.getElementById('recurringSearchMatchCount');

  // Update active filter badge & button state
  const activeCount = (statusFilter ? 1 : 0) + (imageStatus ? 1 : 0);
  const filterBadge = document.getElementById('activeRecurringFilterBadge');
  const btnToggle = document.getElementById('btnToggleRecurringFilters');
  if (filterBadge) {
    if (activeCount > 0) {
      filterBadge.textContent = activeCount;
      filterBadge.style.display = 'inline-flex';
    } else {
      filterBadge.style.display = 'none';
    }
  }
  if (btnToggle) {
    btnToggle.classList.toggle('has-filters', activeCount > 0);
  }

  // 1. Filter recurring templates for Left Sidebar
  filteredRecurringTemplates = allRecurringTemplates.filter(tpl => {
    if (statusFilter === 'active' && !tpl.IsActive) return false;
    if (statusFilter === 'paused' && tpl.IsActive) return false;

    if (!query) return true;

    const childItems = itemsByRecurringTemplate.get(tpl.id) || [];
    const isTplMatch = (
      (tpl.TemplateCode && tpl.TemplateCode.toLowerCase().includes(query)) ||
      (tpl.TaskTitle && tpl.TaskTitle.toLowerCase().includes(query)) ||
      (tpl.MachineID && tpl.MachineID.toLowerCase().includes(query)) ||
      (tpl.AssignedTo && tpl.AssignedTo.toLowerCase().includes(query)) ||
      (tpl.Description && tpl.Description.toLowerCase().includes(query))
    );

    const isChildMatch = childItems.some(i => (
      (i.ItemTitle && i.ItemTitle.toLowerCase().includes(query)) ||
      (i.StandardGuideline && i.StandardGuideline.toLowerCase().includes(query)) ||
      (i.Note && i.Note.toLowerCase().includes(query)) ||
      (i.AssignedTo && i.AssignedTo.toLowerCase().includes(query))
    ));

    return isTplMatch || isChildMatch;
  });

  renderRecurringMasterList(filteredRecurringTemplates, query);

  // 2. Filter recurring items for Right Table
  filteredRecurringItems = allRecurringItems.filter(item => {
    // If specific template is selected, strictly filter by it
    if (selectedRecurringTplId && item.TemplateID != selectedRecurringTplId) {
      return false;
    }

    // Status filter
    if (statusFilter === 'active' && !item.TemplateIsActive) return false;
    if (statusFilter === 'paused' && item.TemplateIsActive) return false;

    // Image status filter
    if (imageStatus === 'has_sample' && !item.SampleImageUrl) return false;
    if (imageStatus === 'no_sample' && item.SampleImageUrl) return false;
    if (imageStatus === 'has_proof' && (!item.ProofCount || item.ProofCount <= 0)) return false;

    // Search query
    if (query) {
      const matchItem = (
        (item.ItemTitle && item.ItemTitle.toLowerCase().includes(query)) ||
        (item.StandardGuideline && item.StandardGuideline.toLowerCase().includes(query)) ||
        (item.Note && item.Note.toLowerCase().includes(query)) ||
        (item.AssignedTo && item.AssignedTo.toLowerCase().includes(query)) ||
        (item.TemplateCode && item.TemplateCode.toLowerCase().includes(query)) ||
        (item.TaskTitle && item.TaskTitle.toLowerCase().includes(query)) ||
        (item.MachineID && item.MachineID.toLowerCase().includes(query))
      );
      if (!matchItem) return false;
    }

    return true;
  });

  // Update match badge
  if (matchBadge) {
    if (query) {
      matchBadge.style.display = 'inline-block';
      matchBadge.textContent = `${filteredRecurringItems.length} việc khớp`;
    } else {
      matchBadge.style.display = 'none';
    }
  }

  if (refreshBanner) {
    updateRecurringDetailBanner(selectedRecurringTplId);
  }

  renderRecurringItemsTable(filteredRecurringItems, query);
}

function renderRecurringMasterList(templates, query = '') {
  const container = document.getElementById('recurringMasterList');
  if (!container) return;

  if (templates.length === 0) {
    container.innerHTML = `
      <div class="master-empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted);">
          <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span>Không có hạng mục phù hợp</span>
      </div>
    `;
    return;
  }

  container.innerHTML = templates.map(tpl => {
    const childItems = itemsByRecurringTemplate.get(tpl.id) || [];
    const sampleCount = childItems.filter(i => !!i.SampleImageUrl).length;
    const isActiveCard = selectedRecurringTplId == tpl.id;

    let cycleDesc = '';
    if (tpl.CycleType === 'INTERVAL_DAYS') {
      cycleDesc = `Mỗi ${tpl.IntervalDays} ngày`;
    } else {
      cycleDesc = `Ngày ${tpl.MonthlyDays} h.tháng`;
    }

    return `
      <div class="master-card ${isActiveCard ? 'active' : ''}" data-tpl-id="${tpl.id}" onclick="selectRecurringTemplate(${tpl.id})">
        <div class="master-card-header">
          <span class="badge-workid">${highlightText(tpl.TemplateCode, query)}</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <span class="master-task-badge">${childItems.length} mục</span>
            <span style="font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; ${tpl.IsActive ? 'background: rgba(16, 185, 129, 0.15); color: #34D399;' : 'background: rgba(245, 158, 11, 0.15); color: #FBBF24;'}">
              ${tpl.IsActive ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>
        <div class="master-card-title">${highlightText(tpl.TaskTitle, query)}</div>
        <div class="master-card-meta">
          <span>Máy: <strong style="color: #F8FAFC;">${escapeHtml(tpl.MachineID || 'Chung')}</strong></span>
          <span>•</span>
          <span>${cycleDesc}</span>
          ${sampleCount > 0 ? `<span style="color: #38BDF8;">• 📸 ${sampleCount} ảnh</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderRecurringItemsTable(items, query = '') {
  const tbody = document.getElementById('recurringItemsTableBody');
  if (!tbody) return;

  const isViewingAll = !selectedRecurringTplId;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
          <div style="font-size: 30px; margin-bottom: 8px;">📋</div>
          <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">Không tìm thấy hạng mục con nào</div>
          <div style="font-size: 0.8rem;">
            ${selectedRecurringTplId ? 'Mẫu này chưa có hạng mục kiểm tra con nào. Bấm nút dưới để thêm:' : 'Hãy thử thay đổi từ khóa hoặc bộ lọc.'}
          </div>
          ${selectedRecurringTplId ? `
            <div style="margin-top: 14px;">
              <button type="button" class="btn-primary" style="padding: 6px 16px; font-size: 0.8rem; background: #10B981;" onclick="openQuickSubItemModal(${selectedRecurringTplId})">
                + Thêm Hạng Mục Con Đầu Tiên
              </button>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map((item, idx) => {
    const hasSample = !!item.SampleImageUrl;
    const proofCount = Number(item.ProofCount) || 0;
    const itemNumber = idx + 1;

    // Parent Recurring Column (only shown when viewing All)
    const parentTplTd = isViewingAll ? `
      <td class="col-sub-parent">
        <div style="font-weight: 700; color: #818CF8; font-size: 12px; font-family: 'JetBrains Mono', monospace;">
          ${highlightText(item.TemplateCode || 'REC', query)}
        </div>
        <div style="font-size: 12px; color: var(--text-muted); line-height: 1.3;">
          ${highlightText(item.TaskTitle || '', query)}
        </div>
      </td>
    ` : '';

    // Sample Image HTML: merged with SOP sample modal trigger
    const sampleImgHtml = hasSample ? `
      <div class="tmpl-thumb-wrapper" onclick="openItemSampleModalById(${item.id})" title="Xem & sửa ảnh mẫu SOP / hướng dẫn">
        <img src="${item.SampleImageUrl}" alt="Ảnh mẫu SOP" class="tmpl-thumb-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/static/placeholder-camera.svg';">
        <span class="tmpl-thumb-badge">Mẫu SOP</span>
      </div>
    ` : `
      <div class="tmpl-no-img" onclick="openItemSampleModalById(${item.id})" title="Thêm ảnh mẫu SOP & hướng dẫn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>+ Mẫu SOP</span>
      </div>
    `;

    // Proof Button HTML (same as categories.html)
    const proofBtnHtml = `
      <button type="button" class="btn-proof-history ${proofCount > 0 ? 'has-proof' : ''}" onclick="openItemSampleModalById(${item.id})" title="Xem ${proofCount} hình ảnh kỹ thuật viên đã chụp khi thực hiện">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>${proofCount} ảnh</span>
      </button>
    `;

    // Guideline text
    const guidelineText = item.StandardGuideline ?
      highlightText(item.StandardGuideline, query) :
      '<span style="color: var(--text-muted); font-style: italic;">Chưa có hướng dẫn SOP chuẩn</span>';

    return `
      <tr data-item-id="${item.id}">
        <td class="col-sub-stt" style="text-align: center; font-weight: 600; color: var(--text-muted); font-size: 12px;">${itemNumber}</td>
        ${parentTplTd}
        <td class="col-sub-title">
          <div class="subitem-title">${highlightText(item.ItemTitle, query)}</div>
          ${item.Note ? `<div class="subitem-note">${highlightText(item.Note, query)}</div>` : ''}
        </td>
        <td class="col-sub-assignee">
          <div class="subitem-assignee">${highlightText(item.AssignedTo || 'Chưa phân công', query)}</div>
          ${item.Department ? `<div class="subitem-dept">${escapeHtml(item.Department)}</div>` : ''}
        </td>
        <td class="col-sub-sample" style="text-align: center;">${sampleImgHtml}</td>
        <td class="col-sub-proof" style="text-align: center;">${proofBtnHtml}</td>
        <td class="col-sub-guideline guideline-cell" style="font-size: 12px; line-height: 1.35; color: #E2E8F0;">${guidelineText}</td>
        <td class="col-sub-action" style="text-align: center;">
          <div style="display: inline-flex; gap: 4px; justify-content: center; align-items: center;">
            <button type="button" class="btn-secondary" style="padding: 4px 7px; font-size: 0.72rem;" onclick="openQuickEditSubItemModal(${item.id})" title="Chỉnh sửa hạng mục con">
              ✏️
            </button>
            <button type="button" class="btn-secondary" style="padding: 4px 6px; font-size: 0.72rem; color: #EF4444;" onclick="deleteSubItem(${item.id})" title="Xóa hạng mục con">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Quick Sub-item Modals & Actions
function openQuickSubItemModal(templateId = null) {
  const tplId = templateId || selectedRecurringTplId;
  if (!tplId) {
    showToast('Vui lòng chọn 1 hạng mục định kỳ ở cột trái trước khi thêm việc con!', 'warning');
    return;
  }
  const modal = document.getElementById('quickSubItemModal');
  if (!modal) return;
  document.getElementById('formQuickSubItem')?.reset();
  document.getElementById('quickSubItemModalTitle').textContent = 'Thêm Hạng Mục Kiểm Tra Con';
  document.getElementById('quickSubItemTplId').value = tplId;
  document.getElementById('quickSubItemId').value = '';
  const sel = document.getElementById('quickSubItemAssignee');
  if (sel) sel.innerHTML = buildEmployeeSelectOptions('', '-- Chọn kỹ thuật viên --');
  showModal(modal);
}

function openQuickEditSubItemModal(itemId) {
  const item = allRecurringItems.find(i => i.id == itemId);
  if (!item) return;
  const modal = document.getElementById('quickSubItemModal');
  if (!modal) return;
  document.getElementById('quickSubItemModalTitle').textContent = 'Chỉnh Sửa Hạng Mục Con';
  document.getElementById('quickSubItemTplId').value = item.TemplateID || '';
  document.getElementById('quickSubItemId').value = item.id;
  document.getElementById('quickSubItemTitle').value = item.ItemTitle || '';
  document.getElementById('quickSubItemDept').value = item.Department || 'Cơ điện';
  document.getElementById('quickSubItemGuideline').value = item.StandardGuideline || '';
  document.getElementById('quickSubItemNote').value = item.Note || '';
  const sel = document.getElementById('quickSubItemAssignee');
  if (sel) sel.innerHTML = buildEmployeeSelectOptions(item.AssignedTo || '', '-- Chọn kỹ thuật viên --');
  showModal(modal);
}

function closeQuickSubItemModal() {
  const modal = document.getElementById('quickSubItemModal');
  if (modal) hideModal(modal);
}

async function submitQuickSubItem(e) {
  if (e && e.preventDefault) e.preventDefault();
  const tplId = document.getElementById('quickSubItemTplId')?.value;
  const itemId = document.getElementById('quickSubItemId')?.value;
  const title = document.getElementById('quickSubItemTitle')?.value.trim();
  if (!title) {
    showToast('Vui lòng nhập tên hạng mục con', 'warning');
    document.getElementById('quickSubItemTitle')?.focus();
    return;
  }

  // Compute next order when adding a new item to guarantee it is placed at the bottom
  let nextOrder = undefined;
  if (!itemId && tplId) {
    const existing = itemsByRecurringTemplate.get(Number(tplId)) || [];
    const maxOrder = existing.reduce((max, it) => Math.max(max, Number(it.ItemOrder) || 0), 0);
    nextOrder = Math.max(maxOrder, existing.length) + 1;
  }

  const sel = document.getElementById('quickSubItemAssignee');
  const opt = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;

  const payload = {
    ItemTitle: title,
    AssignedTo: sel ? sel.value : '',
    AssignedEmpID: opt ? opt.dataset.empid || '' : '',
    Department: document.getElementById('quickSubItemDept')?.value.trim() || 'Cơ điện',
    StandardGuideline: document.getElementById('quickSubItemGuideline')?.value.trim() || '',
    Note: document.getElementById('quickSubItemNote')?.value.trim() || '',
    ItemOrder: nextOrder
  };

  try {
    if (itemId) {
      const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Không thể cập nhật hạng mục con');
      showToast('Đã cập nhật hạng mục con thành công!', 'success');
    } else {
      const res = await fetch(`/api/internal-tasks/recurring-templates/${tplId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Không thể thêm hạng mục con');
      showToast('Đã thêm hạng mục con mới thành công!', 'success');
    }
    closeQuickSubItemModal();
    await loadRecurringData();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Lỗi khi lưu hạng mục con', 'error');
  }
}

async function deleteSubItem(itemId) {
  if (!confirm('Bạn có chắc chắn muốn xóa hạng mục kiểm tra này không?')) return;
  try {
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Không thể xóa hạng mục');
    showToast('Đã xóa hạng mục con thành công!', 'success');
    await loadRecurringData();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Lỗi khi xóa hạng mục', 'error');
  }
}

// Banner Template Actions
function spawnCurrentSelectedTemplate() {
  if (selectedRecurringTplId) {
    spawnTaskFromTemplate(selectedRecurringTplId);
  }
}

function editCurrentSelectedTemplate() {
  if (selectedRecurringTplId) {
    openEditRecurringTemplateModal(selectedRecurringTplId);
  }
}

function toggleCurrentTemplateActive() {
  if (!selectedRecurringTplId) return;
  const tpl = allRecurringTemplates.find(t => t.id == selectedRecurringTplId);
  if (tpl) {
    toggleTemplateActive(tpl.id, tpl.IsActive ? 0 : 1);
  }
}

async function changeRecurringTemplateStatus(val) {
  if (!selectedRecurringTplId) return;
  const newActive = Number(val);
  const tpl = (allRecurringTemplates || []).find(t => t.id == selectedRecurringTplId);
  try {
    await toggleTemplateActive(selectedRecurringTplId, newActive);
  } catch (err) {
    const dropdown = document.getElementById('bannerTplStatusDropdown');
    if (dropdown && tpl) {
      dropdown.value = tpl.IsActive ? '1' : '0';
      dropdown.className = tpl.IsActive ? 'banner-status-dropdown status-active' : 'banner-status-dropdown status-paused';
    }
  }
}

function deleteCurrentSelectedTemplate() {
  if (selectedRecurringTplId) {
    deleteRecurringTemplate(selectedRecurringTplId);
  }
}

// Recurring Template Modal Management (Add & Edit)
async function openRecurringTemplateModal(templateId = null) {
  const modal = document.getElementById('recurringTemplateModal');
  if (!modal) return;

  if (allEmployees.length === 0) {
    await loadEmployees();
  }

  document.getElementById('formRecurringTemplate')?.reset();
  const titleEl = document.getElementById('tplModalHeaderTitle');
  const selAssignee = document.getElementById('tplAssignee');
  const itemsContainer = document.getElementById('tplItemsContainer');

  let tplToEdit = null;
  if (templateId) {
    tplToEdit = allRecurringTemplates.find(t => t.id == templateId);
  }

  if (tplToEdit) {
    document.getElementById('tplId').value = tplToEdit.id;
    if (titleEl) titleEl.textContent = `Sửa: ${tplToEdit.TemplateCode || 'Việc Định Kỳ'}`;

    const tplTitle = document.getElementById('tplTaskTitle');
    if (tplTitle) tplTitle.value = tplToEdit.TaskTitle || '';

    const tplMachine = document.getElementById('tplMachine');
    if (tplMachine) {
      const mMatch = allMachines.find(m => m.MachineID === tplToEdit.MachineID);
      tplMachine.value = mMatch ? (mMatch.MachineText || mMatch.MachineID) : (tplToEdit.MachineID || '');
      tplMachine.dataset.machineId = tplToEdit.MachineID || '';
      const hint = document.getElementById('tplMachineHint');
      if (hint && tplToEdit.MachineID) {
        hint.innerHTML = `<span style="color: #60A5FA; font-weight: 600;">⚙️ Mã máy: <code style="background: rgba(96,165,250,0.15); padding: 2px 6px; border-radius: 4px; color: #93C5FD;">${escapeHtml(tplToEdit.MachineID)}</code></span>`;
      } else if (hint) {
        hint.innerHTML = '';
      }
    }

    const tplRequester = document.getElementById('tplRequester');
    if (tplRequester) tplRequester.value = tplToEdit.RequestedBy || '';

    const tplDept = document.getElementById('tplDept');
    if (tplDept) tplDept.value = tplToEdit.Department || 'KỸ THUẬT';

    const tplTaskType = document.getElementById('tplTaskType');
    if (tplTaskType) tplTaskType.value = tplToEdit.TaskType || 'INTERNAL';

    const tplPriority = document.getElementById('tplPriority');
    if (tplPriority) tplPriority.value = tplToEdit.Priority || 'NORMAL';

    if (selAssignee) {
      selAssignee.innerHTML = buildEmployeeSelectOptions(tplToEdit.AssignedTo || '', '-- Chọn kỹ thuật viên phụ trách --');
    }

    selectTplCycleType(tplToEdit.CycleType || 'INTERVAL_DAYS');
    if (tplToEdit.CycleType === 'MONTHLY_DAYS') {
      const days = (tplToEdit.MonthlyDays || '').split(',');
      document.querySelectorAll('.month-day-btn').forEach(btn => {
        if (days.includes(btn.dataset.val)) {
          btn.classList.add('selected');
        } else {
          btn.classList.remove('selected');
        }
      });
    } else {
      setTplInterval(tplToEdit.IntervalDays || 15);
    }

    const lblSpawn = document.getElementById('lblTplSpawnImmediately');
    if (lblSpawn) lblSpawn.style.display = 'none';
    const chkSpawn = document.getElementById('tplSpawnImmediately');
    if (chkSpawn) chkSpawn.checked = false;

    if (itemsContainer) {
      itemsContainer.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Đang tải hạng mục con...</div>';
      try {
        const res = await fetch(`/api/internal-tasks/recurring-templates/${tplToEdit.id}/items`);
        if (res.ok) {
          const fetchedItems = await res.json();
          itemsContainer.innerHTML = '';
          if (fetchedItems.length > 0) {
            fetchedItems.forEach(it => addTplItemRow(it));
          } else {
            addTplItemRow();
          }
        } else {
          itemsContainer.innerHTML = '';
          addTplItemRow();
        }
      } catch (err) {
        itemsContainer.innerHTML = '';
        addTplItemRow();
      }
    }

    const chkAuto = document.getElementById('tplAutoRecreate');
    if (chkAuto) chkAuto.checked = !!tplToEdit.IsActive;

  } else {
    // Add new
    document.getElementById('tplId').value = '';
    if (titleEl) titleEl.textContent = 'Thêm Việc Định Kỳ';
    // Đảm bảo thông tin user đăng nhập đã được tải
    if (!currentUser) {
      await checkAuth();
    }
    const loggedUser = currentUser || (() => {
      try {
        const s = localStorage.getItem('bopp_user') || sessionStorage.getItem('bopp_user');
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    })();
    const userFullName = loggedUser ? (loggedUser.full_name || loggedUser.username || '') : '';

    if (selAssignee) {
      selAssignee.innerHTML = buildEmployeeSelectOptions(userFullName, '-- Chọn kỹ thuật viên phụ trách --');
    }
    if (itemsContainer) {
      itemsContainer.innerHTML = '';
      addTplItemRow();
    }

    const lblSpawn = document.getElementById('lblTplSpawnImmediately');
    if (lblSpawn) lblSpawn.style.display = 'flex';
    const chkSpawn = document.getElementById('tplSpawnImmediately');
    if (chkSpawn) chkSpawn.checked = true;

    selectTplCycleType('INTERVAL_DAYS');
    setTplInterval(15);

    const chkAuto = document.getElementById('tplAutoRecreate');
    if (chkAuto) chkAuto.checked = true;

    const tplReq = document.getElementById('tplRequester');
    if (tplReq && userFullName) {
      tplReq.value = userFullName;
    }
    if (loggedUser && (loggedUser.depart_id || loggedUser.department)) {
      const tplDept = document.getElementById('tplDept');
      if (tplDept) tplDept.value = loggedUser.depart_id || loggedUser.department;
    }
  }

  showModal(modal);
}

function addTplItemRow(itemData = {}) {
  const container = document.getElementById('tplItemsContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'tpl-item-row';

  const hasSample = !!itemData.SampleImageUrl;

  row.innerHTML = `
    <input type="text" class="form-input tpl-item-title tpl-item-col-title" style="padding: 6px 8px; font-size: 0.82rem;" placeholder="Nội dung kiểm tra..." value="${escapeHtml(itemData.ItemTitle || '')}">
    <select class="form-select tpl-item-assignee tpl-item-col-assignee" style="padding: 6px 6px; font-size: 0.8rem;">
      ${buildEmployeeSelectOptions(itemData.AssignedTo || '', '-- KTV thực hiện --')}
    </select>
    <input type="text" class="form-input tpl-item-note tpl-item-col-note" style="padding: 6px 8px; font-size: 0.8rem;" placeholder="Tiêu chuẩn / thông số..." value="${escapeHtml(itemData.Note || itemData.Notes || '')}">
    <input type="hidden" class="tpl-item-sample-url" value="${escapeHtml(itemData.SampleImageUrl || '')}">
    <div class="tpl-item-col-sample" style="display: flex; align-items: center; gap: 4px;">
      <div class="item-sample-thumb-box" style="width: 28px; height: 28px; border-radius: 4px; overflow: hidden; border: 1px solid #38BDF8; background: #000; cursor: pointer; flex-shrink: 0; display: ${hasSample ? 'block' : 'none'};" onclick="openLightbox('${itemData.SampleImageUrl || ''}', 'Ảnh Mẫu SOP')" title="Xem ảnh mẫu">
        ${hasSample ? `<img src="${itemData.SampleImageUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : ''}
      </div>
      <button type="button" class="btn-secondary btn-item-sample-trigger" style="padding: 3px 6px; font-size: 0.72rem; color: ${hasSample ? '#38BDF8' : 'var(--text-muted)'}; white-space: nowrap;" onclick="openItemSampleModal(${itemData.id || 0}, this.closest('.tpl-item-row').querySelector('.tpl-item-title')?.value || '${escapeHtml(itemData.ItemTitle || '')}', '${itemData.SampleImageUrl || ''}', '', this.closest('.tpl-item-row'), 'recurring')" title="Xem ảnh cũ / Chọn ảnh mẫu">
        📷 ${hasSample ? 'Mẫu' : '+ Mẫu'}
      </button>
    </div>
    <button type="button" class="btn-clear tpl-item-col-delete" style="color: #EF4444; padding: 4px 6px; font-size: 0.85rem;" title="Xóa dòng này" onclick="this.closest('.tpl-item-row').remove()">
      ✕
    </button>
  `;
  container.appendChild(row);
}

async function openEditRecurringTemplateModal(templateId) {
  if (allEmployees.length === 0) {
    await loadEmployees();
  }
  let tpl = allRecurringTemplates.find(t => t.id == templateId);
  let templateItems = [];
  try {
    const res = await fetch(`/api/internal-tasks/recurring-templates/${templateId}`);
    if (res.ok) {
      const data = await res.json();
      tpl = data;
      templateItems = data.items || [];
    }
  } catch (e) { }

  if (!tpl) {
    showToast('Không tìm thấy thông tin hạng mục định kỳ!', 'error');
    return;
  }

  const modal = document.getElementById('recurringTemplateModal');
  if (!modal) return;

  document.getElementById('tplId').value = tpl.id;
  document.getElementById('tplModalHeaderTitle').textContent = `Sửa: ${tpl.TemplateCode || 'Việc Định Kỳ'}`;

  document.getElementById('tplTaskTitle').value = tpl.TaskTitle || '';
  document.getElementById('tplTaskType').value = tpl.TaskType || 'INTERNAL';
  document.getElementById('tplPriority').value = tpl.Priority || 'NORMAL';

  const tplMachineInput = document.getElementById('tplMachine');
  if (tplMachineInput) {
    const mMatch = allMachines.find(m => m.MachineID === tpl.MachineID);
    tplMachineInput.value = mMatch ? (mMatch.MachineText || mMatch.MachineID) : (tpl.MachineID || '');
    tplMachineInput.dataset.machineId = tpl.MachineID || '';
    const hint = document.getElementById('tplMachineHint');
    if (hint && tpl.MachineID) {
      hint.innerHTML = `<span style="color: #60A5FA; font-weight: 600;">⚙️ Mã máy: <code style="background: rgba(96,165,250,0.15); padding: 2px 6px; border-radius: 4px; color: #93C5FD;">${escapeHtml(tpl.MachineID)}</code></span>`;
    } else if (hint) {
      hint.innerHTML = '';
    }
  }
  document.getElementById('tplDept').value = tpl.Department || 'KỸ THUẬT';
  document.getElementById('tplRequester').value = tpl.RequesterName || '';

  // Populate employee select with current assignee
  const selAssignee = document.getElementById('tplAssignee');
  if (selAssignee) {
    selAssignee.innerHTML = buildEmployeeSelectOptions(tpl.AssignedTo || '', '-- Chọn kỹ thuật viên phụ trách --');
  }

  document.getElementById('tplDesc').value = tpl.Description || '';

  // Populate sub-items
  const itemsContainer = document.getElementById('tplItemsContainer');
  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    if (templateItems.length > 0) {
      templateItems.forEach(item => addTplItemRow(item));
    } else {
      addTplItemRow();
    }
  }

  selectTplCycleType(tpl.CycleType || 'INTERVAL_DAYS');
  if (tpl.CycleType === 'MONTHLY_DAYS') {
    document.getElementById('tplMonthlyDays').value = tpl.MonthlyDays || '';
  } else {
    document.getElementById('tplIntervalDays').value = tpl.IntervalDays || 15;
  }

  document.getElementById('tplAutoRecreate').checked = !!tpl.AutoRecreateOnComplete;

  // Don't show "Spawn immediately" checkbox on edit
  const lblSpawn = document.getElementById('lblTplSpawnImmediately');
  if (lblSpawn) lblSpawn.style.display = 'none';

  showModal(modal);
}

function closeRecurringTemplateModal() {
  const modal = document.getElementById('recurringTemplateModal');
  if (modal) hideModal(modal);
  document.getElementById('formRecurringTemplate')?.reset();
}

function selectTplCycleType(type) {
  tplModalCycleType = type;
  const pillInterval = document.getElementById('pillTplCycleInterval');
  const pillMonthly = document.getElementById('pillTplCycleMonthly');
  const panelInterval = document.getElementById('panelTplCycleInterval');
  const panelMonthly = document.getElementById('panelTplCycleMonthly');

  if (type === 'INTERVAL_DAYS') {
    pillInterval?.classList.add('active');
    pillMonthly?.classList.remove('active');
    if (panelInterval) panelInterval.style.display = 'block';
    if (panelMonthly) panelMonthly.style.display = 'none';
  } else {
    pillInterval?.classList.remove('active');
    pillMonthly?.classList.add('active');
    if (panelInterval) panelInterval.style.display = 'none';
    if (panelMonthly) panelMonthly.style.display = 'block';
  }
}

function setTplInterval(days) {
  const inp = document.getElementById('tplIntervalDays');
  if (inp) inp.value = days;
}

function setTplMonthlyDays(daysStr) {
  const inp = document.getElementById('tplMonthlyDays');
  if (inp) inp.value = daysStr;
}

async function submitSaveRecurringTemplate(e) {
  e.preventDefault();
  const tplId = document.getElementById('tplId')?.value;
  const btn = document.getElementById('btnSubmitRecurringTemplate');
  const headerBtn = document.getElementById('btnHeaderSaveRecurringTemplate');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang Lưu...';
  }
  if (headerBtn) {
    headerBtn.disabled = true;
    headerBtn.textContent = 'Đang Lưu...';
  }

  // Collect sub-items
  const itemRows = document.querySelectorAll('#tplItemsContainer .tpl-item-row');
  const items = [];
  itemRows.forEach((r, idx) => {
    const title = (r.querySelector('.tpl-item-title')?.value || '').trim();
    if (title) {
      const sel = r.querySelector('.tpl-item-assignee');
      const opt = sel ? sel.options[sel.selectedIndex] : null;
      items.push({
        ItemTitle: title,
        AssignedTo: sel ? sel.value : '',
        AssignedEmpID: opt ? opt.dataset.empid || '' : '',
        Department: opt ? opt.dataset.dept || 'Cơ điện' : 'Cơ điện',
        Note: (r.querySelector('.tpl-item-note')?.value || '').trim(),
        SampleImageUrl: (r.querySelector('.tpl-item-sample-url')?.value || '').trim(),
        ItemOrder: idx + 1
      });
    }
  });

  const payload = {
    TaskTitle: document.getElementById('tplTaskTitle').value.trim(),
    TaskType: document.getElementById('tplTaskType').value,
    Priority: document.getElementById('tplPriority').value,
    MachineID: (document.getElementById('tplMachine')?.dataset?.machineId) || document.getElementById('tplMachine').value.trim(),
    Department: (document.getElementById('tplDept')?.dataset?.deptName) || document.getElementById('tplDept').value.trim(),
    RequesterName: document.getElementById('tplRequester').value.trim(),
    AssignedTo: document.getElementById('tplAssignee').value.trim(),
    Description: document.getElementById('tplDesc').value.trim(),
    CycleType: tplModalCycleType,
    AutoRecreateOnComplete: document.getElementById('tplAutoRecreate').checked ? 1 : 0,
    Items: items.length > 0 ? items : undefined
  };

  if (tplModalCycleType === 'INTERVAL_DAYS') {
    payload.IntervalDays = Number(document.getElementById('tplIntervalDays').value) || 15;
  } else {
    const monthlyVal = (document.getElementById('tplMonthlyDays')?.value || '').trim();
    if (!monthlyVal) {
      showToast('Vui lòng nhập các ngày trong tháng (ví dụ: 11, 21, 31)!', 'warning');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💾 Lưu Hạng Mục';
      }
      if (headerBtn) {
        headerBtn.disabled = false;
        headerBtn.textContent = '💾 Lưu';
      }
      return;
    }
    payload.MonthlyDays = monthlyVal;
  }

  if (!tplId) {
    payload.SpawnImmediately = document.getElementById('tplSpawnImmediately')?.checked || false;
  }

  try {
    const url = tplId ? `/api/internal-tasks/recurring-templates/${tplId}` : '/api/internal-tasks/recurring-templates';
    const method = tplId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi lưu hạng mục định kỳ');

    const finalTplId = tplId || data.template_id;

    showToast(data.message || 'Lưu thành công hạng mục định kỳ!', 'success');
    closeRecurringTemplateModal();
    await loadRecurringData();
    await loadTasks();
  } catch (err) {
    console.error('Lỗi lưu template:', err);
    showToast(err.message || 'Không thể lưu hạng mục định kỳ', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Lưu Hạng Mục';
    }
    if (headerBtn) {
      headerBtn.disabled = false;
      headerBtn.textContent = '💾 Lưu';
    }
  }
}

async function spawnTaskFromTemplate(templateId) {
  try {
    showToast('Đang khởi tạo công việc chu kỳ...', 'info');
    const res = await fetch(`/api/internal-tasks/recurring-templates/${templateId}/spawn-now`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi khởi tạo công việc chu kỳ');

    showToast(data.message || 'Khởi tạo công việc thành công!', 'success');
    await loadRecurringData();
    await loadTasks();
  } catch (err) {
    console.error('Lỗi spawn task:', err);
    showToast(err.message || 'Không thể khởi tạo công việc', 'error');
  }
}

async function toggleTemplateActive(templateId, newActive) {
  try {
    const res = await fetch(`/api/internal-tasks/recurring-templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IsActive: newActive })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể cập nhật trạng thái');

    showToast(newActive ? 'Đã kích hoạt chu kỳ hạng mục!' : 'Đã tạm dừng chu kỳ hạng mục!', 'info');
    await loadRecurringData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteRecurringTemplate(templateId) {
  if (!confirm('Bạn có chắc chắn muốn xóa quy chuẩn hạng mục định kỳ này không? Các công việc đã tạo trước đây vẫn sẽ được giữ nguyên.')) {
    return;
  }

  try {
    const res = await fetch(`/api/internal-tasks/recurring-templates/${templateId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi xóa hạng mục');

    if (selectedRecurringTplId == templateId) {
      selectRecurringTemplate(null);
    }
    showToast('Đã xóa thành công hạng mục định kỳ!', 'success');
    await loadRecurringData();
    await loadTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// TASK DETAIL & UPDATE WORKFLOW
// =========================================================================
async function openTaskDetail(taskId, userInitiated = true) {
  if (!taskId) return;
  selectInternalTask(taskId, userInitiated);
}

// =========================================================================
// CHECKLIST SUB-ITEMS WORKFLOW (DETAIL MODAL)
// =========================================================================
function renderDetailChecklist(items) {
  const container = document.getElementById('modalDetailItemsContainer');
  const statsEl = document.getElementById('modalDetailItemStats');
  const pctEl = document.getElementById('modalDetailProgressPercent');
  const barEl = document.getElementById('modalDetailProgressBar');

  const total = items.length;
  const completed = items.filter(i => i.Status === 'COMPLETED').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (statsEl) statsEl.textContent = `${completed}/${total}`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (barEl) barEl.style.width = `${pct}%`;

  if (!container) return;

  if (total === 0) {
    container.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted); padding: 12px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); text-align: center;">
        Chưa có hạng mục con nào. Bấm <strong>'+ Thêm Hạng Mục'</strong> ở góc phải để tạo checklist công việc chi tiết.
      </div>
    `;
    return;
  }

  const taskImages = (currentEditingTask && currentEditingTask.images) ? currentEditingTask.images : [];
  let modalTaskGroupId = '';
  if (currentEditingTask) {
    let gids = currentEditingTask.AssignedGroupIDs || [];
    if (typeof gids === 'string') {
      try { gids = JSON.parse(gids); } catch (e) { gids = []; }
    }
    if (Array.isArray(gids) && gids.length > 0) modalTaskGroupId = gids[0];
  }

  container.innerHTML = items.map((item, idx) => {
    const isDone = item.Status === 'COMPLETED';
    const hasIssue = (item.HasIssue == 1 || item.HasIssue === true);

    // Ảnh thực tế của hạng mục này: lấy từ taskImages theo TaskItemID hoặc item.ActualImageUrl
    const matchedPhoto = taskImages.find(img => img.TaskItemID == item.id) || (item.ActualImageUrl ? { FileUrl: item.ActualImageUrl } : null);
    const actualImgUrl = matchedPhoto ? matchedPhoto.FileUrl : (item.ActualImageUrl || '');
    const hasActualPhoto = !!actualImgUrl;

    const sampleUrl = item.SampleImageUrl || '';
    const guideline = (item.StandardGuideline || '').trim();
    let execNote = (item.Note || item.Notes || '').trim();
    if (guideline && execNote === guideline) {
      execNote = '';
    }
    const isSingleTask = !(currentEditingTask && (currentEditingTask.RecurringTemplateID || currentEditingTask.TaskType === 'PREVENTIVE'));
    const hasSample = !isSingleTask && !!sampleUrl;
    const performerName = item.CompletedBy || item.AssignedTo || '';

    return `
      <div class="subitem-card ${isDone ? 'is-completed' : ''} ${hasIssue ? 'has-issue' : ''}" style="margin-bottom: 8px;">
        <!-- DÒNG 1: Checkbox, Số thứ tự, Tên hạng mục + Hướng dẫn chi tiết + Nút xóa -->
        <div class="subitem-line-1" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <label style="display: flex; align-items: flex-start; gap: 8px; flex: 1; cursor: pointer; margin: 0; min-width: 0;">
            <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleItemCompleted(${item.id}, this.checked)" style="width: 18px; height: 18px; accent-color: #10B981; cursor: pointer; flex-shrink: 0; margin-top: 2px;">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                <span class="subitem-order-tag" style="font-weight: 800; color: #64748B; font-size: 0.82rem;">#${idx + 1}.</span>
                <span class="subitem-title-text" style="line-height: 1.35; font-weight: 700; font-size: 0.90rem; color: var(--text-primary);">
                  ${escapeHtml(item.ItemTitle)}
                </span>
              </div>
              ${guideline ? `
                <div class="subitem-guideline-box" style="font-size: 0.76rem; color: #60A5FA; margin-top: 3px; word-break: break-word; line-height: 1.35; background: rgba(59, 130, 246, 0.08); padding: 3px 6px; border-radius: 4px; border-left: 2.5px solid #3B82F6;">
                  📖 <span style="font-weight: 700; color: #93C5FD;">Hướng dẫn:</span> ${escapeHtml(guideline)}
                </div>
              ` : ''}
            </div>
          </label>
          <button type="button" class="btn-clear" onclick="deleteDetailItem(${item.id})" title="Xóa hạng mục" style="color: #EF4444; font-size: 0.85rem; padding: 2px 6px; cursor: pointer; line-height: 1; opacity: 0.6; flex-shrink: 0; background: none; border: none;">✕</button>
        </div>

        <!-- DÒNG 2: Nút sự cố, Text box nhập trực tiếp ghi chú kiểm tra -->
        <div class="subitem-line-2" style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
          <button type="button" class="btn-sub-issue ${hasIssue ? 'active-issue' : ''}" onclick="toggleSubItemIssueQuick(${item.id}, ${hasIssue ? 0 : 1})" title="${hasIssue ? 'Đang đánh dấu có sự cố. Bấm để tắt' : 'Bấm để đánh dấu hạng mục có sự cố'}" style="flex-shrink: 0; height: 32px; padding: 0 10px; font-size: 0.75rem;">
            <span>⚠️</span>
            <span>${hasIssue ? 'Có sự cố' : 'Báo sự cố'}</span>
          </button>
          <div style="flex: 1; min-width: 0;">
            <input type="text" class="subitem-direct-note-input" value="${escapeHtml(execNote)}" placeholder="Nhập ghi chú kiểm tra..." onchange="saveSubItemDirectNote(${item.id}, this.value)" onkeydown="if(event.key==='Enter'){this.blur();}">
          </div>
        </div>

        <!-- DÒNG 3: Hình ảnh mẫu, Hình ảnh thực tế kế bên, Nút chụp / chụp lại tách riêng -->
        <div class="subitem-line-3" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
          ${hasSample ? `
            <div class="subitem-photo-thumb thumb-sop" onclick="openLightbox('${sampleUrl}', 'Ảnh mẫu chuẩn SOP: ${escapeHtml(item.ItemTitle)}')" title="Bấm để xem ảnh mẫu chuẩn SOP">
              <img src="${sampleUrl}" alt="Ảnh SOP">
              <span class="thumb-badge-sop">SOP</span>
            </div>
          ` : (!isSingleTask ? `
            <div class="subitem-photo-thumb thumb-sop-placeholder" onclick="triggerSubItemCapture(${item.id}, false, '${escapeHtml(item.ItemTitle)}', '', '${escapeHtml(guideline)}', '${actualImgUrl}')" title="Chưa có ảnh SOP. Bấm để mở cửa sổ đối chiếu / chụp">
              <span style="font-size: 0.68rem; color: #94A3B8; text-align: center; padding: 4px; line-height: 1.2;">📋 SOP Chưa có</span>
            </div>
          ` : '')}

          ${hasActualPhoto ? `
            <div class="subitem-photo-thumb thumb-actual" onclick="openChecklistPhotoViewer(${item.id})" title="Bấm để xem ảnh phóng to">
              <img src="${actualImgUrl}" alt="Ảnh thực tế">
              <span class="thumb-badge-zoom" title="Phóng to">🔍</span>
            </div>
          ` : ''}

          <!-- Nút Chụp Ảnh / Chụp Lại tách riêng -->
          ${hasActualPhoto ? `
            <button type="button" class="btn-sub-camera btn-camera-retake" onclick="triggerSubItemCapture(${item.id}, ${isSingleTask ? 'true' : 'false'}, '${escapeHtml(item.ItemTitle)}', '${sampleUrl}', '${escapeHtml(guideline)}', '${actualImgUrl}')" title="Chụp lại ảnh cho hạng mục này">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              <span>Chụp Lại</span>
            </button>
          ` : `
            <button type="button" class="btn-sub-camera btn-camera-new" onclick="triggerSubItemCapture(${item.id}, ${isSingleTask ? 'true' : 'false'}, '${escapeHtml(item.ItemTitle)}', '${sampleUrl}', '${escapeHtml(guideline)}', '')" title="${isSingleTask ? 'Mở camera chụp ảnh trực tiếp' : 'Mở cửa sổ chụp ảnh có ảnh mẫu SOP'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              <span>Chụp Ảnh</span>
            </button>
          `}
        </div>

        <!-- DÒNG 4: Hàng cuối là Tên người thực hiện, phân công KTV, thời gian -->
        <div class="subitem-line-4" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.08); font-size: 0.74rem; color: var(--text-muted); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 140px;">
            <span style="font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0;">👷 Phân công:</span>
            <select class="subitem-assignee-select" onchange="assignSubItemKTV(${item.id}, this.value, ${currentEditingTask ? currentEditingTask.id : 0})"
              style="background: rgba(255, 255, 255, 0.06); border: 1px solid var(--border-subtle); color: #E2E8F0; border-radius: 4px; padding: 2px 6px; font-size: 0.73rem; outline: none; max-width: 180px; text-overflow: ellipsis; cursor: pointer;"
              title="Bấm để phân công nhân viên kỹ thuật thực hiện hạng mục này">
              ${buildAssigneeOptionsForGroup(modalTaskGroupId, item.AssignedTo || item.CompletedBy || '', '-- Chưa gán KTV --')}
            </select>
          </div>
          <div>
            ${isDone && item.CompletedAt ? `
              <span class="badge-comp-time" style="font-size: 0.74rem; padding: 2px 6px;">
                ✓ ${formatDateTime(item.CompletedAt)}
              </span>
            ` : (item.UpdatedAt ? `
              <span style="font-size: 0.72rem; color: var(--text-muted);">
                ⏱️ ${formatDateTime(item.UpdatedAt)}
              </span>
            ` : '')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Alias hỗ trợ gọi lại danh sách hạng mục con trong modal
function renderDetailSubItems(items) {
  const targetItems = items || (currentEditingTask && currentEditingTask.items) || [];
  return renderDetailChecklist(targetItems);
}

// =========================================================================
// HỘP KIỂM ĐỐI CHIẾU SOP & MỞ CAMERA CHỤP ẢNH SO SÁNH (CÓ THỂ CHỤP LẠI)
// =========================================================================
let currentDirectCameraSubItemId = null;
let currentDirectCameraSubItemTitle = '';

function triggerSubItemCapture(itemId, isSingleTask, itemTitle, sampleUrl, guideline, actualUrl) {
  let item = null;
  if (currentEditingTask && currentEditingTask.items) {
    item = currentEditingTask.items.find(i => i.id == itemId);
  }
  if (!item && typeof allTasks !== 'undefined' && Array.isArray(allTasks)) {
    for (const t of allTasks) {
      if (t.items) {
        item = t.items.find(i => i.id == itemId);
        if (item) break;
      }
    }
  }

  const title = item ? item.ItemTitle : (itemTitle || '');
  const sample = item ? (item.SampleImageUrl || '') : (sampleUrl || '');
  const guide = item ? (item.StandardGuideline || '') : (guideline || '');
  const actual = item ? (item.ActualImageUrl || '') : (actualUrl || '');
  const single = isSingleTask !== undefined ? isSingleTask : !(currentEditingTask && (currentEditingTask.RecurringTemplateID || currentEditingTask.TaskType === 'PREVENTIVE'));

  // Đối với công việc 1 lần (single task và không có SOP): mở camera chụp trực tiếp
  if (single && !sample) {
    currentDirectCameraSubItemId = itemId;
    currentDirectCameraSubItemTitle = title;
    let camInput = document.getElementById('subitemDirectCameraInput');
    if (!camInput) {
      camInput = document.createElement('input');
      camInput.type = 'file';
      camInput.id = 'subitemDirectCameraInput';
      camInput.accept = 'image/*';
      camInput.setAttribute('capture', 'environment');
      camInput.style.display = 'none';
      camInput.onchange = handleSubitemDirectPhotoCaptured;
      document.body.appendChild(camInput);
    }
    camInput.click();
  } else {
    // Công việc định kỳ hoặc có ảnh mẫu SOP: mở cửa sổ chụp ảnh có ảnh mẫu SOP đối chiếu
    openSubItemCompareModal(itemId, title, sample, guide, actual);
  }
}
let currentCompareItemId = null;
let currentCompareItemTitle = '';
let currentCompareSampleUrl = '';
let currentCompareGuideline = '';
let currentCompareActualUrl = '';
let liveCamStream = null;
let currentCamFacing = 'environment'; // 'environment' (sau) hoặc 'user' (trước)
let currentGhostOpacity = 0.5; // mặc định 50%

function isLiveCamSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function openSubItemCompareModal(itemId, itemTitle, sampleImageUrl = '', guideline = '', actualImageUrl = '') {
  currentCompareItemId = itemId;
  currentCompareItemTitle = itemTitle || '';
  currentCompareSampleUrl = sampleImageUrl || '';
  currentCompareGuideline = guideline || '';
  currentCompareActualUrl = actualImageUrl || '';

  // Tìm task và item tương ứng
  let itemObj = null;
  if (currentEditingTask && currentEditingTask.items) {
    itemObj = currentEditingTask.items.find(it => it.id == itemId);
  }
  if (!itemObj && typeof allTasks !== 'undefined' && Array.isArray(allTasks)) {
    for (const t of allTasks) {
      if (t.items) {
        const found = t.items.find(it => it.id == itemId);
        if (found) {
          itemObj = found;
          if (!currentEditingTask) currentEditingTask = t;
          break;
        }
      }
    }
  }

  if (itemObj) {
    if (!currentCompareItemTitle && itemObj.ItemTitle) currentCompareItemTitle = itemObj.ItemTitle;
    if (!currentCompareSampleUrl && itemObj.SampleImageUrl) currentCompareSampleUrl = itemObj.SampleImageUrl;
    if (!currentCompareGuideline && itemObj.StandardGuideline) currentCompareGuideline = itemObj.StandardGuideline;
    if (itemObj.ActualImageUrl) currentCompareActualUrl = itemObj.ActualImageUrl;
  }

  // Tìm ảnh thực tế nếu chưa có
  if (!currentCompareActualUrl && currentEditingTask) {
    if (currentEditingTask.items) {
      const foundIt = currentEditingTask.items.find(it => it.id == itemId);
      if (foundIt && foundIt.ActualImageUrl) currentCompareActualUrl = foundIt.ActualImageUrl;
    }
    if (!currentCompareActualUrl && currentEditingTask.images) {
      const found = currentEditingTask.images.find(img => img.TaskItemID == itemId);
      if (found) currentCompareActualUrl = found.FileUrl;
    }
  }

  const modal = document.getElementById('subItemCompareModal');
  if (!modal) return;

  const idInp = document.getElementById('compareModalItemId');
  if (idInp) idInp.value = itemId || '';

  // 1. Điền Khối Thông Tin Mô Tả Chi Tiết Công Việc & Hạng Mục
  const titleEl = document.getElementById('compareModalItemTitleText');
  if (titleEl) titleEl.textContent = currentCompareItemTitle || 'Hạng mục kiểm tra';

  const machineName = currentEditingTask ? (currentEditingTask.MachineName || '') : '';
  const taskCode = currentEditingTask ? (currentEditingTask.TaskCode || (currentEditingTask.id ? ('#' + currentEditingTask.id) : '')) : '';
  const dept = (itemObj && itemObj.Department) ? itemObj.Department : (currentEditingTask ? (currentEditingTask.Department || '') : '');
  const taskDesc = currentEditingTask ? (currentEditingTask.Description || '') : '';
  const itemNote = itemObj ? (itemObj.Note || itemObj.Notes || '') : '';

  const machBadge = document.getElementById('compareModalMachineBadge');
  const machText = document.getElementById('compareModalMachineNameText');
  if (machBadge && machText) {
    if (machineName) {
      machText.textContent = machineName;
      machBadge.style.display = 'inline-flex';
    } else {
      machBadge.style.display = 'none';
    }
  }

  const codeBadge = document.getElementById('compareModalTaskCodeBadge');
  const codeText = document.getElementById('compareModalTaskCodeText');
  if (codeBadge && codeText) {
    if (taskCode) {
      codeText.textContent = taskCode;
      codeBadge.style.display = 'inline-flex';
    } else {
      codeBadge.style.display = 'none';
    }
  }

  const deptBadge = document.getElementById('compareModalDeptBadge');
  const deptText = document.getElementById('compareModalDeptText');
  if (deptBadge && deptText) {
    if (dept) {
      deptText.textContent = dept;
      deptBadge.style.display = 'inline-flex';
    } else {
      deptBadge.style.display = 'none';
    }
  }

  // Dòng Tiêu chuẩn SOP
  const guideRow = document.getElementById('compareModalGuidelineRow');
  const guideText = document.getElementById('compareModalGuidelineText');
  if (guideRow && guideText) {
    if (currentCompareGuideline) {
      guideText.textContent = currentCompareGuideline;
      guideRow.style.display = 'block';
    } else {
      guideRow.style.display = 'none';
    }
  }

  // Dòng Ghi chú thực hiện riêng của hạng mục
  const noteRow = document.getElementById('compareModalItemNoteRow');
  const noteText = document.getElementById('compareModalItemNoteText');
  if (noteRow && noteText) {
    if (itemNote) {
      noteText.textContent = itemNote;
      noteRow.style.display = 'block';
    } else {
      noteRow.style.display = 'none';
    }
  }

  // Dòng Mô tả sự cố máy / Nội dung yêu cầu chung
  const descRow = document.getElementById('compareModalTaskDescRow');
  const descText = document.getElementById('compareModalTaskDescText');
  if (descRow && descText) {
    if (taskDesc) {
      descText.textContent = taskDesc;
      descRow.style.display = 'block';
    } else {
      descRow.style.display = 'none';
    }
  }

  // 2. Cấu hình Cột 1: Ảnh Mẫu SOP
  const sopImg = document.getElementById('compareSOPImg');
  const sopPlaceholder = document.getElementById('compareSOPPlaceholder');
  const sopZoomBadge = document.getElementById('compareSOPZoomBadge');

  if (currentCompareSampleUrl) {
    if (sopImg) {
      sopImg.src = currentCompareSampleUrl;
      sopImg.style.display = 'block';
    }
    if (sopPlaceholder) sopPlaceholder.style.display = 'none';
    if (sopZoomBadge) sopZoomBadge.style.display = 'block';
  } else {
    if (sopImg) {
      sopImg.src = '';
      sopImg.style.display = 'none';
    }
    if (sopPlaceholder) sopPlaceholder.style.display = 'block';
    if (sopZoomBadge) sopZoomBadge.style.display = 'none';
  }

  // 3. Cấu hình Cột 2: Ảnh Thực Tế
  stopLiveCamera(); // Tắt stream camera cũ nếu có
  updateCompareModalActualPreview(currentCompareActualUrl);

  showModal(modal);
}

function updateCompareModalActualPreview(url) {
  const actualImg = document.getElementById('compareActualImg');
  const actualPlaceholder = document.getElementById('compareActualPlaceholder');
  const actualZoomBadge = document.getElementById('compareActualZoomBadge');
  const actualBadge = document.getElementById('compareActualBadge');
  const actualTapHint = document.getElementById('compareActualTapHint');
  const btnCamText = document.getElementById('btnCompareOpenCamText');
  const btnLiveCam = document.getElementById('btnCompareLiveCam');

  if (url) {
    if (actualImg) {
      actualImg.src = url;
      actualImg.style.display = 'block';
    }
    if (actualPlaceholder) actualPlaceholder.style.display = 'none';
    if (actualZoomBadge) actualZoomBadge.style.display = 'block';
    if (actualTapHint) actualTapHint.style.display = 'block';
    if (actualBadge) {
      actualBadge.textContent = '✓ ĐÃ CÓ ẢNH';
      actualBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      actualBadge.style.color = '#34D399';
    }
    if (btnCamText) btnCamText.textContent = 'Chụp Lại';
    if (btnLiveCam) btnLiveCam.title = 'Mở live camera đè mờ ảnh mẫu để chụp lại';
  } else {
    if (actualImg) {
      actualImg.src = '';
      actualImg.style.display = 'none';
    }
    if (actualPlaceholder) actualPlaceholder.style.display = 'block';
    if (actualZoomBadge) actualZoomBadge.style.display = 'none';
    if (actualTapHint) actualTapHint.style.display = 'none';
    if (actualBadge) {
      actualBadge.textContent = 'CHƯA CHỤP';
      actualBadge.style.background = 'rgba(255, 255, 255, 0.08)';
      actualBadge.style.color = 'var(--text-muted)';
    }
    if (btnCamText) btnCamText.textContent = 'Camera Máy';
    if (btnLiveCam) btnLiveCam.title = 'Mở camera trực tiếp đè mờ ảnh mẫu để căn góc chụp chuẩn xác';
  }
}

function triggerCompareModalCamera() {
  const camInp = document.getElementById('compareModalCameraInput');
  if (camInp) {
    camInp.value = '';
    camInp.click();
  }
}

async function uploadComparePhotoBlob(file) {
  if (!file || !currentEditingTask) return;

  const itemId = currentCompareItemId;
  const itemTitle = currentCompareItemTitle;

  showToast(`📸 Đang xử lý & nén lưu ảnh chụp cho "${itemTitle || 'hạng mục'}"...`, 'info');

  try {
    file = await compressImageFile(file);
  } catch (e) {
    console.warn('Lỗi nén ảnh đối chiếu:', e);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('image_type', 'AFTER');
  formData.append('caption', `Ảnh thực hiện: ${itemTitle || ''}`);
  if (itemId) {
    formData.append('task_item_id', itemId);
  }

  try {
    const res = await fetch(`/api/internal-tasks/${currentEditingTask.id}/photos`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });

    let data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error(`Lỗi kết nối máy chủ (Mã lỗi: ${res.status})`);
    }

    if (!res.ok) throw new Error(data.detail || data.message || 'Lỗi tải ảnh lên');

    // Tự động đánh dấu công việc đang xử lý nếu còn ở trạng thái chờ
    if (currentEditingTask.Status === 'PENDING' || currentEditingTask.Status === 'HOLD') {
      try {
        await fetch(`/api/internal-tasks/${currentEditingTask.id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ Status: 'IN_PROGRESS' })
        });
        currentEditingTask.Status = 'IN_PROGRESS';
      } catch (e) { }
    }

    currentCompareActualUrl = data.file_url;
    updateCompareModalActualPreview(data.file_url);

    // Cập nhật ngay trong memory của currentEditingTask và allTasks
    if (itemId && currentEditingTask) {
      if (currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.ActualImageUrl = data.file_url;
          it.Status = 'COMPLETED';
        }
      }
      if (currentEditingTask.images) {
        // Xóa ảnh cũ của hạng mục con này khỏi danh sách ảnh chung
        currentEditingTask.images = currentEditingTask.images.filter(img => img.TaskItemID != itemId);
        // Thêm ảnh mới vào đầu danh sách
        currentEditingTask.images.unshift({
          id: data.image_id,
          TaskID: currentEditingTask.id,
          TaskItemID: itemId,
          FileUrl: data.file_url,
          FileName: data.filename,
          ImageType: 'AFTER',
          Caption: `Ảnh thực hiện: ${itemTitle || ''}`
        });
      }
      const tIdx = (typeof allTasks !== 'undefined' && Array.isArray(allTasks)) ? allTasks.findIndex(t => t.id == currentEditingTask.id) : -1;
      if (tIdx !== -1) {
        allTasks[tIdx] = { ...currentEditingTask };
      }
    }

    showToast(`✅ Đã lưu ảnh thành công! 2 ảnh đang được hiển thị đối chiếu.`, 'success');

    // Cập nhật lại chi tiết công việc để cập nhật thumbnail ở dòng checklist và thư viện ảnh chung
    if (currentEditingTask && currentEditingTask.id) {
      await renderDesktopTaskDetail(currentEditingTask.id);
      if (typeof renderDetailChecklist === 'function' && currentEditingTask.items) {
        renderDetailChecklist(currentEditingTask.items);
      }
      if (typeof renderTaskPhotos === 'function' && currentEditingTask.images) {
        renderTaskPhotos(currentEditingTask.images);
      }
      await loadTasks();
    }
  } catch (err) {
    console.error('Lỗi tự động lưu ảnh:', err);
    showToast(`Lỗi lưu ảnh: ${err.message}`, 'error');
  }
}

async function handleCompareModalPhotoCaptured(e) {
  const file = e.target.files?.[0];
  if (file) {
    await uploadComparePhotoBlob(file);
  }
  e.target.value = '';
}

// -------------------------------------------------------------------------
// CÁC HÀM XỬ LÝ LIVE CAMERA & GHOST OVERLAY ĐÈ MỜ ẢNH MẪU
// -------------------------------------------------------------------------
async function startLiveCamera() {
  if (!isLiveCamSupported()) {
    showToast('Trình duyệt hiện tại không hỗ trợ Live Camera trực tiếp (yêu cầu kết nối HTTPS bảo mật hoặc hỗ trợ MediaDevices). Bạn hãy bấm "Camera Máy" để chụp ảnh bình thường.', 'warning');
    return;
  }

  const staticBox = document.getElementById('compareActualStaticBox');
  const liveBox = document.getElementById('compareLiveCamBox');
  const video = document.getElementById('compareLiveVideo');
  const ghostImg = document.getElementById('compareGhostOverlayImg');

  stopLiveCameraStreamOnly();

  try {
    const constraints = {
      video: {
        facingMode: { ideal: currentCamFacing },
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    };

    liveCamStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (video) {
      video.srcObject = liveCamStream;
      await video.play();
    }

    if (staticBox) staticBox.style.display = 'none';
    if (liveBox) liveBox.style.display = 'flex';

    // Cấu hình ảnh mẫu đè mờ (Ghost Overlay)
    if (ghostImg) {
      if (currentCompareSampleUrl) {
        ghostImg.src = currentCompareSampleUrl;
        ghostImg.style.display = currentGhostOpacity > 0 ? 'block' : 'none';
        ghostImg.style.opacity = currentGhostOpacity;
      } else {
        ghostImg.src = '';
        ghostImg.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Lỗi khởi động Live Camera:', err);
    let msg = 'Không thể mở Camera.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = 'Bạn chưa cấp quyền truy cập Camera cho trang web. Vui lòng cho phép quyền Camera trong cài đặt trình duyệt.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = 'Không tìm thấy thiết bị Camera trên máy này.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      msg = 'Camera đang bị ứng dụng khác sử dụng.';
    }
    showToast(msg, 'error');
    stopLiveCamera();
  }
}

function stopLiveCameraStreamOnly() {
  if (liveCamStream) {
    liveCamStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) { }
    });
    liveCamStream = null;
  }
  const video = document.getElementById('compareLiveVideo');
  if (video) {
    video.srcObject = null;
  }
}

function stopLiveCamera() {
  stopLiveCameraStreamOnly();
  const staticBox = document.getElementById('compareActualStaticBox');
  const liveBox = document.getElementById('compareLiveCamBox');
  if (liveBox) liveBox.style.display = 'none';
  if (staticBox) staticBox.style.display = 'flex';
}

async function switchCameraFacing() {
  currentCamFacing = (currentCamFacing === 'environment') ? 'user' : 'environment';
  if (liveCamStream) {
    await startLiveCamera();
  }
}

function setGhostOpacity(level) {
  currentGhostOpacity = level;
  const ghostImg = document.getElementById('compareGhostOverlayImg');
  if (ghostImg) {
    ghostImg.style.opacity = level;
    ghostImg.style.display = (level > 0 && currentCompareSampleUrl) ? 'block' : 'none';
  }
  const btns = document.querySelectorAll('.btn-ghost-op');
  btns.forEach(btn => {
    const val = parseFloat(btn.dataset.op || '0');
    if (Math.abs(val - level) < 0.05) {
      btn.style.background = '#6366F1';
      btn.style.color = '#FFF';
      btn.style.borderColor = '#818CF8';
      btn.style.fontWeight = '700';
    } else {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.color = 'var(--text-muted)';
      btn.style.borderColor = 'rgba(255,255,255,0.15)';
      btn.style.fontWeight = 'normal';
    }
  });
}

async function captureAndSaveLiveCamera() {
  const video = document.getElementById('compareLiveVideo');
  if (!video || !video.videoWidth || !video.videoHeight) {
    showToast('Camera chưa sẵn sàng, vui lòng đợi trong giây lát!', 'warning');
    return;
  }

  try {
    let targetW = video.videoWidth;
    let targetH = video.videoHeight;
    const maxDim = 1600;
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, targetW, targetH);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('Lỗi xuất khung hình chụp!', 'error');
        return;
      }
      const file = new File([blob], `task_proof_${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopLiveCamera();
      await uploadComparePhotoBlob(file);
    }, 'image/jpeg', 0.82);
  } catch (err) {
    console.error('Lỗi khi chụp từ live camera:', err);
    showToast('Lỗi khi chụp ảnh từ camera: ' + err.message, 'error');
  }
}

function closeSubItemCompareModal() {
  stopLiveCamera();
  const modal = document.getElementById('subItemCompareModal');
  if (modal) hideModal(modal);
  currentCompareItemId = null;
  currentCompareItemTitle = '';
  currentCompareActualUrl = '';
}

function triggerDirectSubItemCamera(itemId, itemTitle) {
  const item = (currentEditingTask && currentEditingTask.items) ? currentEditingTask.items.find(it => it.id == itemId) : null;
  openSubItemCompareModal(itemId, itemTitle, item?.SampleImageUrl || '', item?.StandardGuideline || '', item?.ActualImageUrl || '');
}

async function autoSaveSubItemPhoto(file, itemId, itemTitle) {
  if (!file || !currentEditingTask) return;

  showToast(`📸 Đang xử lý & nén lưu ảnh chụp cho "${itemTitle || 'hạng mục'}"...`, 'info');

  try {
    file = await compressImageFile(file);
  } catch (e) {
    console.warn('Lỗi nén ảnh autoSave:', e);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('image_type', 'AFTER');
  formData.append('caption', `Ảnh thực hiện: ${itemTitle || ''}`);
  if (itemId) {
    formData.append('task_item_id', itemId);
  }

  try {
    const res = await fetch(`/api/internal-tasks/${currentEditingTask.id}/photos`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData
    });

    let data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error(`Lỗi kết nối máy chủ (Mã lỗi: ${res.status})`);
    }

    if (!res.ok) throw new Error(data.detail || data.message || 'Lỗi tải ảnh lên');

    // Tự động đánh dấu công việc đang xử lý nếu còn ở trạng thái chờ
    if (currentEditingTask.Status === 'PENDING' || currentEditingTask.Status === 'HOLD') {
      try {
        await fetch(`/api/internal-tasks/${currentEditingTask.id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ Status: 'IN_PROGRESS' })
        });
        currentEditingTask.Status = 'IN_PROGRESS';
      } catch (e) { }
    }

    // Cập nhật ngay trong memory
    if (itemId && currentEditingTask) {
      if (currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.ActualImageUrl = data.file_url;
          it.Status = 'COMPLETED';
        }
      }
      if (currentEditingTask.images) {
        currentEditingTask.images = currentEditingTask.images.filter(img => img.TaskItemID != itemId);
        currentEditingTask.images.unshift({
          id: data.image_id,
          TaskID: currentEditingTask.id,
          TaskItemID: itemId,
          FileUrl: data.file_url,
          FileName: data.filename,
          ImageType: 'AFTER',
          Caption: `Ảnh thực hiện: ${itemTitle || ''}`
        });
      }
      const tIdx = (typeof allTasks !== 'undefined' && Array.isArray(allTasks)) ? allTasks.findIndex(t => t.id == currentEditingTask.id) : -1;
      if (tIdx !== -1) {
        allTasks[tIdx] = { ...currentEditingTask };
      }
    }

    showToast(`✅ Đã chụp và lưu ảnh cho "${itemTitle || 'hạng mục'}" thành công!`, 'success');

    // Reload task detail để cập nhật ảnh trong thư viện ảnh công việc & trạng thái sub-item
    if (currentEditingTask && currentEditingTask.id) {
      await renderDesktopTaskDetail(currentEditingTask.id);
      if (typeof renderDetailChecklist === 'function' && currentEditingTask.items) {
        renderDetailChecklist(currentEditingTask.items);
      }
      if (typeof renderTaskPhotos === 'function' && currentEditingTask.images) {
        renderTaskPhotos(currentEditingTask.images);
      }
      await loadTasks();
    }
  } catch (err) {
    console.error('Lỗi tự động lưu ảnh:', err);
    showToast(`Lỗi lưu ảnh: ${err.message}`, 'error');
  }
}

async function handleSubitemDirectPhotoCaptured(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const itemId = currentDirectCameraSubItemId;
  const itemTitle = currentDirectCameraSubItemTitle;
  try {
    await autoSaveSubItemPhoto(file, itemId, itemTitle);
  } finally {
    currentDirectCameraSubItemId = null;
    currentDirectCameraSubItemTitle = '';
    e.target.value = '';
  }
}

async function toggleItemCompleted(itemId, isCompleted) {
  try {
    const newStatus = isCompleted ? 'COMPLETED' : 'PENDING';
    const payload = {
      Status: newStatus
    };
    if (isCompleted && currentUser) {
      if (currentUser.full_name) payload.AssignedTo = currentUser.full_name;
      if (currentUser.emp_id) payload.AssignedEmpID = currentUser.emp_id;
    }
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi cập nhật trạng thái hạng mục');

    // Tự động chuyển trạng thái công việc sang 'IN_PROGRESS' (Đang thực hiện) nếu đang là PENDING hoặc HOLD
    if (currentEditingTask && (currentEditingTask.Status === 'PENDING' || currentEditingTask.Status === 'HOLD')) {
      try {
        await fetch(`/api/internal-tasks/${currentEditingTask.id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ Status: 'IN_PROGRESS' })
        });
        currentEditingTask.Status = 'IN_PROGRESS';
      } catch (autoErr) {
        console.warn('Lỗi tự chuyển trạng thái sang Đang thực hiện:', autoErr);
      }
    }

    showToast(isCompleted ? 'Đã hoàn thành hạng mục!' : 'Đã chuyển hạng mục về chưa hoàn thành', 'info');
    if (currentEditingTask) {
      await renderDesktopTaskDetail(currentEditingTask.id);
    }
    await loadTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleDetailAddRow() {
  const box = document.getElementById('detailQuickAddBox');
  if (!box) return;
  if (box.style.display === 'none' || !box.style.display) {
    box.style.display = 'block';
    const titleInput = document.getElementById('detailNewItemTitle');
    if (titleInput) titleInput.focus();
  } else {
    box.style.display = 'none';
  }
}

async function submitAddDetailItem() {
  if (!currentEditingTask) return;
  const titleInput = document.getElementById('detailNewItemTitle');
  const descInput = document.getElementById('detailNewItemDesc');
  const assigneeSelect = document.getElementById('detailNewItemAssignee');
  const noteInput = document.getElementById('detailNewItemNote');

  const title = titleInput?.value.trim();
  if (!title) {
    showToast('Vui lòng nhập tên hạng mục công việc', 'warning');
    titleInput?.focus();
    return;
  }

  const payload = {
    ItemTitle: title,
    StandardGuideline: descInput?.value.trim() || '',
    AssignedTo: assigneeSelect?.value.trim() || '',
    Notes: noteInput?.value.trim() || ''
  };

  try {
    const res = await fetch(`/api/internal-tasks/${currentEditingTask.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi thêm hạng mục');

    // Tự động chuyển trạng thái công việc sang 'IN_PROGRESS' (Đang thực hiện) nếu đang là PENDING hoặc HOLD
    if (currentEditingTask && (currentEditingTask.Status === 'PENDING' || currentEditingTask.Status === 'HOLD')) {
      try {
        await fetch(`/api/internal-tasks/${currentEditingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Status: 'IN_PROGRESS' })
        });
        currentEditingTask.Status = 'IN_PROGRESS';
      } catch (autoErr) {
        console.warn('Lỗi tự chuyển trạng thái sang Đang thực hiện:', autoErr);
      }
    }

    showToast('Đã thêm hạng mục mới!', 'success');
    titleInput.value = '';
    if (descInput) descInput.value = '';
    if (noteInput) noteInput.value = '';
    toggleDetailAddRow();

    await openTaskDetail(currentEditingTask.id);
    await loadTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteDetailItem(itemId) {
  if (!confirm('Bạn có chắc muốn xóa hạng mục này?')) return;
  try {
    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi khi xóa hạng mục');

    showToast('Đã xóa hạng mục', 'info');
    if (currentEditingTask) {
      await openTaskDetail(currentEditingTask.id);
    }
    await loadTasks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function assignSubItemKTV(itemId, empName, taskId) {
  try {
    const cleanName = (empName || '').trim();
    let empId = '';
    if (cleanName && Array.isArray(allEmployees)) {
      const foundEmp = allEmployees.find(e => e.EmpName === cleanName || e.EmpID === cleanName);
      if (foundEmp) {
        empId = foundEmp.EmpID;
      }
    }

    const payload = {
      AssignedTo: cleanName,
      AssignedEmpID: empId
    };

    const res = await fetch(`/api/internal-tasks/items/${itemId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi cập nhật người thực hiện');

    showToast(cleanName ? `Đã phân công ${cleanName} thực hiện hạng mục` : 'Đã hủy phân công hạng mục', 'success');

    // Cập nhật lại trong bộ nhớ client để phản ánh tức thì
    if (taskId) {
      const taskInMem = allTasks.find(t => t.id == taskId);
      if (taskInMem && taskInMem.items) {
        const it = taskInMem.items.find(i => i.id == itemId);
        if (it) {
          it.AssignedTo = cleanName;
          it.AssignedEmpID = empId;
        }
      }
      if (currentEditingTask && currentEditingTask.id == taskId && currentEditingTask.items) {
        const it = currentEditingTask.items.find(i => i.id == itemId);
        if (it) {
          it.AssignedTo = cleanName;
          it.AssignedEmpID = empId;
        }
      }
    }

    // Tải lại task list & cập nhật scope counts
    await loadTasks();

    // Re-render chi tiết
    if (taskId) {
      renderDesktopTaskDetail(taskId);
      if (currentEditingTask && currentEditingTask.id == taskId && currentEditingTask.items) {
        renderDetailChecklist(currentEditingTask.items);
      }
    }
  } catch (err) {
    console.error('assignSubItemKTV error:', err);
    showToast(err.message, 'error');
  }
}

function closeTaskDetailModal() {
  const modal = document.getElementById('taskDetailModal');
  if (modal) hideModal(modal);
  document.body.classList.remove('mobile-view-detail');
  const taskId = currentEditingTask?.id;
  currentEditingTask = null;
  cancelPhotoUpload();
  if (taskId) {
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`) || document.querySelector(`tr[data-task-id="${taskId}"]`);
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

async function spawnNextCycleFromDetail() {
  if (!currentEditingTask || !currentEditingTask.RecurringTemplateID) return;
  await spawnTaskFromTemplate(currentEditingTask.RecurringTemplateID);
  await openTaskDetail(currentEditingTask.id);
}

async function navigateToRecurringTemplateFromModal() {
  const tplId = currentEditingTask?.RecurringTemplateID;
  if (!tplId) return;
  closeTaskDetailModal();
  switchTaskTabMode('recurring');
  await loadRecurringData();
  selectRecurringTemplate(tplId);
  setTimeout(() => {
    const card = document.querySelector(`#recurringMasterList .master-card[data-tpl-id="${tplId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 150);
}

function updateStatusDropdownStyle(selectEl, status) {
  if (!selectEl) return;
  const s = (status || 'PENDING').toUpperCase();
  if (s === 'PENDING') {
    selectEl.style.borderColor = 'rgba(245, 158, 11, 0.6)';
    selectEl.style.color = '#FBBF24';
    selectEl.style.backgroundColor = 'rgba(245, 158, 11, 0.12)';
  } else if (s === 'IN_PROGRESS') {
    selectEl.style.borderColor = 'rgba(59, 130, 246, 0.6)';
    selectEl.style.color = '#93C5FD';
    selectEl.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
  } else if (s === 'HOLD') {
    selectEl.style.borderColor = 'rgba(107, 114, 128, 0.6)';
    selectEl.style.color = '#D1D5DB';
    selectEl.style.backgroundColor = 'rgba(107, 114, 128, 0.15)';
  } else if (s === 'COMPLETED') {
    selectEl.style.borderColor = 'rgba(16, 185, 129, 0.6)';
    selectEl.style.color = '#34D399';
    selectEl.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
  } else if (s === 'CANCELLED') {
    selectEl.style.borderColor = 'rgba(239, 68, 68, 0.6)';
    selectEl.style.color = '#F87171';
    selectEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
  } else {
    selectEl.style.borderColor = 'rgba(99, 102, 241, 0.5)';
    selectEl.style.color = 'var(--text-primary)';
    selectEl.style.backgroundColor = 'rgba(17, 24, 39, 0.9)';
  }
}

async function quickCardAction(taskId, newStatus) {
  try {
    const res = await fetch(`/api/internal-tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể cập nhật trạng thái');

    showToast(data.message || `Đã chuyển trạng thái sang: ${newStatus}`, 'success');
    await loadTasks();
    await loadRecurringTemplates();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function quickUpdateStatus(arg1, arg2) {
  let taskId = null;
  let newStatus = null;

  if (arg2 !== undefined) {
    taskId = arg1;
    newStatus = arg2;
  } else {
    taskId = selectedTaskId || currentEditingTask?.id;
    newStatus = arg1;
  }

  if (!taskId || !newStatus) return;

  try {
    const res = await fetch(`/api/internal-tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể cập nhật trạng thái');

    if (currentEditingTask && currentEditingTask.id == taskId) {
      currentEditingTask.Status = newStatus;
    }

    const desktopStatusSelect = document.getElementById('desktopDetailStatusSelect');
    if (desktopStatusSelect) {
      desktopStatusSelect.value = newStatus;
    }

    const statusLabels = {
      PENDING: { text: 'Chờ Xử Lý', class: 'badge-status-pending' },
      IN_PROGRESS: { text: 'Đang Thực Hiện', class: 'badge-status-inprogress' },
      HOLD: { text: 'Tạm Hoãn', class: 'badge-status-hold' },
      COMPLETED: { text: 'Hoàn Tất Nghiệm Thu', class: 'badge-status-completed' },
      CANCELLED: { text: 'Hủy', class: 'badge-status-cancelled' }
    };
    const sInfo = statusLabels[newStatus] || { text: newStatus, class: 'badge-status-pending' };

    showToast(data.message || `Đã chuyển trạng thái: ${sInfo.text}`, 'success');
    await loadTasks();
    renderDesktopTaskDetail(taskId);
    await loadRecurringTemplates();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function submitUpdateTaskDetail(e) {
  e.preventDefault();
  if (!currentEditingTask) return;

  const statusVal = document.getElementById('modalDetailStatusSelect')?.value || currentEditingTask.Status;
  const payload = {
    Status: statusVal,
    AssignedTo: document.getElementById('modalDetailAssignedTo').value.trim(),
    DowntimeMinutes: document.getElementById('modalDetailDowntime').value ? Number(document.getElementById('modalDetailDowntime').value) : 0,
    Solution: document.getElementById('modalDetailSolution').value.trim()
  };

  try {
    const res = await fetch(`/api/internal-tasks/${currentEditingTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể lưu cập nhật xử lý');

    showToast(data.message || 'Đã lưu thông tin xử lý công việc thành công!', 'success');
    await openTaskDetail(currentEditingTask.id);
    await loadTasks();
    await loadRecurringTemplates();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// PHOTOS MANAGEMENT & NAS STORAGE
// =========================================================================
function renderTaskPhotos(images) {
  const grid = document.getElementById('modalPhotosGrid');
  const countEl = document.getElementById('modalPhotoCount');
  if (countEl) countEl.textContent = `${images.length} ảnh`;
  if (!grid) return;

  if (images.length === 0) {
    grid.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; grid-column: 1 / -1;">Chưa có hình ảnh nào được đính kèm.</div>';
    return;
  }

  grid.innerHTML = images.map(img => `
    <div style="position: relative; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border-subtle); background: #000; cursor: pointer;" onclick="openTaskGeneralPhotoViewer(${img.id}, ${currentEditingTask ? currentEditingTask.id : 'null'})">
      <img src="${img.FileUrl}" style="width: 100%; height: 100px; object-fit: cover; display: block;">
      <div style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.7); font-size: 0.68rem; font-weight: 700; color: ${img.ImageType === 'BEFORE' ? '#F87171' : '#34D399'}; padding: 2px 6px; border-radius: 3px;">
        ${img.ImageType === 'BEFORE' ? 'TRƯỚC' : 'SAU'}
      </div>
      <button type="button" onclick="event.stopPropagation(); deleteGeneralPhoto(${img.id}, ${currentEditingTask ? currentEditingTask.id : 'null'})" title="Xóa ảnh này khỏi mục chung"
        style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; background: rgba(239, 68, 68, 0.9); color: #FFF; border: none; font-size: 13px; font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.6); z-index: 5; line-height: 1; transition: transform 0.15s ease;"
        onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
        ✕
      </button>
      ${img.Caption ? `<div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.75); font-size: 0.68rem; color: #FFF; padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(img.Caption)}</div>` : ''}
    </div>
  `).join('');
}

function triggerPhotoUpload() {
  document.getElementById('taskPhotoFileInput')?.click();
}

function handlePhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  selectedPhotoFile = file;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const previewBox = document.getElementById('photoUploadPreviewBox');
    const thumb = document.getElementById('photoUploadThumb');
    if (previewBox && thumb) {
      thumb.src = evt.target.result;
      previewBox.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

function cancelPhotoUpload() {
  selectedPhotoFile = null;
  const fileInput = document.getElementById('taskPhotoFileInput');
  if (fileInput) fileInput.value = '';
  const previewBox = document.getElementById('photoUploadPreviewBox');
  if (previewBox) previewBox.style.display = 'none';
  const captionInput = document.getElementById('photoUploadCaption');
  if (captionInput) captionInput.value = '';
}

async function submitUploadPhoto() {
  if (!selectedPhotoFile || !currentEditingTask) {
    showToast('Chưa chọn tệp ảnh để tải lên', 'warning');
    return;
  }

  showToast('Đang nén & chuẩn bị ảnh...', 'info');
  let file = selectedPhotoFile;
  try {
    file = await compressImageFile(file);
  } catch (e) {
    console.warn('Lỗi nén ảnh modal:', e);
  }

  const photoType = document.querySelector('input[name="uploadPhotoType"]:checked')?.value || 'BEFORE';
  const caption = document.getElementById('photoUploadCaption')?.value.trim() || '';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('image_type', photoType);
  formData.append('caption', caption);

  showToast('Đang tải ảnh và đồng bộ...', 'info');

  try {
    const res = await fetch(`/api/internal-tasks/${currentEditingTask.id}/photos`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi tải ảnh lên máy chủ');

    showToast('Tải ảnh hiện trường thành công!', 'success');
    cancelPhotoUpload();
    await openTaskDetail(currentEditingTask.id);
    await loadTasks();
  } catch (err) {
    console.error('Lỗi tải ảnh:', err);
    showToast(err.message || 'Không thể tải ảnh lên', 'error');
  }
}

// =========================================================================
// LIGHTBOX MODAL & ALBUM DUYỆT ẢNH CÁC HẠNG MỤC CON
// =========================================================================
let currentGalleryPhotos = [];
let currentGalleryIndex = 0;

function getTaskChecklistPhotos(task) {
  if (!task || !task.items) return [];
  const photos = [];
  const images = task.images || [];

  task.items.forEach((item, idx) => {
    const matchedPhoto = images.find(img => img.TaskItemID == item.id) || (item.ActualImageUrl ? { FileUrl: item.ActualImageUrl } : null);
    const actualImgUrl = item.ActualImageUrl || (matchedPhoto ? matchedPhoto.FileUrl : '');
    if (actualImgUrl) {
      photos.push({
        itemId: item.id,
        itemIndex: item.ItemOrder || (idx + 1),
        itemTitle: item.ItemTitle || `Hạng mục ${idx + 1}`,
        guideline: (item.StandardGuideline || '').trim(),
        note: (item.Note || item.Notes || '').trim(),
        performer: item.CompletedBy || item.AssignedTo || '',
        completedAt: item.CompletedAt || '',
        imgUrl: actualImgUrl
      });
    }
  });
  return photos;
}

function openChecklistPhotoViewer(itemId) {
  const task = currentEditingTask || (allTasks && allTasks.find(t => t.items && t.items.some(i => i.id == itemId)));
  if (!task) return;

  currentGalleryPhotos = getTaskChecklistPhotos(task);
  if (!currentGalleryPhotos || currentGalleryPhotos.length === 0) {
    return;
  }

  const foundIdx = currentGalleryPhotos.findIndex(p => p.itemId == itemId);
  currentGalleryIndex = foundIdx >= 0 ? foundIdx : 0;

  renderGalleryPhoto();

  const modal = document.getElementById('lightboxModal');
  if (modal) {
    showModal(modal);
  }
}

function renderGalleryPhoto() {
  if (!currentGalleryPhotos || currentGalleryPhotos.length === 0) return;
  if (currentGalleryIndex < 0) currentGalleryIndex = 0;
  if (currentGalleryIndex >= currentGalleryPhotos.length) currentGalleryIndex = currentGalleryPhotos.length - 1;

  const photo = currentGalleryPhotos[currentGalleryIndex];
  const total = currentGalleryPhotos.length;

  const imgEl = document.getElementById('lightboxImg');
  const counterEl = document.getElementById('lightboxCounter');
  const prevBtn = document.getElementById('lightboxBtnPrev');
  const nextBtn = document.getElementById('lightboxBtnNext');

  const titleEl = document.getElementById('lightboxItemTitle');
  const guidelineEl = document.getElementById('lightboxItemGuideline');
  const noteEl = document.getElementById('lightboxItemNote');
  const metaEl = document.getElementById('lightboxItemMeta');

  if (imgEl) {
    imgEl.src = photo.imgUrl;
    imgEl.alt = photo.itemTitle || 'Ảnh chụp hạng mục';
  }

  if (counterEl) {
    counterEl.textContent = `Ảnh ${currentGalleryIndex + 1} / ${total}`;
    counterEl.style.display = total > 1 ? 'block' : 'none';
  }

  if (prevBtn) {
    prevBtn.style.display = total > 1 ? 'flex' : 'none';
    prevBtn.style.opacity = currentGalleryIndex > 0 ? '1' : '0.35';
    prevBtn.disabled = currentGalleryIndex === 0;
  }

  if (nextBtn) {
    nextBtn.style.display = total > 1 ? 'flex' : 'none';
    nextBtn.style.opacity = currentGalleryIndex < total - 1 ? '1' : '0.35';
    nextBtn.disabled = currentGalleryIndex === total - 1;
  }

  if (titleEl) {
    if (photo.itemIndex) {
      titleEl.innerHTML = `<strong>#${photo.itemIndex}.</strong> ${escapeHtml(photo.itemTitle)}`;
    } else {
      titleEl.innerHTML = escapeHtml(photo.itemTitle);
    }
  }

  if (guidelineEl) {
    if (photo.guideline) {
      guidelineEl.innerHTML = `📖 <strong>Hướng dẫn:</strong> ${escapeHtml(photo.guideline)}`;
      guidelineEl.style.display = 'block';
    } else {
      guidelineEl.style.display = 'none';
      guidelineEl.innerHTML = '';
    }
  }

  if (noteEl) {
    if (photo.note && photo.note !== photo.guideline) {
      noteEl.innerHTML = `📝 <strong>Ghi chú KTV:</strong> ${escapeHtml(photo.note)}`;
      noteEl.style.display = 'block';
    } else {
      noteEl.style.display = 'none';
      noteEl.innerHTML = '';
    }
  }

  if (metaEl) {
    const parts = [];
    if (photo.performer) parts.push(`👷 ${escapeHtml(photo.performer)}`);
    if (photo.completedAt) parts.push(`✓ ${formatDateTime(photo.completedAt)}`);
    if (parts.length > 0) {
      metaEl.innerHTML = parts.join('&nbsp;&nbsp;•&nbsp;&nbsp;');
      metaEl.style.display = 'flex';
    } else {
      metaEl.style.display = 'none';
      metaEl.innerHTML = '';
    }
  }
}

function navigateGallery(direction) {
  if (!currentGalleryPhotos || currentGalleryPhotos.length <= 1) return;
  const nextIdx = currentGalleryIndex + direction;
  if (nextIdx >= 0 && nextIdx < currentGalleryPhotos.length) {
    currentGalleryIndex = nextIdx;
    renderGalleryPhoto();
  }
}

function openTaskGeneralPhotoViewer(photoId, taskId) {
  let task = null;
  if (taskId && typeof allTasks !== 'undefined' && allTasks) {
    task = allTasks.find(t => t.id == taskId);
  }
  if (!task && currentEditingTask && (!taskId || currentEditingTask.id == taskId)) {
    task = currentEditingTask;
  }
  if (!task && typeof allTasks !== 'undefined' && allTasks) {
    task = allTasks.find(t => t.images && t.images.some(img => img.id == photoId));
  }
  if (!task) task = currentEditingTask;

  const images = (task && task.images) ? task.images : (currentEditingTask && currentEditingTask.images ? currentEditingTask.images : []);
  if (!images || images.length === 0) return;

  currentGalleryPhotos = images.map((img, idx) => {
    const typeText = img.ImageType === 'BEFORE' ? 'Ảnh trước xử lý' : (img.ImageType === 'AFTER' ? 'Ảnh sau xử lý' : 'Ảnh hiện trường');
    return {
      itemId: img.id,
      itemIndex: idx + 1,
      itemTitle: img.Caption || typeText,
      guideline: `Phân loại: ${img.ImageType === 'BEFORE' ? 'TRƯỚC XỬ LÝ (BEFORE)' : 'SAU XỬ LÝ (AFTER)'}`,
      note: img.Caption ? `Chú thích: ${img.Caption}` : '',
      performer: img.UploadedBy || '',
      completedAt: img.UploadedAt || '',
      imgUrl: img.FileUrl
    };
  });

  const foundIdx = currentGalleryPhotos.findIndex(p => p.itemId == photoId);
  currentGalleryIndex = foundIdx >= 0 ? foundIdx : 0;
  renderGalleryPhoto();

  const modal = document.getElementById('lightboxModal');
  if (modal) {
    showModal(modal);
  }
}

function openLightbox(url, caption) {
  // Kiểm tra xem url này có thuộc danh sách ảnh chung của công việc hiện tại không để hỗ trợ slide qua lại
  let task = currentEditingTask;
  if (!task && typeof allTasks !== 'undefined' && allTasks) {
    task = allTasks.find(t => t.images && t.images.some(img => img.FileUrl === url));
  }
  const images = (task && task.images) ? task.images : [];
  const foundIdx = images.findIndex(img => img.FileUrl === url);

  if (images.length > 0 && foundIdx >= 0) {
    currentGalleryPhotos = images.map((img, idx) => {
      const typeText = img.ImageType === 'BEFORE' ? 'Ảnh trước xử lý' : (img.ImageType === 'AFTER' ? 'Ảnh sau xử lý' : 'Ảnh hiện trường');
      return {
        itemId: img.id,
        itemIndex: idx + 1,
        itemTitle: img.Caption || typeText,
        guideline: `Phân loại: ${img.ImageType === 'BEFORE' ? 'TRƯỚC XỬ LÝ (BEFORE)' : 'SAU XỬ LÝ (AFTER)'}`,
        note: img.Caption ? `Chú thích: ${img.Caption}` : '',
        performer: img.UploadedBy || '',
        completedAt: img.UploadedAt || '',
        imgUrl: img.FileUrl
      };
    });
    currentGalleryIndex = foundIdx;
  } else {
    currentGalleryPhotos = [{
      itemId: null,
      itemIndex: null,
      itemTitle: caption || 'Xem ảnh lớn',
      guideline: '',
      note: '',
      performer: '',
      completedAt: '',
      imgUrl: url
    }];
    currentGalleryIndex = 0;
  }

  renderGalleryPhoto();

  const modal = document.getElementById('lightboxModal');
  if (modal) {
    showModal(modal);
  }
}

function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  if (modal) {
    hideModal(modal);
  }
}

// Lắng nghe phím bấm Escape, Mũi tên trái / phải để chuyển ảnh
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('lightboxModal');
  if (!modal || (!modal.classList.contains('open') && !modal.classList.contains('active'))) return;

  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowLeft') {
    navigateGallery(-1);
  } else if (e.key === 'ArrowRight') {
    navigateGallery(1);
  }
});

// Vuốt màn hình điện thoại (Touch Swipe Gesture) để chuyển qua lại các ảnh
(function initLightboxSwipeGesture() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  document.addEventListener('touchstart', (e) => {
    const modal = document.getElementById('lightboxModal');
    if (!modal || (!modal.classList.contains('open') && !modal.classList.contains('active'))) return;
    if (e.changedTouches && e.changedTouches[0]) {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const modal = document.getElementById('lightboxModal');
    if (!modal || (!modal.classList.contains('open') && !modal.classList.contains('active'))) return;
    if (e.changedTouches && e.changedTouches[0]) {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;

      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
        if (diffX < 0) {
          navigateGallery(1); // Vuốt sang trái -> Ảnh tiếp theo
        } else {
          navigateGallery(-1); // Vuốt sang phải -> Ảnh trước
        }
      }
    }
  }, { passive: true });
})();

// =========================================================================
// UTILITIES: TOAST NOTIFICATIONS & FORMATTERS
// =========================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message ${type}`;
  toast.style.cssText = `
    display: flex; align-items: center; gap: 10px;
    padding: 12px 18px; margin-bottom: 8px; border-radius: var(--radius-sm);
    background: #1F2937; color: #FFF; font-size: 0.88rem; font-weight: 600;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5); border: 1px solid var(--border-subtle);
    animation: fadeIn 0.2s ease;
  `;

  if (type === 'success') {
    toast.style.borderColor = '#10B981';
    toast.style.background = '#064E3B';
  } else if (type === 'error') {
    toast.style.borderColor = '#EF4444';
    toast.style.background = '#7F1D1D';
  } else if (type === 'warning') {
    toast.style.borderColor = '#F59E0B';
    toast.style.background = '#78350F';
  }

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function formatDateTime(dtStr) {
  if (!dtStr) return '-';
  try {
    const parts = dtStr.split(' ');
    const datePart = parts[0];
    const timePart = parts[1] || '';
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return dtStr;
    return `${d}/${m}/${y}${timePart ? ' ' + timePart.substring(0, 5) : ''}`;
  } catch (e) {
    return dtStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRegex(str) {
  if (!str) return '';
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const escaped = escapeHtml(text);
  return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function openItemSampleModalById(itemId) {
  const item = (allRecurringItems || []).find(i => i.id == itemId);
  const row = document.querySelector(`tr[data-item-id="${itemId}"]`);
  if (item) {
    openItemSampleModal(item.id, item.ItemTitle, item.SampleImageUrl || '', item.StandardGuideline || '', row, 'recurring');
  } else {
    openItemSampleModal(itemId, '', '', '', row, 'recurring');
  }
}

// =========================================================================
// SUB-ITEM SOP SAMPLE PHOTO & PROOF HISTORY WORKFLOW
// =========================================================================
let currentSampleModalItemId = null;
let currentSampleModalItemTitle = '';
let currentSampleModalUrl = '';
let currentSampleModalTriggerRow = null;
let itemSampleSelectedFile = null;
let currentSampleModalMode = 'recurring';

function updateTriggerRowSample(sampleUrl) {
  if (!currentSampleModalTriggerRow) return;
  const hiddenInp = currentSampleModalTriggerRow.querySelector('.tpl-item-sample-url, .new-item-sample-url');
  if (hiddenInp) hiddenInp.value = sampleUrl || '';

  const thumbBox = currentSampleModalTriggerRow.querySelector('.item-sample-thumb-box');
  const btn = currentSampleModalTriggerRow.querySelector('.btn-item-sample-trigger');

  if (sampleUrl) {
    if (thumbBox) {
      thumbBox.innerHTML = `<img src="${sampleUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
      thumbBox.style.display = 'block';
      thumbBox.onclick = () => openLightbox(sampleUrl, 'Ảnh Mẫu SOP');
    }
    if (btn) {
      btn.style.color = '#38BDF8';
      btn.innerHTML = '📷 Mẫu';
    }
  } else {
    if (thumbBox) {
      thumbBox.innerHTML = '';
      thumbBox.style.display = 'none';
    }
    if (btn) {
      btn.style.color = 'var(--text-muted)';
      btn.innerHTML = '📷 + Mẫu';
    }
  }
}

async function openItemSampleModal(itemId, itemTitle, currentSampleUrl = '', guideline = '', triggerEl = null, explicitMode = null) {
  const modal = document.getElementById('itemSampleModal');
  if (!modal) return;

  currentSampleModalItemId = itemId;
  currentSampleModalItemTitle = itemTitle || '';
  currentSampleModalUrl = currentSampleUrl || '';
  currentSampleModalTriggerRow = triggerEl || null;
  cancelItemSampleUpload();

  const isRecurringMode = (explicitMode === 'recurring') ||
    (currentTabMode === 'recurring' && !currentEditingTask) ||
    (!currentEditingTask && (allRecurringItems || []).some(i => i.id == itemId));

  currentSampleModalMode = isRecurringMode ? 'recurring' : 'task';

  const idInp = document.getElementById('itemSampleItemId');
  if (idInp) idInp.value = itemId || '';
  const titleEl = document.getElementById('itemSampleItemTitleText');
  if (titleEl) titleEl.textContent = itemTitle || 'Hạng mục con';

  updateItemSamplePreview(currentSampleUrl, guideline);

  const modalTitle = document.getElementById('itemSampleModalTitle');
  const modalSub = document.getElementById('itemSampleModalSub');
  const actionTitle = document.getElementById('itemSampleActionTitle');
  const btnCamera = document.getElementById('btnLabelCameraSample');
  const btnFile = document.getElementById('btnLabelFileSample');
  const historySection = document.getElementById('itemSampleProofHistorySection');
  const btnSaveSOP = document.getElementById('btnUploadItemSampleDirect');
  const btnDelSample = document.getElementById('btnDeleteItemSample');

  if (isRecurringMode) {
    // Mode: Recurring Templates SOP Management - Chỉ hiển thị tiêu đề hạng mục con ở header
    if (modalTitle) modalTitle.innerHTML = `<span id="itemSampleItemTitleText" style="color: #60A5FA; font-weight: 700;">${escapeHtml(itemTitle || 'Hạng mục')}</span>`;
    if (modalSub) {
      modalSub.textContent = '';
      modalSub.style.display = 'none';
    }
    if (actionTitle) actionTitle.textContent = 'Cập Nhật / Tải Ảnh Mẫu Chuẩn SOP Mới';
    if (btnCamera) btnCamera.style.display = 'inline-flex';
    if (btnFile) btnFile.style.display = 'inline-flex';
    if (btnSaveSOP) btnSaveSOP.style.display = 'inline-block';
    if (historySection) historySection.style.display = 'block';
    if (btnDelSample) btnDelSample.style.display = currentSampleUrl ? 'inline-flex' : 'none';

    showModal(modal);
    await reloadItemProofImages();
  } else {
    // Mode: Work Order / Task Sub-Item Camera Capture
    // Không lưu ảnh thực tế cho các hạng mục con, bỏ nút lưu ảnh, tự lưu ảnh khi chụp xong, bỏ nút đặt làm ảnh SOP. Bỏ nút chọn ảnh từ thư viện. Không cần hiện danh sách ảnh đã chụp trong mục này.
    if (modalTitle) modalTitle.innerHTML = `<span id="itemSampleItemTitleText" style="color: #60A5FA; font-weight: 700;">${escapeHtml(itemTitle || 'Hạng mục')}</span>`;
    if (modalSub) {
      modalSub.textContent = '';
      modalSub.style.display = 'none';
    }
    if (actionTitle) actionTitle.textContent = 'Chụp Ảnh Thực Tế Bằng Camera';
    if (btnCamera) btnCamera.style.display = 'inline-flex';
    if (btnFile) btnFile.style.display = 'none'; // Bỏ nút chọn từ thư viện
    if (btnSaveSOP) btnSaveSOP.style.display = 'none'; // Bỏ nút đặt làm ảnh SOP
    if (historySection) historySection.style.display = 'none'; // Bỏ danh sách ảnh đã chụp
    if (btnDelSample) btnDelSample.style.display = 'none';

    showModal(modal);
  }
}

function updateItemSamplePreview(sampleUrl, guideline = '') {
  const img = document.getElementById('itemSampleCurrentImg');
  const thumbWrap = document.getElementById('itemSampleCurrentThumbWrapper');
  const noSample = document.getElementById('itemSampleNoSamplePlaceholder');
  const btnDel = document.getElementById('btnDeleteItemSample');
  const guideBox = document.getElementById('itemSampleGuidelineBox');
  const guideText = document.getElementById('itemSampleGuidelineText');

  if (sampleUrl) {
    if (img) img.src = sampleUrl;
    if (thumbWrap) thumbWrap.style.display = 'block';
    if (noSample) noSample.style.display = 'none';
    if (btnDel) btnDel.style.display = (currentSampleModalMode === 'recurring') ? 'inline-flex' : 'none';
    if (guideline) {
      if (guideText) guideText.textContent = guideline;
      if (guideBox) guideBox.style.display = 'block';
    } else {
      if (guideBox) guideBox.style.display = 'none';
    }
  } else {
    if (img) img.src = '';
    if (thumbWrap) thumbWrap.style.display = 'none';
    if (noSample) noSample.style.display = 'flex';
    if (btnDel) btnDel.style.display = 'none';
    if (guideBox) guideBox.style.display = 'none';
  }
}

function closeItemSampleModal() {
  const modal = document.getElementById('itemSampleModal');
  if (modal) hideModal(modal);
  currentSampleModalItemId = null;
  currentSampleModalTriggerRow = null;
  itemSampleSelectedFile = null;
}

async function reloadItemProofImages() {
  const container = document.getElementById('itemProofGridContainer');
  if (!container) return;

  if (!currentSampleModalItemId || currentSampleModalItemId === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 26px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        <div style="font-size: 32px; margin-bottom: 6px;">💡</div>
        <div style="font-size: 14px; font-weight: 600; color: #E2E8F0; margin-bottom: 4px;">Hạng mục này chưa được lưu vào hệ thống</div>
        <div style="font-size: 12px; max-width: 480px; margin: 0 auto; color: var(--text-muted);">
          Vui lòng bấm <strong>"Lưu"</strong> hoặc <strong>"Tạo Công Việc"</strong> để lưu hạng mục vào hệ thống. Sau đó bạn có thể chọn ảnh từ kho ảnh thực tế KTV đã chụp hoặc tải ảnh mẫu chuẩn SOP bất cứ lúc nào!
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 26px;">
      <div class="spinner" style="margin: 0 auto 10px;"></div>
      Đang tải ảnh thực tế kỹ thuật viên đã chụp...
    </div>
  `;

  try {
    const res = await fetch(`/api/internal-tasks/items/${currentSampleModalItemId}/proof-images`);
    if (!res.ok) throw new Error('Không thể tải ảnh thực tế');
    const data = await res.json();
    const images = data.images || [];

    if (data.current_sample_url) {
      currentSampleModalUrl = data.current_sample_url;
      updateItemSamplePreview(data.current_sample_url, data.standard_guideline);
    }

    if (images.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 28px; background: rgba(0,0,0,0.2); border-radius: 8px;">
          <div style="font-size: 32px; margin-bottom: 6px;">📷</div>
          <div style="font-size: 14px; font-weight: 600; color: #E2E8F0;">Chưa có ảnh thực tế nào chụp cho hạng mục này</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; max-width: 480px; margin-left: auto; margin-right: auto;">
            Khi nhân viên thực hiện công việc và chụp ảnh hiện trường, hình ảnh sẽ tự động xuất hiện tại đây để bạn chọn làm mẫu chuẩn SOP.
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = images.map(img => {
      const isCurrentSample = (currentSampleModalUrl && currentSampleModalUrl === img.FileUrl);
      const typeLabel = img.ImageType === 'AFTER' ? 'Sau hoàn thành' : 'Trước xử lý';

      return `
        <div class="proof-photo-card ${isCurrentSample ? 'is-current-sample' : ''}">
          <div class="proof-photo-preview" onclick="openLightbox('${img.FileUrl}', '${escapeHtml(currentSampleModalItemTitle)} - Chụp bởi ${escapeHtml(img.UploadedBy || '')} ngày ${img.UploadedAt}')">
            <img src="${img.FileUrl}" alt="Ảnh thực tế" onerror="this.onerror=null;this.src='/static/placeholder-camera.svg';">
            <span class="proof-zoom-hint">🔍 Phóng to</span>
            ${isCurrentSample ? '<span class="current-sample-tag">★ Đang là ảnh mẫu SOP</span>' : ''}
          </div>

          <div class="proof-photo-details">
            <div class="proof-meta-row">
              <span class="proof-meta-item">
                📅 <strong>${img.UploadedAt || '---'}</strong>
              </span>
            </div>

            <div class="proof-meta-row">
              <span class="proof-meta-item">
                👤 KTV: <strong>${escapeHtml(img.UploadedBy || 'Kỹ thuật viên')}</strong>
              </span>
            </div>

            ${img.SourceTitle ? `
              <div class="proof-meta-row">
                <span class="proof-meta-item" style="font-size: 0.72rem; color: #93C5FD;">
                  📌 ${escapeHtml(img.SourceTitle)}
                </span>
              </div>
            ` : ''}

            <div class="proof-type-badge">${typeLabel}</div>
            ${img.Caption ? `<div class="proof-caption">"${escapeHtml(img.Caption)}"</div>` : ''}

            <div class="proof-card-actions">
              <button type="button" class="btn-set-sample" onclick="setItemSampleFromPhoto(${currentSampleModalItemId}, ${img.id}, '${img.Source || 'internal'}', '${escapeHtml(img.UploadedBy || '')}', '${img.UploadedAt || ''}', '${img.FileUrl}')">
                <span>⭐ Đặt Làm Mẫu SOP</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: #EF4444; padding: 24px;">
        Lỗi tải ảnh: ${err.message}
      </div>
    `;
  }
}

async function setItemSampleFromPhoto(itemId, imageId, source, uploader, uploadDate, fileUrl) {
  if (!confirm(`Bạn có chắc muốn chọn ảnh chụp ngày ${uploadDate} của KTV ${uploader} làm Ảnh Mẫu Chuẩn SOP cho hạng mục này?`)) return;

  try {
    const payload = {
      image_id: imageId,
      image_source: source,
      file_url: fileUrl
    };

    const res = await fetch(`/api/internal-tasks/items/${itemId}/set-sample-from-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi thiết lập ảnh mẫu');

    showToast(data.message || 'Đã đặt ảnh thực tế làm ảnh mẫu chuẩn SOP thành công!', 'success');
    currentSampleModalUrl = data.sample_image_url;
    updateItemSamplePreview(data.sample_image_url, data.guideline);
    updateTriggerRowSample(data.sample_image_url);
    await reloadItemProofImages();

    if (currentEditingTask) {
      await openTaskDetail(currentEditingTask.id);
    }
    if (typeof loadRecurringData === 'function' && currentTabMode === 'recurring') {
      await loadRecurringData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleItemSampleFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const isRecurringMode = (currentSampleModalMode === 'recurring');

  if (!isRecurringMode && currentEditingTask) {
    // Chế độ thực hiện công việc: Tự động lưu ảnh ngay khi chụp xong, bỏ nút lưu ảnh, đóng modal ngay
    const itemId = currentSampleModalItemId;
    const itemTitle = currentSampleModalItemTitle;
    closeItemSampleModal();
    await autoSaveSubItemPhoto(file, itemId, itemTitle);
    return;
  }

  // Chế độ cấu hình công việc định kỳ: Chọn ảnh mẫu và hiển thị xem trước để đặt làm mẫu SOP
  itemSampleSelectedFile = file;
  const nameDisplay = document.getElementById('itemSampleFileNameDisplay');
  if (nameDisplay) nameDisplay.textContent = file.name;

  const previewBox = document.getElementById('itemSampleUploadPreviewBox');
  const thumb = document.getElementById('itemSampleUploadThumb');
  if (previewBox && thumb) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      thumb.src = evt.target.result;
      previewBox.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}

function cancelItemSampleUpload() {
  itemSampleSelectedFile = null;
  const camInp = document.getElementById('itemSampleCameraInput');
  if (camInp) camInp.value = '';
  const fileInp = document.getElementById('itemSampleFileInput');
  if (fileInp) fileInp.value = '';
  const nameDisplay = document.getElementById('itemSampleFileNameDisplay');
  if (nameDisplay) nameDisplay.textContent = 'Chưa chọn ảnh nào';
  const previewBox = document.getElementById('itemSampleUploadPreviewBox');
  if (previewBox) previewBox.style.display = 'none';
  const thumb = document.getElementById('itemSampleUploadThumb');
  if (thumb) thumb.src = '';
}

async function submitUploadItemProofDirect() {
  if (!itemSampleSelectedFile || !currentEditingTask) {
    showToast('Chưa chọn tệp ảnh để tải lên', 'warning');
    return;
  }

  const file = itemSampleSelectedFile;
  const itemId = currentSampleModalItemId;
  const itemTitle = currentSampleModalItemTitle;
  cancelItemSampleUpload();
  closeItemSampleModal();
  await autoSaveSubItemPhoto(file, itemId, itemTitle);
}

async function submitUploadItemSampleDirect() {
  if (!itemSampleSelectedFile || !currentSampleModalItemId) {
    showToast('Chưa chọn tệp ảnh để tải lên', 'warning');
    return;
  }

  showToast('Đang nén & chuẩn bị ảnh mẫu...', 'info');
  let file = itemSampleSelectedFile;
  try {
    file = await compressImageFile(file);
  } catch (e) {
    console.warn('Lỗi nén ảnh SOP mẫu:', e);
  }

  const formData = new FormData();
  formData.append('file', file);

  showToast('Đang tải ảnh mẫu SOP...', 'info');

  try {
    const res = await fetch(`/api/internal-tasks/items/${currentSampleModalItemId}/sample-image`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi tải ảnh mẫu lên máy chủ');

    showToast('Đã lưu ảnh mẫu SOP thành công!', 'success');
    currentSampleModalUrl = data.sample_image_url;
    updateItemSamplePreview(data.sample_image_url);
    updateTriggerRowSample(data.sample_image_url);

    cancelItemSampleUpload();
    await reloadItemProofImages();

    if (currentEditingTask) {
      await openTaskDetail(currentEditingTask.id);
    }
    if (typeof loadRecurringData === 'function' && currentTabMode === 'recurring') {
      await loadRecurringData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteCurrentItemSample() {
  if (!currentSampleModalItemId) return;
  if (!confirm('Bạn có chắc muốn xóa ảnh mẫu SOP của hạng mục này?')) return;

  try {
    const res = await fetch(`/api/internal-tasks/items/${currentSampleModalItemId}/sample-image`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Lỗi xóa ảnh mẫu');

    showToast('Đã xóa ảnh mẫu SOP của hạng mục.', 'info');
    currentSampleModalUrl = '';
    updateItemSamplePreview('');
    updateTriggerRowSample('');
    await reloadItemProofImages();

    if (currentEditingTask) {
      await openTaskDetail(currentEditingTask.id);
    }
    if (typeof loadRecurringData === 'function' && currentTabMode === 'recurring') {
      await loadRecurringData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================================
// EXPLICIT WINDOW BINDINGS (Guarantees onclick handlers find functions)
// =========================================================================
window.openCreateTaskModal = openCreateTaskModal;
window.closeCreateTaskModal = closeCreateTaskModal;
window.submitCreateTask = submitCreateTask;
window.openRecurringTemplateModal = openRecurringTemplateModal;
window.openEditRecurringTemplateModal = openEditRecurringTemplateModal;
window.closeRecurringTemplateModal = closeRecurringTemplateModal;
window.submitSaveRecurringTemplate = submitSaveRecurringTemplate;
window.openTaskDetail = openTaskDetail;
window.closeTaskDetailModal = closeTaskDetailModal;
window.submitUpdateTaskDetail = submitUpdateTaskDetail;
window.switchTaskTabMode = switchTaskTabMode;
window.selectNewTaskCycleType = selectNewTaskCycleType;
window.selectTplCycleType = selectTplCycleType;
window.setNewTaskInterval = setNewTaskInterval;
window.setNewTaskMonthlyDays = setNewTaskMonthlyDays;
window.setTplInterval = setTplInterval;
window.setTplMonthlyDays = setTplMonthlyDays;
window.toggleNewTaskRecurringFields = toggleNewTaskRecurringFields;
window.quickCardAction = quickCardAction;
window.quickUpdateStatus = quickUpdateStatus;
window.spawnTaskFromTemplate = spawnTaskFromTemplate;
window.toggleTemplateActive = toggleTemplateActive;
window.deleteRecurringTemplate = deleteRecurringTemplate;
window.spawnNextCycleFromDetail = spawnNextCycleFromDetail;
window.filterByType = filterByType;
window.applyFilters = applyFilters;
window.applyRecurringFilters = filterRecurringItems;
window.loadTasks = loadTasks;
window.loadRecurringTemplates = loadRecurringTemplates;
window.triggerPhotoUpload = triggerPhotoUpload;
window.handlePhotoSelected = handlePhotoSelected;
window.cancelPhotoUpload = cancelPhotoUpload;
window.submitUploadPhoto = submitUploadPhoto;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;

// Checklist & Sub-items bindings
window.addNewTaskItemRow = addNewTaskItemRow;
window.addTplItemRow = addTplItemRow;
window.toggleItemCompleted = toggleItemCompleted;
window.toggleDetailAddRow = toggleDetailAddRow;
window.submitAddDetailItem = submitAddDetailItem;
window.deleteDetailItem = deleteDetailItem;

// Item SOP Sample bindings
window.openItemSampleModal = openItemSampleModal;
window.openItemSampleModalById = openItemSampleModalById;
window.closeItemSampleModal = closeItemSampleModal;
window.reloadItemProofImages = reloadItemProofImages;
window.setItemSampleFromPhoto = setItemSampleFromPhoto;
window.handleItemSampleFileSelected = handleItemSampleFileSelected;
window.cancelItemSampleUpload = cancelItemSampleUpload;
window.submitUploadItemProofDirect = submitUploadItemProofDirect;
window.submitUploadItemSampleDirect = submitUploadItemSampleDirect;
window.deleteCurrentItemSample = deleteCurrentItemSample;

// Recurring Master-Detail View bindings
window.selectRecurringTemplate = selectRecurringTemplate;
window.clearRecurringSearch = clearRecurringSearch;
window.filterRecurringItems = filterRecurringItems;
window.loadRecurringData = loadRecurringData;
window.renderRecurringMasterList = renderRecurringMasterList;
window.renderRecurringItemsTable = renderRecurringItemsTable;
window.openQuickSubItemModal = openQuickSubItemModal;
window.openQuickEditSubItemModal = openQuickEditSubItemModal;
window.closeQuickSubItemModal = closeQuickSubItemModal;
window.submitQuickSubItem = submitQuickSubItem;
window.deleteSubItem = deleteSubItem;
window.spawnCurrentSelectedTemplate = spawnCurrentSelectedTemplate;
window.editCurrentSelectedTemplate = editCurrentSelectedTemplate;
window.toggleCurrentTemplateActive = toggleCurrentTemplateActive;
window.changeRecurringTemplateStatus = changeRecurringTemplateStatus;
window.deleteCurrentSelectedTemplate = deleteCurrentSelectedTemplate;
window.navigateToRecurringTemplateFromModal = navigateToRecurringTemplateFromModal;

// Active Tasks & Scope bindings
window.switchTaskScope = switchTaskScope;
window.selectInternalTask = selectInternalTask;
window.renderDesktopTaskDetail = renderDesktopTaskDetail;
window.saveDesktopTaskDetail = saveDesktopTaskDetail;
window.showMobileTasksListView = showMobileTasksListView;
window.showMobileDetailView = showMobileDetailView;
window.onDesktopDetailGroupChange = onDesktopDetailGroupChange;
window.addDesktopChecklistItem = addDesktopChecklistItem;
window.deleteDesktopChecklistItem = deleteDesktopChecklistItem;
window.uploadDesktopPhoto = uploadDesktopPhoto;
window.deleteGeneralPhoto = deleteGeneralPhoto;
window.compressImageFile = compressImageFile;
window.deleteInternalTask = deleteInternalTask;
window.openCancelTaskModal = openCancelTaskModal;
window.closeCancelTaskModal = closeCancelTaskModal;
window.confirmCancelTask = confirmCancelTask;
window.handleDesktopStatusChange = handleDesktopStatusChange;
window.handleModalStatusChange = handleModalStatusChange;
window.selectTaskFromTable = selectTaskFromTable;
window.toggleTaskViewMode = toggleTaskViewMode;
window.openPriorityPicker = openPriorityPicker;
window.selectPriorityQuick = selectPriorityQuick;

// Employee Groups bindings
window.loadGroups = loadGroups;
window.openManageGroupsModal = openManageGroupsModal;
window.closeManageGroupsModal = closeManageGroupsModal;
window.selectGroupInManager = selectGroupInManager;
window.addEmployeeToCurrentGroup = addEmployeeToCurrentGroup;
window.removeEmployeeFromCurrentGroup = removeEmployeeFromCurrentGroup;
window.promptCreateNewGroup = promptCreateNewGroup;
window.deleteCurrentGroup = deleteCurrentGroup;
window.onTaskGroupSelectChange = onTaskGroupSelectChange;

// Active Tasks Excel View bindings
window.switchActiveTaskViewMode = switchActiveTaskViewMode;
window.renderTaskExcelTable = renderTaskExcelTable;
window.sortExcelTasks = sortExcelTasks;
window.exportTasksToExcel = exportTasksToExcel;
window.clearTaskSearch = clearTaskSearch;
window.resetAllTaskFilters = resetAllTaskFilters;
window.toggleTaskFilters = toggleTaskFilters;
window.toggleRecurringFilters = toggleRecurringFilters;
window.updateStickyHeaderOffset = updateStickyHeaderOffset;

// Sub-item SOP Comparison & Camera bindings
window.openSubItemCompareModal = openSubItemCompareModal;
window.closeSubItemCompareModal = closeSubItemCompareModal;
window.triggerCompareModalCamera = triggerCompareModalCamera;
window.handleCompareModalPhotoCaptured = handleCompareModalPhotoCaptured;
window.startLiveCamera = startLiveCamera;
window.stopLiveCamera = stopLiveCamera;
window.switchCameraFacing = switchCameraFacing;
window.setGhostOpacity = setGhostOpacity;
window.captureAndSaveLiveCamera = captureAndSaveLiveCamera;
window.triggerSubItemCapture = triggerSubItemCapture;

// Sub-item Note & Issue bindings
window.renderDetailChecklist = renderDetailChecklist;
window.renderDetailSubItems = renderDetailSubItems;
window.assignSubItemKTV = assignSubItemKTV;
window.openSubItemNoteModal = openSubItemNoteModal;
window.closeSubItemNoteModal = closeSubItemNoteModal;
window.saveSubItemNoteModal = saveSubItemNoteModal;
window.saveSubItemDirectNote = saveSubItemDirectNote;
window.toggleSubItemIssueQuick = toggleSubItemIssueQuick;
window.appendSubItemQuickNote = appendSubItemQuickNote;
window.toggleDesktopGeneralInfo = toggleDesktopGeneralInfo;

// Lightbox & Photo Gallery bindings
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.openChecklistPhotoViewer = openChecklistPhotoViewer;
window.openTaskGeneralPhotoViewer = openTaskGeneralPhotoViewer;
window.navigateGallery = navigateGallery;
window.renderGalleryPhoto = renderGalleryPhoto;

// User Auth & Profile bindings
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.openUserProfileModal = openUserProfileModal;
window.closeUserProfileModal = closeUserProfileModal;
window.handleLoginSubmit = handleLoginSubmit;
window.logoutUser = logoutUser;
window.checkAuth = checkAuth;

// Mobile app back button handler (Android back button / swipe back gesture)
window.addEventListener('popstate', (e) => {
  // 1. Close lightbox if open
  const lightbox = document.getElementById('lightboxModal');
  if (lightbox && lightbox.style.display !== 'none') {
    closeLightbox();
    return;
  }
  // 2. Close active modals if open
  const modalsToClose = [
    { el: document.getElementById('taskCancelModal'), fn: closeCancelTaskModal },
    { el: document.getElementById('subItemNoteModal'), fn: closeSubItemNoteModal },
    { el: document.getElementById('subItemCompareModal'), fn: closeSubItemCompareModal },
    { el: document.getElementById('taskDetailModal'), fn: closeTaskDetailModal },
    { el: document.getElementById('manageGroupsModal'), fn: closeManageGroupsModal },
    { el: document.getElementById('createTaskModal'), fn: closeCreateTaskModal },
    { el: document.getElementById('loginModal'), fn: closeLoginModal },
    { el: document.getElementById('userProfileModal'), fn: closeUserProfileModal },
    { el: document.getElementById('quickSubItemModal'), fn: closeQuickSubItemModal },
    { el: document.getElementById('quickEditSubItemModal'), fn: closeQuickEditSubItemModal },
    { el: document.getElementById('itemSampleModal'), fn: closeItemSampleModal },
    { el: document.getElementById('recurringTemplateModal'), fn: closeRecurringTemplateModal }
  ];
  for (const m of modalsToClose) {
    if (m.el && (m.el.classList.contains('open') || m.el.style.display === 'flex' || m.el.style.display === 'block')) {
      if (typeof m.fn === 'function') m.fn();
      return;
    }
  }
  // 3. If in recurring view and mobile detail is active, return to category list
  const layoutContainer = document.querySelector('.category-layout-container');
  if (layoutContainer && layoutContainer.classList.contains('mobile-detail-active')) {
    selectRecurringTemplate(null, true);
    return;
  }
});

// =========================================================================
// REAL-TIME SYNCHRONIZATION VIA WEBSOCKET (TỰ ĐỘNG CẬP NHẬT TRANG)
// =========================================================================
(function initRealtimeInternalTasks() {
  if (typeof RealtimeSync === 'undefined') return;

  const debouncedRefreshTasks = RealtimeSync.debounce(async () => {
    try {
      console.log('[Realtime] Đang tự động làm mới danh sách công việc...');
      await loadTasks();
    } catch (err) {
      console.warn('[Realtime] Lỗi tự động làm mới công việc:', err);
    }
  }, 400);

  const debouncedRefreshRecurring = RealtimeSync.debounce(async () => {
    try {
      if (typeof loadRecurringTemplates === 'function') {
        await loadRecurringTemplates();
      }
    } catch (err) { }
  }, 400);

  const debouncedRefreshGroups = RealtimeSync.debounce(async () => {
    try {
      if (typeof loadEmployeeGroups === 'function') {
        await loadEmployeeGroups();
      }
    } catch (err) { }
  }, 400);

  // 1. Khi có công việc mới được tạo
  RealtimeSync.on('TASK_CREATED', (payload) => {
    debouncedRefreshTasks();
    if (payload && payload.title) {
      if (typeof showToast === 'function') {
        const code = payload.task_code ? `[${payload.task_code}] ` : '';
        showToast(`⚡ Việc mới: ${code}${payload.title}`, 'info');
      }
    }
  });

  // 2. Khi công việc được cập nhật (tiến độ, trạng thái, nghiệm thu, phân công)
  RealtimeSync.on('TASK_UPDATED', (payload) => {
    debouncedRefreshTasks();
    // Nếu đang xem chi tiết chính công việc này
    if (currentEditingTask && payload && String(payload.task_id) === String(currentEditingTask.id)) {
      if (typeof openTaskDetail === 'function') {
        openTaskDetail(currentEditingTask.id, false);
      }
    }
  });

  // 3. Khi hạng mục con (checklist) được thêm, hoàn thành, xóa
  RealtimeSync.on('TASK_ITEM_UPDATED', (payload) => {
    debouncedRefreshTasks();
    if (currentEditingTask && payload && String(payload.task_id) === String(currentEditingTask.id)) {
      if (typeof openTaskDetail === 'function') {
        openTaskDetail(currentEditingTask.id, false);
      }
    }
  });

  // 4. Khi có ảnh mới được chụp hoặc tải lên
  RealtimeSync.on('TASK_PHOTO_UPDATED', (payload) => {
    if (currentEditingTask && payload && String(payload.task_id) === String(currentEditingTask.id)) {
      if (typeof openTaskDetail === 'function') {
        openTaskDetail(currentEditingTask.id, false);
      }
    }
  });

  // 5. Khi danh mục định kỳ thay đổi
  RealtimeSync.on('RECURRING_UPDATED', () => {
    debouncedRefreshRecurring();
  });

  // 6. Khi nhóm làm việc thay đổi
  RealtimeSync.on('GROUP_UPDATED', () => {
    debouncedRefreshGroups();
  });
})();



