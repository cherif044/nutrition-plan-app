const PDFDocument = require('pdfkit');
const { recordPdfExport } = require('../../utils/metrics');
const { foodIconImage } = require('../../services/foodIcons');
const { CONTROL_CHARS } = require('../../validation/schemas');
const { INPUT_LIMITS } = require('../../config/inputLimits');
const { loadFoods } = require('../planner/foodRepository');

// Saved plans store { foodId, quantityG }; the catalog supplies the food.
let foodsById;
function catalogFoodById(id) {
  if (!foodsById) foodsById = new Map(loadFoods().map((food) => [String(food.id), food]));
  return foodsById.get(String(id)) || null;
}

// Text drawn into the PDF or its metadata: no control or bidi-override
// characters, which could make a name render differently from what was typed.
function pdfText(value, max = 200) {
  return String(value ?? '').replace(CONTROL_CHARS, '').trim().slice(0, max);
}
// Light-theme tokens from public/css/styles.css.
const C = {
  page: '#F3F6FB', surface: '#FFFFFF', border: '#E2E8F2', rowLine: '#EEF1F6', track: '#EDF1F7',
  ink: '#0A0F24', ink2: '#111A40', lime: '#B6F23A', heroMuted: '#A9B3D1',
  text: '#0A0F24', text2: '#465069', text3: '#7A84A0',
  protein: '#3F7A00', carbs: '#B6F23A', fat: '#F2B33D', ringProtein: '#6FAE1E',
  proteinText: '#3F7A00', carbsText: '#557A10', fatText: '#B76E00',
};

// Each meal type gets its own accent from the app palette: a stripe, a soft
// header tint and an ink for the icon and calories.
const MEAL_ACCENTS = {
  breakfast: { stripe: '#F2B33D', soft: '#FEF6E6', ink: '#B76E00' },
  snack: { stripe: '#B6F23A', soft: '#F4FAE6', ink: '#3F6B00' },
  lunch: { stripe: '#3F7A00', soft: '#EDF5E3', ink: '#3F7A00' },
  dinner: { stripe: '#111A40', soft: '#EEF1F8', ink: '#111A40' },
};

const GOAL_LABELS = { maintain: 'Maintain', lose_weight: 'Lose weight', gain_weight: 'Gain weight' };

// The logo symbol from public/img/icons.svg (128x128 tile; the letters are
// drawn at translate(13 82)).
const LOGO_LETTERS = 'M0.256 0 7.616 -34.432H17.472L16.576 -29.056Q18.432 -32 20.864 -33.6Q23.296 -35.2 26.176 -35.2Q30.016 -35.2 32.064 -33.408Q34.112 -31.616 34.624 -28.288V-28.16Q38.464 -35.2 45.184 -35.2Q49.664 -35.2 51.968 -32.768Q54.272 -30.336 54.272 -26.304Q54.272 -24.576 53.888 -22.112Q53.504 -19.648 53.056 -17.728L49.28 0H38.272L42.176 -18.304Q42.432 -19.584 42.688 -20.864Q42.944 -22.144 42.944 -23.424Q42.944 -25.088 42.08 -25.856Q41.216 -26.624 39.744 -26.624Q37.632 -26.624 36.064 -24.608Q34.496 -22.592 33.728 -18.88L29.696 0H19.84L23.872 -18.88Q24.128 -20.032 24.288 -21.28Q24.448 -22.528 24.448 -23.296Q24.448 -26.624 21.12 -26.624Q19.008 -26.624 17.536 -24.608Q16.064 -22.592 15.296 -18.88L11.264 0Z M69.948 0.768Q62.78 0.768 59.42 -2.176Q56.06 -5.12 55.548 -10.816L66.62 -11.2Q66.94 -8.832 68.028 -7.712Q69.116 -6.592 71.356 -6.592Q76.156 -6.592 76.156 -9.6Q76.156 -11.008 75.004 -11.776Q73.852 -12.544 70.268 -13.184Q63.74 -14.336 60.956 -16.704Q58.172 -19.072 58.172 -23.104Q58.172 -28.48 62.076 -31.84Q65.98 -35.2 74.108 -35.2Q81.596 -35.2 85.212 -32.288Q88.828 -29.376 89.404 -23.104L78.396 -22.72Q78.14 -25.472 77.02 -26.656Q75.9 -27.84 73.66 -27.84Q71.612 -27.84 70.524 -26.848Q69.436 -25.856 69.436 -24.128Q69.436 -22.656 70.748 -21.856Q72.06 -21.056 75.26 -20.48Q79.868 -19.648 82.556 -18.432Q85.244 -17.216 86.364 -15.328Q87.484 -13.44 87.484 -10.624Q87.484 -5.12 82.844 -2.176Q78.204 0.768 69.948 0.768Z';

