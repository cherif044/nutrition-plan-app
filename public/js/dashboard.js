function iconSvg(name, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    chart: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
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

const GOAL_ORDER = ['lose_weight', 'gain_weight', 'maintain', 'inactive'];
const GOAL_COLORS = {
  lose_weight: '#e85d4e',
  gain_weight: '#2f86d6',
  maintain: '#1f9d77',
  active: '#8b5cf6',
  inactive: '#9aa6a0',
  unknown: '#9aa6a0',
};

const state = {
  user: null,
  stats: {},
  customers: [],
  generalPlans: [],
  recentPlans: [],
  customerPlans: new Map(),
  customerFilter: null,
  planFilter: null,
  customerSearch: '',
  planSearch: '',
  menu: null,
};

const AVATAR_TONES = ['coral', 'sky', 'violet', 'amber', 'jade'];

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
    gain_weight: 'Gain weight',
    inactive: 'Inactive',
    active: 'Active',
    unknown: 'Unknown',
  };
  return labels[goal] || titleCase(goal);
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

function initials(name) {
  const parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'P') + (parts[1]?.[0] || '');
}

function planHref(plan) {
  const folderParam = plan.folder_id ? `&folderId=${encodeURIComponent(plan.folder_id)}` : '';
  return `/planner?planId=${encodeURIComponent(plan.id)}&view=plan${folderParam}`;
}

function planExportHref(plan) {
  return `/api/plans/${encodeURIComponent(plan.id)}/export.pdf`;
}

