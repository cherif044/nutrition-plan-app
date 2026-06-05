// Auth guard -- redirect to login if not authenticated
(async () => {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.replace('/login');
      return;
    }
    const { user } = await res.json();
    const navUser = document.getElementById('planner-nav-user');
    if (navUser) {
      const backLink = customerCtx
        ? `<a class="btn btn-ghost" href="/customer/${customerCtx.customerId}" style="min-height:36px;font-size:.82rem;">← ${escapeHtml(customerCtx.customerName)}</a>`
        : `<a class="btn btn-ghost" href="/customers" style="min-height:36px;font-size:.82rem;">Customers</a>`;
      navUser.innerHTML = `
        <span class="planner-nav__greeting">Hi, ${escapeHtml(user.firstname)}</span>
        <a class="btn btn-ghost" href="/" style="min-height:36px;font-size:.82rem;">Home</a>
        ${backLink}
        <button class="btn btn-ghost" id="logout-btn" style="min-height:36px;font-size:.82rem;">Log out</button>
      `;
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.replace('/');
      });
    }

    // Update nav brand if in customer context
    if (customerCtx) {
      const eyebrow = document.getElementById('planner-eyebrow');
      const title = document.getElementById('planner-title');
      if (eyebrow) eyebrow.innerHTML = `<a href="/customers" style="color:var(--accent);text-decoration:none;">Customers</a> / <a href="/customer/${customerCtx.customerId}" style="color:var(--accent);text-decoration:none;">${escapeHtml(customerCtx.customerName)}</a>`;
      if (title) title.textContent = 'New Plan';
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
const ramadanToggle = form.elements.ramadanMode;
const mealsSelect = form.elements.numberOfMeals;
const snacksSelect = form.elements.numberOfSnacks;
const preferenceFields = document.querySelectorAll('.preference-field');

const labels = {
  calories: ['Calories', 'kcal'],
  proteinG: ['Protein', 'g'],
  carbG: ['Carbs', 'g'],
  fatG: ['Fat', 'g'],
};
const separator = '·';
const preferenceState = { allergies: [], dislikes: [] };
let preferenceOptions = { allergies: [], dislikes: [] };

// All foods catalog for swap search (loaded once)
let foodsById = new Map();
loadAllFoods();

// Per-meal interactive state
const mealStates = [];

// ── Customer context (when opened from /planner?customerId=...) ──────────────
const customerCtx = (() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('customerId');
  if (!id) return null;
  return { customerId: id, customerName: params.get('customerName') || 'Customer' };
})();

// ── Form submit ──────────────────────────────────────────────────────────────

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  setLoading(true);

  try {
    const response = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to generate a nutrition plan.');
    }

    renderPlan(payload);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    setLoading(false);
  }
});

ramadanToggle.addEventListener('change', syncRamadanControls);
syncRamadanControls();
loadPreferenceOptions();

function readForm() {
  const data = new FormData(form);
  return {
    weightKg: data.get('weightKg'),
    heightCm: data.get('heightCm'),
    bodyFatPercentage: data.get('bodyFatPercentage'),
    activityLevel: data.get('activityLevel'),
    goal: data.get('goal'),
    numberOfMeals: data.get('numberOfMeals'),
    numberOfSnacks: data.get('numberOfSnacks'),
    dietType: data.get('dietType'),
    allergies: preferenceState.allergies.map((o) => o.id),
    dislikes: preferenceState.dislikes.map((o) => o.id),
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
    const { foods } = await res.json();
    foodsById = new Map(foods.map((f) => [f.id, f]));
  } catch { /* non-critical */ }
}

// ── Render plan ──────────────────────────────────────────────────────────────

function renderPlan(plan) {
  output.innerHTML = '';
  mealStates.length = 0;
  output.hidden = false;
  emptyState.hidden = true;

  output.append(renderSummary(plan.dailyTargets));

  if (customerCtx) {
    showCustomerSaveBar();
  }

  plan.meals.forEach((meal, mealIndex) => {
    const state = {
      mealIndex,
      name: meal.name,
      tag: meal.tag,
      target: meal.target,
      // Deep-copy items so we can mutate without touching original
      items: meal.items.map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
        alternatives: item.alternatives || [],
      })),
      lastBalanced: null, // set after first render
      mealBounds: null,   // 10% bounds around initial meal totals; reset on swap
      sensitivityMatrix: meal.sensitivityMatrix || null,
      cardEl: null,
    };
    // Snapshot as last-known-good baseline
    state.lastBalanced = deepCopyItems(state.items);
    state.mealBounds = computeMealBounds(computeTotals(state.items));
    mealStates.push(state);

    const card = renderMealCard(state);
    state.cardEl = card;
    output.append(card);
  });
}

