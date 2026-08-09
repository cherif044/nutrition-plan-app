const plannerCtx = (() => {
  const p = new URLSearchParams(location.search);
  const planId = p.get('planId');
  const folderId = p.get('folderId');
  if (!planId && !folderId) return null;
  return { planId, folderId, folderName: null };
})();

function iconSvg(name, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    rotate: '<path d="M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2.5v3.8h-3.8"/>',
    save: '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8L15.2 3Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  };
  return `<svg ${attrs}>${icons[name] || ''}</svg>`;
}

// Auth guard
(async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.replace('/login'); return; }
    const { user } = await res.json();
      const navUser = document.getElementById('planner-nav-user');
    if (navUser) {
      const backHref = plannerCtx?.folderId
        ? `/explorer?folderId=${plannerCtx.folderId}`
        : '/explorer';
      const backLabel = plannerCtx?.planId ? 'Explorer' : 'Explorer';
      navUser.innerHTML = `
        <span class="planner-nav__greeting">Hi, ${escapeHtml(user.firstname)}</span>
        <a class="planner-nav__link" href="/" aria-label="Home">${iconSvg('home')}<span>Home</span></a>
        <a class="planner-nav__link" href="${backHref}" aria-label="${backLabel}">${iconSvg('arrowLeft')}<span>${backLabel}</span></a>
        <button class="planner-nav__link" id="logout-btn" type="button" aria-label="Log out">${iconSvg('logout')}<span>Log out</span></button>
      `;
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.replace('/');
      });
    }

    if (plannerCtx?.planId) {
      const eyebrow = document.getElementById('planner-eyebrow');
      const title = document.getElementById('planner-title');
      if (eyebrow) eyebrow.textContent = 'Edit Plan';
      if (title) title.textContent = 'Your inputs';
      loadPlanForEdit(plannerCtx.planId);
    } else if (plannerCtx?.folderId) {
      fetch(`/api/folders/${plannerCtx.folderId}`)
        .then((r) => r.json())
        .then(({ folder }) => {
          if (!folder) return;
          plannerCtx.folderName = folder.name;
          const eyebrow = document.getElementById('planner-eyebrow');
          if (eyebrow) eyebrow.textContent = `Saving to ${folder.name}`;
        })
        .catch(() => {});
    }
  } catch {
    window.location.replace('/login');
  }
})();

const form = document.querySelector('#plan-form');
const message = document.querySelector('#form-message');
const output = document.querySelector('#plan-output');
const emptyState = document.querySelector('#empty-state');
const summaryTemplate = document.querySelector('#summary-template');
const mealTemplate = document.querySelector('#meal-template');
const submitButton = form.querySelector('button[type="submit"]');
const freeformButton = document.querySelector('#freeform-btn');
const inputsToggle = document.querySelector('#inputs-toggle');
const inputChipRow = document.querySelector('#input-chip-row');
const saveBarSlot = document.querySelector('#save-bar-slot');
const ramadanToggle = form.elements.ramadanMode;
const mealsSelect = form.elements.numberOfMeals;
const distributionSelect = form.elements.mealDistribution;
const preferenceFields = document.querySelectorAll('.preference-field');
const DEFAULT_PLAN_OPTIONS = Object.freeze({
  dietType: 'standard',
  milkType: 'skimmed',
  coffeesPerDay: 0,
  ramadanMode: false,
});

const labels = {
  calories: ['Calories', 'kcal'],
  proteinG: ['Protein', 'g'],
  carbG: ['Carbs', 'g'],
  fatG: ['Fat', 'g'],
};
const separator = '·';
const DAILY_CALORIE_WINDOW_PERCENT = 0.05;
const PROTEIN_RANGE_PER_KG = { min: 1.8, max: 2.2 };
const FAT_RANGE_PER_KG = { min: 0.66, max: 1.0 };

const preferenceState = { avoidFoods: [] };
let preferenceOptions = { avoidFoods: [] };

let foodsById = new Map();
loadAllFoods();

const mealStates = [];
let dailyTargets = null;
let currentPlanInput = null;
let pendingAvoidFoodIds = null;

async function readJsonResponse(response, fallbackMessage = 'Request failed.') {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const message = response.ok
      ? 'The server returned an invalid response.'
      : `${fallbackMessage} ${response.status ? `(${response.status})` : ''}`.trim();
    return { error: message };
  }
}

// ── Form submit ──────────────────────────────────────────────────────────────

async function generateAndRender(apiUrl) {
  message.textContent = '';
  setLoading(true);
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    const payload = await readJsonResponse(response, 'Unable to generate a nutrition plan.');
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to generate a nutrition plan.');
    }
    renderPlan(payload);
    switchPlannerView('plan', { push: true });
    setInputsExpanded(false);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  generateAndRender('/api/generate-plan');
});

freeformButton?.addEventListener('click', () => {
  generateAndRender('/api/generate-plan-freeform');
});

inputsToggle?.addEventListener('click', () => {
  setInputsExpanded(!form.classList.contains('inputs-card--expanded'));
});

form.addEventListener('input', syncInputSummary);
form.addEventListener('change', syncInputSummary);
ramadanToggle?.addEventListener('change', syncRamadanControls);
syncRamadanControls();
syncInputSummary();
if (!plannerCtx?.planId) {
  switchPlannerView('input', { push: false });
  setInputsExpanded(true);
}
loadPreferenceOptions();

function readForm() {
  const data = new FormData(form);
  return {
    weightKg: data.get('weightKg'),
    heightCm: data.get('heightCm'),
    age: data.get('age'),
    sex: data.get('sex'),
    bodyFatPercentage: data.get('bodyFatPercentage'),
    activityLevel: data.get('activityLevel'),
    goal: data.get('goal'),
    numberOfMeals: data.get('numberOfMeals'),
    mealDistribution: data.get('mealDistribution'),
    dietType: data.get('dietType') || DEFAULT_PLAN_OPTIONS.dietType,
    avoidFoods: preferenceState.avoidFoods.map((o) => o.id),
    milkType: data.get('milkType') || DEFAULT_PLAN_OPTIONS.milkType,
    coffeesPerDay: data.get('coffeesPerDay') || DEFAULT_PLAN_OPTIONS.coffeesPerDay,
    ramadanMode: data.get('ramadanMode') === 'on',
  };
}

function switchPlannerView(view, { push = false } = {}) {
  const isPlan = view === 'plan';
  document.body.classList.toggle('is-plan-view', isPlan);
  document.body.classList.toggle('is-input-view', !isPlan);
  if (emptyState) emptyState.hidden = isPlan;
  if (saveBarSlot && !isPlan) saveBarSlot.innerHTML = '';
  updateSubmitIdleLabel();

  if (push) {
    const url = new URL(window.location.href);
    if (isPlan) url.searchParams.set('view', 'plan');
    else url.searchParams.delete('view');
    history.pushState({ plannerView: view }, '', url);
  }
}

function setInputsExpanded(expanded) {
  const shouldExpand = Boolean(expanded) || !document.body.classList.contains('is-plan-view');
  form.classList.toggle('inputs-card--expanded', shouldExpand);
  form.classList.toggle('inputs-card--collapsed', !shouldExpand);
  inputsToggle?.setAttribute('aria-expanded', String(shouldExpand));
  const label = inputsToggle?.querySelector('span');
  if (label) label.textContent = shouldExpand ? 'Close' : 'Edit inputs';
  updateSubmitIdleLabel();
}

function updateSubmitIdleLabel() {
  if (submitButton?.disabled) return;
  const label = submitButton?.querySelector('span:last-child');
  if (label) {
    label.textContent = document.body.classList.contains('is-plan-view') ? 'Update plan' : 'Generate plan';
  }
}

function syncInputSummary() {
  if (!inputChipRow) return;
  const input = readForm();
  const chips = [
    ['Goal', goalLabel(input.goal)],
    ['Meals', `${input.numberOfMeals} / day`],
    ['Diet', titleCase(input.dietType)],
    ['Activity', titleCase(input.activityLevel)],
    ['Weight', `${formatNumber(input.weightKg)} kg`],
  ];
  inputChipRow.innerHTML = chips
    .map(([label, value]) => `<span class="input-chip"><small>${label}</small>${escapeHtml(value)}</span>`)
    .join('');
}

