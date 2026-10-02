// Light/dark theme. Loaded without defer in <head> so the saved choice is on
// <html> before the first paint; with no saved choice the system setting wins.
(function () {
  var KEY = 'macrospace.theme';
  var root = document.documentElement;

  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch (_) { /* storage blocked: follow the system */ }

  function currentTheme() {
    if (root.dataset.theme === 'light' || root.dataset.theme === 'dark') return root.dataset.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function syncButtons() {
    var theme = currentTheme();
    document.querySelectorAll('[data-theme-set]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.themeSet === theme));
    });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-theme-set]');
    if (!button) return;
    var theme = button.dataset.themeSet === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (_) { /* not remembered */ }
    syncButtons();
  });

  if (window.matchMedia) {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    if (query.addEventListener) query.addEventListener('change', syncButtons);
  }
  document.addEventListener('DOMContentLoaded', syncButtons);
}());
