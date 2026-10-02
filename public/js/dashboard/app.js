function icon(name, extraClass = '') {
  return `<svg class="ic${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true"><use href="/img/icons.svg#i-${name}"></use></svg>`;
}

const PLAN_CALORIE_RANGE_SIZE = 200;
const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'athlete'];
const SEX_FOLDERS = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['unset', 'Sex not set'],
];

const state = {
  user: null,
  stats: {},
  recentPlans: [],
  expiringPlans: [],
  // One server page at a time; search and filters are applied server-side.
  customersPage: null,
  plansPage: null,
  customerPage: 1,
  planPage: 1,
  detailPage: 1,
  detailCustomerId: null,
  // Set by the route: a sex folder for clients, a calorie folder for plans.
  customerSex: '',
  planFilter: null,
  customerSearch: '',
  groupSearch: '',
  planSearch: '',
  loadTokens: { customers: 0, plans: 0, detail: 0 },
  menu: null,
  menuTrigger: null,
  menuOpenedAt: 0,
};

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

function initials(name) {
  const parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'P') + (parts[1]?.[0] || '')).toUpperCase();
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function planHref(plan) {
  return `/planner?planId=${encodeURIComponent(plan.id)}&view=plan`;
}

function planExportHref(plan) {
  return `/api/plans/${encodeURIComponent(plan.id)}/export.pdf`;
}

function pdfDownloadName(planName) {
  const base = String(planName || 'nutrition-plan')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'nutrition-plan';
  return `${base}.pdf`;
}

function rangeLabel(key) {
  const [min, max] = String(key).split('-').map(Number);
  return `${formatNumber(min)}–${formatNumber(max)} kcal`;
}

function sortCalorieRangeKeys(keys) {
  return [...keys].sort((a, b) => {
    const left = Number(String(a).split('-')[0]);
    const right = Number(String(b).split('-')[0]);
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    return String(a).localeCompare(String(b));
  });
}

function validCalorieRange(value) {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(String(value || ''));
  if (!match) return null;
  const start = Number(match[1]);
  return start % PLAN_CALORIE_RANGE_SIZE === 0 && Number(match[2]) === start + PLAN_CALORIE_RANGE_SIZE
    ? `${start}-${start + PLAN_CALORIE_RANGE_SIZE}`
    : null;
}

// ── Plan pieces ──────────────────────────────────────────────────────────────

function planStatus(plan) {
  return window.PlanStatus?.status(plan) || null;
}

function canRenew(status) {
  return status?.state === 'expired';
}

function statusLine(status) {
  if (!status) return '<span class="st none"><i></i>No schedule</span>';
  return `<span class="st ${status.state}"><i></i>${escapeHtml(status.label)}</span>`;
}

function macroCell(plan) {
  const calories = Number(plan.calories) || 0;
  const protein = Number(plan.protein_g) || 0;
  const carbs = Number(plan.carbs_g) || 0;
  const fat = Number(plan.fat_g) || 0;
  if (!calories && !protein && !carbs && !fat) return '<span class="na">—</span>';
  const kcal = { p: protein * 4, c: carbs * 4, f: fat * 9 };
  const hasSplit = kcal.p + kcal.c + kcal.f > 0;
  return `
    <div class="mx">
      <div class="mx-k"><b>${formatNumber(calories)}</b> kcal</div>
      ${hasSplit ? `
        <div class="mx-bar" aria-hidden="true"><i class="mx-p" style="flex:${kcal.p}"></i><i class="mx-c" style="flex:${kcal.c}"></i><i class="mx-f" style="flex:${kcal.f}"></i></div>
        <div class="mx-g">
          <span><i class="mx-p"></i><span class="mx-w">Protein</span><span class="show-s-i">P</span><b>${formatNumber(protein)}g</b></span>
          <span><i class="mx-c"></i><span class="mx-w">Carbs</span><span class="show-s-i">C</span><b>${formatNumber(carbs)}g</b></span>
          <span><i class="mx-f"></i><span class="mx-w">Fat</span><span class="show-s-i">F</span><b>${formatNumber(fat)}g</b></span>
        </div>` : ''}
    </div>`;
}

function renewButton(plan, status, className = 'btn btn-secondary btn-sm', show = canRenew(status)) {
  if (!show) return '';
  return `<button type="button" class="${className} renew-btn" data-plan-id="${escapeHtml(plan.id)}" data-plan-name="${escapeHtml(plan.name)}">Renew</button>`;
}

function planMenuButton(plan) {
  return `<button
    class="iconbtn dashboard-plan-menu-btn"
    type="button"
    title="Plan options"
    aria-label="More actions for ${escapeHtml(plan.name)}"
    data-plan-id="${escapeHtml(plan.id)}"
    data-plan-name="${escapeHtml(plan.name)}"
    data-customer-id="${escapeHtml(plan.customer_id || '')}"
    data-export-href="${escapeHtml(planExportHref(plan))}"
  >${icon('more')}</button>`;
}

