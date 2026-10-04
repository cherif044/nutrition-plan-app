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
// Light-theme tokens from public/css/styles.css, so the export looks like the
// plan view with "Show targets" off.
const C = {
  page: '#EEF2FA', surface: '#FFFFFF', subtle: '#F4F6FB', border: '#DCE3EF',
  text: '#0A0F24', text2: '#465069', text3: '#687290',
  mealTile: '#EEF8D8', mealInk: '#3F6B00', ring: '#86BF1F',
  protein: '#3F7A00', carbs: '#B6F23A', fat: '#F2B33D', proteinText: '#3F7A00', fatText: '#B76E00',
};

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
const MARGIN = 23;
// Sizes below are the plan view's CSS pixels; the view is drawn about this
// wide, so one pixel maps onto the page at (content width / VIEW_WIDTH_PX).
const VIEW_WIDTH_PX = 980;
const PX = {
  client: 30, gap: 16,
  mealHeader: 72, tableHead: 38, row: 56, mealTotals: 50,
  summaryPadTop: 20, summaryTitle: 20, summaryGap: 16, summaryBody: 206, summaryPadBottom: 24,
};
const SUMMARY_PX = PX.summaryPadTop + PX.summaryTitle + PX.summaryGap + PX.summaryBody + PX.summaryPadBottom;
// Numeric columns, right to left, as in .food-table's grid.
const COLUMN_PX = { fat: 64, carbs: 76, protein: 76, calories: 84, portion: 110 };

function drawPlan(doc, record, options) {
  const width = PAGE.width - MARGIN * 2;
  const plan = record?.plan_data || {};
  // Saved plans are bounded by the schema, but older rows may not be; the
  // caps keep rendering time bounded either way.
  const meals = (Array.isArray(plan.meals) ? plan.meals : []).slice(0, INPUT_LIMITS.mealsPerPlan);
  const mealsWithItems = meals.map((meal) => ({ meal, items: mealItems(meal) }));
  const customer = record?.Customer || record?.customer || null;
  const customName = pdfText(options.clientName, INPUT_LIMITS.clientNameLength);
  const clientName = (record?.customer_id && customer?.name) || (!record?.customer_id && customName) || '';

  // Everything shares one page: the whole layout shrinks until it fits.
  const naturalPx = (clientName ? PX.client : 0)
    + mealsWithItems.reduce((sum, { items }) => sum + mealHeightPx(items.length) + PX.gap, 0)
    + SUMMARY_PX;
  const u = Math.min(width / VIEW_WIDTH_PX, (PAGE.height - MARGIN * 2) / naturalPx);

  doc.rect(0, 0, PAGE.width, PAGE.height).fill(C.page);
  let y = MARGIN;
  if (clientName) {
    textAt(doc, `Client: ${clientName}`, MARGIN, y + 18 * u, { size: 13 * u, bold: true, width });
    y += PX.client * u;
  }
  for (const { meal, items } of mealsWithItems) {
    drawMeal(doc, meal, items, MARGIN, y, width, u);
    y += (mealHeightPx(items.length) + PX.gap) * u;
  }
  drawSummary(doc, totalsForMeals(meals), MARGIN, y, width, u);
}

function mealItems(meal) {
  return (Array.isArray(meal?.items) ? meal.items : [])
    .slice(0, INPUT_LIMITS.foodsPerMeal)
    .map((item) => ({ quantityG: item?.quantityG, food: catalogFoodById(item?.foodId) }));
}
function mealHeightPx(itemCount) { return PX.mealHeader + PX.tableHead + itemCount * PX.row + PX.mealTotals; }