// ── Customer save bar (shown when customerId is in URL) ───────────────────────

function showCustomerSaveBar() {
  const existing = document.getElementById('customer-save-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'customer-save-bar';
  bar.className = 'customer-save-bar';
  bar.innerHTML = `
    <span class="customer-save-bar__label">Saving for <strong>${escapeHtml(customerCtx.customerName)}</strong></span>
    <input class="customer-save-bar__input" type="text" placeholder="Plan name (e.g. Cut Phase Week 1)" autocomplete="off" />
    <button class="btn btn-primary customer-save-bar__btn" type="button">Save plan</button>
    <p class="customer-save-bar__msg message" aria-live="polite"></p>
  `;

  bar.querySelector('.customer-save-bar__btn').addEventListener('click', async () => {
    const planName = bar.querySelector('.customer-save-bar__input').value.trim();
    const msgEl = bar.querySelector('.customer-save-bar__msg');
    msgEl.textContent = '';
    if (!planName) { msgEl.textContent = 'Enter a plan name first.'; return; }

    // Build current plan data from live mealStates
    const planData = {
      dailyTargets: null,
      meals: mealStates.map((state) => ({
        name: state.name,
        tag: state.tag,
        target: state.target,
        items: state.items.map((item) => ({
          food: item.food,
          quantityG: item.quantityG,
          alternatives: item.alternatives || [],
          totals: itemTotals(item.food, item.quantityG),
        })),
        totals: computeTotals(state.items),
      })),
    };

    // Grab daily targets from the summary panel
    const summaryEl = output.querySelector('.summary');
    if (summaryEl) {
      const vals = [...summaryEl.querySelectorAll('.metric strong')].map((el) => Number(el.textContent));
      planData.dailyTargets = { calories: vals[0], proteinG: vals[1], carbG: vals[2], fatG: vals[3] };
    }

    const btn = bar.querySelector('.customer-save-bar__btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const res = await fetch(`/api/customers/${customerCtx.customerId}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planName, planData }),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'Save plan';

    if (!res.ok) { msgEl.textContent = data.error; return; }
    msgEl.style.color = 'var(--accent)';
    msgEl.textContent = `"${planName}" saved!`;
    setTimeout(() => {
      window.location.href = `/customer/${customerCtx.customerId}`;
    }, 1000);
  });

  output.prepend(bar);
}

function renderSummary(targets) {
  const summary = summaryTemplate.content.firstElementChild.cloneNode(true);
  const metrics = summary.querySelector('.metrics');

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const metric = document.createElement('div');
    metric.className = 'metric';
    metric.innerHTML = `
      <span>${labels[key][0]}</span>
      <strong>${formatNumber(targets[key])}</strong>
      <small>${labels[key][1]}</small>
    `;
    metrics.append(metric);
  }

  return summary;
}

function renderMealCard(state) {
  const card = mealTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('h2').textContent = state.name;
  card.dataset.mealIndex = state.mealIndex;
  refreshMealCardHeader(card, state);

  const foodList = card.querySelector('.food-list');
  state.items.forEach((item, itemIndex) => {
    foodList.append(renderFoodItem(state, itemIndex));
  });

  return card;
}

function refreshMealCardHeader(card, state) {
  const totals = computeTotals(state.items);
  card.querySelector('.meal-card__meta').textContent = `${state.items.length} food${state.items.length !== 1 ? 's' : ''}`;
  card.querySelector('.meal-target').textContent = `${formatNumber(state.target.calories)} kcal`;
  card.querySelector('.meal-actual').textContent = `${formatNumber(totals.calories)} kcal`;
  card.querySelector('.meal-macros').textContent =
    `P ${formatNumber(totals.proteinG)}g ${separator} C ${formatNumber(totals.carbG)}g ${separator} F ${formatNumber(totals.fatG)}g`;
  card.querySelector('.approx-badge').hidden = true;
}

// ── Interactive food item ────────────────────────────────────────────────────

function renderFoodItem(state, itemIndex) {
  const item = state.items[itemIndex];
  const food = item.food;
  const totals = itemTotals(food, item.quantityG);

  const row = document.createElement('div');
  row.className = 'food-item';
  row.dataset.itemIndex = itemIndex;

  row.innerHTML = `
    <div class="food-main">
      <div class="food-title">
        <div class="food-name">${escapeHtml(food.name)}</div>
        ${food.nameAr ? `<div class="food-ar">${escapeHtml(food.nameAr)}</div>` : ''}
      </div>
      <div class="food-gram-wrap">
        <button class="gram-btn gram-minus" type="button" aria-label="Decrease grams">−</button>
        <input
          class="food-gram-input"
          type="number"
          value="${item.quantityG}"
          min="${food.minServingG}"
          max="${food.maxServingG}"
          step="10"
          aria-label="Grams of ${escapeHtml(food.name)}"
        />
        <span class="food-gram-unit">g</span>
        <button class="gram-btn gram-plus" type="button" aria-label="Increase grams">+</button>
      </div>
      <div class="food-macros">
        <strong class="item-kcal">${formatNumber(totals.calories)} kcal</strong>
        <span class="item-p">P ${formatNumber(totals.proteinG)}g</span>
        <span class="item-c">C ${formatNumber(totals.carbG)}g</span>
        <span class="item-f">F ${formatNumber(totals.fatG)}g</span>
      </div>
      <button class="food-swap-btn" type="button" title="Swap food" aria-label="Swap ${escapeHtml(food.name)}">&#8652;</button>
    </div>
    <div class="food-swap-panel" hidden></div>
    <div class="food-balance-msg" hidden></div>
  `;

  // Gram input -- debounced rebalance (manual typing)
  const gramInput = row.querySelector('.food-gram-input');
  let debounceTimer = null;
  gramInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newGrams = clampGrams(food, Number(gramInput.value));
      gramInput.value = newGrams;
      handleGramChange(state, itemIndex, newGrams, row);
    }, 400);
  });

  // ±10g buttons -- instant via sensitivity matrix
  row.querySelector('.gram-minus').addEventListener('click', () => handleGramStep(state, itemIndex, -1, row));
  row.querySelector('.gram-plus').addEventListener('click', () => handleGramStep(state, itemIndex, +1, row));

  // Swap button
  const swapBtn = row.querySelector('.food-swap-btn');
  const swapPanel = row.querySelector('.food-swap-panel');
  swapBtn.addEventListener('click', () => {
    const isOpen = !swapPanel.hidden;
    // Close all other open panels in this meal card
    state.cardEl.querySelectorAll('.food-swap-panel').forEach((p) => {
      p.hidden = true;
    });
    state.cardEl.querySelectorAll('.food-swap-btn').forEach((b) => {
      b.classList.remove('active');
    });
    if (!isOpen) {
      swapPanel.hidden = false;
      swapBtn.classList.add('active');
      buildSwapPanel(swapPanel, state, itemIndex);
    }
  });

  return row;
}

