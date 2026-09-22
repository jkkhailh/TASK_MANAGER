// =========================================================================
// PUBLIC REQUEST PORTAL JAVASCRIPT - BOPP EM MAINTENANCE
// =========================================================================

let selectedPhotos = [];
let lastCreatedTaskCode = '';

document.addEventListener('DOMContentLoaded', () => {
  // Check URL query parameters for direct tracking
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('code');
  if (codeParam) {
    const input = document.getElementById('trackSearchInput');
    if (input) input.value = codeParam.trim();
    switchPortalTab('track');
    executeTrackSearch();
  } else {
    // Add 1 initial checklist item by default
    addChecklistItemRow();
  }
});

// Tab Switcher
function switchPortalTab(tabName) {
  const btnCreate = document.getElementById('tabBtnCreate');
  const btnTrack = document.getElementById('tabBtnTrack');
  const panelCreate = document.getElementById('panelCreate');
  const panelTrack = document.getElementById('panelTrack');

  if (tabName === 'create') {
    btnCreate.classList.add('active');
    btnTrack.classList.remove('active');
    panelCreate.style.display = 'block';
    panelTrack.style.display = 'none';
  } else {
    btnCreate.classList.remove('active');
    btnTrack.classList.add('active');
    panelCreate.style.display = 'none';
    panelTrack.style.display = 'block';
    // Focus search input
    setTimeout(() => {
      const inp = document.getElementById('trackSearchInput');
      if (inp) inp.focus();
    }, 100);
  }
}

// Checklist Item Rows
function addChecklistItemRow(defaultValue = '') {
  const container = document.getElementById('checklistItemsList');
  if (!container) return;

  const currentCount = container.children.length + 1;
  const row = document.createElement('div');
  row.className = 'checklist-item-row';
  row.innerHTML = `
    <span style="font-size: 0.8rem; font-weight: 700; color: #60A5FA; width: 22px; text-align: center;">${currentCount}.</span>
    <input type="text" class="portal-input checklist-title-input" placeholder="Nhập đầu việc cần kiểm tra / sửa chữa..." value="${escapeHtml(defaultValue)}">
    <button type="button" class="btn-remove-photo" style="position: static; width: 28px; height: 28px; border-radius: 6px;" onclick="removeChecklistItemRow(this)" title="Xoá mục này">✕</button>
  `;
  container.appendChild(row);
  renumberChecklistItems();
}

function removeChecklistItemRow(btn) {
  const row = btn.closest('.checklist-item-row');
  if (row) {
    row.remove();
    renumberChecklistItems();
  }
}

function renumberChecklistItems() {
  const container = document.getElementById('checklistItemsList');
  if (!container) return;
  const rows = container.querySelectorAll('.checklist-item-row');
  rows.forEach((row, idx) => {
    const numSpan = row.querySelector('span');
    if (numSpan) numSpan.textContent = `${idx + 1}.`;
  });
}

// Photo Upload & Preview
function handlePhotoSelect(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  if (selectedPhotos.length + files.length > 5) {
    alert('Bạn chỉ có thể đính kèm tối đa 5 ảnh sự cố.');
    return;
  }

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    selectedPhotos.push(file);
  }

  renderPhotoPreviews();
  event.target.value = '';
}

function removePhoto(index) {
  selectedPhotos.splice(index, 1);
  renderPhotoPreviews();
}

function renderPhotoPreviews() {
  const grid = document.getElementById('photoPreviewGrid');
  if (!grid) return;

  grid.innerHTML = '';
  selectedPhotos.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const card = document.createElement('div');
    card.className = 'photo-thumb-card';
    card.innerHTML = `
      <img src="${url}" alt="Ảnh ${idx + 1}">
      <button type="button" class="btn-remove-photo" onclick="removePhoto(${idx})" title="Xóa ảnh này">✕</button>
    `;
    grid.appendChild(card);
  });
}