function planTableRow(plan, index = 0) {
  const status = planStatus(plan);
  return `
    <tr data-href="${escapeHtml(planHref(plan))}" style="--i:${index}">
      <td>
        <div class="who">
          <span class="tile">${icon('list')}</span>
          <div>
            <b><a href="${escapeHtml(planHref(plan))}">${escapeHtml(plan.name)}</a></b>
            <div class="hint">${statusLine(status)}</div>
          </div>
        </div>
      </td>
      <td>${macroCell(plan)}</td>
      <td class="r"><div class="row-actions"><span class="hide-s">${renewButton(plan, status)}</span>${planMenuButton(plan)}</div></td>
    </tr>
  `;
}

function emptyTableRow(columns, html) {
  return `<tr><td colspan="${columns}" class="dt-empty">${html}</td></tr>`;
}

// ── Client pieces ────────────────────────────────────────────────────────────

function activityPill(level) {
  const rank = ACTIVITY_LEVELS.indexOf(level) + 1;
  if (!rank) return '';
  const dots = [1, 2, 3, 4].map((step) => `<i class="${step <= rank ? 'on' : ''}" style="--d:${step * 110}ms"></i>`).join('');
  return `<span class="act"><span class="adots" aria-hidden="true">${dots}</span><span class="pill">${escapeHtml(titleCase(level))}</span></span>`;
}

function activityDots(level) {
  const rank = ACTIVITY_LEVELS.indexOf(level) + 1;
  if (!rank) return '<span class="na">—</span>';
  const dots = [1, 2, 3, 4].map((step) => `<i class="${step <= rank ? 'on' : ''}" style="--d:${step * 90}ms"></i>`).join('');
  return `<span class="act"><span class="adots" aria-hidden="true">${dots}</span><span>${escapeHtml(titleCase(level))}</span></span>`;
}

function valueWithUnit(value, unit) {
  if (value === null || value === undefined || value === '') return '<span class="na">—</span>';
  const number = Number(value);
  const shown = Number.isFinite(number) ? number.toLocaleString('en-US') : value;
  return `${escapeHtml(shown)}<span class="unit"> ${unit}</span>`;
}

function addedLabel(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  if (Date.now() - date.getTime() < 86400000) return 'added today';
  return `added ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

function customerTableRow(customer) {
  const count = Number(customer.planCount || 0);
  const name = customer.name || 'Client';
  const plans = count ? `${count} plan${count === 1 ? '' : 's'}` : 'No plans';
  const added = addedLabel(customer.created_at);
  const mobile = [customer.age ? `${customer.age} y` : '', customer.weight ? `${Number(customer.weight)} kg` : '', plans]
    .filter(Boolean).join(' · ');
  const href = `#/customers/${encodeURIComponent(customer.id)}`;
  return `
    <tr data-href="${href}" data-customer-id="${escapeHtml(customer.id)}">
      <td>
        <div class="who">
          <span class="av" aria-hidden="true">${escapeHtml(initials(name))}</span>
          <div>
            <b class="pc-row__name"><a href="${href}">${escapeHtml(name)}</a></b>
            <div class="hint hide-s">${escapeHtml(plans)}${added ? ` · ${escapeHtml(added)}` : ''}</div>
            <div class="hint show-s">${escapeHtml(mobile)}</div>
          </div>
        </div>
      </td>
      <td class="hide-s">${valueWithUnit(customer.age, 'y')}</td>
      <td class="hide-s">${valueWithUnit(customer.weight, 'kg')}</td>
      <td class="hide-s">${valueWithUnit(customer.height, 'cm')}</td>
      <td>${activityDots(customer.activity_level)}</td>
    </tr>
  `;
}

function sexFolderHref(sex) {
  return `#/customers/group/${encodeURIComponent(sex || 'unset')}`;
}

function sexLabel(sex) {
  return (SEX_FOLDERS.find(([key]) => key === (sex || 'unset')) || SEX_FOLDERS[2])[1];
}

function folderCard(href, title, subtitle, count, onCount = null) {
  const spark = onCount === null ? '' : `<div class="fspark" aria-hidden="true">${
    Array.from({ length: Math.min(count, 12) }, (_, i) => `<i class="${i < onCount ? 'on' : ''}"></i>`).join('')
  }</div>`;
  return `
    <a class="box folder" href="${href}">
      <span class="folder-ic">${icon('folder')}</span>
      <div><div class="folder-t">${escapeHtml(title)}</div><div class="folder-s">${escapeHtml(subtitle)}</div>${spark}</div>
      <b class="folder-n">${Number(count).toLocaleString('en-US')}</b>
      ${icon('chev', 'folder-go')}
    </a>
  `;
}

// ── Home ─────────────────────────────────────────────────────────────────────

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 5 ? 'Welcome back' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = String(state.user?.firstname || '').trim();
  return firstName ? `${part}, ${firstName}` : part;
}