function goalLabel(value) {
  if (value === 'lose_weight') return 'Lose weight';
  if (value === 'gain_weight') return 'Gain weight';
  return 'Maintain';
}

function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ── Foods catalog ────────────────────────────────────────────────────────────

async function loadAllFoods() {
  try {
    const res = await fetch('/api/foods');
    if (!res.ok) return;
    const { foods } = await readJsonResponse(res, 'Unable to load foods.');
    foodsById = new Map(foods.map((f) => [f.id, f]));
  } catch { /* non-critical */ }
}

// ── Edit mode ────────────────────────────────────────────────────────────────

async function loadPlanForEdit(planId) {
  try {
    const res = await fetch(`/api/plans/${planId}`);
    if (!res.ok) { message.textContent = 'Plan not found.'; return; }
    const { plan } = await readJsonResponse(res, 'Failed to load plan.');

    if (plan.plan_data?.input) {
      populateFormFromInput(plan.plan_data.input);
    }

    renderPlan(plan.plan_data, { editMode: true, planId, planName: plan.name });
  } catch {
    message.textContent = 'Failed to load plan.';
  }
}

function populateFormFromInput(input) {
  const set = (name, val) => {
    const el = form.elements[name];
    if (!el || val === undefined || val === null) return;
    if (el.type === 'checkbox') {
      el.checked = Boolean(val);
    } else {
      el.value = val;
    }
  };
  set('weightKg', input.weightKg);
  set('heightCm', input.heightCm);
  set('age', input.age);
  set('sex', input.sex);
  set('bodyFatPercentage', input.bodyFatPercentage);
  set('activityLevel', input.activityLevel);
  set('goal', input.goal);
  set('numberOfMeals', input.numberOfMeals);
  set('mealDistribution', input.mealDistribution);
  set('dietType', input.dietType);
  set('milkType', input.milkType);
  set('coffeesPerDay', input.coffeesPerDay);
  set('ramadanMode', input.ramadanMode);
  if (Array.isArray(input.avoidFoods)) {
    pendingAvoidFoodIds = input.avoidFoods;
    hydrateAvoidFoodPreferences();
  }
  syncRamadanControls();
  syncInputSummary();
}

// ── Render plan ──────────────────────────────────────────────────────────────

function renderPlan(plan, { editMode = false, planId = null, planName = '' } = {}) {
  output.innerHTML = '';
  mealStates.length = 0;
  currentPlanInput = plan.input || null;
  output.hidden = false;
  emptyState.hidden = true;
  switchPlannerView('plan', { push: false });
  setInputsExpanded(false);
  syncInputSummary();

  if (isImpossiblePlan(plan)) {
    output.append(renderPlanNotice({
      tone: 'error',
      title: 'Plan cannot be generated with the current templates',
      messages: plan.errors || plan.diagnostics?.errors || ['No feasible nutrition plan was found.'],
      diagnostics: plan.diagnostics,
    }));
    if (!Array.isArray(plan.meals) || plan.meals.length === 0) return;
  }

  if (plan.warnings?.length || plan.diagnostics?.warnings?.length) {
    output.append(renderPlanNotice({
      tone: 'warning',
      title: 'Plan is approximate',
      messages: plan.warnings || plan.diagnostics?.warnings || [],
      diagnostics: plan.diagnostics,
    }));
  }

  output.append(renderSummary(plan.dailyTargets, plan.diagnostics?.bounds));

  if (editMode) {
    showEditBar(planId, planName);
  } else if (plannerCtx?.folderId) {
    showFolderSaveBar(plannerCtx.folderId);
  } else if (saveBarSlot) {
    saveBarSlot.innerHTML = '';
  }

  plan.meals.forEach((meal, mealIndex) => {
    const state = {
      mealIndex,
      name: meal.name,
      tag: meal.tag,
      target: { ...meal.target },
      templateId: meal.templateId || null,
      templateName: meal.templateName || null,
      templateFamily: meal.templateFamily || meal.readyMealTrack || null,
      isOriginalTemplate: Boolean(meal.isOriginalTemplate),
      numberOfSwaps: Number(meal.numberOfSwaps || 0),
      candidateSource: meal.candidateSource || null,
      isApproximate: Boolean(meal.isApproximate),
      unavailableReason: meal.unavailableReason || null,
      mealOptions: (meal.mealOptions || [])
        .map(normalizeMealOption)
        .filter((option) => mealOptionFitsTarget(option, meal.target)),
      mealOptionIndex: 0,
      mealOptionsLoaded: (meal.mealOptions || []).length > 0,
      editModeEnabled: false,
      pendingProposal: null,
      originalItems: (meal.originalItems || meal.items).map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
      })),
      items: meal.items.map((item) => ({
        food: item.food,
        quantityG: Number(item.quantityG) || 0,
        customFood: item.customFood || null,
        alternatives: item.alternatives || [],
        broaderAlternatives: item.broaderAlternatives || [],
        nearestAlternatives: item.nearestAlternatives || [],
        component: item.component || null,
        swapOptions: item.swapOptions || null,
        swapIndex: Number.isInteger(item.swapIndex) ? item.swapIndex : null,
      })),
      originalMealOption: normalizeMealOption({
        templateId: meal.templateId || null,
        templateName: meal.templateName || meal.name,
        templateFamily: meal.templateFamily || null,
        items: meal.items,
        totals: meal.totals || null,
        isApproximate: Boolean(meal.isApproximate),
      }),
      chatHistory: [],
      chatTurnCount: 0,
      chatWorkingItems: null,
      chatPrevWorkingItems: null,
      chatMessages: [],
      cardEl: null,
    };
    mealStates.push(state);

    const card = renderMealCard(state);
    state.cardEl = card;
    output.append(card);
  });

  refreshRedFlags();
}

function isImpossiblePlan(plan) {
  return plan?.status === 'error' || plan?.isImpossible === true || plan?.diagnostics?.status === 'error';
}

function renderPlanNotice({ tone, title, messages, diagnostics }) {
  const panel = document.createElement('section');
  panel.className = `plan-notice plan-notice--${tone} panel`;
  panel.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  const heading = document.createElement('h2');
  heading.textContent = title;
  panel.append(heading);

  const uniqueMessages = [...new Set((messages || []).filter(Boolean))];
  const list = document.createElement('ul');
  const visibleMessages = uniqueMessages.length > 0
    ? uniqueMessages
    : ['The generated plan needs review before use.'];
  visibleMessages.slice(0, 5).forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  });
  panel.append(list);

  const missingSlots = diagnostics?.missingSlots || [];
  if (missingSlots.length > 0) {
    const detail = document.createElement('p');
    detail.className = 'plan-notice__detail';
    detail.textContent = `Missing slots: ${missingSlots.join(', ')}`;
    panel.append(detail);
  }

  return panel;
}

// ── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(targets, serverBounds = null) {
  dailyTargets = targets;
  const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
  const metrics = summary.querySelector('.metrics');

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const bounds = dailyMetricBounds(key, targets, serverBounds);
    const metric = document.createElement('div');
    metric.className = 'metric';
    metric.dataset.metric = key;
    metric.innerHTML = `
      <div class="metric__top">
        <span>${labels[key][0]}</span>
      </div>
      <strong>
        <span class="daily-actual daily-actual-${key}">—</span>
      </strong>
      <div class="metric-bar" aria-hidden="true"><i></i></div>
      <em class="metric-range">${formatAllowedRange(bounds, labels[key][1])}</em>
      <div class="flag-detail"></div>
    `;
    metrics.append(metric);
  }

  return summary;
}

// ── Red flags (daily level) ──────────────────────────────────────────────────