// ── Gram change handler ──────────────────────────────────────────────────────

async function handleGramChange(state, lockedIndex, newGrams, rowEl) {
  state.items[lockedIndex].quantityG = newGrams;
  await triggerRebalance(state, lockedIndex, rowEl);
}

// ── ±10g instant step via sensitivity matrix ─────────────────────────────────

function handleGramStep(state, triggerIdx, sign, rowEl) {
  const trigger = state.items[triggerIdx];
  const newQ = clampGrams(trigger.food, trigger.quantityG + sign * 10);
  if (newQ === trigger.quantityG) return;

  const snapshot = deepCopyItems(state.items);

  trigger.quantityG = newQ;
  const matrix = state.sensitivityMatrix;
  if (matrix && matrix[triggerIdx]) {
    const deltas = matrix[triggerIdx];
    for (let i = 0; i < state.items.length; i++) {
      if (i === triggerIdx) continue;
      const rawDelta = sign * deltas[i];
      if (Math.abs(rawDelta) < 1) continue;
      const item = state.items[i];
      const minQ = item.food.minServingG ?? 20;
      const maxQ = item.food.maxServingG ?? 500;
      item.quantityG = Math.round(Math.min(Math.max(item.quantityG + rawDelta, minQ), maxQ) / 5) * 5;
    }
  }

  if (state.mealBounds && !isWithinBounds(computeTotals(state.items), state.mealBounds)) {
    state.items = snapshot;
    const dir = sign > 0 ? 'increase' : 'decrease';
    showBalanceError(rowEl, `Can't ${dir} more -- meal macros would exceed 10% limit`);
    updateGramButtonStates(state);
    refreshMealDOM(state);
    return;
  }

  state.lastBalanced = deepCopyItems(state.items);
  refreshMealDOM(state);
  clearBalanceError(rowEl);
  refreshSensitivityMatrix(state);
}

