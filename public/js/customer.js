function iconSvg(name, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    folder: '<path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  };
  return `<svg ${attrs}>${icons[name] || ''}</svg>`;
}

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const relativeUnits = [
  ['year', 31536000000],
  ['month', 2592000000],
  ['week', 604800000],
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60000) return 'Just now';
  for (const [unit, ms] of relativeUnits) {
    if (abs >= ms || unit === 'minute') return formatter.format(Math.round(diff / ms), unit);
  }
  return 'Just now';
}

function customerIdFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[0] === 'customers' ? parts[1] : null;
}

function planHref(plan) {
  const folderParam = plan.folder_id ? `&folderId=${encodeURIComponent(plan.folder_id)}` : '';
  return `/planner?planId=${encodeURIComponent(plan.id)}${folderParam}`;
}

async function initNav() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.replace('/login');
    return false;
  }
  const { user } = await res.json();
  document.getElementById('planner-nav-user').innerHTML = `
    <span class="planner-nav__greeting">Hi, ${escapeHtml(user.firstname)}</span>
    <a class="planner-nav__link" href="/dashboard" aria-label="Home">${iconSvg('home')}<span>Home</span></a>
    <button class="planner-nav__link" id="logout-btn" type="button" aria-label="Log out">${iconSvg('logout')}<span>Log out</span></button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/');
  });
  return true;
}

async function loadCustomer() {
  const id = customerIdFromPath();
  const message = document.getElementById('customer-message');
  if (!id) {
    message.textContent = 'Customer not found.';
    return;
  }

  const res = await fetch(`/api/customers/${encodeURIComponent(id)}/plans`);
  if (!res.ok) {
    message.textContent = 'Customer not found.';
    return;
  }
  const { customer, plans } = await res.json();
  document.title = `${customer.name} — Pinch`;
  document.getElementById('customer-title').textContent = customer.name;
  document.getElementById('customer-subtitle').textContent = `${plans.length} plan${plans.length === 1 ? '' : 's'}`;
  document.querySelector('.customer-header-card .dashboard-icon-square').innerHTML = iconSvg('user', 17);
  renderPlans(plans);
}

function renderPlans(plans) {
  const container = document.getElementById('customer-plans');
  container.innerHTML = '';
  if (!plans.length) {
    container.innerHTML = `
      <div class="explorer-empty dashboard-empty">
        <span class="explorer-empty__icon" aria-hidden="true">${iconSvg('file', 20)}</span>
        <strong>No plans yet</strong>
        <p>Saved customer plans will appear here.</p>
      </div>
    `;
    return;
  }

  plans.forEach((plan) => {
    const card = document.createElement('article');
    card.className = 'customer-plan-card';
    card.innerHTML = `
      <span class="dashboard-icon-square" data-tone="${plan.is_active ? 'protein' : 'cal'}" aria-hidden="true">${iconSvg('file', 17)}</span>
      <span class="dashboard-plan-card__body">
        <span class="dashboard-plan-card__title">${escapeHtml(plan.name)}</span>
        <span class="dashboard-plan-card__path">${plan.folder_id ? 'Folder linked' : 'Home'}</span>
        <span class="dashboard-plan-card__footer">
          <span>${escapeHtml(formatRelativeTime(plan.updated_at || plan.created_at))}</span>
          ${plan.is_active ? '<span class="dashboard-badge">Active</span>' : ''}
        </span>
      </span>
      <span class="customer-plan-actions">
        <a class="customer-plan-action" href="${planHref(plan)}" title="Edit plan" aria-label="Edit ${escapeHtml(plan.name)}">${iconSvg('edit', 15)}</a>
        <button class="customer-plan-action" type="button" title="Duplicate plan" aria-label="Duplicate ${escapeHtml(plan.name)}" data-action="duplicate" data-plan-id="${plan.id}" data-plan-name="${escapeHtml(plan.name)}" data-folder-id="${plan.folder_id || ''}">${iconSvg('copy', 15)}</button>
        <button class="customer-plan-action customer-plan-action--danger" type="button" title="Delete plan" aria-label="Delete ${escapeHtml(plan.name)}" data-action="delete" data-plan-id="${plan.id}" data-plan-name="${escapeHtml(plan.name)}">${iconSvg('trash', 15)}</button>
      </span>
    `;
    container.append(card);
  });
}

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const planId = btn.dataset.planId;
  const planName = btn.dataset.planName;
  const message = document.getElementById('customer-message');
  message.textContent = '';

  if (action === 'delete') {
    if (!confirm(`Delete plan "${planName}"?`)) return;
    const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    if (!res.ok) {
      message.textContent = 'Failed to delete plan.';
      return;
    }
    await loadCustomer();
  }

  if (action === 'duplicate') {
    const targetFolderId = btn.dataset.folderId || null;
    const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFolderId, newName: `${planName} (copy)` }),
    });
    if (!res.ok) {
      message.textContent = 'Failed to duplicate plan.';
      return;
    }
    await loadCustomer();
  }
});

(async () => {
  const authed = await initNav();
  if (authed) await loadCustomer();
})();
