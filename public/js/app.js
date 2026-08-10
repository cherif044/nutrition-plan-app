const plannerCtx = (() => {
  const p = new URLSearchParams(location.search);
  const planId = p.get('planId');
  const folderId = p.get('folderId');
  const exportPdf = p.get('export') === 'pdf';
  if (!planId && !folderId) return null;
  return { planId, folderId, folderName: null, exportPdf };
})();

function iconSvg(name, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const icons = {
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    rotate: '<path d="M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2.5v3.8h-3.8"/>',
    save: '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8L15.2 3Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    sunrise: '<path d="M12 2v6"/><path d="m5 10-1.5-1.5"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19 10 1.5-1.5"/><path d="M8 18a4 4 0 0 1 8 0"/><path d="M3 22h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    apple: '<path d="M12 8c-1-2-3-3-5-2-2.5 1.2-3 5 0 10 1 1.7 2 3 3.5 3 .8 0 1-.4 1.5-.4s.7.4 1.5.4c1.5 0 2.5-1.3 3.5-3 3-5 2.5-8.8 0-10-2-1-4 0-5 2Z"/><path d="M12 8V5"/><path d="M12 5c1.5 0 2.5-1 2.5-2.5"/>',
    fish: '<path d="M3 12c3-4 7-6 12-6 3 0 6 2 6 6s-3 6-6 6c-5 0-9-2-12-6Z"/><path d="M3 12c1.5 1.5 2 3 2 5"/><path d="M3 12c1.5-1.5 2-3 2-5"/><circle cx="16" cy="10.5" r="0.6" fill="currentColor"/>',
    bread: '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4c0 1.2-1 2-2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6c-1 0-2-.8-2-2Z"/>',
    salad: '<path d="M4 13h16a8 8 0 0 1-16 0Z"/><path d="M6 20h12"/><path d="M12 10c0-2 1.5-3.5 3.5-3.5"/><path d="M10 10c-.5-1.5-2-2.5-3.5-2"/>',
    milk: '<path d="M9 2h6"/><path d="M9 2v3L7 8v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8l-2-3V2"/><path d="M7 13h10"/>',
    egg: '<path d="M12 2c3.5 0 7 6 7 11a7 7 0 0 1-14 0c0-5 3.5-11 7-11Z"/>',
    nut: '<path d="M12 3c4 0 7 3.5 7 8s-3 10-7 10-7-5.5-7-10 3-8 7-8Z"/><path d="M12 6v12"/>',
    oil: '<path d="M10 3h4v3l4 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l4-4V3Z"/><path d="M9 16h6"/>',
    coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
    meat: '<path d="M13.5 3a5.5 5.5 0 0 1 5 8.2c-.6 1.1-1.7 1.8-3 1.9l-.6 2.4-2.6 1.3-1.2-1.2-5.4 5.4a2 2 0 0 1-2.8-2.8l5.4-5.4-1.2-1.2 1.3-2.6 2.4-.6c.1-1.3.8-2.4 1.9-3 .8-.4 1.7-.6 2.8-.4Z"/>',
    powder: '<path d="M9 4h6a1 1 0 0 1 1 1v3H8V5a1 1 0 0 1 1-1Z"/><path d="M7 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path d="M9 13h6"/>',
    folder: '<path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    sliders: '<path d="M4 6h10"/><path d="M18 6h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  };
  return `<svg ${attrs}>${icons[name] || ''}</svg>`;
}

// ── Meal + food iconography ──────────────────────────────────────────────────
// Colour and icon are meaning-bearing: meal type for the card header, food
// group for each row. Anything unmatched falls back to the neutral plate icon.

const MEAL_ICONS = {
  breakfast: 'sunrise',
  suhoor: 'sunrise',
  snack: 'apple',
  lunch: 'sun',
  dinner: 'moon',
  iftar: 'moon',
};

function mealIconName(tag) {
  return MEAL_ICONS[String(tag || '').toLowerCase()] || 'salad';
}

function mealTypeKey(tag) {
  const key = String(tag || '').toLowerCase();
  if (key === 'suhoor') return 'breakfast';
  if (key === 'iftar') return 'dinner';
  return MEAL_ICONS[key] ? key : 'other';
}

// Order matters — the first match wins, so the more specific patterns lead.
const FOOD_ICON_RULES = [
  [/whey|protein (powder|concentrate|isolate)|supplement/i, 'powder', 'protein'],
  [/coffee|espresso|tea\b/i, 'coffee', 'carb'],
  [/milk|yog(h)?urt|labneh|cheese|cream/i, 'milk', 'protein'],
  [/egg/i, 'egg', 'protein'],
  [/fish|tuna|salmon|shrimp|prawn|sardine|seafood/i, 'fish', 'protein'],
  [/chicken|beef|lamb|turkey|meat|steak|liver|mince/i, 'meat', 'protein'],
  [/oil|butter|ghee|tahini|mayonnaise/i, 'oil', 'fat'],
  [/nut|almond|peanut|walnut|cashew|pistachio|seed|sesame|avocado/i, 'nut', 'fat'],
  [/bread|rice|pasta|oat|cereal|potato|corn|flour|toast|bun|couscous|barley|wheat/i, 'bread', 'carb'],
  [/apple|banana|orange|berry|berries|grape|melon|mango|date|fruit|peach|pear|kiwi/i, 'apple', 'carb'],
  [/tomato|lettuce|salad|cucumber|pepper|onion|carrot|spinach|broccoli|vegetable|greens|bean|lentil|chickpea/i, 'salad', 'carb'],
];

function foodIcon(food) {
  const name = `${food?.name || ''} ${food?.category || ''}`;
  for (const [pattern, icon, tone] of FOOD_ICON_RULES) {
    if (pattern.test(name)) return { icon, tone };
  }
  return { icon: 'salad', tone: 'neutral' };
}

function produceGroup(food) {
  const categories = new Set(food?.categories || []);
  if (categories.has('fruits') || categories.has('fruit')) return 'fruit';
  if (categories.has('vegetables') || categories.has('vegetable')) return 'vegetable';
  return null;
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
        <a class="planner-nav__link" href="/dashboard" aria-label="Home">${iconSvg('home')}<span>Home</span></a>
        <a class="planner-nav__link" href="${backHref}" aria-label="${backLabel}">${iconSvg('folder')}<span>${backLabel}</span></a>
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
const preGenerationCustomerPicker = document.querySelector('#pre-generation-customer-picker');
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
const PROFILE_SYNC_FIELDS = new Map([
  ['age', 'age'],
  ['sex', 'sex'],
  ['weightKg', 'weightKg'],
  ['heightCm', 'heightCm'],
  ['activityLevel', 'activityLevel'],
  ['goal', 'goal'],
]);

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
// Declared up here because reserveSpaceForSaveBar() runs during init, before
// the function that uses it appears further down the file.
let saveBarResizeObserver = null;
loadAllFoods();

const mealStates = [];
let dailyTargets = null;
let currentPlanInput = null;
let pendingAvoidFoodIds = null;
let pdfExportScheduled = false;
let suppressProfileTouchTracking = false;
const touchedProfileFields = new Set();
const preGenerationCustomerState = preGenerationCustomerPicker
  ? bindCustomerPicker(preGenerationCustomerPicker)
  : { selected: null, exactMatch: null, requestId: 0 };

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
  const saveDetailsOk = await validatePreGenerationSaveDetails();
  if (!saveDetailsOk) return;
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
form.addEventListener('input', markProfileFieldTouched);
form.addEventListener('change', markProfileFieldTouched);
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

function readPreGenerationPlanName() {
  return form.elements.planName?.value.trim() || '';
}

async function validatePreGenerationSaveDetails() {
  const planName = readPreGenerationPlanName();
  if (!planName) {
    message.textContent = 'Enter a plan name before generating.';
    form.elements.planName?.focus();
    return false;
  }

  const customerInput = form.elements.customerName;
  const customerName = customerInput?.value.trim() || '';
  const makeActive = Boolean(form.elements.makeActive?.checked);
  if (makeActive && !customerName && !preGenerationCustomerState.selected) {
    message.textContent = 'Choose or enter a customer before making a plan active.';
    customerInput?.focus();
    return false;
  }

  if (customerName && !preGenerationCustomerState.selected) {
    await refreshCustomerMatches(
      customerName,
      preGenerationCustomerState,
      preGenerationCustomerPicker.querySelector('.save-customer-picker__results'),
      preGenerationCustomerPicker.querySelector('.save-customer-picker__match'),
    );
    if (preGenerationCustomerState.exactMatch) {
      message.textContent = `${preGenerationCustomerState.exactMatch.name} already exists — use this customer?`;
      customerInput?.focus();
      return false;
    }
  }

  return true;
}

function preGenerationSavePayload() {
  return {
    name: readPreGenerationPlanName(),
    customerPayload: buildCustomerPayload(preGenerationCustomerPicker, preGenerationCustomerState),
    isActive: Boolean(form.elements.makeActive?.checked),
  };
}

function markProfileFieldTouched(event) {
  if (suppressProfileTouchTracking) return;
  const field = PROFILE_SYNC_FIELDS.get(event.target?.name);
  if (field) touchedProfileFields.add(field);
}

function switchPlannerView(view, { push = false } = {}) {
  const isPlan = view === 'plan';
  document.body.classList.toggle('is-plan-view', isPlan);
  document.body.classList.toggle('is-input-view', !isPlan);
  if (emptyState) emptyState.hidden = isPlan;
  if (saveBarSlot && !isPlan) { saveBarSlot.innerHTML = ''; reserveSpaceForSaveBar(); }
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
    ['Goal', goalLabel(input.goal), 'brand'],
    ['Meals', `${input.numberOfMeals} / day`],
    ['Activity', titleCase(input.activityLevel)],
    ['Weight', `${formatNumber(input.weightKg)} kg`],
  ];
  inputChipRow.innerHTML = chips
    .map(([label, value, tone]) => `<span class="input-chip"${tone ? ` data-tone="${tone}"` : ''}><small>${label}</small>${escapeHtml(value)}</span>`)
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
    if (form.elements.planName) form.elements.planName.value = plan.name || '';
    if (form.elements.makeActive) form.elements.makeActive.checked = Boolean(plan.is_active);
    initializeCustomerPickerFromPlan(plan);

    renderPlan(plan.plan_data, { editMode: true, planId, planName: plan.name });
  } catch {
    message.textContent = 'Failed to load plan.';
  }
}