// ── Swap panel ───────────────────────────────────────────────────────────────

function buildSwapPanel(panelEl, state, itemIndex) {
  const item = state.items[itemIndex];
  const mealTag = state.tag;

  panelEl.innerHTML = '';

  // Suggested alternatives
  const alts = getAlternatives(item.food, mealTag);
  if (alts.length > 0) {
    const label = document.createElement('div');
    label.className = 'swap-section-label';
    label.textContent = 'Suggestions';
    panelEl.append(label);

    const altRow = document.createElement('div');
    altRow.className = 'swap-alternatives';
    for (const alt of alts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swap-alt-btn';
      btn.dataset.altFoodId = alt.id;
      btn.innerHTML = `${escapeHtml(alt.name)} <em>${formatNumber(alt.caloriesPer100g)} kcal/100g</em>`;
      btn.addEventListener('click', () => {
        panelEl.hidden = true;
        panelEl.closest('.food-item').querySelector('.food-swap-btn').classList.remove('active');
        handleFoodSwap(state, itemIndex, alt);
      });
      altRow.append(btn);
    }
    panelEl.append(altRow);
    checkAltsFeasibility(state, itemIndex, alts, altRow);
  }

  // Search all foods
  const searchLabel = document.createElement('div');
  searchLabel.className = 'swap-section-label';
  searchLabel.textContent = 'Search any food';
  panelEl.append(searchLabel);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'swap-search-wrap';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'swap-search-input';
  searchInput.placeholder = 'Type to search…';
  searchInput.autocomplete = 'off';

  const resultsEl = document.createElement('div');
  resultsEl.className = 'swap-search-results';
  resultsEl.hidden = true;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultsEl.hidden = true; return; }

    const matches = [...foodsById.values()]
      .filter((f) => f.id !== item.food.id && f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Prefer same meal tag
        const aTag = a.mealTags.includes(mealTag) ? 0 : 1;
        const bTag = b.mealTags.includes(mealTag) ? 0 : 1;
        return aTag - bTag || a.name.localeCompare(b.name);
      })
      .slice(0, 10);

    resultsEl.innerHTML = '';
    if (matches.length === 0) {
      resultsEl.innerHTML = '<div style="padding:8px 10px;color:var(--muted);font-size:.82rem;">No matches</div>';
    } else {
      for (const food of matches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swap-result-item';
        btn.innerHTML = `<strong>${escapeHtml(food.name)}</strong><em>${escapeHtml(food.macroRole)}</em>`;
        btn.addEventListener('click', () => {
          resultsEl.hidden = true;
          panelEl.hidden = true;
          panelEl.closest('.food-item').querySelector('.food-swap-btn').classList.remove('active');
          handleFoodSwap(state, itemIndex, food);
        });
        resultsEl.append(btn);
      }
    }
    resultsEl.hidden = false;
  });

  // Close results on outside click
  document.addEventListener('click', function closeResults(e) {
    if (!searchWrap.contains(e.target)) {
      resultsEl.hidden = true;
      document.removeEventListener('click', closeResults);
    }
  });

  searchWrap.append(searchInput, resultsEl);
  panelEl.append(searchWrap);
}

// ── Food swap handler ────────────────────────────────────────────────────────

async function handleFoodSwap(state, itemIndex, newFood) {
  const rowEl = state.cardEl.querySelector(`[data-item-index="${itemIndex}"]`);

  state.items[itemIndex] = {
    food: newFood,
    quantityG: clampGrams(newFood, newFood.defaultServingG),
    alternatives: getAlternatives(newFood, state.tag),
  };

  // null = no lock, so the algorithm can also adjust the new food's portion to fit within bounds
  await triggerRebalance(state, null, rowEl);

  // Always recompute from lastBalanced: on success it's the new state, on failure it's the old one
  state.mealBounds = computeMealBounds(computeTotals(state.lastBalanced));

  refreshSensitivityMatrix(state);
}

