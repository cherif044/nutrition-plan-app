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

const preferenceState = { avoidFoods: [] };
let preferenceOptions = { avoidFoods: [] };

let foodsById = new Map();
loadAllFoods();

const mealStates = [];
let dailyTargets = null;

const plannerCtx = (() => {
  const p = new URLSearchParams(location.search);
  const planId = p.get('planId');
  const folderId = p.get('folderId');
  if (!planId && !folderId) return null;
  return { planId, folderId, folderName: null };
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
    const { foods } = await res.json();
    foodsById = new Map(foods.map((f) => [f.id, f]));
  } catch { /* non-critical */ }
}

// ── Edit mode ────────────────────────────────────────────────────────────────

async function loadPlanForEdit(planId) {
  try {
    const res = await fetch(`/api/plans/${planId}`);
    if (!res.ok) { message.textContent = 'Plan not found.'; return; }
    const { plan } = await res.json();

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
  set('bodyFatPercentage', input.bodyFatPercentage);
  set('activityLevel', input.activityLevel);
  set('goal', input.goal);
  set('numberOfMeals', input.numberOfMeals);
  set('numberOfSnacks', input.numberOfSnacks);
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
  output.hidden = false;
  emptyState.hidden = true;

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
      originalItems: (meal.originalItems || meal.items).map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
      })),
      items: meal.items.map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
        alternatives: item.alternatives || [],
      })),
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

  const THRESH = 0.10;

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const tgt = dailyTargets[key];
    const diff = actual[key] - tgt;
    const pct = Math.abs(diff) / Math.max(1, tgt);
    const flagged = pct > THRESH;

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

  refreshMealCardHeader(card, state);

  const foodList = card.querySelector('.food-list');
  state.items.forEach((_, itemIndex) => {
    foodList.append(renderFoodItem(state, itemIndex));
  });

  // Auto-balance button
  card.querySelector('.auto-balance-btn').addEventListener('click', () => handleAutoBalance(state));

  // Add food button
  card.querySelector('.add-food-btn').addEventListener('click', () => toggleAddFoodPanel(state, card));

  // Chat with AI button
  card.querySelector('.chat-ai-btn').addEventListener('click', () => chatPanel.open(state));

  return card;
}

function refreshMealCardHeader(card, state) {
  const totals = computeTotals(state.items);
  card.querySelector('.meal-card__meta').textContent =
    `${state.items.length} food${state.items.length !== 1 ? 's' : ''}`;
  card.querySelector('.meal-target').textContent = `${formatNumber(state.target.calories)} kcal`;
  card.querySelector('.meal-actual').textContent = `${formatNumber(totals.calories)} kcal`;
  card.querySelector('.meal-macros').textContent =
    `P ${formatNumber(totals.proteinG)}g ${separator} C ${formatNumber(totals.carbG)}g ${separator} F ${formatNumber(totals.fatG)}g`;
}