function populateFormFromInput(input) {
  suppressProfileTouchTracking = true;
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
  suppressProfileTouchTracking = false;
  touchedProfileFields.clear();
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

  const summaryEl = renderSummary(plan.dailyTargets, plan.diagnostics?.bounds);
  if (!plannerCtx?.exportPdf) {
    output.append(summaryEl);
  }

  if (plannerCtx?.exportPdf) {
    document.body.classList.add('is-pdf-export');
    if (saveBarSlot) {
      saveBarSlot.innerHTML = '';
      reserveSpaceForSaveBar();
    }
  } else if (editMode) {
    showEditBar(planId, planName);
  } else if (plannerCtx?.folderId) {
    showPlanSaveBar(plannerCtx.folderId);
  } else {
    showPlanSaveBar(null);
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

  if (plannerCtx?.exportPdf) {
    output.append(summaryEl);
  }

  refreshRedFlags();
  if (plannerCtx?.exportPdf) schedulePdfExport();
}

function schedulePdfExport() {
  if (pdfExportScheduled) return;
  pdfExportScheduled = true;
  document.title = 'Pinch meal plan export';
  window.setTimeout(() => {
    window.print();
  }, 700);
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

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function renderSummary(targets, serverBounds = null) {
  dailyTargets = targets;
  const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
  const metrics = summary.querySelector('.metrics');

  const calorieBounds = dailyMetricBounds('calories', targets, serverBounds);
  const ring = document.createElement('div');
  ring.className = 'metric metric--ring';
  ring.dataset.metric = 'calories';
  ring.innerHTML = `
    <div class="cal-ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="cal-ring__track" cx="60" cy="60" r="${RING_RADIUS}"></circle>
        <circle class="cal-ring__value" cx="60" cy="60" r="${RING_RADIUS}"
          stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(1)}"
          stroke-dashoffset="${RING_CIRCUMFERENCE.toFixed(1)}"></circle>
      </svg>
      <div class="cal-ring__center">
        <strong class="daily-actual daily-actual-calories">—</strong>
        <span class="cal-ring__unit">kcal</span>
      </div>
    </div>
    <div class="cal-ring__caption">
      <span>Calories</span>
      <b>of ${formatNumber(targets.calories)} target</b>
      <em class="metric-range">${formatAllowedRange(calorieBounds, labels.calories[1])}</em>
    </div>
    <div class="flag-detail"></div>
  `;
  metrics.append(ring);

  const macroList = document.createElement('div');
  macroList.className = 'macro-bars';
  for (const key of ['proteinG', 'carbG', 'fatG']) {
    const bounds = dailyMetricBounds(key, targets, serverBounds);
    const row = document.createElement('div');
    row.className = 'metric metric--macro';
    row.dataset.metric = key;
    row.innerHTML = `
      <div class="metric__top">
        <span><i class="macro-dot" aria-hidden="true"></i>${labels[key][0]}</span>
        <strong>
          <span class="daily-actual daily-actual-${key}">—</span>
          <small>/ ${formatNumber(targets[key])}${labels[key][1]}</small>
        </strong>
      </div>
      <div class="metric-bar" aria-hidden="true"><i></i></div>
      <em class="metric-range">${formatAllowedRange(bounds, labels[key][1])}</em>
      <div class="flag-detail"></div>
    `;
    macroList.append(row);
  }
  metrics.append(macroList);

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
    const clamped = Math.min(Math.max(percent, 0), 100);
    const barEl = metricEl?.querySelector('.metric-bar i');
    if (barEl) barEl.style.width = `${clamped}%`;

    const ringEl = metricEl?.querySelector('.cal-ring__value');
    if (ringEl) {
      ringEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped / 100));
    }

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
  card.dataset.mealType = mealTypeKey(state.tag);
  card.querySelector('.meal-card__icon').innerHTML = iconSvg(mealIconName(state.tag), 20);
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

  // The calorie figure appears twice — header chip and meal-totals footer.
  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    card.querySelectorAll(`.meal-actual-${key}`).forEach((el) => {
      el.textContent = formatNumber(totals[key]);
    });
  }
}

