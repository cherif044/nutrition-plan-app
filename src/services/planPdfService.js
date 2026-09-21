const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const iconsDir = path.join(__dirname, '..', '..', 'public', 'food-icons');
const imageCache = new Map();
const C = {
  page: '#f4faf7', card: '#ffffff', soft: '#f7faf9', border: '#dce8df',
  ink: '#123832', muted: '#6f7d77', accent: '#1e8c70', protein: '#d97757',
  carbs: '#d4a72c', fat: '#7a74c9',
};

// Direct PDF generation avoids Puppeteer/Chromium cold starts and keeps the
// export independent of the user's device and browser.
async function generatePlanPdf(plan, options = {}) {
  return withTimeout(renderPlanPdf(plan, options), process.env.VERCEL ? 55000 : 30000, 'PDF export timed out.');
}

function renderPlanPdf(record, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true, info: { Title: String(record?.name || 'Nutrition Plan') } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { drawPlan(doc, record, options); doc.end(); } catch (error) { reject(error); }
  });
}

function drawPlan(doc, record, options) {
  const page = { width: 595.28, height: 841.89 };
  const margin = 23;
  const width = page.width - margin * 2;
  const plan = record?.plan_data || {};
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const customer = record?.Customer || record?.customer || null;
  const customName = String(options.clientName || '').trim();
  const clientName = (record?.customer_id && customer?.name) || (!record?.customer_id && customName) || '';
  doc.rect(0, 0, page.width, page.height).fill(C.page);
  let y = margin;
  if (clientName) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(`Client: ${clientName}`, margin, y, { width });
    y += 20;
  }
  for (const meal of meals) {
    const height = mealHeight(meal);
    if (y > margin && y + height > page.height - margin) { doc.addPage({ size: 'A4', margin: 0 }); doc.rect(0, 0, page.width, page.height).fill(C.page); y = margin; }
    drawMeal(doc, meal, margin, y, width);
    y += height + 14;
  }
  if (y + 126 > page.height - margin) { doc.addPage({ size: 'A4', margin: 0 }); doc.rect(0, 0, page.width, page.height).fill(C.page); y = margin; }
  drawSummary(doc, plan.dailyTargets || {}, totalsForMeals(meals), margin, y, width);
}

function mealHeight(meal) { return 42 + 25 + (Array.isArray(meal?.items) ? meal.items.length : 0) * 25 + 29; }