function folderBreadcrumb(plan) {
  const path = Array.isArray(plan.folderPath) ? plan.folderPath : [];
  return ['General', ...path.map((item) => item.name)].join(' / ');
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

function customerGoalKey(customer) {
  if (!customer.activePlan) return 'inactive';
  return customer.goal || 'active';
}

function planGoalKey(plan) {
  return plan.goal || plan.plan_data?.input?.goal || plan.planData?.input?.goal || 'unknown';
}

function matchesSearch(values, term) {
  if (!term) return true;
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function emptyState(label, detail = 'Try a different search or filter') {
  return `
    <div class="explorer-empty dashboard-empty">
      <span class="explorer-empty__icon" aria-hidden="true">${iconSvg('search', 20)}</span>
      <strong>No ${escapeHtml(label)} found</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function goalTone(goal) {
  return {
    lose_weight: 'coral',
    gain_weight: 'sky',
    maintain: 'jade',
    active: 'violet',
    inactive: 'gray',
    unknown: 'gray',
  }[goal] || 'gray';
}

function goalTag(goal) {
  const key = goal || 'unknown';
  return `<span class="dashboard-tag dashboard-tag-${goalTone(key)}">${escapeHtml(goalLabel(key))}</span>`;
}

function statusPill(active) {
  return active ? '<span class="dashboard-badge">Active</span>' : '';
}

function currentPlanChip(active) {
  return active ? '<span class="dashboard-current-chip">Current plan</span>' : '';
}

function customerDetailStats(customer) {
  const planCount = Number(customer.planCount || 0);
  const bodyValue = customer.weight ? `${Number(customer.weight).toLocaleString()} kg` : '-';
  const heightValue = customer.height ? `${Number(customer.height).toLocaleString()} cm` : 'Height not set';
  const ageValue = customer.age ? String(customer.age) : '-';
  const sexValue = customer.sex ? titleCase(customer.sex) : 'Sex not set';
  const activityValue = customer.activity_level ? titleCase(customer.activity_level) : '-';
  const activeValue = customer.activePlan ? 'Active plan' : 'No active plan';
  const cards = [
    { tone: 'cal', label: 'Plans', value: planCount.toLocaleString(), trend: activeValue, icon: iconSvg('file', 15) },
    { tone: 'protein', label: 'Age', value: ageValue, trend: sexValue, icon: iconSvg('users', 15) },
    { tone: 'fat', label: 'Body', value: bodyValue, trend: heightValue, icon: iconSvg('chart', 15) },
    { tone: 'carb', label: 'Activity', value: activityValue, trend: customer.goal ? goalLabel(customer.goal) : 'Goal not set', icon: iconSvg('zap', 15) },
  ];
  return cards.map((card) => `
    <div class="dashboard-stat-card customer-detail-stat" data-tone="${card.tone}">
      <span class="dashboard-stat-label">${escapeHtml(card.label)}</span>
      <span class="dashboard-stat-icon" aria-hidden="true">${card.icon}</span>
      <span class="dashboard-stat-bottom">
        <strong>${escapeHtml(card.value)}</strong>
        <span class="dashboard-trend">${escapeHtml(card.trend)}</span>
      </span>
    </div>
  `).join('');
}

function planRow(
  plan,
  {
    menu = true,
    activeStyle = false,
    showGoal = true,
    showActiveChip = activeStyle,
    tableStyle = false,
  } = {},
) {
  const updatedAt = plan.updated_at || plan.created_at;
  const goal = planGoalKey(plan);
  const footer = [
    showGoal ? goalTag(goal) : '',
    showActiveChip ? currentPlanChip(plan.is_active) : '',
  ].filter(Boolean).join('');
  return `
    <article class="dashboard-plan-card${activeStyle && plan.is_active ? ' is-active-plan' : ''}${tableStyle ? ' dashboard-plan-card--table' : ''}">
      <a class="dashboard-plan-card__link" href="${escapeHtml(planHref(plan))}">
        <span class="dashboard-plan-card__body">
          <span class="dashboard-plan-card__title">
            ${escapeHtml(plan.name)}
          </span>
          ${footer ? `<span class="dashboard-plan-card__footer">${footer}</span>` : ''}
        </span>
      </a>
      <span class="dashboard-plan-card__date">${escapeHtml(formatRelativeTime(updatedAt))}</span>
      ${menu ? `
        <button
          class="dashboard-plan-menu-btn"
          type="button"
          title="Plan options"
          aria-label="Plan options for ${escapeHtml(plan.name)}"
          data-plan-id="${escapeHtml(plan.id)}"
          data-plan-name="${escapeHtml(plan.name)}"
          data-customer-id="${escapeHtml(plan.customer_id || '')}"
          data-export-href="${escapeHtml(planExportHref(plan))}"
        >${iconSvg('more', 18)}</button>
      ` : ''}
    </article>
  `;
}

function planGoalVisualKey(goal) {
  if (goal === 'lose_weight') return 'lose';
  if (goal === 'gain_weight') return 'gain';
  if (goal === 'maintain') return 'maintain';
  return 'unknown';
}

function planGoalColor(goal) {
  return GOAL_COLORS[goal] || GOAL_COLORS.unknown;
}

function planPageRow(plan) {
  const updatedAt = plan.updated_at || plan.created_at;
  const goal = planGoalKey(plan);
  const visualKey = planGoalVisualKey(goal);
  return `
    <li class="pp-row" data-name="${escapeHtml(plan.name)}" data-goal="${escapeHtml(goal)}">
      <a class="pp-row__link" href="${escapeHtml(planHref(plan))}">
        <span class="pp-row__text">
          <span class="pp-row__name">${escapeHtml(plan.name)}</span>
          <span class="pp-goal pp-goal--${escapeHtml(visualKey)}">
            <span class="pp-dot"></span>${escapeHtml(goalLabel(goal))}
          </span>
        </span>
        <span class="pp-row__time">${escapeHtml(formatRelativeTime(updatedAt))}</span>
      </a>
      <button
        class="pp-row__more dashboard-plan-menu-btn"
        type="button"
        title="Plan options"
        aria-label="More actions for ${escapeHtml(plan.name)}"
        data-plan-id="${escapeHtml(plan.id)}"
        data-plan-name="${escapeHtml(plan.name)}"
        data-customer-id="${escapeHtml(plan.customer_id || '')}"
        data-export-href="${escapeHtml(planExportHref(plan))}"
      >${iconSvg('more', 18)}</button>
    </li>
  `;
}

function customerRow(customer) {
  const index = state.customers.findIndex((item) => String(item.id) === String(customer.id));
  const tone = AVATAR_TONES[(index >= 0 ? index : 0) % AVATAR_TONES.length];
  const count = Number(customer.planCount || 0);
  return `
    <article class="dashboard-customer-card dashboard-list-row" data-customer-id="${escapeHtml(customer.id)}">
      <button class="dashboard-customer-card__link" type="button" data-customer-open="${escapeHtml(customer.id)}">
        <span class="dashboard-cust-avatar dashboard-avatar-${tone}" aria-hidden="true">${escapeHtml(initials(customer.name))}</span>
        <span class="dashboard-customer-card__body">
          <strong>${escapeHtml(customer.name)}</strong>
          <small>${count} plan${count === 1 ? '' : 's'}</small>
        </span>
        <span class="dashboard-row-chevron" aria-hidden="true">${iconSvg('chevron', 14)}</span>
      </button>
      <button
        class="dashboard-customer-menu-btn"
        type="button"
        title="Customer options"
        aria-label="Customer options for ${escapeHtml(customer.name)}"
        data-customer-id="${escapeHtml(customer.id)}"
        data-customer-name="${escapeHtml(customer.name)}"
      >${iconSvg('more', 18)}</button>
    </article>
  `;
}

function customerPageRow(customer) {
  const count = Number(customer.planCount || 0);
  const name = customer.name || 'Customer';
  return `
    <li class="pc-row" data-customer-id="${escapeHtml(customer.id)}">
      <a class="pc-row__link" href="#/customers/${encodeURIComponent(customer.id)}">
        <span class="pc-avatar" aria-hidden="true">${escapeHtml(initials(name).toLowerCase())}</span>
        <span class="pc-row__text">
          <span class="pc-row__name">${escapeHtml(name)}</span>
          <span class="pc-row__meta">
            ${count} plan${count === 1 ? '' : 's'}
            ${customer.activePlan ? '<span class="pc-tag">Active</span>' : ''}
          </span>
        </span>
        <svg class="pc-row__chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
      </a>
      <button
        class="pc-row__more dashboard-customer-menu-btn"
        type="button"
        title="Customer options"
        aria-label="More actions for ${escapeHtml(name)}"
        data-customer-id="${escapeHtml(customer.id)}"
        data-customer-name="${escapeHtml(name)}"
      >${iconSvg('more', 18)}</button>
    </li>
  `;
}

function homeCustomerRow(customer) {
  const count = Number(customer.planCount || 0);
  const name = customer.name || 'Customer';
  return `
    <li class="ph-row">
      <a class="ph-row__link" href="#/customers/${encodeURIComponent(customer.id)}">
        <span class="ph-avatar" aria-hidden="true">${escapeHtml(initials(name).toLowerCase())}</span>
        <span class="ph-row__text">
          <span class="ph-row__name">${escapeHtml(name)}</span>
          <span class="ph-row__meta">${count} plan${count === 1 ? '' : 's'}</span>
        </span>
        <svg class="ph-row__chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
      </a>
      <button
        type="button"
        class="ph-row__more dashboard-customer-menu-btn"
        aria-label="More actions for ${escapeHtml(name)}"
        data-customer-id="${escapeHtml(customer.id)}"
        data-customer-name="${escapeHtml(name)}"
      >${iconSvg('more', 18)}</button>
    </li>
  `;
}

function homePlanRow(plan) {
  const goal = planGoalKey(plan);
  const visualKey = planGoalVisualKey(goal);
  const updatedAt = plan.updated_at || plan.created_at;
  return `
    <li class="ph-row">
      <a class="ph-row__link" href="${escapeHtml(planHref(plan))}">
        <span class="ph-row__text">
          <span class="ph-row__name">${escapeHtml(plan.name)}</span>
          <span class="ph-row__meta">
            <span class="ph-goal ph-goal--${escapeHtml(visualKey)}"><span class="ph-dot"></span>${escapeHtml(goalLabel(goal))}</span>
            ${escapeHtml(formatRelativeTime(updatedAt))}
          </span>
        </span>
        <svg class="ph-row__chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
      </a>
      <button
        type="button"
        class="ph-row__more dashboard-plan-menu-btn"
        aria-label="More actions for ${escapeHtml(plan.name)}"
        data-plan-id="${escapeHtml(plan.id)}"
        data-plan-name="${escapeHtml(plan.name)}"
        data-customer-id="${escapeHtml(plan.customer_id || '')}"
        data-export-href="${escapeHtml(planExportHref(plan))}"
      >${iconSvg('more', 18)}</button>
    </li>
  `;
}

function customerDetailGoalKey(customer) {
  return customer.goal || customer.activePlan?.goal || 'unknown';
}

function detailTextValue(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function detailNumberValue(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : fallback;
}

function customerDetailMeta(customer, planCount) {
  const goal = customerDetailGoalKey(customer);
  const visualKey = planGoalVisualKey(goal);
  return `
    <span class="pd-tag pd-tag--${escapeHtml(visualKey)}">
      <span class="pd-dot"></span>${escapeHtml(goalLabel(goal))}
    </span>
    ${customer.activePlan ? '<span class="pd-tag pd-tag--active">Active plan</span>' : '<span class="pd-tag pd-tag--idle">No active plan</span>'}
    <span>${Number(planCount || 0).toLocaleString()} assigned ${Number(planCount || 0) === 1 ? 'plan' : 'plans'}</span>
  `;
}

function customerDetailGrid(customer) {
  const goal = customerDetailGoalKey(customer);
  const details = [
    { label: 'Age', value: detailNumberValue(customer.age), text: false },
    { label: 'Sex', value: customer.sex ? titleCase(customer.sex) : '-', text: true },
    { label: 'Weight', value: detailNumberValue(customer.weight), unit: customer.weight ? 'kg' : '', text: false },
    { label: 'Height', value: detailNumberValue(customer.height), unit: customer.height ? 'cm' : '', text: false },
    { label: 'Activity level', value: customer.activity_level ? titleCase(customer.activity_level) : '-', text: true },
    { label: 'Goal', value: goalLabel(goal), text: true },
  ];

  return details.map((item) => `
    <div class="pd-detail">
      <span class="pd-detail__label">${escapeHtml(item.label)}</span>
      <span class="pd-detail__value${item.text ? ' pd-detail__value--text' : ''}">
        ${escapeHtml(item.value)}${item.unit ? `<span class="pd-detail__unit">${escapeHtml(item.unit)}</span>` : ''}
      </span>
    </div>
  `).join('');
}

function customerDetailPlanRow(plan) {
  const goal = planGoalKey(plan);
  const visualKey = planGoalVisualKey(goal);
  const updatedAt = plan.updated_at || plan.created_at;
  return `
    <li class="pd-row">
      <a class="pd-row__link" href="${escapeHtml(planHref(plan))}">
        <span class="pd-row__text">
          <span class="pd-row__name">${escapeHtml(plan.name)}</span>
          <span class="pd-tag pd-tag--${escapeHtml(visualKey)}"><span class="pd-dot"></span>${escapeHtml(goalLabel(goal))}</span>
        </span>
        <span class="pd-row__time">${escapeHtml(formatRelativeTime(updatedAt))}</span>
      </a>
      <button
        type="button"
        class="pd-row__more dashboard-plan-menu-btn"
        aria-label="More actions for ${escapeHtml(plan.name)}"
        data-plan-id="${escapeHtml(plan.id)}"
        data-plan-name="${escapeHtml(plan.name)}"
        data-customer-id="${escapeHtml(plan.customer_id || '')}"
        data-export-href="${escapeHtml(planExportHref(plan))}"
      >${iconSvg('more', 18)}</button>
    </li>
  `;
}

function renderGoalBar(barId, legendId, counts) {
  const bar = document.getElementById(barId);
  const legend = document.getElementById(legendId);
  if (!bar || !legend) return;

  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  bar.innerHTML = total
    ? entries.map(([key, count]) => (
      `<span style="width:${(count / total * 100).toFixed(1)}%;background:${GOAL_COLORS[key] || GOAL_COLORS.unknown};"></span>`
    )).join('')
    : '<span style="width:100%;background:#e9efec;"></span>';
  legend.innerHTML = entries.length
    ? entries.map(([key, count]) => `
      <span class="dashboard-goal-legend-item">
        <i style="background:${GOAL_COLORS[key] || GOAL_COLORS.unknown};"></i>
        ${escapeHtml(goalLabel(key))}
        <b>${count}</b>
      </span>
    `).join('')
    : '<span class="dashboard-soft-copy">No goal data yet</span>';
}

function renderHomeSummary({ totalPlans, customers, activePlans, plansThisWeek, customersThisWeek }) {
  const activeLabel = activePlans === 1 ? 'active assignment' : 'active assignments';
  const planLabel = plansThisWeek === 1 ? 'plan' : 'plans';
  const customerLabel = customersThisWeek === 1 ? 'customer' : 'customers';
  document.getElementById('home-week-plans').textContent = `${plansThisWeek.toLocaleString()} ${planLabel}`;
  document.getElementById('home-week-customers').textContent = `${customersThisWeek.toLocaleString()} new ${customerLabel}`;
  document.getElementById('home-active-work').textContent = `${activePlans.toLocaleString()} ${activeLabel}`;
  document.getElementById('home-active-percent').textContent = totalPlans ? `${Math.round((activePlans / totalPlans) * 100)}% of saved plans` : 'No active plans yet';
  document.getElementById('home-roster-count').textContent = `${customers.toLocaleString()} customer${customers === 1 ? '' : 's'}`;
  document.getElementById('home-roster-plans').textContent = totalPlans ? `${totalPlans.toLocaleString()} saved plans total` : 'No saved plans yet';
}

function filterChip(key, label, count, active) {
  const color = key ? (GOAL_COLORS[key] || GOAL_COLORS.unknown) : '#123832';
  const activeStyle = active ? `background:${color};border-color:${color};color:#fff;` : `border-color:${color}35;`;
  const dotStyle = active ? 'background:rgba(255,255,255,0.9);' : `background:${color};`;
  return `
    <button class="dashboard-filter-chip${active ? ' is-active' : ''}" type="button" data-key="${escapeHtml(key || '')}" style="${activeStyle}">
      <span style="${dotStyle}"></span>
      ${escapeHtml(label)}
      <b>${count}</b>
    </button>
  `;
}

function renderFilterChips(containerId, counts, total, activeKey, order) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const keys = [
    ...order.filter((key) => counts[key]),
    ...Object.keys(counts).filter((key) => !order.includes(key)),
  ];
  container.innerHTML = [
    filterChip(null, 'All', total, activeKey === null),
    ...keys.map((key) => filterChip(key, goalLabel(key), counts[key], activeKey === key)),
  ].join('');
}

function planFilterChip(key, label, count, active) {
  const visualKey = key ? planGoalVisualKey(key) : 'all';
  return `
    <button type="button" class="pp-chip" data-key="${escapeHtml(key || '')}" aria-pressed="${active ? 'true' : 'false'}">
      <span class="pp-dot pp-dot--${escapeHtml(visualKey)}"></span>
      ${escapeHtml(label)}
      <span>${Number(count || 0).toLocaleString()}</span>
    </button>
  `;
}

function renderPlanFilterChips(counts, total, activeKey) {
  const container = document.getElementById('plan-filter-chips');
  if (!container) return;
  const keys = [
    ...GOAL_ORDER.filter((key) => counts[key]),
    ...Object.keys(counts).filter((key) => !GOAL_ORDER.includes(key)),
  ];
  container.innerHTML = [
    planFilterChip(null, 'All', total, activeKey === null),
    ...keys.map((key) => planFilterChip(key, goalLabel(key), counts[key], activeKey === key)),
  ].join('');
}

function renderPlanGoalBreakdown(counts) {
  const bar = document.getElementById('plan-goal-bar');
  const legend = document.getElementById('plan-goal-legend');
  if (!bar || !legend) return;

  const entries = [
    ...GOAL_ORDER.filter((key) => counts[key]).map((key) => [key, counts[key]]),
    ...Object.keys(counts).filter((key) => !GOAL_ORDER.includes(key)).map((key) => [key, counts[key]]),
  ].filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  bar.setAttribute('aria-label', entries.length
    ? entries.map(([key, count]) => `${count} ${goalLabel(key)}`).join(', ')
    : 'No goal data yet');
  bar.innerHTML = total
    ? entries.map(([key, count]) => `
      <div
        class="pp-bar__seg pp-bar__seg--${escapeHtml(planGoalVisualKey(key))}"
        style="width: ${(count / total * 100).toFixed(1)}%; background: ${escapeHtml(planGoalColor(key))};"
      ></div>
    `).join('')
    : '<div class="pp-bar__seg pp-bar__seg--unknown" style="width:100%;"></div>';
  legend.innerHTML = entries.length
    ? entries.map(([key, count]) => `
      <li>
        <span class="pp-dot pp-dot--${escapeHtml(planGoalVisualKey(key))}"></span>
        ${escapeHtml(goalLabel(key))}
        <b>${Number(count).toLocaleString()}</b>
      </li>
    `).join('')
    : '<li>No goal data yet</li>';
}

function renderStats() {
  const totalPlans = Number(state.stats.totalPlans || 0);
  const customers = Number(state.stats.customers || 0);
  const activePlans = Number(state.stats.activePlans || 0);
  const plansThisWeek = Number(state.stats.plansThisWeek || 0);
  const customersThisWeek = Number(state.stats.customersThisWeek || 0);
  document.getElementById('stat-total-plans').textContent = totalPlans.toLocaleString();
  document.getElementById('stat-customers').textContent = customers.toLocaleString();
  document.getElementById('stat-active-plans').textContent = activePlans.toLocaleString();
  document.getElementById('stat-plans-trend').textContent = plansThisWeek ? `+${plansThisWeek.toLocaleString()} this week` : 'no new plans';
  document.getElementById('stat-plans-trend').hidden = !plansThisWeek;
  document.getElementById('stat-customers-trend').textContent = customersThisWeek ? `+${customersThisWeek.toLocaleString()} this week` : 'no new clients';
  document.getElementById('stat-customers-trend').hidden = !customersThisWeek;
  document.getElementById('stat-active-trend').textContent = activePlans ? 'in progress' : 'none active';
  document.getElementById('stat-active-trend').hidden = !activePlans;
  document.getElementById('dashboard-hero-sub').textContent =
    `You have ${totalPlans.toLocaleString()} plans across ${customers.toLocaleString()} customers, with ${activePlans.toLocaleString()} currently active.`;
  renderHomeSummary({ totalPlans, customers, activePlans, plansThisWeek, customersThisWeek });
}

function sortByNewestCreated(plans) {
  return [...plans].sort((a, b) => {
    const bCreated = new Date(b.created_at).getTime() || 0;
    const aCreated = new Date(a.created_at).getTime() || 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return String(b.id).localeCompare(String(a.id));
  });
}

function sortCustomersForHome(customers) {
  return [...customers].sort((a, b) => {
    const bUpdated = new Date(b.updated_at || b.created_at).getTime() || 0;
    const aUpdated = new Date(a.updated_at || a.created_at).getTime() || 0;
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function renderHome() {
  renderStats();
  const customers = sortCustomersForHome(state.customers).slice(0, 4);
  const plans = (state.recentPlans.length ? state.recentPlans : sortByNewestCreated(state.generalPlans)).slice(0, 4);
  document.getElementById('home-customers-list').innerHTML = customers.length
    ? customers.map(homeCustomerRow).join('')
    : '<li><p class="ph-empty">No customers yet.</p></li>';
  document.getElementById('home-plans-list').innerHTML = plans.length
    ? plans.map(homePlanRow).join('')
    : '<li><p class="ph-empty">No plans yet.</p></li>';
}

function renderCustomersPage() {
  const totalPlans = state.customers.reduce((sum, customer) => sum + Number(customer.planCount || 0), 0);
  const filtered = state.customers.filter((customer) => (
    matchesSearch([customer.name, customer.activePlan?.name], state.customerSearch)
  ));

  document.getElementById('customers-subtitle').textContent = `${state.customers.length} customers total`;
  document.getElementById('customer-stat-total').textContent = state.customers.length.toLocaleString();
  document.getElementById('customer-stat-active').textContent = state.customers.filter((customer) => customer.activePlan).length.toLocaleString();
  document.getElementById('customer-stat-average').textContent = state.customers.length ? (totalPlans / state.customers.length).toFixed(1) : '0';
  document.getElementById('customer-list-count').textContent =
    state.customerSearch ? `(${filtered.length} of ${state.customers.length})` : '';
  document.getElementById('customers-list').innerHTML = filtered.length
    ? filtered.map(customerPageRow).join('')
    : '<li class="pc-empty-state">No customers match that search.</li>';
}

function renderPlansPage() {
  const assignedCount = Math.max(0, Number(state.stats.totalPlans || 0) - state.generalPlans.length);
  const counts = countBy(state.generalPlans, planGoalKey);
  const filtered = state.generalPlans.filter((plan) => (
    (state.planFilter === null || planGoalKey(plan) === state.planFilter)
    && matchesSearch([plan.name, folderBreadcrumb(plan), goalLabel(planGoalKey(plan))], state.planSearch)
  ));
  const newest = state.generalPlans[0]?.updated_at || state.generalPlans[0]?.created_at;

  document.getElementById('plans-subtitle').textContent = `${state.generalPlans.length} general plans`;
  document.getElementById('plan-stat-total').textContent = state.generalPlans.length.toLocaleString();
  document.getElementById('plan-stat-assigned').textContent = assignedCount.toLocaleString();
  document.getElementById('plan-stat-newest').textContent = newest ? formatRelativeTime(newest) : '-';
  document.getElementById('plan-list-count').textContent =
    (state.planFilter || state.planSearch) ? `(${filtered.length} of ${state.generalPlans.length})` : '';
  document.getElementById('recent-plans').innerHTML = filtered.length
    ? filtered.map(planPageRow).join('')
    : state.generalPlans.length
      ? '<li class="pp-empty">No plans match those filters.</li>'
      : '<li class="pp-empty-state"><p>No plans yet.</p><a href="/planner" class="pp-btn">Create your first plan</a></li>';
  renderPlanFilterChips(counts, state.generalPlans.length, state.planFilter);
  renderPlanGoalBreakdown(counts);
}

async function loadCustomerPlans(customerId) {
  if (state.customerPlans.has(String(customerId))) return state.customerPlans.get(String(customerId));
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/plans`);
  if (!res.ok) throw new Error('Failed to load customer plans.');
  const data = await res.json();
  state.customerPlans.set(String(customerId), data);
  return data;
}

async function renderCustomerDetail(customerId) {
  const page = document.getElementById('page-customer-detail');
  const customer = state.customers.find((item) => String(item.id) === String(customerId));
  if (!customer) {
    location.hash = '#/customers';
    return;
  }

  document.getElementById('detail-customer-avatar').textContent = initials(customer.name).toLowerCase();
  document.getElementById('detail-customer-title').textContent = customer.name;
  document.getElementById('detail-customer-meta').innerHTML = customerDetailMeta(customer, customer.planCount || 0);
  document.getElementById('detail-customer-details').innerHTML = customerDetailGrid(customer);
  document.getElementById('detail-edit-link').href = `#/customers/${encodeURIComponent(customer.id)}/edit`;
  document.getElementById('detail-add-plan-link').href = `/planner?customerId=${encodeURIComponent(customer.id)}`;
  document.getElementById('detail-plan-count').textContent = 'Loading...';
  document.getElementById('detail-customer-plans').innerHTML = '<li><div class="pd-empty"><p>Loading assigned plans.</p></div></li>';

  try {
    const { plans } = await loadCustomerPlans(customerId);
    document.getElementById('detail-customer-meta').innerHTML = customerDetailMeta(customer, plans.length);
    document.getElementById('detail-plan-count').textContent = `${plans.length} total`;
    document.getElementById('detail-customer-plans').innerHTML = plans.length
      ? plans.map(customerDetailPlanRow).join('')
      : `<li>
          <div class="pd-empty">
            <p>No plans assigned yet.</p>
            <a href="/planner?customerId=${encodeURIComponent(customer.id)}" class="pd-btn">Assign a plan</a>
          </div>
        </li>`;
  } catch {
    if (page.classList.contains('is-active')) {
      document.getElementById('detail-plan-count').textContent = '';
      document.getElementById('detail-customer-plans').innerHTML = '<li><div class="pd-empty"><p>Failed to load customer plans.</p></div></li>';
    }
  }
}

function customerFormPayload(form) {
  const formData = new FormData(form);
  return {
    name: formData.get('name'),
    age: formData.get('age'),
    sex: formData.get('sex'),
    weightKg: formData.get('weightKg'),
    heightCm: formData.get('heightCm'),
    activityLevel: formData.get('activityLevel'),
  };
}

function setCustomerFormValues(form, customer) {
  form.elements.namedItem('id').value = customer.id;
  form.elements.namedItem('name').value = customer.name || '';
  form.elements.namedItem('age').value = customer.age || '';
  form.elements.namedItem('sex').value = customer.sex || '';
  form.elements.namedItem('weightKg').value = customer.weight || '';
  form.elements.namedItem('heightCm').value = customer.height || '';
  form.elements.namedItem('activityLevel').value = customer.activity_level || '';
}

function renderCustomerEdit(customerId) {
  const customer = state.customers.find((item) => String(item.id) === String(customerId));
  if (!customer) {
    location.hash = '#/customers';
    return false;
  }

  const form = document.getElementById('edit-customer-form');
  document.getElementById('edit-customer-title').textContent = `Edit ${customer.name}`;
  document.getElementById('edit-customer-back').href = `#/customers/${encodeURIComponent(customer.id)}`;
  setCustomerFormValues(form, customer);
  return true;
}

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
  toggle.setAttribute('aria-label', open ? 'Close dashboard menu' : 'Open dashboard menu');
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
  const parts = hash.split('/').filter(Boolean);
  return parts.length ? parts : ['home'];
}

function renderRoute() {
  const parts = parseHash();
  const section = parts[0];

  if (section === 'customers') {
    if (parts[1] === 'new') {
      showPage('page-customer-new', 'customers');
    } else if (parts[1] && parts[2] === 'edit') {
      if (renderCustomerEdit(parts[1])) showPage('page-customer-edit', 'customers');
    } else if (parts[1]) {
      showPage('page-customer-detail', 'customers');
      renderCustomerDetail(parts[1]);
    } else {
      renderCustomersPage();
      showPage('page-customers', 'customers');
    }
  } else if (section === 'plans') {
    renderPlansPage();
    showPage('page-plans', 'plans');
  } else {
    renderHome();
    showPage('page-home', 'home');
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

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
}

function positionDashboardMenu(button) {
  const menu = ensureDashboardMenu();
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
  const clientName = (prompt('Client name for the PDF') || '').trim();
  if (!clientName) return exportHref;
  const url = new URL(exportHref, window.location.origin);
  url.searchParams.set('clientName', clientName);
  return `${url.pathname}${url.search}`;
}

function downloadPlanPdf(exportHref, planName, { hasCustomer = false } = {}) {
  const message = document.getElementById('dashboard-message');
  const href = exportHrefWithClientName(exportHref, hasCustomer);
  const link = document.createElement('a');
  link.href = href;
  link.download = pdfDownloadName(planName);
  document.body.append(link);
  link.click();
  link.remove();
  message.textContent = 'PDF export started.';
}

async function refreshDashboard() {
  const res = await fetch('/api/dashboard?limit=100');
  if (!res.ok) throw new Error('Failed to load dashboard.');
  const data = await res.json();
  state.stats = data.stats || {};
  state.customers = data.customers || [];
  state.generalPlans = data.generalPlans || [];
  state.recentPlans = data.recentPlans || [];
  state.customerPlans.clear();
  renderRoute();
  document.body.classList.remove('dashboard-loading');
}

async function submitNewCustomer(form) {
  const message = document.getElementById('dashboard-message');
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = customerFormPayload(form);

  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Adding...';

  try {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to add customer.');

    form.reset();
    message.textContent = 'Customer added.';
    await refreshDashboard();
    location.hash = '#/customers';
  } catch (error) {
    message.textContent = error.message || 'Failed to add customer.';
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `${iconSvg('plus', 15)}Add customer`;
  }
}

async function submitEditCustomer(form) {
  const message = document.getElementById('dashboard-message');
  const submitButton = form.querySelector('button[type="submit"]');
  const customerId = form.elements.namedItem('id').value;
  const payload = customerFormPayload(form);

  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Saving...';

  try {
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update customer.');

    message.textContent = '';
    await refreshDashboard();
    location.hash = `#/customers/${encodeURIComponent(customerId)}`;
  } catch (error) {
    message.textContent = error.message || 'Failed to update customer.';
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `${iconSvg('plus', 15)}Save customer`;
  }
}

function showPlanMenu(button) {
  const menu = ensureDashboardMenu();
  const { planId, planName, exportHref, customerId } = button.dataset;
  menu.innerHTML = `
    <button type="button" data-action="export">Export as PDF</button>
    <button type="button" class="danger" data-action="delete">Delete</button>
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
    document.getElementById('dashboard-message').textContent = 'Plan deleted.';
    await refreshDashboard();
  });

  positionDashboardMenu(button);
}

function showCustomerMenu(button) {
  const menu = ensureDashboardMenu();
  const { customerId, customerName } = button.dataset;
  menu.innerHTML = `
    <button type="button" data-action="edit">Edit customer</button>
    <button type="button" class="danger" data-action="delete">Delete customer</button>
  `;

  menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
    hideDashboardMenu();
    location.hash = `#/customers/${encodeURIComponent(customerId)}/edit`;
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    hideDashboardMenu();
    if (!confirm(`Delete customer "${customerName}"? Plans assigned to this customer will stay saved as general plans.`)) return;
    const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { method: 'DELETE' });
    if (!res.ok) {
      document.getElementById('dashboard-message').textContent = 'Failed to delete customer.';
      return;
    }
    document.getElementById('dashboard-message').textContent = '';
    if (parseHash()[0] === 'customers' && String(parseHash()[1] || '') === String(customerId)) {
      location.hash = '#/customers';
    }
    await refreshDashboard();
  });

  positionDashboardMenu(button);
}

function installStaticIcons() {
  document.querySelectorAll('.dashboard-action-tile [data-tone="cal"]').forEach((el) => { el.innerHTML = iconSvg('plus', 17); });
  document.querySelectorAll('.dashboard-action-tile [data-tone="protein"]').forEach((el) => { el.innerHTML = iconSvg('users', 17); });
  document.querySelectorAll('[data-icon="customers"]').forEach((el) => { el.innerHTML = iconSvg('users', 15); });
  document.querySelectorAll('[data-icon="plans"]').forEach((el) => { el.innerHTML = iconSvg('file', 15); });
  document.querySelectorAll('[data-icon="active"]').forEach((el) => { el.innerHTML = iconSvg('zap', 15); });
  document.querySelectorAll('[data-icon="chart"]').forEach((el) => { el.innerHTML = iconSvg('chart', 15); });
  document.querySelectorAll('[data-icon="clock"]').forEach((el) => { el.innerHTML = iconSvg('clock', 15); });
}

async function initNav() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.replace('/login');
    return false;
  }

  const { user } = await res.json();
  state.user = user;
  const firstName = String(user.firstname || '');
  document.getElementById('planner-nav-user').innerHTML = `
    <span class="planner-nav__greeting">Hi, ${escapeHtml(firstName)}</span>
    <button class="planner-nav__link" id="logout-btn" type="button" aria-label="Log out">${iconSvg('logout')}<span>Log out</span></button>
    <span class="dashboard-nav-avatar" aria-hidden="true">${escapeHtml(firstName[0] || 'P')}</span>
  `;

  document.getElementById('dashboard-title').textContent = `Good afternoon, ${firstName}`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.replace('/');
  });

  return true;
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
  document.getElementById('customer-search')?.addEventListener('input', (event) => {
    state.customerSearch = event.target.value.trim();
    renderCustomersPage();
  });
  document.getElementById('general-plan-search')?.addEventListener('input', (event) => {
    state.planSearch = event.target.value.trim();
    renderPlansPage();
  });
  document.getElementById('plan-filter-chips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('.dashboard-filter-chip, .pp-chip');
    if (!chip) return;
    state.planFilter = chip.dataset.key || null;
    renderPlansPage();
  });
  document.querySelectorAll('.dashboard-insights-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const block = button.nextElementSibling;
      const open = !block.classList.contains('is-open');
      block.classList.toggle('is-open', open);
      button.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
    });
  });
  document.getElementById('new-customer-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitNewCustomer(event.currentTarget);
  });
  document.getElementById('edit-customer-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    submitEditCustomer(event.currentTarget);
  });
}