function statusRing(onTrack, endingSoon, expired) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const total = onTrack + endingSoon + expired;
  let offset = 0;
  const segment = (count, className) => {
    if (!count || !total) return '';
    const length = circumference * count / total;
    const gap = total > 1 && count < total ? 2 : 0;
    const circle = `<circle r="${radius}" cx="38" cy="38" class="${className}" stroke-dasharray="${(length - gap).toFixed(1)} ${circumference.toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}"/>`;
    offset += length;
    return circle;
  };
  return `<circle r="${radius}" cx="38" cy="38" class="hm-trk"/>${segment(onTrack, 'hm-on')}${segment(endingSoon, 'hm-soon')}${segment(expired, 'hm-ex')}`;
}

function homePlanRow(plan) {
  const status = planStatus(plan);
  const owner = plan.customer_name || 'General plan';
  let progress = '<span class="hm-exp">No schedule</span>';
  let mobileWeek = '';
  if (status?.state === 'expired') {
    progress = '<span class="hm-exp">Expired</span>';
  } else if (status) {
    const segments = Array.from({ length: status.weeks }, (_, i) => {
      const cls = i < status.week - 1 ? 'done' : i === status.week - 1 ? 'now' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
    const weekText = status.week ? `Week ${status.week}<span class="hm-of"> of ${status.weeks}</span>` : 'Not started';
    progress = `<div class="hm-wk"><span>${weekText}</span><em>ends ${escapeHtml(status.endLabel)}</em></div><div class="hm-segs" style="--n:${status.weeks}">${segments}</div>`;
    mobileWeek = status.week ? ` · Wk ${status.week}/${status.weeks}` : '';
  }
  return `
    <li>
      <a class="hm-row" href="${escapeHtml(planHref(plan))}">
        <div class="hm-main"><div class="hm-pn">${escapeHtml(plan.name)}</div><div class="hm-sub">${escapeHtml(owner)}<span class="hm-wkm">${escapeHtml(mobileWeek)}</span></div></div>
        <div class="hm-prog">${progress}</div>
      </a>
    </li>
  `;
}

function homeExpiringRow(plan) {
  const status = planStatus(plan);
  if (!status) return '';
  const end = status.end;
  const warn = status.state === 'expired' || status.daysLeft <= 7;
  return `
    <li>
      <div class="hm-row">
        <div class="hm-day"><small>${escapeHtml(end.toLocaleDateString('en-GB', { month: 'short' }))}</small><b>${end.getDate()}</b></div>
        <a class="hm-main hm-link" href="${escapeHtml(planHref(plan))}">
          <div class="hm-pn">${escapeHtml(plan.name)}</div>
          <div class="hm-sub${warn ? ' warn' : ''}">${escapeHtml(status.state === 'expired' ? 'Expired' : status.label)}${renewButton(plan, status, 'hm-rn', warn)}</div>
        </a>
        ${renewButton(plan, status, 'btn btn-secondary btn-sm hm-renew', warn)}
      </div>
    </li>
  `;
}

function renderStats() {
  const stats = state.stats || {};
  const customers = Number(stats.customers || 0);
  const totalPlans = Number(stats.totalPlans || 0);
  const status = stats.planStatus || {};
  const onTrack = Number(status.onTrack || 0);
  const endingSoon = Number(status.endingSoon || 0);
  const expired = Number(status.expired || 0);
  const running = onTrack + endingSoon;
  const bySex = stats.customersBySex || {};
  const female = bySex.female?.total || 0;
  const male = bySex.male?.total || 0;

  document.getElementById('nav-count-customers').textContent = customers ? customers.toLocaleString('en-US') : '';
  document.getElementById('nav-count-plans').textContent = totalPlans ? totalPlans.toLocaleString('en-US') : '';
  document.getElementById('home-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('dashboard-title').textContent = greeting();
  document.getElementById('dashboard-hero-sub').innerHTML = `
    <b class="hm-b">${customers.toLocaleString('en-US')}</b> client${customers === 1 ? '' : 's'}${customers ? ` (${female} F · ${male} M)` : ''}
    <span class="hm-dot"></span><b class="hm-b">${running.toLocaleString('en-US')}</b> plan${running === 1 ? '' : 's'} running
  `;

  document.getElementById('home-status-total').textContent = `${totalPlans.toLocaleString('en-US')} plan${totalPlans === 1 ? '' : 's'}`;
  document.getElementById('home-status').innerHTML = `
    <div class="hm-ring" role="img" aria-label="${onTrack} on track, ${endingSoon} ending soon, ${expired} expired">
      <svg viewBox="0 0 76 76">${statusRing(onTrack, endingSoon, expired)}</svg>
      <div class="hm-rc"><b>${running}</b><span>active</span></div>
    </div>
    <div class="hm-lg">
      <div class="on">On track<b>${onTrack}</b></div>
      <div class="soon">Ending soon<b>${endingSoon}</b></div>
      <div class="ex">Expired<b>${expired}</b></div>
    </div>
  `;

  const ranges = stats.activeCalorieRanges || [];
  const max = Math.max(1, ...ranges.map((range) => range.count));
  const short = (value) => (value / 1000).toFixed(1).replace(/\.0$/, '');
  document.getElementById('home-calorie-ranges').innerHTML = ranges.length
    ? ranges.map((range) => {
      const [min, top] = range.key.split('-').map(Number);
      return `<div class="hm-hr"><span>${short(min)}–${short(top)}k</span><div class="hm-tr"><i style="width:${(range.count / max) * 100}%"></i></div><b>${range.count}</b></div>`;
    }).join('')
    : '<p class="hm-empty">No active plans yet.</p>';
}

function renderHome() {
  renderStats();
  const plans = state.recentPlans.slice(0, 4);
  document.getElementById('home-plans-list').innerHTML = plans.length
    ? plans.map(homePlanRow).join('')
    : '<li><div class="hm-row hm-none">No plans yet.</div></li>';
  const expiring = state.expiringPlans.slice(0, 4);
  document.getElementById('home-expiring-list').innerHTML = expiring.length
    ? expiring.map(homeExpiringRow).join('')
    : '<li><div class="hm-row hm-none">Nothing ending soon.</div></li>';
}

// ── Lists ────────────────────────────────────────────────────────────────────

function listQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  });
  return search.toString();
}