function drawMeal(doc, meal, items, x, y, width, u) {
  const totals = normalizeTotals(meal?.totals || totalsForItems(items));
  const height = mealHeightPx(items.length) * u;
  const right = x + width;
  // Columns keep their full-width spacing however far the rows shrink.
  const cols = columnEdges(right, width / VIEW_WIDTH_PX);

  doc.save();
  doc.roundedRect(x, y, width, height, 12 * u).clip();
  doc.rect(x, y, width, height).fill(C.surface);

  // Header: icon tile, meal name, kcal pill.
  const headerMid = y + (PX.mealHeader / 2) * u;
  const tile = 40 * u;
  doc.roundedRect(x + 20 * u, headerMid - tile / 2, tile, tile, 11 * u).fill(C.mealTile);
  drawMealIcon(doc, meal?.tag, x + 20 * u + tile / 2, headerMid, 19 * u);
  const pill = [
    { text: fmt(totals.calories), size: 14 * u, bold: true, color: C.text },
    { text: ' kcal', size: 12 * u, color: C.text3 },
  ];
  const pillWidth = runsWidth(doc, pill) + 22 * u;
  const pillLeft = right - 20 * u - pillWidth;
  doc.roundedRect(pillLeft, headerMid - 15 * u, pillWidth, 30 * u, 15 * u).fillAndStroke(C.subtle, C.border);
  doc.lineWidth(u);
  drawRunsRight(doc, pill, right - 31 * u, centerBaseline(headerMid, 14 * u));
  const titleLeft = x + 20 * u + tile + 14 * u;
  textAt(doc, pdfText(meal?.name, 80) || 'Meal', titleLeft, centerBaseline(headerMid, 15 * u), {
    size: 15 * u, bold: true, width: pillLeft - titleLeft - 14 * u,
  });
  let rowTop = y + PX.mealHeader * u;
  hline(doc, x, right, rowTop, u);

  // Column labels.
  doc.rect(x, rowTop, width, PX.tableHead * u).fill(C.subtle);
  const headBaseline = centerBaseline(rowTop + (PX.tableHead / 2) * u, 12 * u);
  textAt(doc, 'Food', x + 20 * u, headBaseline, { size: 12 * u, color: C.text3 });
  [['Portion', cols.portion], ['Calories', cols.calories], ['Protein', cols.protein], ['Carbs', cols.carbs], ['Fat', cols.fat]]
    .forEach(([label, edge]) => drawRunsRight(doc, [{ text: label, size: 12 * u, color: C.text3 }], edge, headBaseline));
  rowTop += PX.tableHead * u;
  hline(doc, x, right, rowTop, u);

  for (const item of items) {
    const rowTotals = normalizeTotals(item?.totals || totalsForItem(item));
    const mid = rowTop + (PX.row / 2) * u;
    const baseline = centerBaseline(mid, 14 * u);
    const iconSize = 34 * u;
    drawFoodIcon(doc, item?.food, x + 20 * u, mid - iconSize / 2, iconSize, u);
    const nameLeft = x + 20 * u + iconSize + 12 * u;
    textAt(doc, pdfText(item?.food?.name, INPUT_LIMITS.foodNameLength) || 'Food', nameLeft, baseline, {
      size: 14 * u, width: cols.foodRight - nameLeft,
    });
    drawRunsRight(doc, [
      { text: fmt(item?.quantityG), size: 14 * u, bold: true, color: C.text },
      { text: ' g', size: 12 * u, color: C.text3 },
    ], cols.portion, baseline);
    drawRunsRight(doc, [{ text: fmt(rowTotals.calories), size: 14 * u, color: C.text }], cols.calories, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.proteinG)}g`, size: 14 * u, color: C.proteinText }], cols.protein, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.carbG)}g`, size: 14 * u, color: C.text2 }], cols.carbs, baseline);
    drawRunsRight(doc, [{ text: `${fmt(rowTotals.fatG)}g`, size: 14 * u, color: C.fatText }], cols.fat, baseline);
    rowTop += PX.row * u;
    hline(doc, x, right, rowTop, u);
  }

  // Meal totals.
  doc.rect(x, rowTop, width, PX.mealTotals * u).fill(C.subtle);
  const totalsBaseline = centerBaseline(rowTop + (PX.mealTotals / 2) * u, 15 * u);
  textAt(doc, 'Meal totals', x + 20 * u, centerBaseline(rowTop + (PX.mealTotals / 2) * u, 12 * u), { size: 12 * u, color: C.text3 });
  drawRunsRight(doc, [
    { text: fmt(totals.calories), size: 15 * u, bold: true, color: C.text },
    { text: ' kcal', size: 12 * u, color: C.text3 },
  ], cols.calories, totalsBaseline);
  drawRunsRight(doc, [{ text: `${fmt(totals.proteinG)}g`, size: 15 * u, bold: true, color: C.proteinText }], cols.protein, totalsBaseline);
  drawRunsRight(doc, [{ text: `${fmt(totals.carbG)}g`, size: 15 * u, bold: true, color: C.text }], cols.carbs, totalsBaseline);
  drawRunsRight(doc, [{ text: `${fmt(totals.fatG)}g`, size: 15 * u, bold: true, color: C.fatText }], cols.fat, totalsBaseline);
  doc.restore();

  doc.roundedRect(x, y, width, height, 12 * u).lineWidth(u).strokeColor(C.border).stroke();
}