function refreshRedFlags() {
  if (!dailyTargets) return;
  const summaryEl = output.querySelector('.summary');
  if (!summaryEl) return;

  const actual = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };

  for (const state of mealStates) {
    const t = computeTotals(state.items);
    actual.calories += t.calories;
    actual.proteinG += t.proteinG;
    actual.carbG += t.carbG;
    actual.fatG += t.fatG;
  }

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const tgt = dailyTargets[key];
    const flagged = !dailyMetricFitsTarget(key, actual[key], dailyTargets);

    const metricEl = summaryEl.querySelector(`.metric[data-metric="${key}"]`);
    if (metricEl) metricEl.classList.toggle('metric--flagged', flagged);

    const actualEl = summaryEl.querySelector(`.daily-actual-${key}`);
    if (actualEl) actualEl.textContent = formatNumber(actual[key]);

    const percent = tgt > 0 ? (actual[key] / tgt) * 100 : 0;
    const barEl = metricEl?.querySelector('.metric-bar i');
    if (barEl) barEl.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;

    const flagDetail = metricEl?.querySelector('.flag-detail');
    if (flagDetail) {
      if (flagged) {
        flagDetail.textContent = `${labels[key][0]} outside the accepted range`;
        flagDetail.hidden = false;
      } else {
        flagDetail.hidden = true;
      }
    }
  }
}

// ── Meal card rendering ──────────────────────────────────────────────────────

function renderMealCard(state) {
  const card = mealTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('h2').textContent = state.name;
  card.dataset.mealIndex = state.mealIndex;
  state.cardEl = card;

  refreshMealCardHeader(card, state);

  renderFoodList(state);

  card.querySelector('.meal-cycle-btn--prev').addEventListener('click', () => handleCycleMealOption(state, -1));
  card.querySelector('.meal-cycle-btn--next').addEventListener('click', () => handleCycleMealOption(state, 1));
  card.querySelector('.meal-add-food-btn').addEventListener('click', () => showAddFoodAction(state));
  card.querySelector('.edit-mode-toggle').addEventListener('change', (event) => {
    setMealAiMode(state, event.target.checked);
  });
  refreshMealCustomizationControls(state);
  refreshMealCycleButtons(state);

  return card;
}

function setMealAiMode(state, enabled) {
  state.editModeEnabled = Boolean(enabled);
  renderFoodList(state);
  refreshMealCustomizationControls(state);
  if (!state.editModeEnabled) {
    const panel = actionPanel(state);
    panel.hidden = true;
    panel.innerHTML = '';
    state.pendingProposal = null;
  }
}

function refreshMealCustomizationControls(state) {
  const tray = state.cardEl?.querySelector('.meal-add-tray');
  if (tray) tray.hidden = !state.editModeEnabled;
}

function refreshMealCardHeader(card, state) {
  const totals = computeTotals(state.items);
  card.querySelector('.meal-card__meta').textContent = mealCardMetaText(state);

  const values = {
    calories: { actual: totals.calories },
    proteinG: { actual: totals.proteinG },
    carbG: { actual: totals.carbG },
    fatG: { actual: totals.fatG },
  };

  for (const [key, value] of Object.entries(values)) {
    const actualEl = card.querySelector(`.meal-actual-${key}`);
    if (actualEl) actualEl.textContent = formatNumber(value.actual);
  }
}

function mealCardMetaText(state) {
  const optionCount = readyMealOptions(state).length;
  const total = Math.max(optionCount, 1);
  const current = Math.min(Math.max((Number(state.mealOptionIndex) || 0) + 1, 1), total);
  return `${current} of ${total}`;
}

function renderFoodList(state) {
  const foodList = state.cardEl?.querySelector('.food-list');
  if (!foodList) return;
  foodList.innerHTML = '';
  state.items.forEach((_, itemIndex) => {
    foodList.append(renderFoodItem(state, itemIndex));
  });
}

// ── Food item rendering ──────────────────────────────────────────────────────

function renderFoodItem(state, itemIndex) {
  const item = state.items[itemIndex];
  const food = item.food;

  const row = document.createElement('div');
  row.className = `food-item${state.editModeEnabled ? ' food-item--edit' : ''}`;
  row.dataset.itemIndex = itemIndex;

  const totals = itemTotals(food, item.quantityG);

  row.innerHTML = `
    <div class="food-main">
      <div class="food-title">
        <div class="food-name">${escapeHtml(food.name)}</div>
        ${food.nameAr ? `<div class="food-ar">${escapeHtml(food.nameAr)}</div>` : ''}
      </div>
      <div class="food-grams-readout">${escapeHtml(formatPortion(item))}</div>
      <div class="food-macros">
        <strong class="item-kcal">${formatNumber(totals.calories)} kcal</strong>
        <span class="item-p">P ${formatNumber(totals.proteinG)}g</span>
        <span class="item-c">C ${formatNumber(totals.carbG)}g</span>
        <span class="item-f">F ${formatNumber(totals.fatG)}g</span>
      </div>
      ${state.editModeEnabled ? `
        <div class="food-actions">
          <button class="food-icon-btn food-swap-btn" type="button" aria-label="Swap ${escapeHtml(food.name)}">
            <span aria-hidden="true">⇄</span>
          </button>
          <button class="food-icon-btn food-delete-btn" type="button" aria-label="Remove ${escapeHtml(food.name)}">
            <span aria-hidden="true">⌫</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;

  row.querySelector('.food-swap-btn')?.addEventListener('click', () => showSwapFoodAction(state, itemIndex));
  row.querySelector('.food-delete-btn')?.addEventListener('click', () => showRemoveFoodAction(state, itemIndex));

  return row;
}

// ── Guided meal actions ─────────────────────────────────────────────────────

function normalizeMealOption(option) {
  return {
    templateId: option.templateId || null,
    templateName: option.templateName || 'Alternate meal',
    templateFamily: option.templateFamily || null,
    items: (option.items || []).map(normalizeStateItem),
    totals: option.totals || null,
    isApproximate: Boolean(option.isApproximate),
  };
}

function mealOptionFitsTarget(option, target) {
  if (!target || !Array.isArray(option.items) || option.items.length === 0) return false;
  const totals = option.totals || computeTotals(option.items);
  if (target.macroWindows) {
    return (
      totals.calories >= target.macroWindows.calories.min &&
      totals.calories <= target.macroWindows.calories.max &&
      totals.proteinG >= target.macroWindows.proteinG.min &&
      totals.proteinG <= target.macroWindows.proteinG.max &&
      totals.carbG >= target.macroWindows.carbG.min &&
      totals.carbG <= target.macroWindows.carbG.max &&
      totals.fatG >= target.macroWindows.fatG.min &&
      totals.fatG <= target.macroWindows.fatG.max
    );
  }
  const weightKg = Number(currentPlanInput?.weightKg);
  if (!dailyTargets || !Number.isFinite(weightKg)) return false;
  const proteinShare = target.proteinG / dailyTargets.proteinG;
  const fatShare = target.fatG / dailyTargets.fatG;
  return (
    Math.abs(totals.calories - target.calories) <=
      dailyTargets.calories * DAILY_CALORIE_WINDOW_PERCENT &&
    totals.proteinG >= weightKg * PROTEIN_RANGE_PER_KG.min *
      proteinShare &&
    totals.proteinG <= weightKg * PROTEIN_RANGE_PER_KG.max *
      proteinShare &&
    totals.fatG >= weightKg * FAT_RANGE_PER_KG.min *
      fatShare &&
    totals.fatG <= weightKg * FAT_RANGE_PER_KG.max *
      fatShare &&
    totals.carbG >= 0
  );
}

function addTotals(left, right) {
  return {
    calories: left.calories + right.calories,
    proteinG: left.proteinG + right.proteinG,
    carbG: left.carbG + right.carbG,
    fatG: left.fatG + right.fatG,
  };
}

function dailyMetricFitsTarget(key, actual, targets) {
  if (!Number.isFinite(actual) || !targets) return false;
  const bounds = dailyMetricBounds(key, targets);
  return actual >= bounds.min && actual <= bounds.max;
}