// The meal-* symbols from public/img/icons.svg (16x16 viewBox, stroked).
const MEAL_ICON_PATHS = {
  breakfast: ['M8 1.8v1.4M2.8 4.2l1 1M13.2 4.2l-1 1M1.5 10.5h13M4.5 10.5a3.5 3.5 0 017 0M3.5 13.5h9'],
  snack: ['M8 4.5c-1.2-1-4.5-1.2-4.5 2.6 0 3 2 6.4 3.4 6.4.5 0 .7-.3 1.1-.3s.6.3 1.1.3c1.4 0 3.4-3.4 3.4-6.4 0-3.8-3.3-3.6-4.5-2.6z', 'M8 4.5c0-1.4.7-2.3 1.8-2.6'],
  lunch: ['M1.8 7.5h12.4a6.2 6.2 0 01-12.4 0z', 'M5.5 5.5c0-1 .8-1.5.8-2.5M8.5 5.5c0-1 .8-1.5.8-2.5'],
  dinner: ['M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z'],
};

// Direct PDF generation avoids Puppeteer/Chromium cold starts and keeps the
// export independent of the user's device and browser.
async function generatePlanPdf(plan, options = {}) {
  const startedAt = process.hrtime.bigint();
  try {
    const pdf = await withTimeout(
      renderPlanPdf(plan, options),
      process.env.VERCEL ? 55000 : 30000,
      'PDF export timed out.',
    );
    recordPdfExport({
      outcome: 'success',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      bytes: pdf.length,
    });
    return pdf;
  } catch (error) {
    recordPdfExport({
      outcome: 'error',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
    throw error;
  }
}

function renderPlanPdf(record, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true, info: { Title: pdfText(record?.name, INPUT_LIMITS.planNameLength) || 'Nutrition Plan' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { drawPlan(doc, record, options); doc.end(); } catch (error) { reject(error); }
  });
}

const PAGE = { width: 595.28, height: 841.89 };
// The layout is designed in CSS pixels for a 794px-wide A4 sheet
// (docs/export-design-trial.html); one pixel is 0.75pt.
const PT_PER_PX = PAGE.width / 794;
const MARGIN_X = 34 * PT_PER_PX;
const PX = {
  padTop: 30, padBottom: 24,
  hero: 196, macrosGap: 14, macros: 64, mealsGap: 18,
  mealHead: 50, row: 40, mealGap: 10,
  footer: 44,
};
// Numeric columns (portion, kcal, protein, carbs, fat), equal widths.
const NUMBER_COLUMN_PX = 84;

function drawPlan(doc, record, options) {
  const width = PAGE.width - MARGIN_X * 2;
  const plan = record?.plan_data || {};
  // Saved plans are bounded by the schema, but older rows may not be; the
  // caps keep rendering time bounded either way.
  const meals = (Array.isArray(plan.meals) ? plan.meals : []).slice(0, INPUT_LIMITS.mealsPerPlan);
  const mealsWithItems = meals.map((meal) => ({ meal, items: mealItems(meal) }));
  const customer = record?.Customer || record?.customer || null;
  const customName = pdfText(options.clientName, INPUT_LIMITS.clientNameLength);
  const clientName = pdfText((record?.customer_id && customer?.name) || (!record?.customer_id && customName) || '', INPUT_LIMITS.clientNameLength);
  const planName = pdfText(record?.name, INPUT_LIMITS.planNameLength) || 'Nutrition plan';

  // Everything shares one page: vertical sizes shrink until it fits, while
  // the content keeps the full page width.
  const naturalPx = PX.padTop + PX.hero + PX.macrosGap + PX.macros + PX.mealsGap
    + mealsWithItems.reduce((sum, { items }) => sum + mealHeightPx(items.length), 0)
    + Math.max(0, mealsWithItems.length - 1) * PX.mealGap
    + PX.footer + PX.padBottom;
  const u = PT_PER_PX * Math.min(1, (PAGE.height / PT_PER_PX) / naturalPx);

  const totals = totalsForMeals(meals);
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(C.page);
  let y = PX.padTop * u;
  drawHero(doc, {
    clientName, planName, totals, mealCount: meals.length,
    goal: GOAL_LABELS[record?.goal || plan?.input?.goal] || '',
  }, MARGIN_X, y, width, u);
  y += (PX.hero + PX.macrosGap) * u;
  drawMacroTiles(doc, totals, MARGIN_X, y, width, u);
  y += (PX.macros + PX.mealsGap) * u;
  mealsWithItems.forEach(({ meal, items }) => {
    drawMeal(doc, meal, items, MARGIN_X, y, width, u);
    y += (mealHeightPx(items.length) + PX.mealGap) * u;
  });
  drawFooter(doc, formatDate(record?.created_at), MARGIN_X, PAGE.height - (PX.footer + PX.padBottom) * u, width, u);
  drawWatermark(doc);
}

function mealItems(meal) {
  return (Array.isArray(meal?.items) ? meal.items : [])
    .slice(0, INPUT_LIMITS.foodsPerMeal)
    .map((item) => ({ quantityG: item?.quantityG, food: catalogFoodById(item?.foodId) }));
}
function mealHeightPx(itemCount) { return PX.mealHead + itemCount * PX.row; }

// Calories from each macro, for the ring and the percentages.
function macroCalories(totals) {
  const protein = totals.proteinG * 4;
  const carbs = totals.carbG * 4;
  const fat = totals.fatG * 9;
  return { protein, carbs, fat, all: protein + carbs + fat };
}
function percent(part, all) { return all > 0 ? Math.round((part / all) * 100) : 0; }

// Dark header: the client's name, or the plan's name when there is no client.
function drawHero(doc, { clientName, planName, totals, mealCount, goal }, x, y, width, u) {
  const height = PX.hero * u;
  const right = x + width;
  doc.save();
  doc.roundedRect(x, y, width, height, 22 * u).clip();
  doc.rect(x, y, width, height).fill(doc.linearGradient(x, y, right, y + height).stop(0, C.ink).stop(1, C.ink2));
  const glow = doc.radialGradient(right - width * 0.05, y, 0, right - width * 0.05, y, 280 * u)
    .stop(0, C.lime, 0.26).stop(1, C.lime, 0);
  doc.rect(x, y, width, height).fill(glow);
  doc.restore();

  const left = x + 28 * u;
  const ringSize = 150 * u;
  const textRight = right - 28 * u - ringSize - 24 * u;

  drawLogo(doc, left, y + 24 * u, 24 * u);
  textAt(doc, 'macrospace', left + 33 * u, centerBaseline(y + 36 * u, 14 * u), { size: 14 * u, bold: true, color: '#FFFFFF' });
  textAt(doc, clientName ? 'NUTRITION PLAN PREPARED FOR' : 'YOUR NUTRITION PLAN', left, y + 84 * u, {
    size: 10.5 * u, bold: true, color: C.lime, characterSpacing: 1.6 * u,
  });

  // First word white, the rest lime; long names step down in size, then cut.
  const [first, ...rest] = (clientName || planName).split(/\s+/);
  const titleRuns = (size) => [
    { text: first, size, bold: true, color: '#FFFFFF' },
    ...(rest.length ? [{ text: ` ${rest.join(' ')}`, size, bold: true, color: C.lime }] : []),
  ];
  let titleSize = 44 * u;
  while (titleSize > 26 * u && runsWidth(doc, titleRuns(titleSize)) > textRight - left) titleSize -= u;
  drawRunsLeft(doc, fitRuns(doc, titleRuns(titleSize), textRight - left), left, y + 132 * u);

  const metaMid = y + 160 * u;
  let metaX = left;
  if (goal) {
    const pillWidth = runsWidth(doc, [{ text: goal, size: 11.5 * u, bold: true }]) + 20 * u;
    doc.roundedRect(metaX, metaMid - 10 * u, pillWidth, 20 * u, 10 * u).fill(C.lime);
    textAt(doc, goal, metaX + 10 * u, centerBaseline(metaMid, 11.5 * u), { size: 11.5 * u, bold: true, color: C.ink });
    metaX += pillWidth + 8 * u;
  }
  const meta = [{ text: `${mealCount} ${mealCount === 1 ? 'meal' : 'meals'} a day`, size: 12.5 * u, color: C.heroMuted }];
  if (clientName) meta.unshift({ text: planName, size: 12.5 * u, bold: true, color: '#FFFFFF' }, { text: '  ·  ', size: 12.5 * u, color: C.heroMuted });
  drawRunsLeft(doc, fitRuns(doc, meta, textRight - metaX), metaX, centerBaseline(metaMid, 12.5 * u));

  drawCalorieRing(doc, totals, right - 28 * u - ringSize / 2, y + height / 2, ringSize, u);
}

// Three arcs sized by each macro's share of calories, on a faint track.
function drawCalorieRing(doc, totals, cx, cy, size, u) {
  const radius = size * (50 / 120);
  const stroke = size * (10 / 120);
  doc.save();
  doc.circle(cx, cy, radius).lineWidth(stroke).strokeOpacity(0.08).strokeColor('#FFFFFF').stroke();
  doc.restore();

  const kcal = macroCalories(totals);
  const circumference = 2 * Math.PI * radius;
  let start = -Math.PI / 2;
  [[kcal.protein, C.ringProtein], [kcal.carbs, C.carbs], [kcal.fat, C.fat]].forEach(([value, color]) => {
    const sweep = kcal.all > 0 ? (value / kcal.all) * Math.PI * 2 : 0;
    // A small gap between arcs; round caps take up part of it.
    const gap = Math.min(sweep / 2, ((12 * size) / 120 / circumference) * Math.PI * 2);
    if (sweep - gap > 0.01) {
      const a0 = start + gap / 2;
      const a1 = start + sweep - gap / 2;
      doc.path(`M ${cx + radius * Math.cos(a0)} ${cy + radius * Math.sin(a0)} A ${radius} ${radius} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + radius * Math.cos(a1)} ${cy + radius * Math.sin(a1)}`)
        .lineWidth(stroke).lineCap('round').strokeColor(color).stroke();
    }
    start += sweep;
  });

  textAt(doc, fmtThousands(totals.calories), cx - size / 2, cy + 6 * u, { size: 34 * u, bold: true, color: '#FFFFFF', width: size, align: 'center' });
  textAt(doc, 'KCAL / DAY', cx - size / 2, cy + 22 * u, { size: 10 * u, bold: true, color: C.heroMuted, width: size, align: 'center', characterSpacing: u });
}

function drawMacroTiles(doc, totals, x, y, width, u) {
  const kcal = macroCalories(totals);
  const gap = 12 * u;
  const tileWidth = (width - gap * 2) / 3;
  const height = PX.macros * u;
  [
    ['Protein', totals.proteinG, kcal.protein, C.protein],
    ['Carbs', totals.carbG, kcal.carbs, C.carbs],
    ['Fat', totals.fatG, kcal.fat, C.fat],
  ].forEach(([label, grams, calories, color], i) => {
    const left = x + i * (tileWidth + gap);
    const tileRight = left + tileWidth;
    doc.roundedRect(left, y, tileWidth, height, 14 * u).lineWidth(0.75 * u).fillAndStroke(C.surface, C.border);
    const baseline = y + 32 * u;
    doc.roundedRect(left + 16 * u, baseline - 8 * u, 8 * u, 8 * u, 3 * u).fill(color);
    textAt(doc, label, left + 30 * u, baseline, { size: 11.5 * u, bold: true, color: C.text3 });
    drawRunsRight(doc, [
      { text: fmt(grams), size: 21 * u, bold: true, color: C.text },
      { text: 'g', size: 12 * u, bold: true, color: C.text3 },
      { text: `  ${percent(calories, kcal.all)}%`, size: 11 * u, bold: true, color: C.text3 },
    ], tileRight - 16 * u, baseline);
    const barTop = y + 46 * u;
    const barWidth = tileWidth - 32 * u;
    doc.roundedRect(left + 16 * u, barTop, barWidth, 5 * u, 2.5 * u).fill(C.track);
    const filled = barWidth * (percent(calories, kcal.all) / 100);
    if (filled > 0) doc.roundedRect(left + 16 * u, barTop, Math.max(filled, 5 * u), 5 * u, 2.5 * u).fill(color);
  });
}

function drawMeal(doc, meal, items, x, y, width, u) {
  const totals = normalizeTotals(meal?.totals || totalsForItems(items));
  const accent = MEAL_ACCENTS[String(meal?.tag || '').toLowerCase()] || MEAL_ACCENTS.lunch;
  const height = mealHeightPx(items.length) * u;
  const right = x + width;
  // Columns keep their full-width spacing however far the rows shrink.
  const cols = columnEdges(right - 18 * u, NUMBER_COLUMN_PX * PT_PER_PX);
  const left = x + 18 * u;

  doc.save();
  doc.roundedRect(x, y, width, height, 14 * u).clip();
  doc.rect(x, y, width, height).fill(C.surface);
  doc.rect(x, y, width, PX.mealHead * u).fill(accent.soft);
  doc.rect(x, y, 4 * u, height).fill(accent.stripe);

  // Header: icon and name, then each column's label over the meal's total,
  // so every meal says what its columns are.
  const headMid = y + (PX.mealHead / 2) * u;
  drawMealIcon(doc, meal?.tag, left + 9 * u, headMid, 18 * u, accent.ink);
  textAt(doc, pdfText(meal?.name, 80) || 'Meal', left + 28 * u, centerBaseline(headMid, 14 * u), {
    size: 14 * u, bold: true, width: cols.foodRight - left - 28 * u,
  });
  const labelBaseline = headMid - 4 * u;
  const valueBaseline = headMid + 12 * u;
  [
    ['PORTION', cols.portion, null],
    ['KCAL', cols.calories, [{ text: fmt(totals.calories), size: 12.5 * u, bold: true, color: accent.ink }]],
    ['PROTEIN', cols.protein, [{ text: `${fmt(totals.proteinG)}g`, size: 12.5 * u, bold: true, color: C.proteinText }]],
    ['CARBS', cols.carbs, [{ text: `${fmt(totals.carbG)}g`, size: 12.5 * u, bold: true, color: C.carbsText }]],
    ['FAT', cols.fat, [{ text: `${fmt(totals.fatG)}g`, size: 12.5 * u, bold: true, color: C.fatText }]],
  ].forEach(([label, edge, value]) => {
    drawRunsRight(doc, [{ text: label, size: 9 * u, bold: true, color: C.text3, characterSpacing: 0.7 * u }], edge, labelBaseline);
    if (value) drawRunsRight(doc, value, edge, valueBaseline);
  });

  let rowTop = y + PX.mealHead * u;
  items.forEach((item, i) => {
    if (i > 0) hline(doc, x + 4 * u, right, rowTop, u, C.rowLine);
    const rowTotals = normalizeTotals(item?.totals || totalsForItem(item));
    const mid = rowTop + (PX.row / 2) * u;
    const baseline = centerBaseline(mid, 12.5 * u);
    const iconSize = 28 * u;
    drawFoodIcon(doc, item?.food, left, mid - iconSize / 2, iconSize);
    const nameLeft = left + iconSize + 11 * u;
    const [main, detail] = splitFoodName(pdfText(item?.food?.name, INPUT_LIMITS.foodNameLength) || 'Food');
    drawRunsLeft(doc, fitRuns(doc, [
      { text: main, size: 12.5 * u, bold: true, color: C.text },
      ...(detail ? [{ text: detail, size: 12.5 * u, color: C.text3 }] : []),
    ], cols.foodRight - nameLeft), nameLeft, baseline);
    drawRunsRight(doc, [
      { text: fmt(item?.quantityG), size: 12.5 * u, bold: true, color: C.text },
      { text: 'g', size: 10 * u, bold: true, color: C.text3 },
    ], cols.portion, baseline);
    drawRunsRight(doc, [{ text: fmt(rowTotals.calories), size: 12.5 * u, color: C.text2 }], cols.calories, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.proteinG)}g`, size: 12.5 * u, color: C.proteinText }], cols.protein, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.carbG)}g`, size: 12.5 * u, color: C.carbsText }], cols.carbs, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.fatG)}g`, size: 12.5 * u, color: C.fatText }], cols.fat, baseline);
    rowTop += PX.row * u;
  });
  doc.restore();

  doc.roundedRect(x, y, width, height, 14 * u).lineWidth(0.75 * u).strokeColor(C.border).stroke();
}

// Right text edge of each numeric column, right to left from `right`.
function columnEdges(right, columnWidth) {
  return {
    fat: right,
    carbs: right - columnWidth,
    protein: right - columnWidth * 2,
    calories: right - columnWidth * 3,
    portion: right - columnWidth * 4,
    foodRight: right - columnWidth * 5,
  };
}

// "Chicken breast, skinless, grilled" → bold "Chicken breast", muted ", skinless, grilled".
function splitFoodName(name) {
  const comma = name.indexOf(',');
  return comma < 0 ? [name, ''] : [name.slice(0, comma), name.slice(comma)];
}

function drawFooter(doc, created, x, y, width, u) {
  const top = y + 18 * u;
  hline(doc, x, x + width, top, 0.75 * u, C.border);
  const mid = top + 19 * u;
  drawLogo(doc, x + 4 * u, mid - 8 * u, 16 * u);
  textAt(doc, 'macrospace', x + 27 * u, centerBaseline(mid, 11 * u), { size: 11 * u, bold: true });
  if (created) textAt(doc, `Created ${created}`, x, centerBaseline(mid, 10 * u), { size: 10 * u, bold: true, color: C.text3, width, align: 'center' });
  drawRunsRight(doc, [{ text: 'Page 1 of 1', size: 10 * u, bold: true, color: C.text3 }], x + width - 4 * u, centerBaseline(mid, 10 * u));
}

function drawLogo(doc, x, y, size) {
  doc.save();
  doc.translate(x, y).scale(size / 128);
  doc.roundedRect(0, 0, 128, 128, 30).fill(C.lime);
  doc.translate(13, 82).path(LOGO_LETTERS).fill(C.ink);
  doc.restore();
}

// The logo, large and tilted, drawn last at very low opacity so it shows
// through the cards without getting in the way. The letters are cut out of
// the tile.
function drawWatermark(doc) {
  const size = 460 * PT_PER_PX;
  doc.save();
  doc.translate(PAGE.width / 2, PAGE.height * 0.58).rotate(-14).translate(-size / 2, -size / 2).scale(size / 128);
  doc.translate(13, 82);
  doc.roundedRect(-13, -82, 128, 128, 30);
  doc.path(LOGO_LETTERS);
  doc.fillOpacity(0.035).fill(C.ink, 'even-odd');
  doc.restore();
}

function drawMealIcon(doc, tag, cx, cy, size, color) {
  const key = String(tag || '').toLowerCase();
  const paths = MEAL_ICON_PATHS[key] || MEAL_ICON_PATHS.lunch;
  doc.save();
  doc.translate(cx - size / 2, cy - size / 2).scale(size / 16);
  doc.lineWidth(1.6).lineCap('round').lineJoin('round').strokeColor(color);
  paths.forEach((d) => doc.path(d).stroke());
  doc.restore();
}

function drawFoodIcon(doc, food, x, y, size) {
  const r = size / 2;
  const image = foodIconImage(food?.id);
  doc.circle(x + r, y + r, r).fill('#F6F8FC');
  if (image) {
    doc.save();
    doc.circle(x + r, y + r, r).clip();
    doc.image(image, x, y, { width: size, height: size });
    doc.restore();
  } else {
    const initial = String(food?.name || 'F').trim().charAt(0).toUpperCase();
    textAt(doc, initial, x, centerBaseline(y + r, size * 0.4), { size: size * 0.4, bold: true, color: C.text2, width: size, align: 'center' });
  }
}

// Helvetica's ascender is 718/1000 em; pdfkit places text by the top of it.
const ASCENT = 0.718;
function centerBaseline(mid, size) { return mid + size * ASCENT / 2; }
function fontFor(bold) { return bold ? 'Helvetica-Bold' : 'Helvetica'; }

// One line of text with its baseline at `baseline`, cut with an ellipsis to fit `width`.
function textAt(doc, value, x, baseline, { size, bold = false, color = C.text, width, align = 'left', characterSpacing = 0 }) {
  doc.font(fontFor(bold)).fontSize(size).fillColor(color);
  const text = width && align === 'left' ? fitText(doc, value, width) : value;
  doc.text(text, x, baseline - size * ASCENT, { width, align, lineBreak: false, characterSpacing });
}

function fitText(doc, value, width) {
  if (doc.widthOfString(value) <= width) return value;
  let text = value;
  while (text.length > 1 && doc.widthOfString(`${text}…`) > width) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

function runWidth(doc, run) {
  return doc.font(fontFor(run.bold)).fontSize(run.size).widthOfString(run.text, { characterSpacing: run.characterSpacing || 0 });
}
function runsWidth(doc, runs) { return runs.reduce((sum, run) => sum + runWidth(doc, run), 0); }

// Cuts mixed runs to `width`, trimming from the end and adding an ellipsis.
function fitRuns(doc, runs, width) {
  if (runsWidth(doc, runs) <= width) return runs;
  const out = runs.map((run) => ({ ...run }));
  while (out.length) {
    const last = out[out.length - 1];
    const before = runsWidth(doc, out.slice(0, -1));
    let text = last.text;
    while (text.length > 1 && before + runWidth(doc, { ...last, text: `${text}…` }) > width) text = text.slice(0, -1);
    if (before + runWidth(doc, { ...last, text: `${text}…` }) <= width || out.length === 1) {
      last.text = `${text.trimEnd()}…`;
      return out;
    }
    out.pop();
  }
  return out;
}

function drawRunsAt(doc, runs, x, baseline) {
  for (const run of runs) {
    doc.font(fontFor(run.bold)).fontSize(run.size).fillColor(run.color);
    doc.text(run.text, x, baseline - run.size * ASCENT, { lineBreak: false, characterSpacing: run.characterSpacing || 0 });
    x += runWidth(doc, run);
  }
}
// Mixed-size text (e.g. "60g") sharing one baseline, starting at `left` or ending at `right`.
function drawRunsLeft(doc, runs, left, baseline) { drawRunsAt(doc, runs, left, baseline); }
function drawRunsRight(doc, runs, right, baseline) { drawRunsAt(doc, runs, right - runsWidth(doc, runs), baseline); }

function hline(doc, x1, x2, y, lineWidth, color) { doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lineWidth).strokeColor(color).stroke(); }
function withTimeout(promise, ms, message) { let id; const timer = new Promise((_, reject) => { id = setTimeout(() => reject(Object.assign(new Error(message), { status: 504 })), ms); }); return Promise.race([promise, timer]).finally(() => clearTimeout(id)); }
function totalsForMeals(meals) { return (meals || []).reduce((a, m) => add(a, normalizeTotals(m?.totals || totalsForItems(mealItems(m)))), zero()); }
function totalsForItems(items) { return (items || []).reduce((a, i) => add(a, normalizeTotals(i?.totals || totalsForItem(i))), zero()); }
function totalsForItem(item) { const food = item?.food || {}; const factor = (Number(item?.quantityG) || 0) / 100; return { calories: (Number(food.caloriesPer100g) || 0) * factor, proteinG: (Number(food.proteinGPer100g) || 0) * factor, carbG: (Number(food.carbGPer100g) || 0) * factor, fatG: (Number(food.fatGPer100g) || 0) * factor }; }
function zero() { return { calories: 0, proteinG: 0, carbG: 0, fatG: 0 }; }
function normalizeTotals(value = {}) { return { calories: Number(value.calories) || 0, proteinG: Number(value.proteinG) || 0, carbG: Number(value.carbG) || 0, fatG: Number(value.fatG) || 0 }; }
function add(a, b) { return { calories: a.calories + b.calories, proteinG: a.proteinG + b.proteinG, carbG: a.carbG + b.carbG, fatG: a.fatG + b.fatG }; }
// Whole numbers, as the plan view shows them.
function fmt(value) { const n = Number(value); return Number.isFinite(n) ? String(Math.round(n)) : '0'; }
function pdfFilename(plan) { const base = String(plan?.name || 'nutrition-plan').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'nutrition-plan'; return `${base}.pdf`; }
// Whole numbers with thousands separators, for the headline calories.
function fmtThousands(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0'; }
function formatDate(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; }

module.exports = { generatePlanPdf, pdfFilename };