function drawMeal(doc, meal, x, y, width) {
  const items = Array.isArray(meal?.items) ? meal.items : [];
  const totals = normalizeTotals(meal?.totals || totalsForItems(items));
  const height = mealHeight(meal);
  doc.roundedRect(x, y, width, height, 7).fillAndStroke(C.card, C.border);
  doc.rect(x, y, width, 42).fill(C.card);
  drawMealIcon(doc, meal?.tag, x + 12, y + 12);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(String(meal?.name || 'Meal'), x + 39, y + 13, { width: width - 140, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.ink).text(`${fmt(totals.calories)} kcal`, x + width - 92, y + 14, { width: 80, align: 'right' });

  const tableY = y + 42;
  const titleWidth = width - 68 - 4 * 51;
  const columns = [
    { x: x + 10, w: titleWidth, a: 'left', label: 'Food' },
    { x: x + 10 + titleWidth, w: 51, a: 'right', label: 'Portion' },
    { x: x + 10 + titleWidth + 51, w: 51, a: 'right', label: 'Calories' },
    { x: x + 10 + titleWidth + 102, w: 51, a: 'right', label: 'Protein' },
    { x: x + 10 + titleWidth + 153, w: 51, a: 'right', label: 'Carbs' },
    { x: x + 10 + titleWidth + 204, w: 51, a: 'right', label: 'Fat' },
  ];
  doc.rect(x, tableY, width, 25).fill(C.card);
  columns.forEach((col) => doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.muted).text(col.label, col.x, tableY + 9, { width: col.w - 2, align: col.a, lineBreak: false }));
  line(doc, x, tableY + 25, x + width, tableY + 25, 0.7);
  let rowY = tableY + 25;
  for (const item of items) {
    const totalsForRow = normalizeTotals(item?.totals || totalsForItem(item));
    drawFoodIcon(doc, item?.food, x + 10, rowY + 4, 17);
    doc.font('Helvetica').fontSize(7.8).fillColor(C.ink).text(item?.food?.name || item?.customFood?.name || 'Food', x + 32, rowY + 8, { width: titleWidth - 25, height: 12, ellipsis: true, lineBreak: false });
    [ `${fmt(item?.quantityG)}g`, fmt(totalsForRow.calories), `${fmt(totalsForRow.proteinG)}g`, `${fmt(totalsForRow.carbG)}g`, `${fmt(totalsForRow.fatG)}g` ].forEach((value, i) => {
      const col = columns[i + 1];
      doc.font('Helvetica').fontSize(7.5).fillColor(C.ink).text(value, col.x, rowY + 8, { width: col.w - 2, align: 'right', lineBreak: false });
    });
    line(doc, x, rowY + 25, x + width, rowY + 25, 0.45);
    rowY += 25;
  }
  doc.rect(x, rowY, width, 29).fill(C.soft);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.ink).text('Meal totals', x + 10, rowY + 10, { width: titleWidth - 25, lineBreak: false });
  [fmt(totals.calories), `${fmt(totals.proteinG)}g`, `${fmt(totals.carbG)}g`, `${fmt(totals.fatG)}g`].forEach((value, i) => {
    const col = columns[i + 2];
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.ink).text(value, col.x, rowY + 10, { width: col.w - 2, align: 'right', lineBreak: false });
  });
  line(doc, x, rowY, x + width, rowY, 0.7);
}

function drawSummary(doc, targets, actual, x, y, width) {
  doc.roundedRect(x, y, width, 126, 7).fillAndStroke(C.card, C.border);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text('Daily totals', x + 14, y + 14);
  const targetCalories = Number(targets.calories) || 0;
  const ratio = targetCalories > 0 ? clamp(actual.calories / targetCalories, 0, 1.25) : 0;
  drawRing(doc, x + 58, y + 73, 30, ratio);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(fmt(actual.calories), x + 28, y + 67, { width: 60, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor(C.muted).text('kcal', x + 28, y + 81, { width: 60, align: 'center' });
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('Calories', x + 102, y + 61);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(`of ${fmt(targetCalories)} target`, x + 102, y + 73);
  [['Protein', actual.proteinG, targets.proteinG, C.protein], ['Carbs', actual.carbG, targets.carbG, C.carbs], ['Fat', actual.fatG, targets.fatG, C.fat]].forEach(([label, value, target, color], i) => {
    const mx = x + 205 + i * 103;
    const safeTarget = Number(target) || 0;
    const percent = safeTarget > 0 ? clamp(Number(value) / safeTarget, 0, 1.25) : 0;
    doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(label, mx, y + 59);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink).text(`${fmt(value)} / ${fmt(safeTarget)}g`, mx, y + 72);
    doc.roundedRect(mx, y + 92, 88, 5, 2).fill('#e6eee9');
    if (percent) doc.roundedRect(mx, y + 92, 88 * Math.min(percent, 1), 5, 2).fill(color);
  });
}

function drawRing(doc, cx, cy, radius, ratio) {
  doc.circle(cx, cy, radius).lineWidth(6).strokeColor('#e6eee9').stroke();
  if (!ratio) return;
  const end = -Math.PI / 2 + Math.PI * 2 * Math.min(ratio, 1);
  const points = [];
  for (let i = 0; i <= 48; i += 1) { const a = -Math.PI / 2 + (end + Math.PI / 2) * (i / 48); points.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]); }
  doc.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
  doc.lineWidth(6).lineCap('round').strokeColor(C.accent).stroke().lineCap('butt');
}