function dailyMetricBounds(key, targets, serverBounds = null) {
  const serverRange = serverBounds?.[key];
  if (serverRange && Number.isFinite(Number(serverRange.min)) && Number.isFinite(Number(serverRange.max))) {
    return { min: Number(serverRange.min), max: Number(serverRange.max) };
  }

  const target = Number(targets?.[key]);
  const range = targets?.macroRanges?.[key];
  if ((key === 'proteinG' || key === 'fatG') && range) {
    return { min: Number(range.min), max: Number(range.max) };
  }

  const weightKg = Number(currentPlanInput?.weightKg);
  if (key === 'proteinG' && Number.isFinite(weightKg)) {
    return { min: weightKg * PROTEIN_RANGE_PER_KG.min, max: weightKg * PROTEIN_RANGE_PER_KG.max };
  }
  if (key === 'fatG' && Number.isFinite(weightKg)) {
    return { min: weightKg * FAT_RANGE_PER_KG.min, max: weightKg * FAT_RANGE_PER_KG.max };
  }

  const calories = {
    min: Number(targets?.calories) * (1 - DAILY_CALORIE_WINDOW_PERCENT),
    max: Number(targets?.calories) * (1 + DAILY_CALORIE_WINDOW_PERCENT),
  };
  if (key === 'carbG') {
    const protein = dailyMetricBounds('proteinG', targets, serverBounds);
    const fat = dailyMetricBounds('fatG', targets, serverBounds);
    return {
      min: Math.max(0, (calories.min - protein.max * 4 - fat.max * 9) / 4),
      max: (calories.max - protein.min * 4 - fat.min * 9) / 4,
    };
  }

  return calories;
}

function formatAllowedRange(bounds, unit) {
  return `Allowed ${formatNumber(bounds.min)}-${formatNumber(bounds.max)} ${unit}`;
}

function normalizeStateItem(item) {
  return {
    food: item.food,
    quantityG: Number(item.quantityG) || 0,
    customFood: item.customFood || null,
    alternatives: item.alternatives || [],
    broaderAlternatives: item.broaderAlternatives || [],
    nearestAlternatives: item.nearestAlternatives || [],
    component: item.component || null,
  };
}

function mealActionItems(items) {
  return items.filter((item) => item.food).map((item) => ({
    foodId: item.food.id,
    name: item.food.name,
    quantityG: item.quantityG,
    customFood: item.customFood || (item.food.custom ? customFoodPayload(item.food) : null),
  }));
}

function customFoodPayload(food) {
  return {
    id: food.id,
    name: food.name,
    servingG: food.defaultServingG || 100,
    calories: (food.caloriesPer100g || 0) * (food.defaultServingG || 100) / 100,
    proteinG: (food.proteinGPer100g || 0) * (food.defaultServingG || 100) / 100,
    carbG: (food.carbGPer100g || 0) * (food.defaultServingG || 100) / 100,
    fatG: (food.fatGPer100g || 0) * (food.defaultServingG || 100) / 100,
  };
}

async function handleTryAnotherMeal(state) {
  await handleCycleMealOption(state, 1);
}

function readyMealOptions(state) {
  const original = state.originalMealOption || normalizeMealOption({
    templateId: state.templateId || null,
    templateName: state.templateName || state.name,
    items: state.items,
    isApproximate: Boolean(state.isApproximate),
  });
  const seen = new Set();
  return [original, ...(state.mealOptions || [])].filter((option) => {
    const key = option.templateId || option.templateName || JSON.stringify((option.items || []).map((item) => item.food?.id));
    if (seen.has(key)) return false;
    seen.add(key);
    return Array.isArray(option.items) && option.items.length > 0;
  });
}

async function handleCycleMealOption(state, direction) {
  if (!state.mealOptionsLoaded && readyMealOptions(state).length <= 1) {
    const refillOk = await refillMealOptions(state);
    if (!refillOk) return;
  }

  const options = readyMealOptions(state);
  if (options.length <= 1) {
    showActionMessage(state, 'No other ready meals fit this meal window yet.');
    refreshMealCycleButtons(state);
    return;
  }

  const nextIndex = nextDaySafeMealOptionIndex(state, direction, options);
  if (nextIndex === null) {
    showActionMessage(state, 'No other ready meal fits this meal window.');
    refreshMealCycleButtons(state);
    return;
  }

  applyReadyMealOption(state, options[nextIndex], nextIndex);
}

function nextDaySafeMealOptionIndex(state, direction, options) {
  const step = direction >= 0 ? 1 : -1;
  const currentIndex = Number.isInteger(state.mealOptionIndex) ? state.mealOptionIndex : 0;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (currentIndex + step * offset + options.length) % options.length;
    if (index === currentIndex) continue;
    const option = options[index];
    if (mealOptionFitsTarget(option, state.target)) return index;
  }

  return null;
}

function applyReadyMealOption(state, option, optionIndex) {
  state.items = option.items.map(normalizeStateItem);
  state.mealOptionIndex = optionIndex;
  state.templateId = option.templateId || state.templateId;
  state.templateName = option.templateName || state.templateName;
  state.templateFamily = option.templateFamily || option.readyMealTrack || null;
  state.isApproximate = Boolean(option.isApproximate);
  state.isOriginalTemplate = optionIndex === 0;
  state.numberOfSwaps = 0;
  state.pendingProposal = null;

  const panel = actionPanel(state);
  panel.hidden = true;
  panel.innerHTML = '';
  renderFoodList(state);
  refreshMealCardHeader(state.cardEl, state);
  refreshMealCycleButtons(state);
  refreshRedFlags();
  resetChat(state);
}

function refreshMealCycleButtons(state) {
  const options = readyMealOptions(state);
  const prev = state.cardEl?.querySelector('.meal-cycle-btn--prev');
  const next = state.cardEl?.querySelector('.meal-cycle-btn--next');
  if (!prev || !next) return;

  const disabled = options.length <= 1;
  prev.disabled = disabled;
  next.disabled = disabled;
  prev.setAttribute('aria-disabled', String(prev.disabled));
  next.setAttribute('aria-disabled', String(next.disabled));
}

async function refillMealOptions(state) {
  showActionMessage(state, 'Finding alternate meals...');
  try {
    const res = await fetch('/api/meal-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealTag: state.tag,
        mealTarget: state.target,
        templateId: state.templateId,
        currentItems: mealOptionRequestItems(state.items),
        userPreferences: getUserPreferences(),
        dailyContext: {
          dailyTargets,
          weightKg: Number(currentPlanInput?.weightKg),
        },
        limit: 250,
      }),
    });
    const payload = await readJsonResponse(res, 'Unable to find alternate meals.');
    if (!res.ok) throw new Error(payload.error || 'Unable to find alternate meals.');
    state.mealOptions = (payload.mealOptions || [])
      .map(normalizeMealOption)
      .filter((option) => mealOptionFitsTarget(option, state.target));
    state.mealOptionIndex = 0;
    state.mealOptionsLoaded = true;
    refreshMealCycleButtons(state);
    return true;
  } catch (error) {
    showActionMessage(state, error.message || 'Unable to find alternate meals.');
    return false;
  }
}

function mealOptionRequestItems(items) {
  const compactFoods = (foods) => (foods || [])
    .filter((food) => food?.id)
    .map((food) => ({ id: food.id }));

  return items.filter((item) => item.food).map((item) => ({
    foodId: item.food.id,
    quantityG: item.quantityG,
    component: item.component || null,
    alternatives: compactFoods(item.alternatives),
    broaderAlternatives: compactFoods(item.broaderAlternatives),
    nearestAlternatives: compactFoods(item.nearestAlternatives),
  }));
}

