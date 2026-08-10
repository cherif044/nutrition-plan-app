function iconSvg(name, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    folder: '<path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  };
  return `<svg ${attrs}>${icons[name] || ''}</svg>`;
}

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
let allCustomers = [];
let allGeneralPlans = [];
let selectedCustomerId = null;
let customerPlanRequestId = 0;
const relativeUnits = [
  ['year', 31536000000],
  ['month', 2592000000],
  ['week', 604800000],
  ['day', 86400000],
  ['hour', 3600000],
  ['minute', 60000],
];

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';

  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60000) return 'Just now';
  for (const [unit, ms] of relativeUnits) {
    if (abs >= ms || unit === 'minute') {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return 'Just now';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function goalLabel(goal) {
  const labels = {
    maintain: 'Maintain',
    lose_weight: 'Lose weight',
    lose_weight_aggressive: 'Lose weight',
    gain_weight: 'Gain weight',
  };
  return labels[goal] || titleCase(goal);
}

function indicatorFor(plan) {
  if (plan.status && plan.status !== 'ok') {
    return { label: titleCase(plan.status), metric: 'calories' };
  }
  if (plan.goal) {
    const metric = plan.goal === 'gain_weight'
      ? 'carbG'
      : plan.goal === 'maintain'
        ? 'fatG'
        : 'proteinG';
    return { label: goalLabel(plan.goal), metric };
  }
  if (plan.dietType) {
    return { label: titleCase(plan.dietType), metric: 'proteinG' };
  }
  return null;
}

function planHref(plan) {
  const folderParam = plan.folder_id ? `&folderId=${encodeURIComponent(plan.folder_id)}` : '';
  return `/planner?planId=${encodeURIComponent(plan.id)}${folderParam}`;
}

function folderBreadcrumb(plan) {
  const path = Array.isArray(plan.folderPath) ? plan.folderPath : [];
  return ['General', ...path.map((item) => item.name)].join(' / ');
}

function renderStats(stats = {}) {
  document.getElementById('stat-total-plans').textContent = Number(stats.totalPlans || 0).toLocaleString();
  document.getElementById('stat-customers').textContent = Number(stats.customers || 0).toLocaleString();
  document.getElementById('stat-active-plans').textContent = Number(stats.activePlans || 0).toLocaleString();
}

function renderGeneralPlans(plans = allGeneralPlans) {
  const container = document.getElementById('recent-plans');
  const search = document.getElementById('general-plan-search');
  const query = search?.value.trim().toLowerCase() || '';
  const visiblePlans = query
    ? plans.filter((plan) => {
      const haystack = [plan.name, folderBreadcrumb(plan)].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    : plans;

  container.innerHTML = '';

  if (!visiblePlans.length) {
    const empty = document.createElement('div');
    empty.className = 'explorer-empty dashboard-empty';
    empty.innerHTML = `
      <span class="explorer-empty__icon" aria-hidden="true">${iconSvg('file', 20)}</span>
      <strong>${query ? 'No matching plans' : 'No general plans yet'}</strong>
      <p>${query ? 'Try another plan name.' : 'Plans without a customer will appear here.'}</p>
    `;
    container.append(empty);
    return;
  }

  visiblePlans.forEach((plan) => {
    const updatedAt = plan.updated_at || plan.created_at;
    const indicator = indicatorFor(plan);
    const card = document.createElement('a');
    card.className = 'dashboard-plan-card';
    card.href = planHref(plan);
    card.innerHTML = `
      <span class="dashboard-icon-square" data-tone="cal" aria-hidden="true">${iconSvg('file', 17)}</span>
      <span class="dashboard-plan-card__body">
        <span class="dashboard-plan-card__title">${escapeHtml(plan.name)}</span>
        <span class="dashboard-plan-card__path">${escapeHtml(folderBreadcrumb(plan))}</span>
        <span class="dashboard-plan-card__footer">
          <span>${escapeHtml(formatRelativeTime(updatedAt))}</span>
          ${plan.is_active ? '<span class="dashboard-badge">Active</span>' : ''}
          ${indicator ? `
            <span class="dashboard-plan-card__indicator metric metric--macro" data-metric="${escapeHtml(indicator.metric)}">
              <span class="metric__top"><span><i class="macro-dot" aria-hidden="true"></i>${escapeHtml(indicator.label)}</span></span>
              <span class="metric-bar" aria-hidden="true"><i></i></span>
            </span>
          ` : ''}
        </span>
      </span>
    `;
    container.append(card);
  });
}

function addGeneralPlans(plans, folderPath, bucket) {
  (plans || []).forEach((plan) => {
    if (plan.customer_id) return;
    bucket.push({ ...plan, folderPath });
  });
}

async function loadGeneralPlans() {
  const bucket = [];
  const rootRes = await fetch('/api/folders');
  if (!rootRes.ok) throw new Error('Failed to load general plans.');
  const rootData = await rootRes.json();
  addGeneralPlans(rootData.plans, [], bucket);

  const treeRes = await fetch('/api/folders/tree');
  if (treeRes.ok) {
    const { tree } = await treeRes.json();
    await loadFolderPlans(tree || [], [], bucket);
  }

  allGeneralPlans = bucket.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });
  renderGeneralPlans();
}

async function loadFolderPlans(nodes, parentPath, bucket) {
  for (const node of nodes) {
    const path = [...parentPath, { id: node.id, name: node.name }];
    const res = await fetch(`/api/folders/${encodeURIComponent(node.id)}`);
    if (res.ok) {
      const data = await res.json();
      addGeneralPlans(data.plans, path, bucket);
    }
    await loadFolderPlans(node.children || [], path, bucket);
  }
}

function renderCustomers(customers = []) {
  allCustomers = customers;
  renderCustomerList();
}

function renderCustomerList() {
  const container = document.getElementById('customers-list');
  const search = document.getElementById('customer-search');
  const query = search?.value.trim().toLowerCase() || '';
  const customers = query
    ? allCustomers.filter((customer) => customer.name.toLowerCase().includes(query))
    : allCustomers;

  container.innerHTML = '';

  if (!customers.length) {
    const empty = document.createElement('div');
    empty.className = 'explorer-empty dashboard-empty';
    empty.innerHTML = `
      <span class="explorer-empty__icon" aria-hidden="true">${iconSvg('user', 20)}</span>
      <strong>${query ? 'No matching customers' : 'No customers yet'}</strong>
      <p>${query ? 'Try another name.' : 'Attach a saved plan to a customer and they will appear here.'}</p>
    `;
    container.append(empty);
    return;
  }

  customers.forEach((customer) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dashboard-customer-card dashboard-list-row';
    if (String(customer.id) === String(selectedCustomerId)) row.classList.add('is-selected');
    row.innerHTML = `
      <span class="dashboard-icon-square" data-tone="protein" aria-hidden="true">${iconSvg('user', 17)}</span>
      <span class="dashboard-customer-card__body">
        <strong>${escapeHtml(customer.name)}</strong>
        <small>${Number(customer.planCount || 0)} plan${Number(customer.planCount || 0) === 1 ? '' : 's'}</small>
        <small>${customer.activePlan ? `Active: ${escapeHtml(customer.activePlan.name)}` : 'No active plan'}</small>
      </span>
    `;
    row.addEventListener('click', () => loadCustomerPlans(customer, row));
    container.append(row);
  });
}

async function loadCustomerPlans(customer, row) {
  if (String(selectedCustomerId) === String(customer.id)) return;
  selectedCustomerId = customer.id;
  const requestId = ++customerPlanRequestId;
  document.querySelectorAll('.dashboard-customer-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
  row?.classList.add('is-selected');

  const panel = document.getElementById('selected-customer-plans');
  panel.hidden = false;
  panel.innerHTML = `<p class="dashboard-customer-plans__title">${escapeHtml(customer.name)} plans</p>`;

  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(customer.id)}/plans`);
    if (!res.ok) throw new Error('Failed to load customer plans.');
    const { plans } = await res.json();
    if (requestId !== customerPlanRequestId) return;
    const title = document.createElement('p');
    title.className = 'dashboard-customer-plans__title';
    title.textContent = `${customer.name} plans`;
    if (!plans.length) {
      const empty = document.createElement('p');
      empty.className = 'message';
      empty.textContent = 'No plans for this customer.';
      panel.replaceChildren(title, empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'dashboard-customer-plan-list';
    plans.forEach((plan) => {
      const link = document.createElement('a');
      link.className = 'dashboard-customer-plan-row';
      link.href = planHref(plan);
      link.innerHTML = `
        <span>${escapeHtml(plan.name)}</span>
        ${plan.is_active ? '<span class="dashboard-badge">Active</span>' : ''}
      `;
      list.append(link);
    });
    panel.replaceChildren(title, list);
  } catch {
    if (requestId !== customerPlanRequestId) return;
    const title = document.createElement('p');
    title.className = 'dashboard-customer-plans__title';
    title.textContent = `${customer.name} plans`;
    const error = document.createElement('p');
    error.className = 'message';
    error.textContent = 'Failed to load customer plans.';
    panel.replaceChildren(title, error);
  }
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
    <a class="planner-nav__link" href="/dashboard" aria-label="Home" aria-current="page">${iconSvg('home')}<span>Home</span></a>
    <button class="planner-nav__link" id="logout-btn" type="button" aria-label="Log out">${iconSvg('logout')}<span>Log out</span></button>
  `;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/');
  });

  return true;
}

async function initDashboard() {
  const authed = await initNav();
  if (!authed) return;

  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Failed to load dashboard.');
    const data = await res.json();
    renderStats(data.stats);
    renderCustomers(data.customers);
    await loadGeneralPlans();
    document.getElementById('customer-search')?.addEventListener('input', renderCustomerList);
    document.getElementById('general-plan-search')?.addEventListener('input', () => renderGeneralPlans());
  } catch {
    document.getElementById('dashboard-message').textContent = 'Failed to load dashboard.';
  }
}

document.querySelector('.dashboard-action-tile [data-tone="protein"]').innerHTML = iconSvg('plus', 17);
initDashboard();