function scrollListIntoView(elementId) {
  document.getElementById(elementId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function customerListTargets() {
  return state.customerSex
    ? { list: 'group-customers-list', pager: 'group-customers-pager', search: state.groupSearch }
    : { list: 'customers-list', pager: 'customers-pager', search: state.customerSearch };
}

function planListTargets() {
  return state.planFilter
    ? { list: 'folder-plans', pager: 'folder-plans-pager' }
    : { list: 'recent-plans', pager: 'plans-pager' };
}

// Each loader ignores responses that arrive after a newer request started,
// so fast typing or clicking never renders an out-of-date page.
async function loadCustomersPage(page = state.customerPage) {
  const token = ++state.loadTokens.customers;
  const { list, search } = customerListTargets();
  const res = await fetch(`/api/dashboard/customers?${listQuery({ page, query: search, sex: state.customerSex })}`);
  if (token !== state.loadTokens.customers) return;
  if (!res.ok) {
    document.getElementById(list).innerHTML = emptyTableRow(5, 'Failed to load clients.');
    return;
  }
  const data = await res.json();
  if (token !== state.loadTokens.customers) return;
  if (data.total > 0 && page > data.totalPages) {
    loadCustomersPage(data.totalPages);
    return;
  }
  state.customerPage = data.page;
  state.customersPage = data;
  renderCustomersPage();
}

async function loadPlansPage(page = state.planPage) {
  const token = ++state.loadTokens.plans;
  const query = listQuery({ page, query: state.planFilter ? '' : state.planSearch, calorieRange: state.planFilter });
  const res = await fetch(`/api/dashboard/plans?${query}`);
  if (token !== state.loadTokens.plans) return;
  if (!res.ok) {
    document.getElementById(planListTargets().list).innerHTML = emptyTableRow(3, 'Failed to load plans.');
    return;
  }
  const data = await res.json();
  if (token !== state.loadTokens.plans) return;
  if (data.total > 0 && page > data.totalPages) {
    loadPlansPage(data.totalPages);
    return;
  }
  state.planPage = data.page;
  state.plansPage = data;
  renderPlansPage();
}

function renderCustomerFolders() {
  const bySex = state.stats.customersBySex || {};
  const total = Number(state.stats.customers || 0);
  const female = bySex.female?.total || 0;
  const male = bySex.male?.total || 0;
  document.getElementById('customers-subtitle').textContent =
    `${total.toLocaleString('en-US')} client${total === 1 ? '' : 's'}: ${female} female, ${male} male.`;
  const folders = SEX_FOLDERS
    .filter(([key]) => key !== 'unset' || bySex.unset?.total)
    .map(([key, label]) => {
      const group = bySex[key] || { total: 0, ongoing: 0 };
      const sub = `${group.total} client${group.total === 1 ? '' : 's'}, ${group.ongoing} with an ongoing plan`;
      return folderCard(sexFolderHref(key), label, sub, group.total, group.ongoing);
    });
  document.getElementById('customer-folders').innerHTML = total
    ? folders.join('')
    : `<div class="box empty folders-empty"><h3>No clients yet</h3><p>Add a client once and every plan for them starts from their profile.</p><a class="btn btn-primary" href="#/customers/new">Add client</a></div>`;
}

function renderCustomersPage() {
  const data = state.customersPage;
  if (!data) return;
  const { list, pager } = customerListTargets();

  if (state.customerSex) {
    const group = state.stats.customersBySex?.[state.customerSex];
    document.getElementById('group-subtitle').textContent = state.groupSearch
      ? `${data.total} of ${group?.total ?? data.total} clients`
      : `${data.total} client${data.total === 1 ? '' : 's'}`;
  }

  document.getElementById(list).innerHTML = data.items.length
    ? data.items.map(customerTableRow).join('')
    : emptyTableRow(5, data.summary.totalCustomers ? 'No clients match that search.' : 'No clients here yet.');
  renderPagination(document.getElementById(pager), data, (page) => {
    loadCustomersPage(page).then(() => scrollListIntoView(list));
  });
}

function renderPlanFolders(summary) {
  const counts = summary.calorieRangeCounts || {};
  const active = summary.calorieRangeActiveCounts || {};
  const keys = sortCalorieRangeKeys(Object.keys(counts));
  document.getElementById('plan-folders').innerHTML = keys.length
    ? keys.map((key) => {
      const count = counts[key];
      const ongoing = active[key] || 0;
      return folderCard(`#/plans/band/${encodeURIComponent(key)}`, rangeLabel(key), `${count} plan${count === 1 ? '' : 's'}, ${ongoing} ongoing`, count, ongoing);
    }).join('')
    : `<div class="box empty folders-empty"><h3>No plans yet</h3><p>Generated general plans land here, in folders by daily calories.</p><a class="btn btn-primary" href="/planner">Create your first plan</a></div>`;
}

function renderPlansPage() {
  const data = state.plansPage;
  if (!data) return;
  const { totalGeneralPlans } = data.summary;
  const { list, pager } = planListTargets();

  if (state.planFilter) {
    document.getElementById('folder-title').textContent = rangeLabel(state.planFilter);
    document.getElementById('folder-subtitle').textContent = `${data.total} plan${data.total === 1 ? '' : 's'} in this folder`;
  } else {
    document.getElementById('plans-subtitle').textContent =
      `${totalGeneralPlans.toLocaleString('en-US')} general plan${totalGeneralPlans === 1 ? '' : 's'}, in folders by daily calories.`;
    renderPlanFolders(data.summary);
    const searching = Boolean(state.planSearch);
    document.getElementById('plan-folders').hidden = searching;
    document.getElementById('plan-results').hidden = !searching;
  }

  document.getElementById(list).innerHTML = data.items.length
    ? data.items.map(planTableRow).join('')
    : emptyTableRow(3, totalGeneralPlans ? 'No plans match.' : 'No plans yet.');
  renderPagination(document.getElementById(pager), data, (page) => {
    loadPlansPage(page).then(() => scrollListIntoView(list));
  });
}

function customerDetailRows(customer) {
  const na = '<span class="cp-na">—</span>';
  const row = (iconName, label, value) => `
    <div class="cp-row"><span class="cp-rl"><i class="cp-ic">${icon(iconName)}</i>${label}</span><b>${value || na}</b></div>`;
  return [
    row('person', 'Sex', customer.sex ? escapeHtml(titleCase(customer.sex)) : ''),
    row('cal', 'Age', customer.age ? `${escapeHtml(customer.age)} years` : ''),
    row('ruler', 'Height', customer.height ? `${escapeHtml(Number(customer.height))} cm` : ''),
    row('weight', 'Weight', customer.weight ? `${escapeHtml(Number(customer.weight))} kg` : ''),
    row('pulse', 'Activity level', activityPill(customer.activity_level)),
  ].join('');
}

async function renderCustomerDetail(customerId, page = 1) {
  const pageEl = document.getElementById('page-customer-detail');
  const token = ++state.loadTokens.detail;
  const sameCustomer = state.detailCustomerId === String(customerId);
  state.detailCustomerId = String(customerId);
  state.detailPage = page;
  if (page === 1 && !sameCustomer) {
    document.getElementById('detail-customer-title').textContent = '';
    document.getElementById('detail-customer-avatar').textContent = '';
    document.getElementById('detail-customer-details').innerHTML = '';
    document.getElementById('detail-plan-count').textContent = '';
    document.getElementById('detail-customer-plans').innerHTML = emptyTableRow(3, 'Loading plans…');
  }

  let data;
  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/plans?${listQuery({ page })}`);
    if (res.status === 404) {
      location.hash = '#/customers';
      return;
    }
    if (!res.ok) throw new Error('Failed to load client plans.');
    data = await res.json();
  } catch {
    if (token === state.loadTokens.detail && pageEl.classList.contains('is-active')) {
      document.getElementById('detail-plan-count').textContent = '';
      document.getElementById('detail-customer-plans').innerHTML = emptyTableRow(3, 'Failed to load client plans.');
    }
    return;
  }
  if (token !== state.loadTokens.detail) return;

  const { customer, plans, pagination } = data;
  if (pagination.total > 0 && page > pagination.totalPages) {
    renderCustomerDetail(customerId, pagination.totalPages);
    return;
  }
  const total = pagination.total;
  const firstName = String(customer.name || '').split(/\s+/)[0] || 'this client';
  document.getElementById('detail-back-link').href = customer.sex ? sexFolderHref(customer.sex) : '#/customers';
  document.getElementById('detail-back-label').textContent = customer.sex ? `${sexLabel(customer.sex)} clients` : 'Clients';
  document.getElementById('detail-customer-avatar').textContent = initials(customer.name);
  document.getElementById('detail-customer-title').textContent = customer.name;
  document.getElementById('detail-customer-details').innerHTML = customerDetailRows(customer);
  document.getElementById('detail-edit-link').href = `#/customers/${encodeURIComponent(customer.id)}/edit`;
  document.getElementById('detail-add-plan-link').href = `/planner?customerId=${encodeURIComponent(customer.id)}`;
  document.getElementById('detail-plan-count').textContent = `${total} plan${total === 1 ? '' : 's'}`;
  document.getElementById('detail-customer-plans').innerHTML = plans.length
    ? plans.map(planTableRow).join('')
    : emptyTableRow(3, `<div class="empty empty--inline"><h3>No plans for ${escapeHtml(firstName)} yet</h3><p>One click builds a full day from this profile.</p><a class="btn btn-primary" href="/planner?customerId=${encodeURIComponent(customer.id)}">Generate plan</a></div>`);
  renderPagination(document.getElementById('detail-plans-pager'), pagination, (nextPage) => {
    renderCustomerDetail(customerId, nextPage).then(() => scrollListIntoView('detail-customer-plans'));
  });
}

// ── Client forms ─────────────────────────────────────────────────────────────

function customerFormPayload(form) {
  const formData = new FormData(form);
  return {
    name: formData.get('name'),
    age: formData.get('age'),
    sex: formData.get('sex') || '',
    weightKg: formData.get('weightKg'),
    heightCm: formData.get('heightCm'),
    activityLevel: formData.get('activityLevel') || '',
  };
}

function setRadioValue(form, name, value) {
  form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === (value || '');
  });
}