function showAddFoodAction(state) {
  const panel = actionPanel(state);
  resetActionPanel(panel);
  panel.hidden = false;
  panel.innerHTML = `
    <p class="meal-action-title">Add food to ${escapeHtml(state.name)}</p>
    <div class="meal-action-grid">
      <label>Database food <input class="guided-food-search" type="search" placeholder="Search existing foods" autocomplete="off" /></label>
      <div class="guided-search-results" hidden></div>
      <div class="guided-selected-food" hidden></div>
      <button class="btn btn-primary guided-food-submit" type="button" disabled>Add selected food</button>
    </div>
    <div class="custom-food-form">
      <p class="meal-action-subtitle">Custom food</p>
      <div class="custom-food-grid">
        <input class="custom-name" type="text" placeholder="Food name" />
        <input class="custom-calories" type="number" min="0" step="1" placeholder="Calories" />
        <input class="custom-protein" type="number" min="0" step="0.1" placeholder="Protein g" />
        <input class="custom-carbs" type="number" min="0" step="0.1" placeholder="Carbs g" />
        <input class="custom-fat" type="number" min="0" step="0.1" placeholder="Fat g" />
      </div>
      <button class="btn btn-primary guided-custom-add" type="button">Fit custom food</button>
    </div>
  `;

  const search = panel.querySelector('.guided-food-search');
  const results = panel.querySelector('.guided-search-results');
  const selectedEl = panel.querySelector('.guided-selected-food');
  const submit = panel.querySelector('.guided-food-submit');
  let selectedFood = null;

  search.addEventListener('input', () => {
    selectedFood = null;
    selectedEl.hidden = true;
    selectedEl.innerHTML = '';
    submit.disabled = true;
    renderFoodSearchResults(state, search.value, results, (food) => {
      selectedFood = food;
      selectedEl.hidden = false;
      selectedEl.innerHTML = `<strong>${escapeHtml(food.name)}</strong><span>${formatNumber(food.caloriesPer100g)} kcal/100g</span>`;
      submit.disabled = false;
    });
  });

  submit.addEventListener('click', () => {
    if (!selectedFood) {
      showActionMessage(state, 'Choose a food from the search results first.');
      return;
    }
    const food = selectedFood;
    const attempted = [...state.items, normalizeStateItem({ food, quantityG: food.defaultServingG })];
    attemptGuidedRebalance(state, {
      action: 'add_food',
      attemptedItems: attempted,
      title: `Add ${food.name}`,
      failureReason: 'Cannot add this food.',
      successMessage: 'Food added successfully.',
      failureMessage: 'Cannot add this food.',
      feedbackTone: 'success',
    });
  });

  panel.querySelector('.guided-custom-add').addEventListener('click', () => {
    const custom = readCustomFood(panel);
    if (!custom) {
      showActionMessage(state, 'Enter a custom food name and calories/macros first.');
      return;
    }
    const food = foodFromCustom(custom);
    const attempted = [...state.items, normalizeStateItem({ food, quantityG: food.defaultServingG, customFood: custom })];
    attemptGuidedRebalance(state, {
      action: 'add_custom_food',
      attemptedItems: attempted,
      title: `Add ${food.name}`,
      failureReason: 'Cannot add this food.',
      successMessage: 'Food added successfully.',
      failureMessage: 'Cannot add this food.',
      feedbackTone: 'success',
    });
  });
}

function showRemoveFoodAction(state, itemIndex = null) {
  const foods = state.items.filter((item) => item.food);
  if (foods.length <= 1) {
    showActionFeedback(state, {
      tone: 'danger',
      message: 'Cannot delete this food.',
      cardClass: 'meal-card--flash-delete',
    });
    return;
  }

  if (Number.isInteger(itemIndex)) {
    const item = state.items[itemIndex];
    if (!item?.food) return;
    const attempted = state.items.filter((_, candidateIndex) => candidateIndex !== itemIndex);
    attemptGuidedRebalance(state, {
      action: 'remove_food',
      attemptedItems: attempted,
      title: `Remove ${item.food.name}`,
      failureReason: 'Cannot delete this food.',
      successMessage: 'Food deleted.',
      failureMessage: 'Cannot delete this food.',
      feedbackTone: 'delete',
    });
    return;
  }

  const panel = actionPanel(state);
  resetActionPanel(panel);
  panel.hidden = false;
  panel.innerHTML = `
    <p class="meal-action-title">Remove one food</p>
    <div class="guided-choice-list"></div>
  `;
  const list = panel.querySelector('.guided-choice-list');
  foods.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-action-btn';
    btn.innerHTML = `<strong>${escapeHtml(item.food.name)}</strong><em>${formatNumber(item.quantityG)}g</em>`;
    btn.addEventListener('click', () => {
      const attempted = state.items.filter((candidate) => candidate !== item);
      attemptGuidedRebalance(state, {
        action: 'remove_food',
        attemptedItems: attempted,
        title: `Remove ${item.food.name}`,
        failureReason: 'Cannot delete this food.',
        successMessage: 'Food deleted.',
        failureMessage: 'Cannot delete this food.',
        feedbackTone: 'delete',
      });
    });
    list.append(btn);
  });
}

function showSwapFoodAction(state, itemIndex = null) {
  const item = Number.isInteger(itemIndex) ? state.items[itemIndex] : null;
  if (!item?.food) {
    showActionMessage(state, 'Choose a food to swap first.');
    return;
  }

  const alternatives = uniqueFoods([
    ...(item.alternatives || []),
    ...(item.broaderAlternatives || []),
    ...(item.nearestAlternatives || []),
  ]).filter(foodAllowedForCurrentPreferences);

  const panel = actionPanel(state);
  resetActionPanel(panel);
  panel.hidden = false;
  panel.innerHTML = `
    <p class="meal-action-title">Swap ${escapeHtml(item.food.name)}</p>
    <div class="guided-choice-list"></div>
    <div class="meal-action-grid swap-search-block">
      <label>Search foods <input class="guided-food-search" type="search" placeholder="Find a replacement food" autocomplete="off" /></label>
      <div class="guided-search-results" hidden></div>
    </div>
  `;
  const list = panel.querySelector('.guided-choice-list');

  if (!alternatives.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.textContent = 'No suggested swaps for this food. Search for another allowed food.';
    list.append(empty);
  }

  alternatives.slice(0, 8).forEach((alt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-action-btn';
    btn.innerHTML = `<strong>${escapeHtml(alt.name)}</strong><em>Swap</em>`;
    btn.addEventListener('click', () => attemptSwapFood(state, itemIndex, alt));
    list.append(btn);
  });

  const search = panel.querySelector('.guided-food-search');
  const results = panel.querySelector('.guided-search-results');
  search.addEventListener('input', () => renderFoodSearchResults(state, search.value, results, (food) => {
    attemptSwapFood(state, itemIndex, food);
  }));
}

function uniqueFoods(foods) {
  const seen = new Set();
  return (foods || []).filter((food) => {
    if (!food?.id || seen.has(food.id)) return false;
    seen.add(food.id);
    return true;
  });
}

function attemptSwapFood(state, itemIndex, alt) {
  const item = state.items[itemIndex];
  if (!item?.food || !alt) return;
  const replacementQuantityG = clampGrams(alt, item.quantityG, 5) || alt.defaultServingG || item.quantityG;
  const attempted = state.items.map((candidate, candidateIndex) => (
    candidateIndex === itemIndex
      ? normalizeStateItem({ ...item, food: alt, quantityG: replacementQuantityG })
      : candidate
  ));
  attemptGuidedRebalance(state, {
    action: 'swap_food',
    attemptedItems: attempted,
    title: `Swap ${item.food.name}`,
    failureReason: 'Cannot swap this food.',
    successMessage: 'Food swapped successfully.',
    failureMessage: 'Cannot swap this food.',
    feedbackTone: 'success',
  });
}

async function handleDeterministicRebalance(state, { previewTitle = 'Rebalanced meal' } = {}) {
  await attemptGuidedRebalance(state, {
    action: 'rebalance',
    attemptedItems: state.items,
    title: previewTitle,
    failureReason: 'No combination can solve this meal with the current foods. Change one of the foods.',
  });
}

async function attemptGuidedRebalance(state, {
  action,
  attemptedItems,
  title,
  failureReason,
  successMessage = '',
  failureMessage = '',
  feedbackTone = 'success',
} = {}) {
  const shouldApplyImmediately = state.editModeEnabled && ['add_food', 'add_custom_food', 'remove_food', 'swap_food'].includes(action);
  if (!shouldApplyImmediately) {
    showActionMessage(state, 'Checking meal fit...');
  }
  const payloadItems = mealActionItems(attemptedItems);
  try {
    const res = await fetch('/api/rebalance-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealTarget: state.target,
        items: payloadItems,
        dailyContext: {
          dailyTargets,
          weightKg: Number(currentPlanInput?.weightKg),
        },
      }),
    });
    const payload = await readJsonResponse(res, 'Unable to rebalance this meal.');
    if (!res.ok) throw new Error(payload.error || 'Unable to rebalance this meal.');
    if (res.ok && payload.success) {
      const proposedItems = mergeSolvedQuantities(attemptedItems, payload.items);
      if (shouldApplyImmediately) {
        applyMealItems(state, proposedItems, { source: 'deterministic' });
        showActionFeedback(state, {
          tone: feedbackTone === 'delete' ? 'danger' : 'success',
          message: successMessage || 'Meal updated.',
          cardClass: feedbackTone === 'delete' ? 'meal-card--flash-delete' : 'meal-card--flash-success',
        });
        return;
      }
      showProposal(state, {
        title,
        message: 'Deterministic rebalance found a valid fit.',
        proposedItems,
        proposedTotals: payload.totals,
        source: 'deterministic',
        retryContext: { action, attemptedItems, failureReason },
      });
      return;
    }
    showActionFeedback(state, {
      tone: 'danger',
      message: failureMessage || failureReason || 'This change cannot be applied.',
      cardClass: 'meal-card--flash-fail',
    });
  } catch (error) {
    showActionFeedback(state, {
      tone: 'danger',
      message: failureMessage || error.message || 'This change cannot be applied.',
      cardClass: 'meal-card--flash-fail',
    });
  }
}

