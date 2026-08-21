const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', '..', 'public');
const iconsDir = path.join(__dirname, '..', '..', 'icons');
const appCss = fs.readFileSync(path.join(publicDir, 'css', 'styles.css'), 'utf8');

let browserPromise = null;

async function generatePlanPdf(plan) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1180, height: 1600, deviceScaleFactor: 1 });
    await page.setContent(renderPlanExportHtml(plan), {
      waitUntil: ['load', 'networkidle0'],
      timeout: 30000,
    });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

async function launchBrowser() {
  if (process.env.VERCEL) {
    const chromiumModule = require('@sparticuz/chromium');
    const chromium = chromiumModule.default || chromiumModule;
    const puppeteer = require('puppeteer-core');
    const headless = 'shell';
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless }),
      defaultViewport: {
        deviceScaleFactor: 1,
        hasTouch: false,
        height: 1600,
        isLandscape: false,
        isMobile: false,
        width: 1180,
      },
      executablePath: await chromium.executablePath(),
      headless,
    });
  }

  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

function renderPlanExportHtml(planRecord) {
  const plan = planRecord?.plan_data || {};
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const actual = totalsForMeals(meals);
  const summary = renderSummary(plan.dailyTargets || {}, actual);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(planRecord?.name || 'Nutrition Plan')}</title>
    <style>${appCss}</style>
    <style>${exportCss()}</style>
  </head>
  <body class="pdf-export-document is-plan-view is-pdf-export">
    <main class="app-shell">
      <section class="workspace">
        <section class="results" id="plan-output">
          ${meals.map(renderMealCard).join('')}
          ${summary}
        </section>
      </section>
    </main>
  </body>