function setCustomerFormValues(form, customer) {
  form.elements.namedItem('id').value = customer.id;
  form.elements.namedItem('name').value = customer.name || '';
  form.elements.namedItem('age').value = customer.age || '';
  setRadioValue(form, 'sex', customer.sex);
  form.elements.namedItem('weightKg').value = customer.weight || '';
  form.elements.namedItem('heightCm').value = customer.height || '';
  setRadioValue(form, 'activityLevel', customer.activity_level);
}

async function renderCustomerEdit(customerId) {
  const form = document.getElementById('edit-customer-form');
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`);
  if (!res.ok) {
    location.hash = '#/customers';
    return;
  }
  const { customer } = await res.json();
  document.getElementById('edit-customer-title').textContent = `Edit ${customer.name}`;
  document.getElementById('edit-customer-back').href = `#/customers/${encodeURIComponent(customer.id)}`;
  document.getElementById('edit-customer-delete').dataset.customerName = customer.name;
  setCustomerFormValues(form, customer);
}

// ── Routing ──────────────────────────────────────────────────────────────────

function setActiveNav(route) {
  document.querySelectorAll('[data-route]').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.route === route);
  });
}

function setMobileNavOpen(open) {
  const sidebar = document.getElementById('dashboard-sidebar');
  const toggle = document.getElementById('dashboard-menu-toggle');
  const backdrop = document.getElementById('dashboard-menu-backdrop');
  if (!sidebar || !toggle || !backdrop) return;

  sidebar.classList.toggle('is-open', open);
  document.body.classList.toggle('dashboard-menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  backdrop.hidden = !open;
}

function showPage(pageId, route) {
  document.querySelectorAll('.dashboard-page-view').forEach((page) => {
    page.classList.toggle('is-active', page.id === pageId);
  });
  setActiveNav(route);
  hideDashboardMenu();
  setMobileNavOpen(false);
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  return parts.length ? parts : ['home'];
}

function setCustomerSex(sex) {
  if (state.customerSex === sex) return;
  state.customerSex = sex;
  state.customerPage = 1;
  state.customersPage = null;
}

function setPlanFilter(range) {
  if (state.planFilter === range) return;
  state.planFilter = range;
  state.planPage = 1;
  state.plansPage = null;
}

function renderRoute() {
  const parts = parseHash();
  const section = parts[0];

  if (section === 'customers') {
    if (parts[1] === 'new') {
      showPage('page-customer-new', 'customers');
    } else if (parts[1] === 'group' && ['female', 'male', 'unset'].includes(parts[2])) {
      setCustomerSex(parts[2]);
      document.getElementById('group-title').textContent = parts[2] === 'unset' ? 'Sex not set' : sexLabel(parts[2]);
      document.getElementById('customer-group-search').value = state.groupSearch;
      showPage('page-customer-group', 'customers');
      loadCustomersPage();
    } else if (parts[1] && parts[2] === 'edit') {
      showPage('page-customer-edit', 'customers');
      renderCustomerEdit(parts[1]);
    } else if (parts[1] && parts[1] !== 'group') {
      showPage('page-customer-detail', 'customers');
      // Stay on the same page of plans when refreshing the same client.
      const samePage = state.detailCustomerId === String(parts[1]) ? state.detailPage : 1;
      renderCustomerDetail(parts[1], samePage);
    } else {
      setCustomerSex('');
      renderCustomerFolders();
      const searching = Boolean(state.customerSearch);
      document.getElementById('customer-folders').hidden = searching;
      document.getElementById('customer-results').hidden = !searching;
      showPage('page-customers', 'customers');
      if (searching) loadCustomersPage();
    }
  } else if (section === 'plans') {
    const range = parts[1] === 'band' ? validCalorieRange(parts[2]) : null;
    if (parts[1] === 'band' && !range) {
      location.hash = '#/plans';
      return;
    }
    setPlanFilter(range);
    showPage(range ? 'page-plan-folder' : 'page-plans', 'plans');
    loadPlansPage();
  } else {
    renderHome();
    showPage('page-home', 'home');
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Context menu ─────────────────────────────────────────────────────────────

function ensureDashboardMenu() {
  if (state.menu) return state.menu;
  state.menu = document.createElement('div');
  state.menu.className = 'dashboard-context-menu';
  state.menu.hidden = true;
  document.body.append(state.menu);
  return state.menu;
}

function hideDashboardMenu() {
  if (state.menu) state.menu.hidden = true;
  state.menuTrigger?.setAttribute('aria-expanded', 'false');
  state.menuTrigger = null;
  state.menuOpenedAt = 0;
}

function positionDashboardMenu(button) {
  const menu = ensureDashboardMenu();
  state.menuTrigger?.setAttribute('aria-expanded', 'false');
  state.menuTrigger = button;
  state.menuOpenedAt = performance.now();
  button.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = buttonRect.right - menuRect.width;
  let top = buttonRect.bottom + 6;

  if (left < 8) left = 8;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = buttonRect.top - menuRect.height - 6;

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function exportHrefWithClientName(exportHref, hasCustomer) {
  if (hasCustomer) return exportHref;
  if (!confirm('Do you want to add a client name in the PDF?')) return exportHref;
  const clientName = (prompt('Client name for the PDF') || '').trim().slice(0, 80);
  if (!clientName) return exportHref;
  const url = new URL(exportHref, window.location.origin);
  url.searchParams.set('clientName', clientName);
  return `${url.pathname}${url.search}`;
}

function downloadPlanPdf(exportHref, planName, { hasCustomer = false } = {}) {
  const href = exportHrefWithClientName(exportHref, hasCustomer);
  const link = document.createElement('a');
  link.href = href;
  link.download = pdfDownloadName(planName);
  document.body.append(link);
  link.click();
  link.remove();
}

async function refreshDashboard() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error('Failed to load dashboard.');
  const data = await res.json();
  state.stats = data.stats || {};
  state.recentPlans = data.recentPlans || [];
  state.expiringPlans = data.expiringPlans || [];
  renderStats();
  renderRoute();
  document.body.classList.remove('dashboard-loading');
}

function setSubmitBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

async function submitNewCustomer(form) {
  const message = document.getElementById('dashboard-message');
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = customerFormPayload(form);

  message.textContent = '';
  setSubmitBusy(submitButton, true, 'Adding…');

  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to add client.');

    form.reset();
    await refreshDashboard();
    location.hash = data.customer?.id ? `#/customers/${encodeURIComponent(data.customer.id)}` : '#/customers';
  } catch (error) {
    message.textContent = error.message || 'Failed to add client.';
  } finally {
    setSubmitBusy(submitButton, false, 'Add client');
  }
}

async function submitEditCustomer(form) {
  const message = document.getElementById('dashboard-message');
  const submitButton = form.querySelector('button[type="submit"]');
  const customerId = form.elements.namedItem('id').value;
  const payload = customerFormPayload(form);

  message.textContent = '';
  setSubmitBusy(submitButton, true, 'Saving…');

  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update client.');

    message.textContent = '';
    await refreshDashboard();
    location.hash = `#/customers/${encodeURIComponent(customerId)}`;
  } catch (error) {
    message.textContent = error.message || 'Failed to update client.';
  } finally {
    setSubmitBusy(submitButton, false, 'Save changes');
  }
}

async function deleteCustomer(customerId, customerName) {
  if (!confirm(`Delete client "${customerName}"? Plans assigned to this client will stay saved as general plans.`)) return;
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' });
  if (!res.ok) {
    document.getElementById('dashboard-message').textContent = 'Failed to delete client.';
    return;
  }
  document.getElementById('dashboard-message').textContent = '';
  if (parseHash()[0] === 'customers' && String(parseHash()[1] || '') === String(customerId)) {
    location.hash = '#/customers';
  }
  await refreshDashboard();
}

// Renewing restarts the plan today for the same number of weeks.
async function renewPlan(button) {
  const { planId, planName } = button.dataset;
  const message = document.getElementById('dashboard-message');
  button.disabled = true;
  button.textContent = 'Renewing…';
  try {
    const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: window.PlanStatus.todayIso() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to renew "${planName}".`);
    message.textContent = '';
    await refreshDashboard();
  } catch (error) {
    message.textContent = error.message || 'Failed to renew plan.';
    button.disabled = false;
    button.textContent = 'Renew';
  }
}

function showPlanMenu(button) {
  const menu = ensureDashboardMenu();
  const {
    planId, planName, exportHref, customerId,
  } = button.dataset;
  menu.innerHTML = `
    <button type="button" data-action="export">${icon('print')}Export as PDF</button>
    <button type="button" class="danger" data-action="delete">${icon('trash')}Delete</button>
  `;

  menu.querySelector('[data-action="export"]').addEventListener('click', () => {
    hideDashboardMenu();
    downloadPlanPdf(exportHref, planName, { hasCustomer: Boolean(customerId) });
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    hideDashboardMenu();
    if (!confirm(`Delete plan "${planName}"?`)) return;
    const res = await fetch(`/api/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    if (!res.ok) {
      document.getElementById('dashboard-message').textContent = 'Failed to delete plan.';
      return;
    }
    document.getElementById('dashboard-message').textContent = '';
    await refreshDashboard();
  });

  positionDashboardMenu(button);
}