function showProposal(state, proposal) {
  state.pendingProposal = proposal;
  const panel = actionPanel(state);
  resetActionPanel(panel);
  panel.hidden = false;
  const currentTotals = computeTotals(state.items);
  panel.innerHTML = `
    <p class="meal-action-title">${escapeHtml(proposal.title)}</p>
    <p class="meal-action-message">${escapeHtml(proposal.message || '')}</p>
    <div class="proposal-compare">
      <div>
        <span>Current</span>
        <strong>${formatMacroLine(currentTotals)}</strong>
      </div>
      <div>
        <span>Preview</span>
        <strong>${formatMacroLine(proposal.proposedTotals || computeTotals(proposal.proposedItems))}</strong>
      </div>
    </div>
    <div class="proposal-list"></div>
    <div class="proposal-actions">
      <button class="btn btn-primary proposal-apply" type="button">Apply</button>
      <button class="btn btn-ghost proposal-decline" type="button">Decline</button>
    </div>
  `;
  const list = panel.querySelector('.proposal-list');
  proposal.proposedItems.forEach((item) => {
    const totals = itemTotals(item.food, item.quantityG);
    const row = document.createElement('div');
    row.className = 'proposal-item';
    row.innerHTML = `<strong>${escapeHtml(item.food.name)}</strong><span>${escapeHtml(formatPortion(item))}</span><em>${formatNumber(totals.calories)} kcal · P ${formatNumber(totals.proteinG)}g · C ${formatNumber(totals.carbG)}g · F ${formatNumber(totals.fatG)}g</em>`;
    list.append(row);
  });
  panel.querySelector('.proposal-apply').addEventListener('click', () => applyProposal(state));
  panel.querySelector('.proposal-decline').addEventListener('click', () => showDeclineRetry(state, proposal));
}

function showDeclineRetry(state, proposal) {
  const panel = actionPanel(state);
  const canTryAnotherMeal = proposal.source === 'alternate_meal' && state.mealOptions.length > 0;
  panel.innerHTML = `
    <p class="meal-action-title">Suggestion declined</p>
    <div class="proposal-actions">
      ${canTryAnotherMeal ? '<button class="btn btn-primary retry-alternate" type="button">Next ready meal</button>' : ''}
      <button class="btn btn-ghost close-action" type="button">Close</button>
    </div>
  `;
  panel.querySelector('.retry-alternate')?.addEventListener('click', () => handleTryAnotherMeal(state));
  panel.querySelector('.close-action').addEventListener('click', () => {
    panel.hidden = true;
    panel.innerHTML = '';
    state.pendingProposal = null;
  });
}

function applyProposal(state) {
  if (!state.pendingProposal) return;
  applyMealItems(state, state.pendingProposal.proposedItems, state.pendingProposal);
}

function applyMealItems(state, items, options = {}) {
  state.items = items.map(normalizeStateItem);
  state.isOriginalTemplate = false;
  state.numberOfSwaps = options.source === 'alternate_meal' ? 0 : Math.max(1, Number(state.numberOfSwaps || 0));
  if (options.source === 'alternate_meal') {
    state.templateName = options.templateName || options.title?.replace(/^Try\s+/, '') || state.templateName;
    state.isApproximate = Boolean(options.isApproximate);
  } else {
    state.originalMealOption = normalizeMealOption({
      templateId: state.templateId || null,
      templateName: state.templateName || state.name,
      items: state.items,
      totals: computeTotals(state.items),
      isApproximate: Boolean(state.isApproximate),
    });
    state.mealOptionIndex = 0;
  }
  renderFoodList(state);
  refreshMealCardHeader(state.cardEl, state);
  refreshMealCycleButtons(state);
  refreshRedFlags();
  resetChat(state);
  const panel = actionPanel(state);
  panel.hidden = true;
  panel.innerHTML = '';
  state.pendingProposal = null;
}

function actionPanel(state) {
  return state.cardEl.querySelector('.meal-action-panel');
}

function showActionMessage(state, text) {
  const panel = actionPanel(state);
  panel.hidden = false;
  resetActionPanel(panel);
  panel.innerHTML = `<p class="meal-action-message">${escapeHtml(text)}</p>`;
}

function resetActionPanel(panel) {
  panel.classList.remove('meal-action-panel--success', 'meal-action-panel--danger');
  panel.removeAttribute('role');
}

function showActionFeedback(state, { tone = 'success', message, cardClass = '' }) {
  const panel = actionPanel(state);
  panel.hidden = false;
  panel.classList.remove('meal-action-panel--success', 'meal-action-panel--danger');
  panel.classList.add(tone === 'danger' ? 'meal-action-panel--danger' : 'meal-action-panel--success');
  panel.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  panel.innerHTML = `<p class="meal-action-message">${escapeHtml(message)}</p>`;

  if (cardClass && state.cardEl) {
    state.cardEl.classList.remove('meal-card--flash-success', 'meal-card--flash-delete', 'meal-card--flash-fail');
    void state.cardEl.offsetWidth;
    state.cardEl.classList.add(cardClass);
    window.setTimeout(() => {
      state.cardEl?.classList.remove(cardClass);
    }, 700);
  }
}

function renderFoodSearchResults(state, query, resultsEl, onSelect) {
  const q = normalizeText(query);
  const foods = [...foodsById.values()]
    .filter(foodAllowedForCurrentPreferences)
    .map((food) => ({ food, score: scoreFoodForMealSearch(food, q, state.tag) }))
    .filter((entry) => entry.score > -1)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, 8);

  resultsEl.innerHTML = '';
  if (!q) {
    resultsEl.hidden = true;
    return;
  }
  if (!foods.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.textContent = 'No allowed foods match that search.';
    resultsEl.append(empty);
    resultsEl.hidden = false;
    return;
  }

  foods.forEach(({ food }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggestion-item';
    btn.innerHTML = `
      <span>
        <strong>${escapeHtml(food.name)}</strong>
        <small>${formatNumber(food.caloriesPer100g)} kcal/100g · ${escapeHtml(food.macroRole || 'mixed')}</small>
      </span>
      <em>Select</em>
    `;
    btn.addEventListener('click', () => {
      resultsEl.hidden = true;
      onSelect(food);
    });
    resultsEl.append(btn);
  });
  resultsEl.hidden = false;
}

function scoreFoodForMealSearch(food, query, mealTag) {
  if (!query) return -1;
  const name = normalizeText(food.name);
  const nameAr = normalizeText(food.nameAr);
  const aliases = (food.aliases || []).map(normalizeText);
  let score = -1;
  if (name === query || nameAr === query || aliases.includes(query)) score = 100;
  else if (name.startsWith(query) || nameAr.startsWith(query) || aliases.some((a) => a.startsWith(query))) score = 85;
  else if (name.includes(query) || nameAr.includes(query) || aliases.some((a) => a.includes(query))) score = 65;
  if (score < 0) return -1;
  if ((food.mealTags || []).includes(mealTag)) score += 12;
  return score;
}

function foodAllowedForCurrentPreferences(food) {
  const prefs = getUserPreferences();
  if (prefs.avoidFoods.includes(food.id)) return false;
  if (prefs.dietType === 'vegan' && !food.isVegan) return false;
  if (prefs.dietType === 'vegetarian' && !(food.isVegetarian || food.isVegan)) return false;
  return true;
}

