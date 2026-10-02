// App shell shared by the dashboard, planner and account pages: the account
// block in the sidebar, and (outside the dashboard, which drives its own) the
// mobile menu that slides the sidebar in from the left.
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || 'M')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
  }

  function setUser(user) {
    var slot = document.getElementById('shell-user');
    if (!slot || !user) return;
    var name = [user.firstname, user.lastname].filter(Boolean).join(' ') || user.email || 'Account';
    slot.innerHTML = '<a class="acct" href="/account" title="Account settings">'
      + '<span class="av">' + escapeHtml(initials(name)) + '</span>'
      + '<span class="acct-t"><b>' + escapeHtml(name) + '</b><span>' + escapeHtml(user.email || '') + '</span></span></a>'
      + '<button class="side-link" id="logout-btn" type="button">'
      + '<svg class="ic" aria-hidden="true"><use href="/img/icons.svg#i-logout"></use></svg><span>Sign out</span></button>';
    document.getElementById('logout-btn').addEventListener('click', async function () {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.replace('/');
    });
  }

  function setMenuOpen(open) {
    var sidebar = document.getElementById('dashboard-sidebar');
    var toggle = document.getElementById('dashboard-menu-toggle');
    var backdrop = document.getElementById('dashboard-menu-backdrop');
    if (!sidebar || !toggle || !backdrop) return;
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('dashboard-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    backdrop.hidden = !open;
  }

  function bindMenu() {
    if (document.body.classList.contains('dashboard-page')) return;
    var toggle = document.getElementById('dashboard-menu-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      setMenuOpen(!document.getElementById('dashboard-sidebar').classList.contains('is-open'));
    });
    document.getElementById('dashboard-menu-backdrop')?.addEventListener('click', function () { setMenuOpen(false); });
    document.getElementById('dashboard-sidebar')?.addEventListener('click', function (event) {
      if (event.target.closest('a')) setMenuOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setMenuOpen(false);
    });
  }

  // The mobile top bar has its own sign-out button.
  document.addEventListener('click', async function (event) {
    if (!event.target.closest || !event.target.closest('[data-logout]')) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/');
  });

  window.Shell = { setUser: setUser, initials: initials };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindMenu);
  else bindMenu();
}());
