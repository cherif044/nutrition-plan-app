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
      const backLabel = plannerCtx?.planId ? '← Back' : 'Explorer';
      navUser.innerHTML = `
        <span class="planner-nav__greeting">Hi, ${escapeHtml(user.firstname)}</span>
        <a class="btn btn-ghost" href="/" style="min-height:36px;font-size:.82rem;">Home</a>
        <a class="btn btn-ghost" href="${backHref}" style="min-height:36px;font-size:.82rem;">${backLabel}</a>
        <button class="btn btn-ghost" id="logout-btn" style="min-height:36px;font-size:.82rem;">Log out</button>
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
      if (title) title.textContent = 'Edit Mode';
      loadPlanForEdit(plannerCtx.planId);
    } else if (plannerCtx?.folderId) {
      fetch(`/api/folders/${plannerCtx.folderId}`)
        .then((r) => r.json())
        .then(({ folder }) => {
          if (!folder) return;
          plannerCtx.folderName = folder.name;
          const eyebrow = document.getElementById('planner-eyebrow');
          if (eyebrow) eyebrow.textContent = `Saving to: ${folder.name}`;
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
const ramadanToggle = form.elements.ramadanMode;
const mealsSelect = form.elements.numberOfMeals;
const distributionSelect = form.elements.mealDistribution;
const preferenceFields = document.querySelectorAll('.preference-field');

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

const plannerCtx = (() => {
  const p = new URLSearchParams(location.search);
  const planId = p.get('planId');
  const folderId = p.get('folderId');
  if (!planId && !folderId) return null;
  return { planId, folderId, folderName: null };
})();

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

ramadanToggle.addEventListener('change', syncRamadanControls);
syncRamadanControls();
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
    dietType: data.get('dietType'),
    avoidFoods: preferenceState.avoidFoods.map((o) => o.id),
    milkType: data.get('milkType'),
    coffeesPerDay: data.get('coffeesPerDay'),
    ramadanMode: data.has('ramadanMode'),
  };
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
    if (el && val !== undefined && val !== null) el.value = val;
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
  if (input.ramadanMode) form.elements.ramadanMode.checked = true;
  syncRamadanControls();
}

// ── Render plan ──────────────────────────────────────────────────────────────

function renderPlan(plan, { editMode = false, planId = null, planName = '' } = {}) {
  output.innerHTML = '';
  mealStates.length = 0;
  currentPlanInput = plan.input || null;
  output.hidden = false;
  emptyState.hidden = true;

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

  output.append(renderSummary(plan.dailyTargets));

  if (editMode) {
    showEditBar(planId, planName);
  } else if (plannerCtx?.folderId) {
    showFolderSaveBar(plannerCtx.folderId);
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

function renderSummary(targets) {
  dailyTargets = targets;
  const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
  const metrics = summary.querySelector('.metrics');

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const metric = document.createElement('div');
    metric.className = 'metric';
    metric.dataset.metric = key;
    metric.innerHTML = `
      <span>${labels[key][0]}</span>
      <strong>
        <span class="daily-actual daily-actual-${key}">—</span>
        <span class="daily-sep"> / </span>
        <span class="daily-target daily-target-${key}">${formatNumber(targets[key])}</span>
      </strong>
      <small>${labels[key][1]}</small>
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
    const diff = actual[key] - tgt;
    const pct = Math.abs(diff) / Math.max(1, tgt);
    const flagged = !dailyMetricFitsTarget(key, actual[key], tgt);

    const metricEl = summaryEl.querySelector(`.metric[data-metric="${key}"]`);
    if (metricEl) metricEl.classList.toggle('metric--flagged', flagged);

    const actualEl = summaryEl.querySelector(`.daily-actual-${key}`);
    if (actualEl) actualEl.textContent = formatNumber(actual[key]);

    const flagDetail = metricEl?.querySelector('.flag-detail');
    if (flagDetail) {
      if (flagged) {
        const sign = diff > 0 ? '+' : '';
        flagDetail.textContent = `${sign}${Math.round(pct * 100)}% off target`;
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
  refreshMealCycleButtons(state);

  return card;
}

function refreshMealCardHeader(card, state) {
  const totals = computeTotals(state.items);
  card.querySelector('.meal-card__meta').textContent = mealCardMetaText(state);

  const values = {
    calories: { unit: 'kcal', actual: totals.calories, target: state.target.calories },
    proteinG: { unit: 'g', actual: totals.proteinG, target: state.target.proteinG },
    carbG: { unit: 'g', actual: totals.carbG, target: state.target.carbG },
    fatG: { unit: 'g', actual: totals.fatG, target: state.target.fatG },
  };

  for (const [key, value] of Object.entries(values)) {
    const actualEl = card.querySelector(`.meal-actual-${key}`);
    const targetEl = card.querySelector(`.meal-target-${key}`);
    if (actualEl) actualEl.textContent = `${formatNumber(value.actual)} ${value.unit}`;
    if (targetEl) targetEl.textContent = `${formatNumber(value.target)} ${value.unit}`;
  }
}

function mealCardMetaText(state) {
  const optionCount = readyMealOptions(state).length;
  const optionLabel = optionCount > 0 ? `Meal ${state.mealOptionIndex + 1} of ${optionCount}` : 'No ready meal';
  const templateLabel = state.templateName ? `Ready meal: ${state.templateName}` : 'Ready meal: None';
  return `${templateLabel} ${separator} ${optionLabel} ${separator} ${mealTemplateStatusLabel(state)}`;
}

function mealTemplateStatusLabel(state) {
  if (state.items.length === 0 || state.candidateSource === 'failed') return 'Failed';
  if (state.isApproximate) return 'Approximate fit';
  return 'Macro fit';
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
  row.className = 'food-item';
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
    </div>
  `;

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

function dailyMetricFitsTarget(key, actual, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return false;
  const weightKg = Number(currentPlanInput?.weightKg);
  if (key === 'calories') {
    return Math.abs(actual - target) <= target * DAILY_CALORIE_WINDOW_PERCENT;
  }
  if (key === 'proteinG' && Number.isFinite(weightKg)) {
    return actual >= weightKg * PROTEIN_RANGE_PER_KG.min &&
      actual <= weightKg * PROTEIN_RANGE_PER_KG.max;
  }
  if (key === 'fatG' && Number.isFinite(weightKg)) {
    return actual >= weightKg * FAT_RANGE_PER_KG.min &&
      actual <= weightKg * FAT_RANGE_PER_KG.max;
  }
  return actual >= 0;
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
      failureReason: `Adding ${food.name} could not be fit by deterministic rebalance.`,
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
      failureReason: `Adding custom food ${food.name} could not be fit by deterministic rebalance.`,
    });
  });
}

function showRemoveFoodAction(state, itemIndex = null) {
  const foods = state.items.filter((item) => item.food);
  if (foods.length <= 1) {
    showActionMessage(state, 'This meal needs at least one food.');
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
      failureReason: `Removing ${item.food.name} could not be fit by deterministic rebalance.`,
    });
    return;
  }

  const panel = actionPanel(state);
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
        failureReason: `Removing ${item.food.name} could not be fit by deterministic rebalance.`,
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
    failureReason: `Swapping ${item.food.name} for ${alt.name} could not be fit by deterministic rebalance.`,
  });
}

async function handleDeterministicRebalance(state, { previewTitle = 'Rebalanced meal' } = {}) {
  await attemptGuidedRebalance(state, {
    action: 'rebalance',
    attemptedItems: state.items,
    title: previewTitle,
    useAiFallback: false,
    failureReason: 'No combination can solve this meal with the current foods. Change one of the foods.',
  });
}

async function attemptGuidedRebalance(state, { action, attemptedItems, title, failureReason, useAiFallback = true, rejectedProposal = null, userFeedback = '' }) {
  showActionMessage(state, 'Checking meal fit...');
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
    if (useAiFallback) {
      await requestGuidedAiSuggestion(state, { action, attemptedItems, failureReason, rejectedProposal, userFeedback });
    } else {
      showActionMessage(state, failureReason || 'No combination can solve this meal with the current foods. Change one of the foods.');
    }
  } catch (error) {
    showActionMessage(state, error.message || 'Unable to rebalance this meal.');
  }
}

async function requestGuidedAiSuggestion(state, { action, attemptedItems, failureReason, rejectedProposal = null, userFeedback = '' }) {
  showActionMessage(state, 'Deterministic rebalance failed. Asking AI for food-level changes...');
  try {
    const res = await fetch('/api/guided-meal-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        mealTag: state.tag,
        mealTarget: state.target,
        currentItems: mealActionItems(state.items),
        attemptedItems: mealActionItems(attemptedItems),
        failureReason,
        rejectedProposal: compactRejectedProposal(rejectedProposal),
        userFeedback,
        userPreferences: getUserPreferences(),
      }),
      signal: AbortSignal.timeout(50_000),
    });
    const payload = await readJsonResponse(res, 'AI suggestion failed.');
    if (!res.ok) throw new Error(payload.error || 'AI suggestion failed.');
    if (payload.status === 'proposal' && Array.isArray(payload.proposedItems)) {
      const proposedItems = payload.proposedItems.map(itemFromGuidedProposal).filter((item) => item.food);
      showProposal(state, {
        title: 'Suggested food change',
        message: payload.message,
        proposedItems,
        proposedTotals: payload.proposedTotals || computeTotals(proposedItems),
        source: 'ai',
        retryContext: { action, attemptedItems, failureReason },
      });
    } else {
      showActionMessage(state, payload.message || 'No valid food-level suggestion was found.');
    }
  } catch (error) {
    showActionMessage(state, error.message || 'No valid AI suggestion was found.');
  }
}

function showProposal(state, proposal) {
  state.pendingProposal = proposal;
  const panel = actionPanel(state);
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
  const canRetryAi = proposal.retryContext?.attemptedItems && proposal.retryContext?.action !== 'rebalance';
  panel.innerHTML = `
    <p class="meal-action-title">Suggestion declined</p>
    ${canRetryAi ? "<label class=\"decline-feedback\">What didn't you like? <input type=\"text\" placeholder=\"Optional feedback\" /></label>" : ''}
    <div class="proposal-actions">
      ${canRetryAi ? '<button class="btn btn-primary retry-ai" type="button">Try again</button>' : ''}
      ${canTryAnotherMeal ? '<button class="btn btn-primary retry-alternate" type="button">Next ready meal</button>' : ''}
      <button class="btn btn-ghost close-action" type="button">Close</button>
    </div>
  `;
  panel.querySelector('.retry-ai')?.addEventListener('click', () => {
    const feedback = panel.querySelector('input').value.trim();
    requestGuidedAiSuggestion(state, {
      ...(proposal.retryContext || {}),
      rejectedProposal: proposal,
      userFeedback: feedback,
    });
  });
  panel.querySelector('.retry-alternate')?.addEventListener('click', () => handleTryAnotherMeal(state));
  panel.querySelector('.close-action').addEventListener('click', () => {
    panel.hidden = true;
    panel.innerHTML = '';
    state.pendingProposal = null;
  });
}

function applyProposal(state) {
  if (!state.pendingProposal) return;
  state.items = state.pendingProposal.proposedItems.map(normalizeStateItem);
  state.isOriginalTemplate = false;
  state.numberOfSwaps = state.pendingProposal.source === 'alternate_meal' ? 0 : Math.max(1, Number(state.numberOfSwaps || 0));
  if (state.pendingProposal.source === 'alternate_meal') {
    state.templateName = state.pendingProposal.templateName || state.pendingProposal.title.replace(/^Try\s+/, '');
    state.isApproximate = Boolean(state.pendingProposal.isApproximate);
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
  panel.innerHTML = `<p class="meal-action-message">${escapeHtml(text)}</p>`;
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

  const bar = document.createElement('div');
  bar.id = 'edit-bar';
  bar.className = 'save-action-bar';
  bar.innerHTML = `
    <input class="save-action-bar__name" type="text" value="${escapeHtml(initialName)}" placeholder="Plan name" autocomplete="off" />
    <button class="btn btn-primary save-action-bar__save" type="button">Save changes</button>
    <button class="btn btn-ghost save-action-bar__discard" type="button">Discard</button>
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
    btn.disabled = false; btn.textContent = 'Save changes';

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = 'Saved!';
    document.getElementById('planner-title').textContent = name;
    setTimeout(() => { msgEl.textContent = ''; msgEl.style.color = ''; }, 2000);
  });

  bar.querySelector('.save-action-bar__discard').addEventListener('click', () => {
    if (confirm('Discard changes and reload the saved plan?')) {
      loadPlanForEdit(planId);
    }
  });

  output.prepend(bar);
}