function readCustomFood(panel) {
  const name = panel.querySelector('.custom-name')?.value.trim();
  const calories = readMacroInput(panel, '.custom-calories');
  const proteinG = readMacroInput(panel, '.custom-protein');
  const carbG = readMacroInput(panel, '.custom-carbs');
  const fatG = readMacroInput(panel, '.custom-fat');
  if (!name || [calories, proteinG, carbG, fatG].some((value) => value === null)) return null;
  return {
    id: `custom_${Date.now()}`,
    name,
    servingG: 100,
    calories,
    proteinG,
    carbG,
    fatG,
  };
}

function readMacroInput(panel, selector) {
  const value = Number(panel.querySelector(selector)?.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function foodFromCustom(custom) {
  return {
    id: custom.id,
    name: custom.name,
    nameAr: '',
    macroRole: dominantMacroRoleFrontend(custom),
    caloriesPer100g: Number(custom.calories) || 0,
    proteinGPer100g: Number(custom.proteinG) || 0,
    carbGPer100g: Number(custom.carbG) || 0,
    fatGPer100g: Number(custom.fatG) || 0,
    isVegan: false,
    isVegetarian: false,
    allergens: [],
    categories: ['custom_food'],
    mealTags: ['breakfast', 'lunch', 'dinner', 'snack', 'iftar', 'suhoor'],
    defaultServingG: 100,
    minServingG: 0,
    maxServingG: 100,
    custom: true,
  };
}

function dominantMacroRoleFrontend({ proteinG = 0, carbG = 0, fatG = 0 }) {
  const scores = [
    ['protein', Number(proteinG) * 4],
    ['carb', Number(carbG) * 4],
    ['fat', Number(fatG) * 9],
  ].sort((a, b) => b[1] - a[1]);
  if (scores[0][1] <= 0) return 'mixed';
  return scores[0][1] >= scores[1][1] * 1.35 ? scores[0][0] : 'mixed';
}

function mergeSolvedQuantities(attemptedItems, solvedItems) {
  const solvedById = new Map((solvedItems || []).map((item) => [String(item.foodId), Number(item.quantityG) || 0]));
  return attemptedItems
    .filter((item) => item.food && solvedById.has(String(item.food.id)))
    .map((item) => normalizeStateItem({
      ...item,
      quantityG: solvedById.get(String(item.food.id)),
    }));
}

function itemFromGuidedProposal(item) {
  const custom = item.customFood || null;
  const food = custom
    ? foodFromCustom({ id: item.foodId, ...custom })
    : (item.food?.caloriesPer100g !== undefined ? item.food : foodsById.get(item.foodId));

  return normalizeStateItem({
    food,
    quantityG: item.quantityG,
    customFood: custom,
    alternatives: [],
    broaderAlternatives: [],
    nearestAlternatives: [],
  });
}

function formatMacroLine(totals) {
  return `${formatNumber(totals.calories)} kcal · P ${formatNumber(totals.proteinG)}g · C ${formatNumber(totals.carbG)}g · F ${formatNumber(totals.fatG)}g`;
}

function formatPortion(item) {
  if (item.customFood) {
    const servingG = Number(item.customFood.servingG || 100);
    const servings = servingG > 0 ? item.quantityG / servingG : 1;
    return `${formatNumber(servings, servings >= 10 ? 0 : 1)} serving${Math.abs(servings - 1) < 0.05 ? '' : 's'}`;
  }
  return `${formatNumber(item.quantityG)}g`;
}

function compactRejectedProposal(proposal) {
  if (!proposal) return null;
  return {
    source: proposal.source,
    message: proposal.message,
    items: mealActionItems(proposal.proposedItems || []),
  };
}

// ── Edit / Save bars ─────────────────────────────────────────────────────────

function showEditBar(planId, initialName) {
  const existing = document.getElementById('edit-bar');
  if (existing) existing.remove();
  if (!saveBarSlot) return;

  const bar = document.createElement('div');
  bar.id = 'edit-bar';
  bar.className = 'save-action-bar';
  bar.innerHTML = `
    <span class="save-action-bar__label">${plannerCtx?.folderName ? escapeHtml(plannerCtx.folderName) : 'Saved plan'}</span>
    <input class="save-action-bar__name" type="text" value="${escapeHtml(initialName)}" placeholder="Plan name" autocomplete="off" />
    <button class="btn btn-ghost save-action-bar__discard" type="button">${iconSvg('rotate')}Discard</button>
    <button class="btn btn-primary save-action-bar__save" type="button">${iconSvg('save')}Save changes</button>
    <p class="save-action-bar__msg message" aria-live="polite"></p>
  `;

  bar.querySelector('.save-action-bar__save').addEventListener('click', async () => {
    const name = bar.querySelector('.save-action-bar__name').value.trim();
    const msgEl = bar.querySelector('.save-action-bar__msg');
    msgEl.textContent = '';
    if (!name) { msgEl.textContent = 'Enter a plan name.'; return; }

    const planData = buildPlanData();
    const btn = bar.querySelector('.save-action-bar__save');
    btn.disabled = true; btn.textContent = 'Saving…';

    const res = await fetch(`/api/plans/${planId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, planData }),
    });
    const data = await readJsonResponse(res, 'Unable to save plan changes.');
    btn.disabled = false; btn.innerHTML = `${iconSvg('save')}Save changes`;

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = 'Saved!';
    setTimeout(() => { msgEl.textContent = ''; msgEl.style.color = ''; }, 2000);
  });

  bar.querySelector('.save-action-bar__discard').addEventListener('click', () => {
    if (confirm('Discard changes and reload the saved plan?')) {
      loadPlanForEdit(planId);
    }
  });

  saveBarSlot.replaceChildren(bar);
}

function showFolderSaveBar(folderId) {
  const existing = document.getElementById('folder-save-bar');
  if (existing) existing.remove();
  if (!saveBarSlot) return;

  const folderLabel = plannerCtx?.folderName
    ? escapeHtml(plannerCtx.folderName)
    : 'Save plan';

  const bar = document.createElement('div');
  bar.id = 'folder-save-bar';
  bar.className = 'save-action-bar';
  bar.innerHTML = `
    <span class="save-action-bar__label">${folderLabel}</span>
    <input class="save-action-bar__name" type="text" placeholder="Cutting plan — week 1" autocomplete="off" />
    <button class="btn btn-ghost save-action-bar__discard" type="button">${iconSvg('rotate')}Discard</button>
    <button class="btn btn-primary save-action-bar__save" type="button">${iconSvg('save')}Save changes</button>
    <p class="save-action-bar__msg message" aria-live="polite"></p>
  `;

  bar.querySelector('.save-action-bar__save').addEventListener('click', async () => {
    const name = bar.querySelector('.save-action-bar__name').value.trim();
    const msgEl = bar.querySelector('.save-action-bar__msg');
    msgEl.textContent = '';
    if (!name) { msgEl.textContent = 'Enter a plan name first.'; return; }

    const planData = buildPlanData();
    const btn = bar.querySelector('.save-action-bar__save');
    btn.disabled = true; btn.textContent = 'Saving…';

    const res = await fetch(`/api/folders/${folderId}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, planData }),
    });
    const data = await readJsonResponse(res, 'Unable to save plan.');
    btn.disabled = false; btn.innerHTML = `${iconSvg('save')}Save changes`;

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = `"${name}" saved!`;
    setTimeout(() => { window.location.href = `/explorer?folderId=${folderId}`; }, 900);
  });

  bar.querySelector('.save-action-bar__discard').addEventListener('click', () => {
    output.innerHTML = '';
    output.hidden = true;
    mealStates.length = 0;
    dailyTargets = null;
    currentPlanInput = null;
    switchPlannerView('input', { push: true });
    setInputsExpanded(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  saveBarSlot.replaceChildren(bar);
}

function buildPlanData() {
  const actual = mealStates.reduce(
    (acc, state) => {
      const t = computeTotals(state.items);
      acc.calories += t.calories; acc.proteinG += t.proteinG;
      acc.carbG += t.carbG; acc.fatG += t.fatG;
      return acc;
    },
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );

  return {
    input: readForm(),
    dailyTargets,
    dailyActuals: actual,
    meals: mealStates.map((state) => ({
      name: state.name,
      tag: state.tag,
      target: state.target,
      originalItems: state.originalItems.map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
      })),
      items: state.items.map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
        customFood: item.customFood || null,
        alternatives: item.alternatives || [],
        broaderAlternatives: item.broaderAlternatives || [],
        nearestAlternatives: item.nearestAlternatives || [],
        component: item.component || null,
        totals: item.food ? itemTotals(item.food, item.quantityG) : { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
      })),
      mealOptions: state.mealOptions || [],
      totals: computeTotals(state.items),
      templateId: state.templateId,
      templateName: state.templateName,
      readyMealId: state.templateId,
      readyMealTrack: state.templateFamily || null,
      isOriginalTemplate: state.isOriginalTemplate,
      numberOfSwaps: state.numberOfSwaps,
      candidateSource: state.candidateSource,
    })),
  };
}