function mealCardMetaText(state) {
  const optionCount = readyMealOptions(state).length;
  const total = Math.max(optionCount, 1);
  const current = Math.min(Math.max((Number(state.mealOptionIndex) || 0) + 1, 1), total);
  return `${current} of ${total}`;
}

// Reconciles the rendered rows against state.items in place. Rows that did not
// change keep their DOM nodes untouched, so applying a swap in AI mode only
// repaints the row that actually moved instead of rebuilding the whole meal.
function renderFoodList(state) {
  const foodList = state.cardEl?.querySelector('.food-list');
  if (!foodList) return;

  const rows = [...foodList.children];

  state.items.forEach((item, itemIndex) => {
    const existing = rows[itemIndex];
    if (!existing) {
      const row = renderFoodItem(state, itemIndex);
      row.classList.add('food-item--entering');
      foodList.append(row);
      return;
    }
    if (updateFoodRow(existing, state, itemIndex)) {
      existing.classList.remove('food-item--changed');
      void existing.offsetWidth;
      existing.classList.add('food-item--changed');
    }
  });

  rows.slice(state.items.length).forEach((row) => row.remove());
}

function foodRowSignature(item) {
  return [
    item.food?.id ?? item.food?.name ?? '',
    item.food?.name ?? '',
    Number(item.quantityG) || 0,
    item.customFood ? '1' : '0',
  ].join('|');
}