// Handle Form Submission
async function handlePublicRequestSubmit(event) {
  event.preventDefault();

  const title = document.getElementById('reqTitle').value.trim();
  const name = document.getElementById('reqName').value.trim();
  const dept = document.getElementById('reqDept').value.trim();
  const email = document.getElementById('reqEmail').value.trim();
  const phone = document.getElementById('reqPhone').value.trim();
  const machine = document.getElementById('reqMachine').value.trim();
  const priority = document.getElementById('reqPriority').value;
  const desc = document.getElementById('reqDesc').value.trim();

  if (!title || !name || !dept || !email) {
    alert('Vui lòng điền đầy đủ các trường thông tin có dấu sao (*).');
    return;
  }

  // Thu thập checklist
  const checklistInputs = document.querySelectorAll('.checklist-title-input');
  const items = [];
  checklistInputs.forEach(inp => {
    const val = inp.value.trim();
    if (val) items.push({ ItemTitle: val });
  });

  const btn = document.getElementById('btnSubmitRequest');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳ Đang gửi yêu cầu và gửi email...</span>';

  try {
    const payload = {
      TaskTitle: title,
      Department: dept,
      RequesterName: name,
      RequesterEmail: email,
      RequesterPhone: phone,
      MachineID: machine,
      Priority: priority,
      Description: desc,
      Items: items
    };

    const res = await fetch('/api/public/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Lỗi khi gửi yêu cầu.');
    }

    const taskId = data.task_id;
    const taskCode = data.task_code;
    lastCreatedTaskCode = taskCode;

    // Upload các ảnh đính kèm nếu có
    if (selectedPhotos.length > 0 && taskId) {
      btn.innerHTML = `<span>📸 Đang tải lên ${selectedPhotos.length} ảnh hiện trường...</span>`;
      for (const photoFile of selectedPhotos) {
        try {
          const formData = new FormData();
          formData.append('file', photoFile);
          await fetch(`/api/public/requests/${taskId}/photos`, {
            method: 'POST',
            body: formData
          });
        } catch (imgErr) {
          console.error('Lỗi tải ảnh:', imgErr);
        }
      }
    }

    // Hiển thị modal thành công
    document.getElementById('successTaskCode').textContent = taskCode;
    document.getElementById('successEmailDisplay').textContent = email;
    document.getElementById('successModal').classList.add('open');

  } catch (err) {
    alert('❌ Không thể gửi yêu cầu: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 GỬI YÊU CẦU CHO BỘ PHẬN KỸ THUẬT</span>';
  }
}

function viewSubmittedTaskProgress() {
  document.getElementById('successModal').classList.remove('open');
  switchPortalTab('track');
  const input = document.getElementById('trackSearchInput');
  if (input) input.value = lastCreatedTaskCode;
  executeTrackSearch();
}

function resetFormForNewRequest() {
  document.getElementById('successModal').classList.remove('open');
  document.getElementById('publicRequestForm').reset();
  selectedPhotos = [];
  renderPhotoPreviews();
  const clList = document.getElementById('checklistItemsList');
  if (clList) clList.innerHTML = '';
  addChecklistItemRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Track Progress Search
async function executeTrackSearch() {
  const query = (document.getElementById('trackSearchInput').value || '').trim();
  const container = document.getElementById('trackResultContainer');
  if (!query) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-muted);">
        <div style="font-size: 38px; margin-bottom: 8px;">⚠️</div>
        <p style="margin: 0; font-size: 0.9rem;">Vui lòng nhập Mã công việc (ví dụ: TASK-xxx) hoặc địa chỉ Email.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="text-align: center; padding: 40px 16px; color: #93C5FD;">
      <div style="font-size: 32px; margin-bottom: 8px;">⏳</div>
      <p style="margin: 0; font-weight: 600;">Đang tra cứu dữ liệu tiến độ...</p>
    </div>
  `;

  try {
    const isEmail = query.includes('@');
    const paramKey = isEmail ? 'email' : 'code';
    const res = await fetch(`/api/public/requests/track?${paramKey}=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Không tìm thấy yêu cầu.');
    }

    if (data.task) {
      renderSingleTaskTracking(data.task, container);
    } else if (data.tasks) {
      renderTaskListTracking(data.tasks, query, container);
    } else {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Không tìm thấy thông tin phù hợp.</div>`;
    }
  } catch (err) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: #EF4444;">
        <div style="font-size: 38px; margin-bottom: 8px;">❌</div>
        <p style="margin: 0; font-weight: 600; font-size: 0.95rem;">${escapeHtml(err.message)}</p>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">Vui lòng kiểm tra lại mã công việc hoặc liên hệ bộ phận Kỹ thuật nếu cần hỗ trợ khẩn.</p>
      </div>
    `;
  }
}