function drawMealIcon(doc, tag, x, y) {
  const key = String(tag || '').toLowerCase();
  const color = key === 'lunch' ? C.carbs : key === 'dinner' || key === 'iftar' ? C.fat : C.accent;
  doc.circle(x + 9, y + 9, 9).fill(color);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(key === 'dinner' || key === 'iftar' ? 'D' : key === 'lunch' ? 'L' : key === 'snack' ? 'S' : 'B', x + 3, y + 5, { width: 12, align: 'center' });
}

function drawFoodIcon(doc, food, x, y, size) {
  const iconPath = food?.id ? path.join(iconsDir, `${food.id}.png`) : '';
  if (iconPath && fs.existsSync(iconPath)) {
    let image = imageCache.get(iconPath);
    if (!image) { image = fs.readFileSync(iconPath); imageCache.set(iconPath, image); }
    doc.image(image, x, y, { fit: [size, size] });
    return;
  }
  const tone = foodTone(food);
  const color = tone === 'protein' ? C.protein : tone === 'fat' ? C.fat : tone === 'carb' ? C.carbs : C.muted;
  doc.circle(x + size / 2, y + size / 2, size / 2).fill(color);
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text(String(food?.name || 'F').trim().charAt(0).toUpperCase(), x, y + 4, { width: size, align: 'center' });
}

function foodTone(food) {
  const name = `${food?.name || ''} ${food?.category || ''}`;
  if (/milk|yog|cheese|egg|fish|chicken|beef|meat|protein|whey/i.test(name)) return 'protein';
  if (/oil|butter|ghee|tahini|nut|seed|avocado/i.test(name)) return 'fat';
  if (/bread|rice|pasta|oat|potato|fruit|vegetable|bean|lentil/i.test(name)) return 'carb';
  return 'neutral';
}

function line(doc, x1, y1, x2, y2, width) { doc.moveTo(x1, y1).lineTo(x2, y2).strokeColor(C.border).lineWidth(width).stroke(); }
function withTimeout(promise, ms, message) { let id; const timer = new Promise((_, reject) => { id = setTimeout(() => reject(Object.assign(new Error(message), { status: 504 })), ms); }); return Promise.race([promise, timer]).finally(() => clearTimeout(id)); }
function totalsForMeals(meals) { return (meals || []).reduce((a, m) => add(a, normalizeTotals(m.totals || totalsForItems(m.items || []))), zero()); }
function totalsForItems(items) { return (items || []).reduce((a, i) => add(a, normalizeTotals(i?.totals || totalsForItem(i))), zero()); }
function totalsForItem(item) { const food = item?.food || {}; const factor = (Number(item?.quantityG) || 0) / 100; return { calories: (Number(food.caloriesPer100g) || 0) * factor, proteinG: (Number(food.proteinGPer100g) || 0) * factor, carbG: (Number(food.carbGPer100g) || 0) * factor, fatG: (Number(food.fatGPer100g) || 0) * factor }; }
function zero() { return { calories: 0, proteinG: 0, carbG: 0, fatG: 0 }; }
function normalizeTotals(value = {}) { return { calories: Number(value.calories) || 0, proteinG: Number(value.proteinG) || 0, carbG: Number(value.carbG) || 0, fatG: Number(value.fatG) || 0 }; }
function add(a, b) { return { calories: a.calories + b.calories, proteinG: a.proteinG + b.proteinG, carbG: a.carbG + b.carbG, fatG: a.fatG + b.fatG }; }
function fmt(value) { const n = Number(value); if (!Number.isFinite(n)) return '0'; return Math.round(n) === n ? String(n) : n.toFixed(1); }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function pdfFilename(plan) { const base = String(plan?.name || 'nutrition-plan').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'nutrition-plan'; return `${base}.pdf`; }

module.exports = { generatePlanPdf, pdfFilename };
