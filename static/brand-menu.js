/**
 * BOPP EM Maintenance - Global System App Launcher Dropdown Menu
 * File: static/brand-menu.js
 */

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

// Đóng menu khi bấm ra ngoài
document.addEventListener('click', (e) => {
  const menu = document.getElementById('systemAppMenu');
  const trigger = document.getElementById('brandMenuTrigger');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
      closeSystemAppMenu();
    }
  }

  // Đóng nav dropdown nếu bấm ra ngoài
  if (!e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown.open').forEach(el => el.classList.remove('open'));
  }
});

// Toggle navigation dropdown for Dữ Liệu Bảo Trì
function toggleNavDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dropdown = (e && e.currentTarget) ? e.currentTarget.closest('.nav-dropdown') : document.querySelector('.nav-dropdown');
  if (dropdown) {
    const wasOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.nav-dropdown.open').forEach(el => el.classList.remove('open'));
    if (!wasOpen) {
      dropdown.classList.add('open');
    }
  }
}

// Đóng menu khi bấm phím Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSystemAppMenu();
    document.querySelectorAll('.nav-dropdown.open').forEach(el => el.classList.remove('open'));
  }
});