async function refreshSensitivityMatrix(state) {
  try {
    const mealTarget = computeTotals(state.lastBalanced);
    const res = await fetch('/api/compute-sensitivity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealTarget,
        items: state.items.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
      }),
    });
    if (!res.ok) return;
    const { sensitivityMatrix } = await res.json();
    state.sensitivityMatrix = sensitivityMatrix;
    updateGramButtonStates(state);
  } catch { /* non-critical -- buttons still work, just no compensation */ }
}

// ── Core rebalance ───────────────────────────────────────────────────────────

async function triggerRebalance(state, lockedIndex, triggerRowEl) {
  const card = state.cardEl;
  card.classList.add('meal-rebalancing');

  // Target = current actual totals of last balanced state (not the plan's ideal target).
  // This asks "can we preserve the meal's current balance after this change?"
  // and works correctly for both exact and approximate meals.
  const mealTarget = computeTotals(state.lastBalanced);

  try {
    const res = await fetch('/api/rebalance-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealTarget,
        mealBounds: state.mealBounds,
        items: state.items.map((item, i) => ({
          foodId: item.food.id,
          quantityG: item.quantityG,
          locked: lockedIndex !== null && i === lockedIndex,
        })),
      }),
    });

    const payload = await res.json();

    if (!res.ok || !payload.success) {
      state.items = deepCopyItems(state.lastBalanced);
      refreshMealDOM(state);
      const macro = payload?.violatedMacro;
      const msg = macro
        ? `Can't balance -- ${macro} would exceed 10% limit`
        : "This change can't be balanced in this meal -- try a different food or adjust another item first.";
      showBalanceError(triggerRowEl, msg);
      return;
    }

    // Apply new quantities from server
    for (const update of payload.items) {
      const stateItem = state.items.find((it) => it.food.id === update.foodId);
      if (stateItem) stateItem.quantityG = update.quantityG;
    }

    // Snapshot the new balanced state
    state.lastBalanced = deepCopyItems(state.items);
    refreshMealDOM(state);
    clearBalanceError(triggerRowEl);
  } catch {
    // Network error -- revert silently
    state.items = deepCopyItems(state.lastBalanced);
    refreshMealDOM(state);
  } finally {
    card.classList.remove('meal-rebalancing');
  }
}

// ── DOM refresh helpers ──────────────────────────────────────────────────────

function refreshMealDOM(state) {
  const card = state.cardEl;
  refreshMealCardHeader(card, state);

  state.items.forEach((item, itemIndex) => {
    const rowEl = card.querySelector(`[data-item-index="${itemIndex}"]`);
    if (!rowEl) return;

    const totals = itemTotals(item.food, item.quantityG);

    const gramInput = rowEl.querySelector('.food-gram-input');
    if (gramInput && document.activeElement !== gramInput) {
      gramInput.value = item.quantityG;
    }

    const nameEl = rowEl.querySelector('.food-name');
    if (nameEl) nameEl.textContent = item.food.name;

    rowEl.querySelector('.item-kcal').textContent = `${formatNumber(totals.calories)} kcal`;
    rowEl.querySelector('.item-p').textContent = `P ${formatNumber(totals.proteinG)}g`;
    rowEl.querySelector('.item-c').textContent = `C ${formatNumber(totals.carbG)}g`;
    rowEl.querySelector('.item-f').textContent = `F ${formatNumber(totals.fatG)}g`;
  });

  updateGramButtonStates(state);
}