async function initNav() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.replace('/login');
    return false;
  }

  const { user } = await res.json();
  state.user = user;
  window.Shell?.setUser(user);
  document.getElementById('dashboard-title').textContent = greeting();
  return true;
}

function debounceSearch(inputId, apply) {
  let timer = null;
  document.getElementById(inputId)?.addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => apply(event.target.value.trim()), 250);
  });
}

function bindEvents() {
  document.getElementById('dashboard-menu-toggle')?.addEventListener('click', () => {
    const open = !document.getElementById('dashboard-sidebar')?.classList.contains('is-open');
    setMobileNavOpen(open);
  });
  document.getElementById('dashboard-menu-backdrop')?.addEventListener('click', () => {
    setMobileNavOpen(false);
  });
  document.getElementById('dashboard-sidebar')?.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMobileNavOpen(false);
  });
  // Searches run on the server, so wait for a pause in typing.
  debounceSearch('customer-search', (value) => {
    state.customerSearch = value;
    const searching = Boolean(value);
    document.getElementById('customer-folders').hidden = searching;
    document.getElementById('customer-results').hidden = !searching;
    if (searching) loadCustomersPage(1);
  });
  debounceSearch('customer-group-search', (value) => {
    state.groupSearch = value;
    loadCustomersPage(1);
  });
  debounceSearch('general-plan-search', (value) => {
    state.planSearch = value;
    loadPlansPage(1);
  });
  document.getElementById('new-customer-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitNewCustomer(event.currentTarget);
  });
  document.getElementById('edit-customer-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitEditCustomer(event.currentTarget);
  });
  document.getElementById('edit-customer-delete')?.addEventListener('click', (event) => {
    const form = document.getElementById('edit-customer-form');
    deleteCustomer(form.elements.namedItem('id').value, event.currentTarget.dataset.customerName || 'this client');
  });
}