function showFolderSaveBar(folderId) {
  const existing = document.getElementById('folder-save-bar');
  if (existing) existing.remove();

  const folderLabel = plannerCtx?.folderName
    ? `Saving to: <strong>${escapeHtml(plannerCtx.folderName)}</strong>`
    : 'Save plan';

  const bar = document.createElement('div');
  bar.id = 'folder-save-bar';
  bar.className = 'save-action-bar';
  bar.innerHTML = `
    <span class="save-action-bar__label">${folderLabel}</span>
    <input class="save-action-bar__name" type="text" placeholder="Plan name (e.g. Cut Phase Week 1)" autocomplete="off" />
    <button class="btn btn-primary save-action-bar__save" type="button">Save plan</button>
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
    btn.disabled = false; btn.textContent = 'Save plan';

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = `"${name}" saved!`;
    setTimeout(() => { window.location.href = `/explorer?folderId=${folderId}`; }, 900);
  });

  output.prepend(bar);
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

// ── AI Chatbox ───────────────────────────────────────────────────────────────

function resetChat(state, notify = false) {
  state.chatWorkingItems = null;
  state.chatPrevWorkingItems = null;
  state.chatHistory = [];
  state.chatTurnCount = 0;
  state.chatMessages = [];
  if (notify) {
    const node = buildMessageNode('assistant', 'Meal updated — chat restarted.');
    state.chatMessages.push(node);
  }
  if (chatPanel.currentState === state) chatPanel.syncFromState();
}

// ── AI Chat Panel singleton ───────────────────────────────────────────────────

function buildMessageNode(role, text, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chatbox-message-group';
  const bubble = document.createElement('div');
  bubble.className = `chatbox-msg chatbox-msg--${role}`;
  bubble.textContent = text;
  wrap.append(bubble);
  if (role === 'assistant' && opts.snapshot?.length && opts.mealTarget) {
    wrap.append(buildSnapshotTable(opts.snapshot, opts.snapshotTotals, opts.mealTarget));
  }
  return wrap;
}

function buildDraftTable(state) {
  const workingItems = state.chatWorkingItems;
  const displayItems = workingItems || state.items.filter((i) => i.food).map((i) => ({
    foodId: i.food.id,
    name: i.food.name,
    grams: i.quantityG,
    calories: parseFloat((i.food.caloriesPer100g * i.quantityG / 100).toFixed(1)),
    proteinG: parseFloat((i.food.proteinGPer100g * i.quantityG / 100).toFixed(1)),
    carbG: parseFloat((i.food.carbGPer100g * i.quantityG / 100).toFixed(1)),
    fatG: parseFloat((i.food.fatGPer100g * i.quantityG / 100).toFixed(1)),
  }));

  const prevItems = state.chatPrevWorkingItems || (workingItems
    ? state.items.filter((i) => i.food).map((i) => ({ foodId: i.food.id, grams: i.quantityG }))
    : null);
  const prevMap = prevItems ? new Map(prevItems.map((i) => [i.foodId, i])) : null;

  const table = document.createElement('table');
  table.className = 'chatbox-snapshot';
  table.innerHTML = '<thead><tr><th>Food</th><th>g</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr></thead>';

  const tbody = document.createElement('tbody');
  let totals = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };

  for (const item of displayItems) {
    const tr = document.createElement('tr');
    let diff = 'unchanged';
    let prevGrams = null;
    if (prevMap) {
      const prev = prevMap.get(item.foodId);
      if (!prev) {
        diff = 'added';
      } else if (Math.abs(item.grams - prev.grams) > 0.5) {
        diff = 'modified';
        prevGrams = prev.grams;
      }
    }
    if (diff === 'added') tr.className = 'draft-row--added';
    if (diff === 'modified') tr.className = 'draft-row--modified';
    const gramsCell = diff === 'modified' ? `${prevGrams}→${item.grams}` : item.grams;
    tr.innerHTML = `<td>${escapeHtml(item.name)}</td><td>${gramsCell}</td><td>${formatNumber(item.calories)}</td><td>${formatNumber(item.proteinG)}</td><td>${formatNumber(item.carbG)}</td><td>${formatNumber(item.fatG)}</td>`;
    tbody.append(tr);
    totals.calories += item.calories;
    totals.proteinG += item.proteinG;
    totals.carbG += item.carbG;
    totals.fatG += item.fatG;
  }
  table.append(tbody);

  const tfoot = document.createElement('tfoot');
  const target = state.target;
  const allOk = target && ['calories', 'proteinG', 'carbG', 'fatG'].every(
    (k) => Math.abs((totals[k] - target[k]) / Math.max(1, target[k])) <= 0.05,
  );
  const tfootr = document.createElement('tr');
  tfootr.className = allOk ? 'snapshot-ok' : 'snapshot-off';
  tfootr.innerHTML = `<td>Total</td><td>—</td><td>${formatNumber(totals.calories)}</td><td>${formatNumber(totals.proteinG)}</td><td>${formatNumber(totals.carbG)}</td><td>${formatNumber(totals.fatG)}</td>`;
  tfoot.append(tfootr);
  table.append(tfoot);
  return table;
}

const chatPanel = (() => {
  let currentState = null;
  const panelEl = document.getElementById('ai-chat-panel');
  if (!panelEl) {
    return {
      open() {},
      close() {},
      async openAndSend() {},
      syncFromState() {},
      refreshDraftTable() {},
      get currentState() { return null; },
    };
  }
  const titleEl = panelEl.querySelector('.ai-chat-panel__title');
  const messagesEl = panelEl.querySelector('.ai-chat-panel__messages');
  const statusEl = panelEl.querySelector('.ai-chat-panel__status');
  const inputEl = panelEl.querySelector('.ai-chat-panel__input');
  const sendBtn = panelEl.querySelector('.ai-chat-panel__send-btn');
  const draftTableEl = panelEl.querySelector('.ai-chat-panel__draft-table');
  const revertBtn = panelEl.querySelector('.ai-chat-panel__revert-btn');
  const applyBtn = panelEl.querySelector('.ai-chat-panel__apply-btn');
  const closeBtn = panelEl.querySelector('.ai-chat-panel__close');

  function open(state) {
    currentState = state;
    titleEl.textContent = `${state.name}`;
    syncFromState();
    panelEl.hidden = false;
    inputEl.focus();
  }

  function close() {
    panelEl.hidden = true;
  }

  function syncFromState() {
    if (!currentState) return;
    messagesEl.innerHTML = '';
    for (const node of currentState.chatMessages) {
      messagesEl.append(node.cloneNode(true));
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    refreshDraftTable();
  }

  function refreshDraftTable() {
    if (!currentState) return;
    draftTableEl.innerHTML = '';
    draftTableEl.append(buildDraftTable(currentState));
    applyBtn.hidden = !currentState.chatWorkingItems;
  }

  function removeRevertButton() {
    messagesEl.querySelector('.chat-revert-btn')?.remove();
    if (currentState) {
      const stored = currentState.chatMessages.find((n) => n.querySelector?.('.chat-revert-btn'));
      stored?.querySelector('.chat-revert-btn')?.remove();
    }
  }

  function addRevertButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost chat-revert-btn';
    btn.textContent = '↩ Revert last changes';
    btn.addEventListener('click', () => {
      if (!currentState?.chatPrevWorkingItems) return;
      const isOriginal = !currentState.chatPrevWorkingItems[0]?.calories;
      currentState.chatWorkingItems = isOriginal ? null : currentState.chatPrevWorkingItems;
      currentState.chatPrevWorkingItems = null;
      btn.remove();
      refreshDraftTable();
    });
    // Add to live DOM and stored node
    messagesEl.append(btn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    const lastStored = currentState.chatMessages[currentState.chatMessages.length - 1];
    if (lastStored) lastStored.append(btn.cloneNode(true));
  }

  function pushMessage(role, text, opts = {}) {
    const node = buildMessageNode(role, text, opts);
    currentState.chatMessages.push(node);
    messagesEl.append(node.cloneNode(true));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendMessage() {
    if (!currentState) return;
    const state = currentState;
    const userText = inputEl.value.trim();
    if (!userText) return;

    removeRevertButton();
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;

    pushMessage('user', userText);
    statusEl.hidden = false;

    try {
      const sourceItems = state.chatWorkingItems
        ? state.chatWorkingItems.map((pi) => ({ food: foodsById.get(pi.foodId), quantityG: pi.grams }))
        : state.items.filter((item) => item.food);

      const currentItems = sourceItems.filter((item) => item.food).map((item) => ({
        name: item.food.name,
        grams: item.quantityG,
        foodId: item.food.id,
        macroRole: item.food.macroRole,
        categories: item.food.categories || [],
        calories: parseFloat((item.food.caloriesPer100g * item.quantityG / 100).toFixed(1)),
        proteinG: parseFloat((item.food.proteinGPer100g * item.quantityG / 100).toFixed(1)),
        carbG: parseFloat((item.food.carbGPer100g * item.quantityG / 100).toFixed(1)),
        fatG: parseFloat((item.food.fatGPer100g * item.quantityG / 100).toFixed(1)),
      }));

      const currentTotals = computeTotals(sourceItems);

      state.chatHistory.push({ role: 'user', content: userText });
      state.chatTurnCount += 1;

      const res = await fetch('/api/meal-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mealTag: state.tag,
          mealTarget: state.target,
          currentItems,
          currentTotals,
          userPreferences: getUserPreferences(),
          conversationHistory: state.chatHistory.slice(0, -1),
          userMessage: userText,
        }),
        signal: AbortSignal.timeout(50_000),
      });

      const payload = await readJsonResponse(res, 'AI request failed.');
      if (!res.ok) throw new Error(payload.error || 'AI request failed');

      state.chatHistory.push({ role: 'assistant', content: payload.message || '' });

      if (payload.status === 'negotiating') {
        pushMessage('assistant', payload.message);
      } else if (payload.status === 'ready') {
        const madeChanges = Array.isArray(payload.proposedItems) && payload.proposedItems.length > 0;
        if (madeChanges) {
          state.chatPrevWorkingItems = state.chatWorkingItems
            ? [...state.chatWorkingItems]
            : state.items.filter((i) => i.food).map((i) => ({ foodId: i.food.id, name: i.food.name, grams: i.quantityG }));
          state.chatWorkingItems = payload.proposedItems;
          refreshDraftTable();
        }
        pushMessage('assistant', payload.message);
        if (madeChanges) addRevertButton();
      } else {
        pushMessage('assistant', payload.message || "I couldn't process that. Please try again.");
      }

    } catch (err) {
      console.error('[meal-chat error]', err);
      pushMessage('assistant', 'Sorry, I had trouble processing that. Please try again.');
    } finally {
      statusEl.hidden = true;
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  async function openAndSend(state, text) {
    open(state);
    inputEl.value = text;
    await sendMessage();
  }

  closeBtn.addEventListener('click', close);
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });


  applyBtn.addEventListener('click', () => {
    if (!currentState?.chatWorkingItems) return;
    const state = currentState;
    state.items = state.chatWorkingItems.map((pi) => {
      const food = foodsById.get(pi.foodId);
      return { food, quantityG: pi.grams, alternatives: [], broaderAlternatives: [], nearestAlternatives: [], component: null, swapOptions: food ? [food] : [], swapIndex: 0, isEmpty: false };
    }).filter((i) => i.food);
    renderFoodList(state);
    refreshMealCardHeader(state.cardEl, state);
    refreshRedFlags();
    resetChat(state);
  });

  return { open, close, openAndSend, syncFromState, refreshDraftTable, get currentState() { return currentState; } };
})();

function buildSnapshotTable(snapshot, totals, mealTarget) {
  const tol = 0.05;
  const ok = totals && ['calories', 'proteinG', 'carbG', 'fatG'].every(
    (k) => Math.abs((totals[k] - mealTarget[k]) / Math.max(1, mealTarget[k])) <= tol,
  );

  const table = document.createElement('table');
  table.className = 'chatbox-snapshot';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Food</th><th>g</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr>';
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of snapshot) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.name}</td><td>${row.grams}</td><td>${formatNumber(row.calories)}</td><td>${formatNumber(row.proteinG)}</td><td>${formatNumber(row.carbG)}</td><td>${formatNumber(row.fatG)}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);

  if (totals) {
    const tfoot = document.createElement('tfoot');
    const tr = document.createElement('tr');
    tr.className = ok ? 'snapshot-ok' : 'snapshot-off';
    tr.innerHTML = `<td>Total</td><td>—</td><td>${formatNumber(totals.calories)}</td><td>${formatNumber(totals.proteinG)}</td><td>${formatNumber(totals.carbG)}</td><td>${formatNumber(totals.fatG)}</td>`;
    tfoot.append(tr);
    table.append(tfoot);
  }

  return table;
}

function getUserPreferences() {
  return {
    dietType: form.elements.dietType?.value || 'standard',
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

    for (const field of preferenceFields) {
      setupPreferencePicker(field);
    }
  } catch (error) {
    message.textContent = error.message;
  }
}

function setupPreferencePicker(field) {
  const key = field.dataset.picker;
  const input = field.querySelector('input[type="search"]');
  const hidden = field.querySelector('input[type="hidden"]');
  const tokenList = field.querySelector('.selected-tokens');
  const suggestions = field.querySelector('.suggestions');
  const combobox = field.querySelector('.token-input');

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
  submitButton.querySelector('span:last-child').textContent = isLoading ? 'Generating' : 'Generate plan';
  if (freeformButton) {
    freeformButton.querySelector('span:last-child').textContent = isLoading ? 'Generating' : 'Build your own meals instead';
  }
}

function syncRamadanControls() {
  const disabled = ramadanToggle.checked;
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