// ── Food item rendering ──────────────────────────────────────────────────────

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
      <div class="food-actions">
        <button class="food-swap-btn" type="button" title="Swap food" aria-label="Swap ${escapeHtml(food.name)}">&#8652;</button>
      </div>
    </div>
    <div class="food-swap-panel" hidden></div>
  `;

  const gramInput = row.querySelector('.food-gram-input');
  let debounceTimer = null;
  gramInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newGrams = clampGrams(food, Number(gramInput.value));
      gramInput.value = newGrams;
      state.items[itemIndex].quantityG = newGrams;
      if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
      refreshMealDOM(state);
      refreshRedFlags();
    }, 400);
  });

  row.querySelector('.gram-minus').addEventListener('click', () => {
    const newQ = clampGrams(food, item.quantityG - 10);
    if (newQ === item.quantityG) return;
    state.items[itemIndex].quantityG = newQ;
    if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
    refreshMealDOM(state);
    refreshRedFlags();
  });

  row.querySelector('.gram-plus').addEventListener('click', () => {
    const newQ = clampGrams(food, item.quantityG + 10);
    if (newQ === item.quantityG) return;
    state.items[itemIndex].quantityG = newQ;
    if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
    refreshMealDOM(state);
    refreshRedFlags();
  });

  // Swap button
  const swapBtn = row.querySelector('.food-swap-btn');
  const swapPanel = row.querySelector('.food-swap-panel');
  swapBtn.addEventListener('click', () => {
    const isOpen = !swapPanel.hidden;
    state.cardEl.querySelectorAll('.food-swap-panel').forEach((p) => { p.hidden = true; });
    state.cardEl.querySelectorAll('.food-swap-btn').forEach((b) => b.classList.remove('active'));
    if (!isOpen) {
      swapPanel.hidden = false;
      swapBtn.classList.add('active');
      buildSwapPanel(swapPanel, state, itemIndex);
    }
  });

  return row;
}

// ── Swap panel ───────────────────────────────────────────────────────────────

function buildSwapPanel(panelEl, state, itemIndex) {
  const item = state.items[itemIndex];
  const mealTag = state.tag;

  panelEl.innerHTML = '';

  const alts = item.alternatives?.length ? item.alternatives : getAlternatives(item.food, mealTag);
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
        applyFoodSwap(state, itemIndex, alt, clampGrams(alt, alt.defaultServingG));
      });
      altRow.append(btn);
    }
    panelEl.append(altRow);
  }

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
          applyFoodSwap(state, itemIndex, food, clampGrams(food, food.defaultServingG));
        });
        resultsEl.append(btn);
      }
    }
    resultsEl.hidden = false;
  });

  document.addEventListener('click', function closeResults(e) {
    if (!searchWrap.contains(e.target)) {
      resultsEl.hidden = true;
      document.removeEventListener('click', closeResults);
    }
  });

  searchWrap.append(searchInput, resultsEl);
  panelEl.append(searchWrap);
}

// ── Food swap ────────────────────────────────────────────────────────────────

function applyFoodSwap(state, itemIndex, newFood, gramAmount) {
  state.items[itemIndex] = {
    food: newFood,
    quantityG: gramAmount,
    alternatives: getAlternatives(newFood, state.tag),
  };
  if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
  const oldRow = state.cardEl.querySelector(`[data-item-index="${itemIndex}"]`);
  const newRow = renderFoodItem(state, itemIndex);
  oldRow.replaceWith(newRow);
  refreshMealCardHeader(state.cardEl, state);
  refreshRedFlags();
}

// ── Insert food ──────────────────────────────────────────────────────────────

function toggleAddFoodPanel(state, card) {
  const panelEl = card.querySelector('.add-food-panel');
  if (!panelEl) return;

  if (!panelEl.hidden) {
    panelEl.hidden = true;
    return;
  }

  panelEl.innerHTML = '';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'swap-search-wrap';
  searchWrap.style.padding = '10px 18px 12px';

  const label = document.createElement('div');
  label.className = 'swap-section-label';
  label.style.marginBottom = '6px';
  label.textContent = 'Add food to this meal';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'swap-search-input';
  searchInput.placeholder = 'Search food to add…';
  searchInput.autocomplete = 'off';

  const resultsEl = document.createElement('div');
  resultsEl.className = 'swap-search-results';
  resultsEl.hidden = true;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultsEl.hidden = true; return; }

    const matches = [...foodsById.values()]
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aTag = a.mealTags.includes(state.tag) ? 0 : 1;
        const bTag = b.mealTags.includes(state.tag) ? 0 : 1;
        return aTag - bTag || a.name.localeCompare(b.name);
      })
      .slice(0, 10);

    resultsEl.innerHTML = '';
    for (const food of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swap-result-item';
      btn.innerHTML = `<strong>${escapeHtml(food.name)}</strong><em>${escapeHtml(food.macroRole)}</em>`;
      btn.addEventListener('click', () => {
        const newItem = {
          food,
          quantityG: clampGrams(food, food.defaultServingG),
          alternatives: getAlternatives(food, state.tag),
        };
        state.items.push(newItem);
        if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
        const foodList = card.querySelector('.food-list');
        foodList.append(renderFoodItem(state, state.items.length - 1));
        refreshMealCardHeader(card, state);
        refreshRedFlags();
        panelEl.hidden = true;
      });
      resultsEl.append(btn);
    }
    resultsEl.hidden = matches.length === 0;
  });

  searchWrap.append(label, searchInput, resultsEl);
  panelEl.append(searchWrap);
  panelEl.hidden = false;
  setTimeout(() => searchInput.focus(), 50);
}

// ── Auto-balance ─────────────────────────────────────────────────────────────

async function handleAutoBalance(state) {
  const card = state.cardEl;
  const btn = card.querySelector('.auto-balance-btn');
  btn.disabled = true;
  btn.textContent = 'Balancing…';

  // Clear previous suggestions
  const prevSuggestions = card.querySelector('.auto-balance-suggestions');
  if (prevSuggestions) {
    prevSuggestions.innerHTML = '';
    prevSuggestions.hidden = true;
  }
  card.querySelectorAll('.food-item--problematic').forEach((el) => el.classList.remove('food-item--problematic'));

  try {
    const res = await fetch('/api/auto-balance-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealTag: state.tag,
        items: state.items.map((item) => ({
          foodId: item.food.id,
          quantityG: item.quantityG,
        })),
        originalItems: state.originalItems.map((item) => ({
          foodId: item.food.id,
          quantityG: item.quantityG,
        })),
      }),
    });

    const payload = await res.json();

    if (payload.success) {
      for (const update of payload.items) {
        const stateItem = state.items.find((it) => it.food.id === update.foodId);
        if (stateItem) stateItem.quantityG = update.quantityG;
      }
      if (state.chatHistory.length > 0 || state.chatWorkingItems) resetChat(state, true);
      refreshMealDOM(state);
      refreshRedFlags();
    } else {
      showAutoBalanceSuggestions(state, payload.problematicFoodId, payload.suggestions || []);
    }
  } catch {
    // Network error — silently ignore
  } finally {
    btn.disabled = false;
    btn.textContent = 'Auto-balance';
  }
}

function showAutoBalanceSuggestions(state, problematicFoodId, suggestions) {
  const card = state.cardEl;

  const probIdx = state.items.findIndex((i) => i.food.id === problematicFoodId);
  if (probIdx !== -1) {
    card.querySelector(`[data-item-index="${probIdx}"]`)?.classList.add('food-item--problematic');
  }

  const panel = card.querySelector('.auto-balance-suggestions');
  if (!panel) return;

  panel.hidden = false;
  panel.innerHTML = '';

  const title = document.createElement('p');
  title.className = 'suggestions-title';
  title.textContent = suggestions.length > 0
    ? 'Auto-balance couldn\'t find a solution. Try one of these options:'
    : 'Auto-balance couldn\'t find a solution. Try swapping the highlighted food manually.';
  panel.append(title);

  if (suggestions.length > 0) {
    const list = document.createElement('div');
    list.className = 'suggestion-list';

    for (const s of suggestions) {
      const swapBtn = document.createElement('button');
      swapBtn.type = 'button';
      swapBtn.className = 'suggestion-action-btn';
      swapBtn.innerHTML = `<span class="suggestion-action-tag">Swap</span> <strong>${escapeHtml(s.food.name)}</strong> <em>${s.gramAmount}g</em>`;
      swapBtn.addEventListener('click', () => {
        if (probIdx !== -1) {
          applyFoodSwap(state, probIdx, s.food, s.gramAmount);
        }
        panel.hidden = true;
        card.querySelectorAll('.food-item--problematic').forEach((el) => el.classList.remove('food-item--problematic'));
      });
      list.append(swapBtn);

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'suggestion-action-btn';
      insertBtn.innerHTML = `<span class="suggestion-action-tag suggestion-action-tag--insert">Add</span> <strong>${escapeHtml(s.food.name)}</strong> <em>${s.gramAmount}g</em>`;
      insertBtn.addEventListener('click', () => {
        const newItem = {
          food: s.food,
          quantityG: s.gramAmount,
          alternatives: getAlternatives(s.food, state.tag),
        };
        state.items.push(newItem);
        const foodList = card.querySelector('.food-list');
        foodList.append(renderFoodItem(state, state.items.length - 1));
        refreshMealCardHeader(card, state);
        refreshRedFlags();
        panel.hidden = true;
        card.querySelectorAll('.food-item--problematic').forEach((el) => el.classList.remove('food-item--problematic'));
      });
      list.append(insertBtn);
    }

    panel.append(list);
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

    rowEl.querySelector('.item-kcal').textContent = `${formatNumber(totals.calories)} kcal`;
    rowEl.querySelector('.item-p').textContent = `P ${formatNumber(totals.proteinG)}g`;
    rowEl.querySelector('.item-c').textContent = `C ${formatNumber(totals.carbG)}g`;
    rowEl.querySelector('.item-f').textContent = `F ${formatNumber(totals.fatG)}g`;
  });
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
    const data = await res.json();
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
    const data = await res.json();
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
        alternatives: item.alternatives || [],
        totals: itemTotals(item.food, item.quantityG),
      })),
      totals: computeTotals(state.items),
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
  const displayItems = workingItems || state.items.map((i) => ({
    foodId: i.food.id,
    name: i.food.name,
    grams: i.quantityG,
    calories: parseFloat((i.food.caloriesPer100g * i.quantityG / 100).toFixed(1)),
    proteinG: parseFloat((i.food.proteinGPer100g * i.quantityG / 100).toFixed(1)),
    carbG: parseFloat((i.food.carbGPer100g * i.quantityG / 100).toFixed(1)),
    fatG: parseFloat((i.food.fatGPer100g * i.quantityG / 100).toFixed(1)),
  }));

  const prevItems = state.chatPrevWorkingItems || (workingItems
    ? state.items.map((i) => ({ foodId: i.food.id, grams: i.quantityG }))
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
        : state.items;

      const currentItems = sourceItems.map((item) => ({
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

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'AI request failed');

      state.chatHistory.push({ role: 'assistant', content: JSON.stringify(payload) });

      if (payload.status === 'negotiating') {
        pushMessage('assistant', payload.message);
      } else if (payload.status === 'ready') {
        const madeChanges = Array.isArray(payload.proposedItems) && payload.proposedItems.length > 0;
        if (madeChanges) {
          state.chatPrevWorkingItems = state.chatWorkingItems
            ? [...state.chatWorkingItems]
            : state.items.map((i) => ({ foodId: i.food.id, name: i.food.name, grams: i.quantityG }));
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

  closeBtn.addEventListener('click', close);
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });


  applyBtn.addEventListener('click', () => {
    if (!currentState?.chatWorkingItems) return;
    const state = currentState;
    state.items = state.chatWorkingItems.map((pi) => {
      const food = foodsById.get(pi.foodId);
      return { food, quantityG: pi.grams, alternatives: getAlternatives(food, state.tag) };
    }).filter((i) => i.food);
    const foodList = state.cardEl.querySelector('.food-list');
    foodList.innerHTML = '';
    state.items.forEach((_, i) => foodList.append(renderFoodItem(state, i)));
    refreshMealCardHeader(state.cardEl, state);
    refreshRedFlags();
    resetChat(state);
    close();
  });

  return { open, close, syncFromState, refreshDraftTable, get currentState() { return currentState; } };
})();

function appendMessage(messagesEl, role, text, opts = {}) {
  const node = buildMessageNode(role, text, opts);
  messagesEl.append(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

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

function getAlternatives(food, mealTag, limit = 4) {
  const byRole = (f) =>
    f.id !== food.id &&
    f.macroRole === food.macroRole &&
    f.mealTags.includes(mealTag);

  const withCategory = [...foodsById.values()].filter(
    (f) => byRole(f) && f.categories.some((c) => food.categories.includes(c)),
  );
  const pool = withCategory.length > 0
    ? withCategory
    : [...foodsById.values()].filter(byRole);

  return pool.slice(0, limit);
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

// ── Preference picker ────────────────────────────────────────────────────────

async function loadPreferenceOptions() {
  try {
    const response = await fetch('/api/preferences');
    const payload = await response.json();

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