document.addEventListener('click', (event) => {
  const menuButton = event.target.closest('.dashboard-plan-menu-btn');
  if (menuButton) {
    event.preventDefault();
    event.stopPropagation();
    if (menuButton.getAttribute('aria-expanded') === 'true' && state.menu && !state.menu.hidden) {
      hideDashboardMenu();
      return;
    }
    showPlanMenu(menuButton);
    return;
  }

  const renew = event.target.closest('.renew-btn');
  if (renew) {
    event.preventDefault();
    event.stopPropagation();
    renewPlan(renew);
    return;
  }

  if (!event.target.closest('.dashboard-context-menu')) hideDashboardMenu();

  // Whole table rows open their plan or client; links and buttons inside
  // them keep their own behaviour.
  const row = event.target.closest('tr[data-href]');
  if (row && !event.target.closest('a, button')) {
    window.location.href = row.dataset.href;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideDashboardMenu();
    setMobileNavOpen(false);
  }
});

window.addEventListener('hashchange', renderRoute);
window.addEventListener('scroll', () => {
  if (!state.menu || state.menu.hidden) return;
  if (performance.now() - state.menuOpenedAt < 250) return;
  hideDashboardMenu();
}, true);

(async () => {
  bindEvents();
  const authed = await initNav();
  if (!authed) return;

  try {
    // refreshDashboard already rendered the current route.
    await refreshDashboard();
    if (!location.hash) location.hash = '#/home';
  } catch {
    document.body.classList.remove('dashboard-loading');
    document.getElementById('dashboard-message').textContent = 'Failed to load dashboard.';
  }
})();
