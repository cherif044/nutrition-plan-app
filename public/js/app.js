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
const separator = '\u00b7';
const preferenceState = {
  allergies: [],
  dislikes: [],
};
let preferenceOptions = {
  allergies: [],
  dislikes: [],
};

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
    allergies: preferenceState.allergies.map((option) => option.id),
    dislikes: preferenceState.dislikes.map((option) => option.id),
    milkType: data.get('milkType'),
    coffeesPerDay: data.get('coffeesPerDay'),
    ramadanMode: data.has('ramadanMode'),
  };
}

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

    if (event.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', (event) => {
    if (!field.contains(event.target)) {
      hideSuggestions();
    }
  });

  function renderTokens() {
    tokenList.innerHTML = '';
    hidden.value = preferenceState[key].map((option) => option.id).join(',');

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
    if (!option || preferenceState[key].some((item) => item.id === option.id)) {
      return;
    }

    preferenceState[key].push(option);
    renderTokens();
  }

  function renderSuggestions() {
    const query = input.value.trim();
    const selected = new Set(preferenceState[key].map((option) => option.id));
    const matches = preferenceOptions[key]
      .filter((option) => !selected.has(option.id))
      .map((option) => ({ option, score: scoreOption(option, query) }))
      .filter((match) => match.score > -1)
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
  return preferenceOptions[key].find((option) => option.id === id);
}

function scoreOption(option, query) {
  if (!query) {
    return option.type === 'food' ? 10 : 20;
  }

  const normalizedQuery = normalizeText(query);
  const label = normalizeText(option.label);
  const aliases = (option.aliases || []).map(normalizeText);

  if (label === normalizedQuery || aliases.includes(normalizedQuery)) {
    return 100;
  }
  if (label.startsWith(normalizedQuery)) {
    return 90;
  }
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) {
    return 80;
  }
  if (label.includes(normalizedQuery)) {
    return 70;
  }
  if (aliases.some((alias) => alias.includes(normalizedQuery))) {
    return 60;
  }

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
  submitButton.querySelector('span:last-child').textContent = isLoading
    ? 'Generating'
    : 'Generate plan';
}

function syncRamadanControls() {
  const disabled = ramadanToggle.checked;
  mealsSelect.disabled = disabled;
  snacksSelect.disabled = disabled;
}

function renderPlan(plan) {
  output.innerHTML = '';
  output.hidden = false;
  emptyState.hidden = true;

  output.append(renderSummary(plan.dailyTargets));
  for (const meal of plan.meals) {
    output.append(renderMeal(meal));
  }
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

function renderMeal(meal) {
  const card = mealTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('h2').textContent = meal.name;
  card.querySelector('.meal-card__meta').textContent = `${meal.items.length} foods`;
  card.querySelector('.meal-target').textContent = `${formatNumber(meal.target.calories)} kcal`;
  card.querySelector('.meal-actual').textContent = `${formatNumber(meal.totals.calories)} kcal`;
  card.querySelector('.meal-macros').textContent =
    `P ${formatNumber(meal.totals.proteinG)}g ${separator} C ${formatNumber(meal.totals.carbG)}g ${separator} F ${formatNumber(meal.totals.fatG)}g`;
  card.querySelector('.approx-badge').hidden = !meal.isApproximate;

  const foodList = card.querySelector('.food-list');
  for (const item of meal.items) {
    foodList.append(renderFoodItem(item));
  }

  return card;
}

function renderFoodItem(item) {
  const food = item.food;
  const row = document.createElement('div');
  row.className = 'food-item';

  const alternatives = item.alternatives
    .map((alternative) => `<span>${formatNumber(item.quantityG)}g ${escapeHtml(alternative.name)}</span>`)
    .join('');

  row.innerHTML = `
    <div class="food-main">
      <div class="food-title">
        <div class="food-name">${escapeHtml(food.name)}</div>
        ${food.nameAr ? `<div class="food-ar">${escapeHtml(food.nameAr)}</div>` : ''}
      </div>
      <div class="food-quantity">${formatNumber(item.quantityG)}g</div>
      <div class="food-macros">
        <strong>${formatNumber(item.totals.calories)} kcal</strong>
        <span>P ${formatNumber(item.totals.proteinG)}g</span>
        <span>C ${formatNumber(item.totals.carbG)}g</span>
        <span>F ${formatNumber(item.totals.fatG)}g</span>
      </div>
    </div>
    ${alternatives ? `<div class="alternatives">${alternatives}</div>` : ''}
  `;

  return row;
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