// Render Single Task Detail & Timeline
function renderSingleTaskTracking(task, container) {
  const status = (task.Status || 'PENDING').toUpperCase();

  // Determine Timeline Progress
  const isCreated = true;
  const isAssigned = !!(task.AssignedTo && task.AssignedTo.trim());
  const isStarted = status === 'IN_PROGRESS' || status === 'COMPLETED' || !!task.StartedAt;
  const isCompleted = status === 'COMPLETED';

  let statusBadgeHtml = '';
  if (isCompleted) {
    statusBadgeHtml = `<span class="badge-status completed">✅ Hoàn Thành Nghiệm Thu</span>`;
  } else if (isStarted) {
    statusBadgeHtml = `<span class="badge-status in_progress">🚀 Đang Tiến Hành Xử Lý</span>`;
  } else if (isAssigned) {
    statusBadgeHtml = `<span class="badge-status in_progress" style="background: rgba(99, 102, 241, 0.15); color: #A5B4FC; border-color: rgba(99, 102, 241, 0.3);">👷 Đã Có KTV Nhận Việc</span>`;
  } else {
    statusBadgeHtml = `<span class="badge-status pending">⏳ Chờ Kỹ Thuật Tiếp Nhận</span>`;
  }

  const priorityLabels = {
    NORMAL: { text: 'Bình thường', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' },
    HIGH: { text: 'Ưu tiên cao', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
    URGENT: { text: 'Khẩn cấp (Dừng máy)', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
  };
  const prio = priorityLabels[task.Priority] || priorityLabels.NORMAL;

  // Checklist items
  const items = task.items || [];
  let checklistHtml = '';
  if (items.length > 0) {
    checklistHtml = `
      <div style="margin-top: 18px; background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px;">
        <div style="font-size: 0.8rem; font-weight: 700; color: #A5B4FC; margin-bottom: 8px;">📋 Tiến Độ Hạng Mục Công Việc (${items.filter(i => i.Status === 'COMPLETED').length}/${items.length})</div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${items.map(it => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; font-size: 0.82rem;">
              <span style="color: ${it.Status === 'COMPLETED' ? '#34D399' : '#CBD5E1'}; ${it.Status === 'COMPLETED' ? 'text-decoration: line-through;' : ''}">
                ${it.Status === 'COMPLETED' ? '✓' : '○'} ${escapeHtml(it.ItemTitle)}
              </span>
              <span style="font-size: 0.72rem; color: ${it.Status === 'COMPLETED' ? '#34D399' : '#94A3B8'};">
                ${it.Status === 'COMPLETED' ? 'Đã xong' : 'Đang chờ'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Images
  const images = task.images || [];
  let imagesHtml = '';
  if (images.length > 0) {
    imagesHtml = `
      <div style="margin-top: 18px;">
        <div style="font-size: 0.8rem; font-weight: 700; color: #93C5FD; margin-bottom: 8px;">📸 Hình Ảnh Hiện Trường / Nghiệm Thu (${images.length})</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px;">
          ${images.map(img => `
            <a href="${escapeHtml(img.FileUrl)}" target="_blank" class="photo-thumb-card" style="text-decoration: none;" title="Xem ảnh lớn">
              <img src="${escapeHtml(img.FileUrl)}" alt="${escapeHtml(img.Caption || 'Ảnh')}" loading="lazy">
              <span style="position: absolute; bottom: 2px; left: 2px; right: 2px; background: rgba(0,0,0,0.7); color: #FFF; font-size: 9px; text-align: center; border-radius: 3px; padding: 1px 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${img.ImageType === 'AFTER' ? '✅ Sau xử lý' : '📷 Hiện trường'}
              </span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="animation: modalFadeIn 0.25s ease;">
      <!-- Header Bar -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: #60A5FA; font-size: 1.15rem;">${escapeHtml(task.TaskCode)}</span>
            ${statusBadgeHtml}
          </div>
          <h3 style="font-size: 1.1rem; margin: 0; color: #FFFFFF; font-weight: 700;">${escapeHtml(task.TaskTitle)}</h3>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.72rem; color: ${prio.color}; background: ${prio.bg}; padding: 3px 10px; border-radius: 20px; font-weight: 700;">${prio.text}</span>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">Thời gian gửi: ${escapeHtml(task.ReportedAt || task.CreatedAt || '-')}</div>
        </div>
      </div>

      <!-- 4-Step Visual Timeline -->
      <div class="timeline-steps">
        <!-- Step 1 -->
        <div class="timeline-step">
          <div class="step-circle ${isCreated ? 'done' : ''}">📋</div>
          <div class="step-label ${isCreated ? 'active' : ''}">Tiếp Nhận</div>
          <div class="step-time">${escapeHtml((task.ReportedAt || '').split(' ')[1] || '')}</div>
        </div>

        <!-- Step 2 -->
        <div class="timeline-step">
          <div class="step-circle ${isAssigned ? (isStarted ? 'done' : 'active') : ''}">👷</div>
          <div class="step-label ${isAssigned ? 'active' : ''}">Phân Công</div>
          <div class="step-time">${escapeHtml(task.AssignedTo || 'Chờ phân công')}</div>
        </div>

        <!-- Step 3 -->
        <div class="timeline-step">
          <div class="step-circle ${isStarted ? (isCompleted ? 'done' : 'active') : ''}">🚀</div>
          <div class="step-label ${isStarted ? 'active' : ''}">Đang Xử Lý</div>
          <div class="step-time">${escapeHtml((task.StartedAt || '').split(' ')[1] || '')}</div>
        </div>

        <!-- Step 4 -->
        <div class="timeline-step">
          <div class="step-circle ${isCompleted ? 'done' : ''}">✅</div>
          <div class="step-label ${isCompleted ? 'active' : ''}">Hoàn Thành</div>
          <div class="step-time">${escapeHtml((task.CompletedAt || '').split(' ')[1] || '')}</div>
        </div>
      </div>

      <!-- Details Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-top: 16px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div>
          <div style="font-size: 0.68rem; color: var(--text-muted);">Người Yêu Cầu:</div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #E2E8F0;">${escapeHtml(task.RequesterName)}</div>
        </div>
        <div>
          <div style="font-size: 0.68rem; color: var(--text-muted);">Phòng Ban:</div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #E2E8F0;">${escapeHtml(task.Department || 'KỸ THUẬT')}</div>
        </div>
        <div>
          <div style="font-size: 0.68rem; color: var(--text-muted);">Máy / Thiết Bị:</div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #FBBF24;">⚙️ ${escapeHtml(task.MachineID || 'Khu vực chung')}</div>
        </div>
        <div>
          <div style="font-size: 0.68rem; color: var(--text-muted);">KTV Phụ Trách:</div>
          <div style="font-size: 0.85rem; font-weight: 600; color: #93C5FD;">👷 ${escapeHtml(task.AssignedTo || 'Đang chờ phân công')}</div>
        </div>
      </div>

      <!-- Description if any -->
      ${task.Description ? `
        <div style="margin-top: 14px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; font-size: 0.84rem; color: #E2E8F0;">
          <strong style="color: #94A3B8;">Mô tả hiện trạng:</strong> ${escapeHtml(task.Description)}
        </div>
      ` : ''}

      <!-- Solution if completed -->
      ${task.Solution ? `
        <div style="margin-top: 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px; padding: 14px; font-size: 0.86rem; color: #E2E8F0;">
          <div style="font-weight: 700; color: #34D399; margin-bottom: 4px;">🎯 Giải Pháp & Kết Quả Xử Lý:</div>
          <div>${escapeHtml(task.Solution)}</div>
          ${task.DowntimeMinutes > 0 ? `<div style="margin-top: 6px; font-size: 0.78rem; color: #FCA5A5;">⏱️ Thời gian dừng máy thực tế: <strong>${task.DowntimeMinutes} phút</strong></div>` : ''}
        </div>
      ` : ''}

      ${checklistHtml}
      ${imagesHtml}

      <div style="text-align: center; margin-top: 24px;">
        <button type="button" class="btn-portal-login" style="background: rgba(255,255,255,0.05); color: #94A3B8;" onclick="window.print()">
          🖨️ In Phiếu Tiến Độ
        </button>
      </div>
    </div>
  `;
}

// Render Multiple Tasks (When Searching By Email)
function renderTaskListTracking(tasks, email, container) {
  if (!tasks.length) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Không tìm thấy yêu cầu nào được gửi từ email '${escapeHtml(email)}'.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom: 14px; font-size: 0.88rem; color: var(--text-muted);">
      Tìm thấy <strong>${tasks.length}</strong> yêu cầu công việc gửi bởi <strong>${escapeHtml(email)}</strong>:
    </div>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${tasks.map(t => {
        const st = (t.Status || 'PENDING').toUpperCase();
        let badge = '';
        if (st === 'COMPLETED') badge = '<span class="badge-status completed">✓ Hoàn thành</span>';
        else if (st === 'IN_PROGRESS') badge = '<span class="badge-status in_progress">🚀 Đang làm</span>';
        else badge = '<span class="badge-status pending">⏳ Đang chờ</span>';

        return `
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #60A5FA; font-size: 0.95rem;">${escapeHtml(t.TaskCode)}</span>
                ${badge}
                <span style="font-size: 0.72rem; color: #FBBF24;">⚙️ ${escapeHtml(t.MachineID || 'Chung')}</span>
              </div>
              <div style="font-weight: 600; color: #F8FAFC; font-size: 0.92rem;">${escapeHtml(t.TaskTitle)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 3px;">
                KTV: <strong>${escapeHtml(t.AssignedTo || 'Chưa phân công')}</strong> • Gửi lúc: ${escapeHtml(t.ReportedAt || '-')}
              </div>
            </div>
            <div>
              <button type="button" class="btn-portal-login" style="cursor: pointer;" onclick="loadSingleTaskByCode('${escapeHtml(t.TaskCode)}')">
                Xem Chi Tiết →
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function loadSingleTaskByCode(code) {
  const input = document.getElementById('trackSearchInput');
  if (input) input.value = code;
  executeTrackSearch();
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