// Returns true when anything visible actually changed.
function updateFoodRow(row, state, itemIndex) {
  const item = state.items[itemIndex];
  row.dataset.itemIndex = itemIndex;
  setRowActions(row, state, itemIndex);
  setProduceCycleControl(row, state, itemIndex);

  const signature = foodRowSignature(item);
  if (row.dataset.signature === signature) return false;
  row.dataset.signature = signature;

  const food = item.food;
  const totals = itemTotals(food, item.quantityG);
  const { icon, tone } = foodIcon(food);

  const iconEl = row.querySelector('.food-icon');
  iconEl.dataset.tone = tone;
  iconEl.innerHTML = iconSvg(icon, 15);
  row.querySelector('.food-name').textContent = food.name;

  const cells = {
    '.food-cell--portion': formatPortion(item),
    '.food-cell--cal': formatNumber(totals.calories),
    '.food-cell--protein': `${formatNumber(totals.proteinG)}g`,
    '.food-cell--carb': `${formatNumber(totals.carbG)}g`,
    '.food-cell--fat': `${formatNumber(totals.fatG)}g`,
  };
  for (const [selector, value] of Object.entries(cells)) {
    row.querySelector(selector).textContent = value;
  }
  return true;
}

// The actions column is always present in the grid, so toggling AI mode fills
// or empties it without moving a single other column.
function setRowActions(row, state, itemIndex) {
  const slot = row.querySelector('.food-actions');
  const wanted = Boolean(state.editModeEnabled);
  if ((slot.dataset.filled === '1') === wanted) return;

  const name = escapeHtml(state.items[itemIndex].food.name);
  slot.dataset.filled = wanted ? '1' : '0';
  slot.innerHTML = state.editModeEnabled ? `
    <button class="food-icon-btn food-swap-btn" type="button" aria-label="Swap ${name}"><span aria-hidden="true">⇄</span></button>
    <button class="food-icon-btn food-delete-btn" type="button" aria-label="Remove ${name}"><span aria-hidden="true">⌫</span></button>
  ` : '';
  slot.querySelector('.food-swap-btn')?.addEventListener('click', () => {
    const nextIndex = Number(row.dataset.itemIndex);
    if (produceGroup(state.items[nextIndex]?.food)) {
      handleCycleProduceSwap(state, nextIndex);
      return;
    }
    showSwapFoodAction(state, nextIndex);
  });
  slot.querySelector('.food-delete-btn')?.addEventListener('click', () => showRemoveFoodAction(state, Number(row.dataset.itemIndex)));
}