</html>`;
}

function renderMealCard(meal, mealIndex) {
  const items = Array.isArray(meal.items) ? meal.items : [];
  const totals = normalizeTotals(meal.totals || totalsForItems(items));
  return `
    <article class="meal-card panel" data-meal-index="${mealIndex}" data-meal-type="${escapeHtml(mealTypeKey(meal.tag))}">
      <div class="meal-card__header">
        <span class="meal-card__icon" aria-hidden="true">${iconSvg(mealIconName(meal.tag), 20)}</span>
        <div>
          <div class="meal-card__title-line">
            <h2>${escapeHtml(meal.name || 'Meal')}</h2>
          </div>
        </div>
        <span class="meal-card__kcal"><b>${formatNumber(totals.calories)}</b> kcal</span>
        <div class="meal-card__actions"></div>
      </div>
      <div class="food-table">
        <div class="food-list-head">
          <span class="food-col-title">Food</span>
          <span class="food-cell food-cell--portion">Portion</span>
          <span class="food-cell food-cell--cal">Calories</span>
          <span class="food-cell food-cell--protein">Protein</span>
          <span class="food-cell food-cell--carb">Carbs</span>
          <span class="food-cell food-cell--fat">Fat</span>
          <span class="food-actions-spacer" aria-hidden="true"></span>
        </div>
        <div class="food-list">
          ${items.map(renderFoodRow).join('')}
        </div>
        <div class="meal-card__totals">
          <span class="food-col-title meal-card__totals-label">Meal totals</span>
          <span class="food-cell food-cell--portion"></span>
          <span class="food-cell food-cell--cal meal-metric"><strong>${formatNumber(totals.calories)}</strong></span>
          <span class="food-cell food-cell--protein meal-metric"><strong>${formatNumber(totals.proteinG)}</strong></span>
          <span class="food-cell food-cell--carb meal-metric"><strong>${formatNumber(totals.carbG)}</strong></span>
          <span class="food-cell food-cell--fat meal-metric"><strong>${formatNumber(totals.fatG)}</strong></span>
          <span class="food-actions-spacer" aria-hidden="true"></span>
        </div>
      </div>
    </article>`;
}

function renderFoodRow(item) {
  const food = item?.food || {};
  const totals = normalizeTotals(item?.totals || totalsForItem(item));
  return `
    <div class="food-item">
      <div class="food-title">
        ${foodMedia(food)}
        <span class="food-name">${escapeHtml(food.name || item?.customFood?.name || 'Food')}</span>
        <button class="produce-cycle-btn" type="button" hidden aria-hidden="true"></button>
      </div>
      <div class="food-cell food-cell--portion">${formatNumber(item?.quantityG)}g</div>
      <div class="food-cell food-cell--cal">${formatNumber(totals.calories)}</div>
      <div class="food-cell food-cell--protein">${formatNumber(totals.proteinG)}g</div>
      <div class="food-cell food-cell--carb">${formatNumber(totals.carbG)}g</div>
      <div class="food-cell food-cell--fat">${formatNumber(totals.fatG)}g</div>
      <div class="food-actions"></div>
    </div>`;
}

function renderSummary(targets, actual) {
  const calorieTarget = Number(targets.calories) || 0;
  const circumference = 326.7;
  const caloriePercent = calorieTarget > 0 ? clamp(actual.calories / calorieTarget, 0, 1.25) : 0;
  const dashOffset = circumference * (1 - Math.min(caloriePercent, 1));

  return `
    <section class="summary panel">
      <header class="summary__header">
        <h2>Daily totals</h2>
      </header>
      <div class="metrics">
        <div class="metric metric--ring" data-metric="calories">
          <div class="cal-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="cal-ring__track" cx="60" cy="60" r="52"></circle>
              <circle class="cal-ring__value" cx="60" cy="60" r="52"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${dashOffset.toFixed(1)}"></circle>
            </svg>
            <div class="cal-ring__center">
              <strong class="daily-actual daily-actual-calories">${formatNumber(actual.calories)}</strong>
              <span class="cal-ring__unit">kcal</span>
            </div>
          </div>
          <div class="cal-ring__caption">
            <span>Calories</span>
            <b>of ${formatNumber(targets.calories)} target</b>
          </div>
          <div class="flag-detail"></div>
        </div>
        <div class="macro-bars">
          ${['proteinG', 'carbG', 'fatG'].map((key) => renderMacroMetric(key, targets, actual)).join('')}
        </div>
      </div>
    </section>`;
}

function renderMacroMetric(key, targets, actual) {
  const target = Number(targets[key]) || 0;
  const value = Number(actual[key]) || 0;
  const width = target > 0 ? clamp(value / target * 100, 0, 125) : 0;
  const label = labels[key][0];
  const unit = labels[key][1];
  return `
    <div class="metric metric--macro" data-metric="${key}">
      <div class="metric__top">
        <span><i class="macro-dot" aria-hidden="true"></i>${label}</span>
        <strong>
          <span class="daily-actual daily-actual-${key}">${formatNumber(value)}</span>
          <small>/ ${formatNumber(target)}${unit}</small>
        </strong>
      </div>
      <div class="metric-bar" aria-hidden="true"><i style="width: ${width.toFixed(1)}%"></i></div>
      <div class="flag-detail"></div>
    </div>`;
}

const labels = {
  calories: ['Calories', 'kcal'],
  proteinG: ['Protein', 'g'],
  carbG: ['Carbs', 'g'],
  fatG: ['Fat', 'g'],
};

function exportCss() {
  return `
    @page { size: A4; margin: 0; }
    html, body { background: #f4faf7 !important; }
    body.pdf-export-document {
      padding: 8mm !important;
      min-height: auto !important;
    }
    body.pdf-export-document::before,
    body.pdf-export-document::after {
      display: none !important;
    }
    body.pdf-export-document .app-shell,
    body.pdf-export-document .workspace,
    body.pdf-export-document .results,
    body.pdf-export-document #plan-output {
      display: grid !important;
      width: 100% !important;
      max-width: 1040px !important;
      margin: 0 auto !important;
      padding: 0 !important;
      gap: 14px !important;
    }
    body.pdf-export-document .summary {
      order: 99;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    body.pdf-export-document .meal-card {
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 0 !important;
      overflow: hidden !important;
      animation: none !important;
      box-shadow: 0 3px 10px rgba(26, 44, 33, 0.12) !important;
    }
    body.pdf-export-document .meal-card__actions,
    body.pdf-export-document .meal-card__ranges,
    body.pdf-export-document .summary__ranges,
    body.pdf-export-document .metric-range,
    body.pdf-export-document .meal-add-tray,
    body.pdf-export-document .meal-action-panel,
    body.pdf-export-document .produce-cycle-btn,
    body.pdf-export-document .food-actions,
    body.pdf-export-document .food-actions-spacer {
      display: none !important;
    }
    body.pdf-export-document .food-table {
      overflow: visible !important;
      --col-portion: 68px;
      --col-macro: 62px;
      --col-actions: 0px;
    }
    body.pdf-export-document .food-list-head,
    body.pdf-export-document .food-item,
    body.pdf-export-document .meal-card__totals {
      min-width: 0 !important;
      grid-template-columns: minmax(180px, 1fr) var(--col-portion) repeat(4, var(--col-macro)) !important;
      grid-template-areas: "title portion cal prot carb fat" !important;
    }
    body.pdf-export-document .food-icon {
      overflow: hidden;
      border-radius: 999px !important;
    }
    body.pdf-export-document .food-icon img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    body.pdf-export-document .cal-ring__value {
      transform: rotate(-90deg);
      transform-origin: 50% 50%;
    }
  `;
}

function totalsForMeals(meals) {
  return (meals || []).reduce((acc, meal) => addTotals(acc, normalizeTotals(meal.totals || totalsForItems(meal.items || []))), zeroTotals());
}

function totalsForItems(items) {
  return (items || []).reduce((acc, item) => addTotals(acc, normalizeTotals(item?.totals || totalsForItem(item))), zeroTotals());
}

function totalsForItem(item) {
  const food = item?.food || {};
  const factor = (Number(item?.quantityG) || 0) / 100;
  return {
    calories: (Number(food.caloriesPer100g) || 0) * factor,
    proteinG: (Number(food.proteinGPer100g) || 0) * factor,
    carbG: (Number(food.carbGPer100g) || 0) * factor,
    fatG: (Number(food.fatGPer100g) || 0) * factor,
  };
}

function zeroTotals() {
  return { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
}

function normalizeTotals(totals = {}) {
  return {
    calories: Number(totals.calories) || 0,
    proteinG: Number(totals.proteinG) || 0,
    carbG: Number(totals.carbG) || 0,
    fatG: Number(totals.fatG) || 0,
  };
}

function addTotals(left, right) {
  return {
    calories: left.calories + right.calories,
    proteinG: left.proteinG + right.proteinG,
    carbG: left.carbG + right.carbG,
    fatG: left.fatG + right.fatG,
  };
}

function foodMedia(food) {
  const iconPath = food?.id ? path.join(iconsDir, `${food.id}.png`) : '';
  if (iconPath && fs.existsSync(iconPath)) {
    const dataUrl = imageDataUrl(iconPath);
    return `<span class="food-icon food-icon--image" aria-hidden="true"><img src="${dataUrl}" alt="" /></span>`;
  }
  const { icon, tone } = foodIcon(food);
  return `<span class="food-icon" data-tone="${tone}" aria-hidden="true">${iconSvg(icon, 15)}</span>`;
}

function imageDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function foodIcon(food) {
  const name = `${food?.name || ''} ${food?.category || ''}`;
  const rules = [
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
  for (const [pattern, icon, tone] of rules) {
    if (pattern.test(name)) return { icon, tone };
  }
  return { icon: 'salad', tone: 'neutral' };
}

function iconSvg(name, size = 16) {
  const icons = {
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
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.salad}</svg>`;
}

function mealIconName(tag) {
  const icons = { breakfast: 'sunrise', suhoor: 'sunrise', snack: 'apple', lunch: 'sun', dinner: 'moon', iftar: 'moon' };
  return icons[String(tag || '').toLowerCase()] || 'salad';
}

function mealTypeKey(tag) {
  const key = String(tag || '').toLowerCase();
  if (key === 'suhoor') return 'breakfast';
  if (key === 'iftar') return 'dinner';
  return ['breakfast', 'snack', 'lunch', 'dinner'].includes(key) ? key : 'other';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Math.round(number) === number ? String(number) : number.toFixed(1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pdfFilename(plan) {
  const base = String(plan?.name || 'nutrition-plan')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'nutrition-plan';
  return `${base}.pdf`;
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

module.exports = {
  generatePlanPdf,
  pdfFilename,
};