document.addEventListener('click', (event) => {
  const menuButton = event.target.closest('.dashboard-plan-menu-btn');
  if (menuButton) {
    event.preventDefault();
    event.stopPropagation();
    showPlanMenu(menuButton);
    return;
  }

  const customerMenuButton = event.target.closest('.dashboard-customer-menu-btn');
  if (customerMenuButton) {
    event.preventDefault();
    event.stopPropagation();
    showCustomerMenu(customerMenuButton);
    return;
  }

  const customerOpen = event.target.closest('[data-customer-open]');
  if (customerOpen) {
    location.hash = `#/customers/${encodeURIComponent(customerOpen.dataset.customerOpen)}`;
    return;
  }

  if (!event.target.closest('.dashboard-context-menu')) hideDashboardMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideDashboardMenu();
    setMobileNavOpen(false);
  }
});

window.addEventListener('hashchange', renderRoute);
window.addEventListener('scroll', hideDashboardMenu, true);

(async () => {
  installStaticIcons();
  bindEvents();
  const authed = await initNav();
  if (!authed) return;

  try {
    await refreshDashboard();
    if (!location.hash) location.hash = '#/home';
    else renderRoute();
  } catch {
    document.body.classList.remove('dashboard-loading');
    document.getElementById('dashboard-message').textContent = 'Failed to load dashboard.';
  }
})();