// Right text edge of each numeric column (cells have 10px side padding).
function columnEdges(right, k) {
  const fatLeft = right - COLUMN_PX.fat * k;
  const carbsLeft = fatLeft - COLUMN_PX.carbs * k;
  const proteinLeft = carbsLeft - COLUMN_PX.protein * k;
  const caloriesLeft = proteinLeft - COLUMN_PX.calories * k;
  const portionLeft = caloriesLeft - COLUMN_PX.portion * k;
  return {
    fat: right - 10 * k,
    carbs: fatLeft - 10 * k,
    protein: carbsLeft - 10 * k,
    calories: proteinLeft - 10 * k,
    portion: caloriesLeft - 10 * k,
    foodRight: portionLeft - 10 * k,
  };
}

function drawSummary(doc, actual, x, y, width, u) {
  const height = SUMMARY_PX * u;
  doc.roundedRect(x, y, width, height, 12 * u).lineWidth(u).fillAndStroke(C.surface, C.border);
  textAt(doc, 'Daily totals', x + 24 * u, centerBaseline(y + (PX.summaryPadTop + PX.summaryTitle / 2) * u, 15 * u), { size: 15 * u, bold: true });

  const bodyTop = y + (PX.summaryPadTop + PX.summaryTitle + PX.summaryGap) * u;
  const bodyHeight = PX.summaryBody * u;

  // Calorie ring: always full while targets are hidden.
  const ringSize = 148 * u;
  const captionGap = 10 * u;
  const captionSize = 13 * u;
  const blockTop = bodyTop + (bodyHeight - (ringSize + captionGap + captionSize * 1.35)) / 2;
  const cx = x + 24 * u + (168 * u) / 2;
  const cy = blockTop + ringSize / 2;
  doc.circle(cx, cy, ringSize * (52 / 120)).lineWidth(ringSize * (10 / 120)).strokeColor(C.ring).stroke();
  const numberSize = 32 * u;
  const unitSize = 12 * u;
  const numberBaseline = cy + (numberSize * 0.718 - (4 * u + unitSize * 0.718)) / 2;
  textAt(doc, fmt(actual.calories), cx - ringSize / 2, numberBaseline, { size: numberSize, bold: true, width: ringSize, align: 'center' });
  textAt(doc, 'kcal', cx - ringSize / 2, numberBaseline + 4 * u + unitSize * 0.95, { size: unitSize, color: C.text3, width: ringSize, align: 'center' });
  textAt(doc, 'Calories', cx - ringSize / 2, blockTop + ringSize + captionGap + captionSize, { size: captionSize, bold: true, width: ringSize, align: 'center' });

  // Macro bars.
  const barsLeft = x + 24 * u + 168 * u + 28 * u;
  const barsWidth = x + width - 24 * u - barsLeft;
  const boxGap = 10 * u;
  const boxHeight = (bodyHeight - boxGap * 2) / 3;
  [['Protein', actual.proteinG, C.protein], ['Carbs', actual.carbG, C.carbs], ['Fat', actual.fatG, C.fat]].forEach(([label, value, color], i) => {
    const top = bodyTop + i * (boxHeight + boxGap);
    doc.roundedRect(barsLeft, top, barsWidth, boxHeight, 10 * u).lineWidth(u).fillAndStroke(C.subtle, C.border);
    const labelMid = top + 12 * u + 9 * u;
    doc.roundedRect(barsLeft + 16 * u, labelMid - 4.5 * u, 9 * u, 9 * u, 3 * u).fill(color);
    textAt(doc, label, barsLeft + 16 * u + 17 * u, centerBaseline(labelMid, 13 * u), { size: 13 * u, color: C.text2 });
    drawRunsRight(doc, [{ text: fmt(value), size: 13 * u, bold: true, color: C.text }], barsLeft + barsWidth - 16 * u, centerBaseline(labelMid, 13 * u));
    doc.roundedRect(barsLeft + 16 * u, top + boxHeight - 12 * u - 8 * u, barsWidth - 32 * u, 8 * u, 4 * u).fill(color);
  });
}