function resetChat(state) {
  state.chatWorkingItems = null;
  state.chatPrevWorkingItems = null;
  state.chatHistory = [];
  state.chatTurnCount = 0;
  state.chatMessages = [];
}

function getUserPreferences() {
  return {
    dietType: DEFAULT_PLAN_OPTIONS.dietType,
    avoidFoods: preferenceState.avoidFoods.map((o) => o.id),
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function computeTotals(items) {
  return items.reduce(
    (acc, item) => {
      if (!item.food) return acc;
      const t = itemTotals(item.food, item.quantityG);
      acc.calories += t.calories;
      acc.proteinG += t.proteinG;
      acc.carbG += t.carbG;
      acc.fatG += t.fatG;
      return acc;
    },
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}

function itemTotals(food, quantityG) {
  const factor = quantityG / 100;
  return {
    calories: food.caloriesPer100g * factor,
    proteinG: food.proteinGPer100g * factor,
    carbG: food.carbGPer100g * factor,
    fatG: food.fatGPer100g * factor,
  };
}

function clampGrams(food, grams, step = 10) {
  if (!Number.isFinite(Number(grams)) || Number(grams) <= 0) return 0;
  const min = food.minServingG ?? 20;
  const max = food.maxServingG ?? 500;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 10;
  const clamped = Math.min(Math.max(grams, min), max);
  let rounded = Math.round(clamped / safeStep) * safeStep;
  if (rounded < min) rounded = Math.ceil(min / safeStep) * safeStep;
  if (rounded > max) rounded = Math.floor(max / safeStep) * safeStep;
  return Math.min(Math.max(rounded, min), max);
}

// ── Preference picker ────────────────────────────────────────────────────────

async function loadPreferenceOptions() {
  try {
    const response = await fetch('/api/preferences');
    const payload = await readJsonResponse(response, 'Unable to load preference options.');

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load preference options.');
    }

    preferenceOptions = { avoidFoods: payload.allergyOptions || [] };
    hydrateAvoidFoodPreferences();

    for (const field of preferenceFields) {
      setupPreferencePicker(field);
    }
  } catch (error) {
    message.textContent = error.message;
  }
}

function hydrateAvoidFoodPreferences() {
  if (!Array.isArray(pendingAvoidFoodIds) || !preferenceOptions.avoidFoods?.length) return;
  const optionsById = new Map(preferenceOptions.avoidFoods.map((option) => [option.id, option]));
  preferenceState.avoidFoods = pendingAvoidFoodIds.map((id) => (
    optionsById.get(id) || { id, label: titleCase(id), type: 'food' }
  ));
  pendingAvoidFoodIds = null;
  preferenceFields.forEach((field) => field._renderTokens?.());
}

function setupPreferencePicker(field) {
  const key = field.dataset.picker;
  const input = field.querySelector('input[type="search"]');
  const hidden = field.querySelector('input[type="hidden"]');
  const tokenList = field.querySelector('.selected-tokens');
  const suggestions = field.querySelector('.suggestions');
  const combobox = field.querySelector('.token-input');

  field._renderTokens = renderTokens;
  renderTokens();

  input.addEventListener('input', () => renderSuggestions());
  input.addEventListener('focus', () => renderSuggestions());
  input.addEventListener('keydown', (event) => {
    const first = suggestions.querySelector('button');
    if (event.key === 'Enter' && first) {
      event.preventDefault();
      addPreference(optionById(key, first.dataset.optionId));
      input.value = '';
      hideSuggestions();
    }
    if (event.key === 'Backspace' && input.value === '' && preferenceState[key].length > 0) {
      preferenceState[key].pop();
      renderTokens();
    }
    if (event.key === 'Escape') hideSuggestions();
  });

  document.addEventListener('click', (event) => {
    if (!field.contains(event.target)) hideSuggestions();
  });

  function renderTokens() {
    tokenList.innerHTML = '';
    hidden.value = preferenceState[key].map((o) => o.id).join(',');
    for (const option of preferenceState[key]) {
      const token = document.createElement('button');
      token.className = 'token';
      token.type = 'button';
      token.innerHTML = `<span>${escapeHtml(option.label)}</span><strong aria-hidden="true">x</strong>`;
      token.setAttribute('aria-label', `Remove ${option.label}`);
      token.addEventListener('click', () => {
        preferenceState[key] = preferenceState[key].filter((item) => item.id !== option.id);
        renderTokens();
        renderSuggestions();
      });
      tokenList.append(token);
    }
  }

  function addPreference(option) {
    if (!option || preferenceState[key].some((item) => item.id === option.id)) return;
    preferenceState[key].push(option);
    renderTokens();
  }

  function renderSuggestions() {
    const query = input.value.trim();
    const selected = new Set(preferenceState[key].map((o) => o.id));
    const opts = preferenceOptions[key] || [];
    const matches = opts
      .filter((o) => !selected.has(o.id))
      .map((o) => ({ option: o, score: scoreOption(o, query) }))
      .filter((m) => m.score > -1)
      .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label));

    suggestions.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'suggestion-empty';
      empty.textContent = 'No close matches';
      suggestions.append(empty);
    } else {
      for (const { option } of matches) {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.optionId = option.id;
        item.className = 'suggestion-item';
        item.innerHTML = `
          <span>
            <strong>${escapeHtml(option.label)}</strong>
            <small>${escapeHtml(option.description || option.type)}</small>
          </span>
          <em>${escapeHtml(option.type)}</em>
        `;
        item.addEventListener('click', () => {
          addPreference(option);
          input.value = '';
          hideSuggestions();
        });
        suggestions.append(item);
      }
    }
    suggestions.hidden = false;
    combobox.setAttribute('aria-expanded', 'true');
  }

  function hideSuggestions() {
    suggestions.hidden = true;
    combobox.setAttribute('aria-expanded', 'false');
  }
}

function optionById(key, id) {
  return (preferenceOptions[key] || []).find((o) => o.id === id);
}

function scoreOption(option, query) {
  if (!query) return option.type === 'food' ? 10 : 20;
  const q = normalizeText(query);
  const label = normalizeText(option.label);
  const aliases = (option.aliases || []).map(normalizeText);
  if (label === q || aliases.includes(q)) return 100;
  if (label.startsWith(q)) return 90;
  if (aliases.some((a) => a.startsWith(q))) return 80;
  if (label.includes(q)) return 70;
  if (aliases.some((a) => a.includes(q))) return 60;
  return -1;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  if (freeformButton) freeformButton.disabled = isLoading;
  submitButton.querySelector('span:last-child').textContent = isLoading
    ? 'Generating plan…'
    : (document.body.classList.contains('is-plan-view') ? 'Update plan' : 'Generate plan');
  if (freeformButton) {
    freeformButton.querySelector('span:last-child').textContent = isLoading ? 'Generating' : 'Build your own meals instead';
  }
}

function syncRamadanControls() {
  const disabled = Boolean(ramadanToggle?.checked);
  mealsSelect.disabled = disabled;
  distributionSelect.disabled = disabled;
}

function formatNumber(value, decimals = 0) {
  return Number(value).toFixed(decimals);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
