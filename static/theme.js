/**
 * BOPP EM Maintenance - Global Theme Manager (Dark / Light Mode)
 * File: static/theme.js
 */

(function () {
  'use strict';

  const THEME_STORAGE_KEY = 'bopp_theme';
  let isToggling = false;

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    const isLight = theme === 'light';
    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    htmlEl.setAttribute('data-theme', theme);
    if (isLight) {
      htmlEl.classList.add('light-theme');
      if (bodyEl) bodyEl.classList.add('light-theme');
    } else {
      htmlEl.classList.remove('light-theme');
      if (bodyEl) bodyEl.classList.remove('light-theme');
    }

    // Update all theme toggle buttons on the page
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.setAttribute('title', isLight ? 'Chuyển sang Giao diện Tối' : 'Chuyển sang Giao diện Sáng');
      btn.setAttribute('aria-label', isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode');
    });

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {
      console.warn('[BOPP Theme] LocalStorage error:', e);
    }
  }

  function setTheme(theme) {
    applyTheme(theme);
  }

  function toggleTheme(e) {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    // Debounce guard: prevent duplicate invocation from inline onclick + event listener in same click
    if (isToggling) return;
    isToggling = true;
    setTimeout(() => { isToggling = false; }, 250);

    const currentTheme = document.documentElement.getAttribute('data-theme') || getStoredTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }

  // Expose to global window
  window.BOPP_THEME = {
    get: getStoredTheme,
    set: setTheme,
    toggle: toggleTheme,
    apply: applyTheme
  };
  window.toggleTheme = toggleTheme;

  // Immediately apply stored theme before DOM is fully parsed
  applyTheme(getStoredTheme());

  // Setup event listeners after DOM loaded
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getStoredTheme());

    // Only bind click listener if button does NOT have inline onclick
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      if (!btn.getAttribute('onclick')) {
        btn.addEventListener('click', toggleTheme);
      }
    });
  });
})();