function setProduceCycleControl(row, state, itemIndex) {
  const item = state.items[itemIndex];
  const btn = row.querySelector('.produce-cycle-btn');
  if (!btn) return;

  const group = produceGroup(item?.food);
  btn.hidden = !group;
  if (!group) return;

  const label = `Next ${group} for ${item.food.name}`;
  btn.dataset.group = group;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

// ── Food item rendering ──────────────────────────────────────────────────────

function renderFoodItem(state, itemIndex) {
  const row = document.createElement('div');
  row.className = 'food-item';
  row.innerHTML = `
    <div class="food-title">
      <span class="food-icon" aria-hidden="true"></span>
      <span class="food-name"></span>
      <button class="produce-cycle-btn" type="button" hidden aria-label="Next produce"><span aria-hidden="true">&rsaquo;</span></button>
    </div>
    <div class="food-cell food-cell--portion"></div>
    <div class="food-cell food-cell--cal"></div>
    <div class="food-cell food-cell--protein"></div>
    <div class="food-cell food-cell--carb"></div>
    <div class="food-cell food-cell--fat"></div>
    <div class="food-actions" data-filled="0"></div>
  `;
  row.querySelector('.produce-cycle-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    handleCycleProduceSwap(state, Number(row.dataset.itemIndex));
  });
  updateFoodRow(row, state, itemIndex);
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

async function handleCycleProduceSwap(state, itemIndex) {
  const item = state.items[itemIndex];
  const group = produceGroup(item?.food);
  if (!group) return;

  const row = state.cardEl?.querySelector(`.food-item[data-item-index="${itemIndex}"]`);
  const btn = row?.querySelector('.produce-cycle-btn');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/produce-swap-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndex,
        currentItems: mealActionItems(state.items),
        mealTarget: state.target,
        dailyContext: {
          dailyTargets,
          weightKg: Number(currentPlanInput?.weightKg),
        },
        userPreferences: getUserPreferences(),
        limit: 20,
      }),
    });
    const payload = await readJsonResponse(res, 'Unable to swap produce.');
    if (!res.ok) throw new Error(payload.error || 'Unable to swap produce.');

    const option = firstUsableProduceOption(payload.options);
    if (!option?.items?.length) {
      showActionFeedback(state, {
        tone: 'danger',
        message: `No other ${group} fits this meal window right now.`,
        cardClass: 'meal-card--flash-fail',
      });
      return;
    }

    const nextName = option.food?.name || `${group} option`;
    applyMealItems(state, option.items, { source: 'produce_swap' });
    showActionFeedback(state, {
      tone: 'success',
      message: `Swapped to ${nextName}.`,
      cardClass: 'meal-card--flash-success',
    });
  } catch (error) {
    showActionFeedback(state, {
      tone: 'danger',
      message: error.message || 'Unable to swap produce.',
      cardClass: 'meal-card--flash-fail',
    });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function firstUsableProduceOption(options) {
  return (options || []).find((option) => (
    option?.food?.id &&
    Array.isArray(option.items) &&
    option.items.length > 0
  ));
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
  clearFeedbackTimer(state);
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
  clearFeedbackTimer(state);
  resetActionPanel(panel);
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

// The save bar is sticky at the bottom, so the page has to reserve exactly its
// height or the bar sits on top of the last meal card. Its height varies with
// viewport and validation messages, so measure it rather than guessing.
function reserveSpaceForSaveBar() {
  const bar = saveBarSlot?.querySelector('.save-action-bar');
  if (!bar) {
    document.body.style.removeProperty('--save-bar-height');
    saveBarResizeObserver?.disconnect();
    saveBarResizeObserver = null;
    return;
  }

  const apply = () => {
    document.body.style.setProperty('--save-bar-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  apply();

  saveBarResizeObserver?.disconnect();
  if (typeof ResizeObserver === 'function') {
    saveBarResizeObserver = new ResizeObserver(apply);
    saveBarResizeObserver.observe(bar);
  } else {
    window.addEventListener('resize', apply);
  }
}

function actionPanel(state) {
  return state.cardEl.querySelector('.meal-action-panel');
}

function showActionMessage(state, text) {
  const panel = actionPanel(state);
  clearFeedbackTimer(state);
  panel.hidden = false;
  resetActionPanel(panel);
  panel.innerHTML = `<p class="meal-action-message">${escapeHtml(text)}</p>`;
}

function resetActionPanel(panel) {
  panel.classList.remove('meal-action-panel--success', 'meal-action-panel--danger');
  panel.removeAttribute('role');
}

const FEEDBACK_DISMISS_MS = 5000;

function clearFeedbackTimer(state) {
  if (state.feedbackTimer) {
    window.clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
  }
}

function showActionFeedback(state, { tone = 'success', message, cardClass = '' }) {
  const panel = actionPanel(state);
  clearFeedbackTimer(state);
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

  // Confirmations are transient — clear themselves so the panel never sticks.
  state.feedbackTimer = window.setTimeout(() => {
    state.feedbackTimer = null;
    if (panel.classList.contains('meal-action-panel--success') || panel.classList.contains('meal-action-panel--danger')) {
      panel.hidden = true;
      panel.innerHTML = '';
      resetActionPanel(panel);
    }
  }, FEEDBACK_DISMISS_MS);
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
    const { customerPayload, isActive } = preGenerationSavePayload();
    const btn = bar.querySelector('.save-action-bar__save');
    btn.disabled = true; btn.textContent = 'Saving…';

    const res = await fetch(`/api/plans/${planId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        planData,
        customer: customerPayload?.customer || null,
        isActive,
      }),
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
  reserveSpaceForSaveBar();
}

function showPlanSaveBar(folderId = null) {
  const existing = document.getElementById('folder-save-bar');
  if (existing) existing.remove();
  if (!saveBarSlot) return;

  const folderLabel = folderId && plannerCtx?.folderName
    ? escapeHtml(plannerCtx.folderName)
    : 'Home';
  const saveUrl = folderId ? `/api/folders/${folderId}/plans` : '/api/plans';
  const explorerUrl = folderId ? `/explorer?folderId=${folderId}` : '/explorer';

  const bar = document.createElement('div');
  bar.id = 'folder-save-bar';
  bar.className = 'save-action-bar';
  bar.innerHTML = `
    <span class="save-action-bar__label">${folderLabel}</span>
    <span class="save-action-bar__summary">${escapeHtml(readPreGenerationPlanName())}</span>
    <button class="btn btn-ghost save-action-bar__discard" type="button">${iconSvg('rotate')}Discard</button>
    <button class="btn btn-primary save-action-bar__save" type="button">${iconSvg('save')}Save plan</button>
    <p class="save-action-bar__msg message" aria-live="polite"></p>
  `;

  bar.querySelector('.save-action-bar__save').addEventListener('click', async () => {
    const msgEl = bar.querySelector('.save-action-bar__msg');
    msgEl.textContent = '';
    const saveDetailsOk = await validatePreGenerationSaveDetails();
    if (!saveDetailsOk) {
      msgEl.textContent = message.textContent;
      setInputsExpanded(true);
      return;
    }

    const planData = buildPlanData();
    const { name, customerPayload, isActive } = preGenerationSavePayload();
    const btn = bar.querySelector('.save-action-bar__save');
    btn.disabled = true; btn.textContent = 'Saving…';

    const res = await fetch(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        planData,
        customer: customerPayload?.customer || null,
        isActive,
      }),
    });
    const data = await readJsonResponse(res, 'Unable to save plan.');
    btn.disabled = false; btn.innerHTML = `${iconSvg('save')}Save plan`;

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = `"${name}" saved!`;
    setTimeout(() => { window.location.href = explorerUrl; }, 900);
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
  reserveSpaceForSaveBar();
}

function bindCustomerPicker(bar) {
  const state = { selected: null, exactMatch: null, requestId: 0 };
  const input = bar.querySelector('.save-action-bar__customer');
  const results = bar.querySelector('.save-customer-picker__results');
  const match = bar.querySelector('.save-customer-picker__match');
  if (!input || !results || !match) return state;

  input.addEventListener('input', () => {
    state.selected = null;
    refreshCustomerMatches(input.value.trim(), state, results, match);
  });

  input.addEventListener('focus', () => {
    refreshCustomerMatches(input.value.trim(), state, results, match);
  });

  return state;
}

async function refreshCustomerMatches(query, state, resultsEl, matchEl) {
  const requestId = ++state.requestId;
  resultsEl.hidden = true;
  matchEl.hidden = true;
  matchEl.innerHTML = '';
  if (!query) {
    state.exactMatch = null;
    return;
  }

  try {
    const [listRes, matchRes] = await Promise.all([
      fetch(`/api/customers?query=${encodeURIComponent(query)}`),
      fetch(`/api/customers/match?name=${encodeURIComponent(query)}`),
    ]);
    if (requestId !== state.requestId) return;

    const listData = await readJsonResponse(listRes, 'Unable to search customers.');
    const matchData = await readJsonResponse(matchRes, 'Unable to check customer.');
    state.exactMatch = matchData.customer || null;

    renderCustomerExactMatch(query, state, matchEl);
    renderCustomerResults(listData.customers || [], state, resultsEl, matchEl);
  } catch {
    resultsEl.hidden = true;
  }
}

function renderCustomerExactMatch(query, state, matchEl) {
  if (!state.exactMatch || state.selected?.id === state.exactMatch.id) return;
  matchEl.innerHTML = `
    <span>${escapeHtml(state.exactMatch.name)} already exists.</span>
    <button type="button">Use this customer</button>
  `;
  matchEl.querySelector('button').addEventListener('click', () => {
    selectCustomer(state.exactMatch, state, matchEl.closest('.save-customer-picker'));
  });
  matchEl.hidden = false;
}

function renderCustomerResults(customers, state, resultsEl, matchEl) {
  resultsEl.innerHTML = '';
  customers.slice(0, 6).forEach((customer) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'save-customer-result';
    btn.innerHTML = `
      <span class="dashboard-icon-square" data-tone="cal" aria-hidden="true">${iconSvg('user', 15)}</span>
      <span><strong>${escapeHtml(customer.name)}</strong><small>${customer.goal ? escapeHtml(goalLabel(customer.goal)) : 'Customer'}</small></span>
    `;
    btn.addEventListener('click', () => {
      selectCustomer(customer, state, resultsEl.closest('.save-customer-picker'));
      matchEl.hidden = true;
    });
    resultsEl.append(btn);
  });
  resultsEl.hidden = customers.length === 0;
}

function selectCustomer(customer, state, picker, { hydrateProfile = !plannerCtx?.planId } = {}) {
  state.selected = customer;
  const input = picker?.querySelector('.save-action-bar__customer');
  const results = picker?.querySelector('.save-customer-picker__results');
  const match = picker?.querySelector('.save-customer-picker__match');
  if (input) input.value = customer.name;
  if (picker === preGenerationCustomerPicker && hydrateProfile) applyCustomerProfileToForm(customer);
  if (results) results.hidden = true;
  if (match) {
    match.innerHTML = `<span>Using ${escapeHtml(customer.name)}</span>`;
    match.hidden = false;
  }
}

function initializeCustomerPickerFromPlan(plan) {
  const customer = plan?.Customer || plan?.customer || null;
  if (!customer || !preGenerationCustomerPicker) return;
  selectCustomer(customer, preGenerationCustomerState, preGenerationCustomerPicker, { hydrateProfile: false });
}

function applyCustomerProfileToForm(customer) {
  if (!customer) return;
  suppressProfileTouchTracking = true;
  setFormValue('age', customer.age);
  setFormValue('sex', customer.sex);
  setFormValue('weightKg', customer.weight);
  setFormValue('heightCm', customer.height);
  setFormValue('activityLevel', customer.activity_level);
  suppressProfileTouchTracking = false;
  syncInputSummary();
}

function setFormValue(name, value) {
  if (value === undefined || value === null || value === '') return;
  const field = form.elements[name];
  if (!field) return;
  field.value = value;
}

function buildCustomerPayload(bar, state) {
  const name = bar.querySelector('.save-action-bar__customer')?.value.trim() || '';
  const touchedFields = Array.from(touchedProfileFields);
  if (!name && !state.selected) return null;

  if (state.selected) {
    return { customer: { id: state.selected.id, touchedFields } };
  }

  return { customer: { name, touchedFields } };
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
  const input = readForm();
  return {
    dietType: input.dietType || DEFAULT_PLAN_OPTIONS.dietType,
    avoidFoods: preferenceState.avoidFoods.map((o) => o.id),
    dislikes: preferenceState.avoidFoods.map((o) => o.id),
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

// Ramadan mode is no longer exposed in the form; the guard keeps the meal
// controls usable if it is ever reintroduced.
function syncRamadanControls() {
  const disabled = Boolean(ramadanToggle?.checked);
  if (mealsSelect) mealsSelect.disabled = disabled;
  if (distributionSelect) distributionSelect.disabled = disabled;
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