function showBalanceError(rowEl, msg) {
  if (!rowEl) return;
  const el = rowEl.querySelector('.food-balance-msg');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

function clearBalanceError(rowEl) {
  if (!rowEl) return;
  const el = rowEl.querySelector('.food-balance-msg');
  if (el) el.hidden = true;
}

// ── Meal bounds (10% per macro) ──────────────────────────────────────────────

function computeMealBounds(totals) {
  const t = 0.10;
  return {
    calories: { min: totals.calories * (1 - t), max: totals.calories * (1 + t) },
    proteinG: { min: totals.proteinG * (1 - t), max: totals.proteinG * (1 + t) },
    carbG: { min: totals.carbG * (1 - t), max: totals.carbG * (1 + t) },
    fatG: { min: totals.fatG * (1 - t), max: totals.fatG * (1 + t) },
  };
}

function isWithinBounds(totals, bounds) {
  return (
    totals.calories >= bounds.calories.min && totals.calories <= bounds.calories.max &&
    totals.proteinG >= bounds.proteinG.min && totals.proteinG <= bounds.proteinG.max &&
    totals.carbG >= bounds.carbG.min && totals.carbG <= bounds.carbG.max &&
    totals.fatG >= bounds.fatG.min && totals.fatG <= bounds.fatG.max
  );
}

function wouldStepBeWithinBounds(state, triggerIdx, sign) {
  if (!state.mealBounds) return true;
  const trigger = state.items[triggerIdx];
  const newQ = clampGrams(trigger.food, trigger.quantityG + sign * 10);
  if (newQ === trigger.quantityG) return false;

  const matrix = state.sensitivityMatrix;
  const simulated = state.items.map((item, i) => {
    if (i === triggerIdx) return { ...item, quantityG: newQ };
    if (!matrix || !matrix[triggerIdx]) return item;
    const rawDelta = sign * matrix[triggerIdx][i];
    if (Math.abs(rawDelta) < 1) return item;
    const minQ = item.food.minServingG ?? 20;
    const maxQ = item.food.maxServingG ?? 500;
    return { ...item, quantityG: Math.round(Math.min(Math.max(item.quantityG + rawDelta, minQ), maxQ) / 5) * 5 };
  });

  return isWithinBounds(computeTotals(simulated), state.mealBounds);
}

function updateGramButtonStates(state) {
  if (!state.mealBounds) return;
  state.items.forEach((_, triggerIdx) => {
    const rowEl = state.cardEl.querySelector(`[data-item-index="${triggerIdx}"]`);
    if (!rowEl) return;
    rowEl.querySelector('.gram-plus').classList.toggle('gram-btn--at-limit', !wouldStepBeWithinBounds(state, triggerIdx, +1));
    rowEl.querySelector('.gram-minus').classList.toggle('gram-btn--at-limit', !wouldStepBeWithinBounds(state, triggerIdx, -1));
  });
}

async function fetchSwapFeasibility(state, itemIndex, newFood) {
  try {
    const mealTarget = computeTotals(state.lastBalanced);
    const items = state.items.map((item, i) => ({
      foodId: i === itemIndex ? newFood.id : item.food.id,
      quantityG: i === itemIndex ? clampGrams(newFood, newFood.defaultServingG) : item.quantityG,
      locked: false,
    }));
    const res = await fetch('/api/check-swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealTarget, items }),
    });
    if (!res.ok) return true;
    const { feasible } = await res.json();
    return feasible;
  } catch {
    return true;
  }
}

async function checkAltsFeasibility(state, itemIndex, alts, containerEl) {
  await Promise.all(alts.map(async (alt) => {
    const feasible = await fetchSwapFeasibility(state, itemIndex, alt);
    if (!feasible) {
      const btn = containerEl.querySelector(`[data-alt-food-id="${alt.id}"]`);
      if (!btn) return;
      btn.classList.add('swap-alt-btn--warn');
      btn.title = "May not balance within 10% -- try anyway";
      const icon = document.createElement('span');
      icon.className = 'swap-warn-icon';
      icon.textContent = ' ⚠';
      btn.append(icon);
    }
  }));
}

// ── Utility ──────────────────────────────────────────────────────────────────

function getAlternatives(food, mealTag, limit = 3) {
  return [...foodsById.values()]
    .filter((f) => f.id !== food.id && f.macroRole === food.macroRole && f.mealTags.includes(mealTag))
    .slice(0, limit);
}

function computeTotals(items) {
  return items.reduce(
    (acc, item) => {
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

function clampGrams(food, grams) {
  const min = food.minServingG ?? 20;
  const max = food.maxServingG ?? 500;
  return Math.round(Math.min(Math.max(grams, min), max) / 10) * 10;
}

function deepCopyItems(items) {
  return items.map((item) => ({ ...item, alternatives: [...(item.alternatives || [])] }));
}

// ── Preference pickers ───────────────────────────────────────────────────────

async function loadPreferenceOptions() {
  try {
    const response = await fetch('/api/preferences');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load preference options.');
    }

    preferenceOptions = {
      allergies: payload.allergyOptions || [],
      dislikes: payload.dislikeOptions || [],
    };

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
    const matches = preferenceOptions[key]
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
  return preferenceOptions[key].find((o) => o.id === id);
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
  submitButton.querySelector('span:last-child').textContent = isLoading ? 'Generating' : 'Generate plan';
}

function syncRamadanControls() {
  const disabled = ramadanToggle.checked;
  mealsSelect.disabled = disabled;
  snacksSelect.disabled = disabled;
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