function drawMealIcon(doc, tag, cx, cy, size) {
  const key = String(tag || '').toLowerCase();
  const paths = MEAL_ICON_PATHS[key] || MEAL_ICON_PATHS.lunch;
  doc.save();
  doc.translate(cx - size / 2, cy - size / 2).scale(size / 16);
  doc.lineWidth(1.5).lineCap('round').lineJoin('round').strokeColor(C.mealInk);
  paths.forEach((d) => doc.path(d).stroke());
  doc.restore();
}

function drawFoodIcon(doc, food, x, y, size, u) {
  const r = size / 2;
  const image = foodIconImage(food?.id);
  doc.circle(x + r, y + r, r).fill(C.subtle);
  if (image) {
    doc.save();
    doc.circle(x + r, y + r, r).clip();
    doc.image(image, x, y, { width: size, height: size });
    doc.restore();
  } else {
    const initial = String(food?.name || 'F').trim().charAt(0).toUpperCase();
    textAt(doc, initial, x, centerBaseline(y + r, size * 0.4), { size: size * 0.4, bold: true, color: C.text2, width: size, align: 'center' });
  }
  doc.circle(x + r, y + r, r).lineWidth(u).strokeColor(C.border).stroke();
}

// Helvetica's ascender is 718/1000 em; pdfkit places text by the top of it.
const ASCENT = 0.718;
function centerBaseline(mid, size) { return mid + size * ASCENT / 2; }
function fontFor(bold) { return bold ? 'Helvetica-Bold' : 'Helvetica'; }

// One line of text with its baseline at `baseline`, cut with an ellipsis to fit `width`.
function textAt(doc, value, x, baseline, { size, bold = false, color = C.text, width, align = 'left' }) {
  doc.font(fontFor(bold)).fontSize(size).fillColor(color);
  const text = width && align === 'left' ? fitText(doc, value, width) : value;
  doc.text(text, x, baseline - size * ASCENT, { width, align, lineBreak: false });
}

function fitText(doc, value, width) {
  if (doc.widthOfString(value) <= width) return value;
  let text = value;
  while (text.length > 1 && doc.widthOfString(`${text}…`) > width) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

function runsWidth(doc, runs) {
  return runs.reduce((sum, run) => sum + doc.font(fontFor(run.bold)).fontSize(run.size).widthOfString(run.text), 0);
}

// Mixed-size text (e.g. "527 kcal") ending at `right`, sharing one baseline.
function drawRunsRight(doc, runs, right, baseline) {
  let x = right - runsWidth(doc, runs);
  for (const run of runs) {
    doc.font(fontFor(run.bold)).fontSize(run.size).fillColor(run.color);
    doc.text(run.text, x, baseline - run.size * ASCENT, { lineBreak: false });
    x += doc.widthOfString(run.text);
  }
}

function hline(doc, x1, x2, y, u) { doc.moveTo(x1, y).lineTo(x2, y).lineWidth(u).strokeColor(C.border).stroke(); }
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

module.exports = { generatePlanPdf, pdfFilename };
