/**
 * MemorAid - Shared Navigation & Universal Accessibility Controller
 * Matches Figma Source of Truth: Supports App Sidebar & Public Nav
 */

document.addEventListener('DOMContentLoaded', () => {
  initAccessibilityPreferences();
  highlightActiveNavLink();
  initMobileMenu();
  initAppSidebar();
  setupSpeechSynthesisHelper();
});

// 1. Accessibility Preferences (Font size, High Contrast)
function initAccessibilityPreferences() {
  const savedFontSize = localStorage.getItem('memoraid_font_size') || 'normal';
  const savedContrast = localStorage.getItem('memoraid_high_contrast') === 'true';

  applyFontSize(savedFontSize);
  applyHighContrast(savedContrast);

  // Wire buttons if present
  const btnFontNormal = document.getElementById('btn-font-normal');
  const btnFontLarge = document.getElementById('btn-font-large');
  const btnFontXlarge = document.getElementById('btn-font-xlarge');
  const btnContrast = document.getElementById('btn-contrast-toggle');

  if (btnFontNormal) {
    btnFontNormal.addEventListener('click', () => setFontSize('normal'));
  }
  if (btnFontLarge) {
    btnFontLarge.addEventListener('click', () => setFontSize('large'));
  }
  if (btnFontXlarge) {
    btnFontXlarge.addEventListener('click', () => setFontSize('xlarge'));
  }
  if (btnContrast) {
    btnContrast.addEventListener('click', () => {
      const isCurrentlyHigh = document.body.getAttribute('data-high-contrast') === 'true';
      setHighContrast(!isCurrentlyHigh);
    });
  }
}

function setFontSize(size) {
  localStorage.setItem('memoraid_font_size', size);
  applyFontSize(size);
  window.showToast?.(`Text size adjusted to ${size}`, 'info');
}

function applyFontSize(size) {
  document.body.removeAttribute('data-font-size');
  if (size !== 'normal') {
    document.body.setAttribute('data-font-size', size);
  }
  document.querySelectorAll('.btn-font-scale').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-size') === size);
  });
}

function setHighContrast(enable) {
  localStorage.setItem('memoraid_high_contrast', enable);
  applyHighContrast(enable);
  window.showToast?.(`High contrast mode ${enable ? 'activated' : 'deactivated'}`, 'info');
}

function applyHighContrast(enable) {
  if (enable) {
    document.body.setAttribute('data-high-contrast', 'true');
    const contrastBtn = document.getElementById('btn-contrast-toggle');
    if (contrastBtn) contrastBtn.classList.add('active');
  } else {
    document.body.removeAttribute('data-high-contrast');
    const contrastBtn = document.getElementById('btn-contrast-toggle');
    if (contrastBtn) contrastBtn.classList.remove('active');
  }
}

// 2. Active Link Highlighter for both Top Nav & App Sidebar
function highlightActiveNavLink() {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  
  // Top nav links
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('active');
    }
  });

  // App sidebar links
  const sidebarLinks = document.querySelectorAll('.sidebar-nav-link');
  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'dashboard.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('active');
    }
  });
}

// 3. Mobile Navigation Menu Toggle (Public Pages)
function initMobileMenu() {
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const navLinks = document.getElementById('nav-links');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const isOpen = navLinks.classList.contains('open');
      menuToggle.setAttribute('aria-expanded', isOpen);
    });
  }
}

// 4. App Sidebar Mobile Toggle (Inner App Pages)
function initAppSidebar() {
  const toggleBtn = document.getElementById('app-mobile-menu-btn');
  const sidebar = document.querySelector('.app-sidebar');
  let backdrop = document.querySelector('.sidebar-backdrop');

  if (toggleBtn && sidebar) {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('visible');
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('visible');
    });
  }
}

// 5. Voice Speech Synthesis Helper (Elderly-Friendly Accessibility)
function setupSpeechSynthesisHelper() {
  window.speakText = function(text) {
    if (!('speechSynthesis' in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
    window.showToast?.('Reading aloud...', 'info');
  };
}
