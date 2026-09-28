const { z } = require('zod');
const { INPUT_LIMITS: L } = require('../config/inputLimits');
const { NUTRITION } = require('../config/nutritionConstants');

// Request schemas. The server assumes every request may be hand-written, so
// each field is bounded here even when the UI could never send it.

const SEX_VALUES = Object.keys(NUTRITION.calorieFloorBySex);
const ACTIVITY_VALUES = Object.keys(NUTRITION.activityMultipliers);
const PROFILE_FIELDS = ['age', 'sex', 'weight', 'weightKg', 'height', 'heightCm', 'activityLevel', 'activity_level'];
const TIMELINE_EVENTS = ['generation_failed', 'plan_shown', 'save_failed', 'save_finished', 'validation_failed'];

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;

function text(label, max, { min = 1 } = {}) {
  return z.string({ error: `${label} must be text.` })
    .transform((value) => value.replace(CONTROL_CHARS, '').trim())
    .pipe(z.string()
      .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
      .max(max, `${label} must be at most ${max} characters.`));
}

function optionalText(label, max) {
  return z.union([z.null(), text(label, max, { min: 0 })]).optional();
}

function number(label, min, max, { integer = false } = {}) {
  let schema = z.number({ error: `${label} must be a number.` })
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);
  if (integer) schema = schema.int(`${label} must be a whole number.`);
  return schema;
}

// Form posts send numbers as strings and blank fields as "". Empty becomes
// null; anything else must parse to a number inside the range.
function optionalFormNumber(label, min, max, options) {
  return z.preprocess((value) => {
    if (value === '' || value === null || value === undefined) return null;
    return typeof value === 'string' ? Number(value.trim()) : value;
  }, z.union([z.null(), number(label, min, max, options)])).optional();
}

const idString = z.union([
  z.string().regex(/^\d{1,18}$/, 'Invalid id.'),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
]);

const nullableId = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.union([z.null(), idString]),
).optional();

const finite = (min, max) => z.number().min(min).max(max);

// Macro targets and windows: generous numeric ranges, extra keys allowed
// (the planner sends its whole target object back).
const minMax = z.looseObject({
  min: finite(-1, 100000).optional(),
  max: finite(-1, 100000).optional(),
});
const macroTarget = z.looseObject({
  calories: finite(0, 10000),
  proteinG: finite(0, 1000),
  carbG: finite(0, 2000).optional(),
  fatG: finite(0, 1000).optional(),
  macroWindows: z.record(z.string().max(40), minMax).optional(),
});
const dailyContext = z.looseObject({
  dailyTargets: z.looseObject({
    calories: finite(0, 20000).optional(),
    proteinG: finite(0, 2000).optional(),
    carbG: finite(0, 4000).optional(),
    fatG: finite(0, 2000).optional(),
  }).nullable().optional(),
  weightKg: z.number().min(0).max(1000).nullable().optional(),
});

// Custom foods are only created by crafted or legacy data today, so they get
// the tightest checks: real food never exceeds ~900 kcal or 100 g of a macro
// per 100 g. Aliases mirror resolveFoodForMealAction in planGenerator.js.
const customFood = z.looseObject({
  name: optionalText('Custom food name', L.customFood.nameLength),
  servingG: finite(1, L.customFood.servingGMax).optional(),
  maxServingG: finite(0, L.customFood.servingGMax).optional(),
}).superRefine((food, ctx) => {
  const servingG = Number(food.servingG ?? 100);
  const pick = (...keys) => {
    const key = keys.find((candidate) => food[candidate] !== undefined && food[candidate] !== null);
    return key === undefined ? 0 : food[key];
  };
  const values = {
    calories: pick('calories', 'caloriesPerServing', 'caloriesPer100g'),
    proteinG: pick('proteinG', 'proteinGPerServing', 'proteinGPer100g'),
    carbG: pick('carbG', 'carbGPerServing', 'carbGPer100g'),
    fatG: pick('fatG', 'fatGPerServing', 'fatGPer100g'),
  };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      ctx.addIssue({ code: 'custom', message: `Custom food ${key} must be a positive number.` });
      return;
    }
    const per100g = (value * 100) / servingG;
    const max = key === 'calories' ? L.customFood.kcalPer100gMax : L.customFood.macroPer100gMax;
    if (per100g > max) {
      ctx.addIssue({ code: 'custom', message: `Custom food ${key} is too high for its serving size.` });
      return;
    }
  }
});

const foodId = z.union([z.string().min(1).max(L.foodIdLength), z.number().int()]);

const mealActionItem = z.looseObject({
  foodId,
  name: optionalText('Food name', L.foodNameLength),
  quantityG: finite(0, L.gramsPerFood).optional(),
  customFood: customFood.nullable().optional(),
});
const mealActionItems = z.array(mealActionItem)
  .max(L.foodsPerMeal, `A meal can have at most ${L.foodsPerMeal} foods.`);

const preferenceList = z.array(text('Preference', L.preferenceTermLength))
  .max(L.preferenceItems, `Choose at most ${L.preferenceItems} foods to avoid.`);

const rebalanceBody = z.looseObject({
  mealTarget: macroTarget,
  items: mealActionItems.min(1, 'A meal needs at least one food.'),
  mealBounds: z.record(z.string().max(40), minMax).nullable().optional(),
  dailyContext,
  action: z.string().max(40).nullable().optional(),
  changedItemIndex: z.number().int().min(0).max(L.foodsPerMeal).nullable().optional(),
});

const swapSuggestionsBody = z.looseObject({
  foodId,
  userPreferences: z.looseObject({
    dietType: z.string().max(20).optional(),
    avoidFoods: preferenceList.optional(),
    dislikes: preferenceList.optional(),
  }).nullable().optional(),
  limit: z.union([z.literal('all'), z.number().int().min(1).max(200)]).nullable().optional(),
  cursor: z.number().int().min(0).max(100000).nullable().optional(),
  mealContext: z.looseObject({
    mealTag: z.string().max(20).optional(),
    itemIndex: z.number().int().min(0).max(L.foodsPerMeal),
    currentItems: mealActionItems,
    mealTarget: macroTarget,
    dailyContext: dailyContext.optional(),
  }).nullable().optional(),
});

const timelineBody = z.object({
  timelineId: z.string().max(128).optional(),
  generationRequestId: z.string().max(128).optional(),
  event: z.enum(TIMELINE_EVENTS),
  elapsedMs: finite(0, 3600000).optional(),
  timings: z.record(z.string().max(40), z.unknown()).optional(),
});

// Saved plans are the planner's own document; only the parts that feed the
// solver, PDF, and dashboard are bounded, the rest is kept as-is.
const savedItem = z.looseObject({
  quantityG: finite(0, L.gramsPerFood).optional(),
  customFood: customFood.nullable().optional(),
});
const savedItems = z.array(savedItem)
  .max(L.foodsPerMeal, `A meal can have at most ${L.foodsPerMeal} foods.`)
  .optional();
const planData = z.looseObject({
  meals: z.array(z.looseObject({
    name: optionalText('Meal name', 80),
    items: savedItems,
    originalItems: savedItems,
    mealOptions: z.array(z.looseObject({ items: savedItems })).max(L.mealOptionsPerMeal).optional(),
  })).max(L.mealsPerPlan).optional(),
}, { error: 'planData must be an object.' });

const customerSelection = z.looseObject({
  id: nullableId,
  name: optionalText('Customer name', L.customerNameLength),
  touchedFields: z.array(z.enum(PROFILE_FIELDS)).max(PROFILE_FIELDS.length).optional(),
}).nullable().optional();

const clientRequestId = z.string().max(128).nullable().optional();

const createPlanBody = z.looseObject({
  name: text('Plan name', L.planNameLength),
  planData,
  folderId: nullableId,
  customer: customerSelection,
  clientRequestId,
});

const updatePlanBody = z.looseObject({
  name: text('Plan name', L.planNameLength).optional(),
  planData: planData.optional(),
  folderId: nullableId,
  customer: customerSelection,
  expectedVersion: z.number().int().min(1).nullable().optional(),
});

const duplicatePlanBody = z.looseObject({
  targetFolderId: nullableId,
  // "<name> (copy)" can run past the plan-name limit; shorten instead of failing.
  newName: z.string().max(500).optional()
    .transform((value) => (value === undefined ? value : value.replace(CONTROL_CHARS, '').trim().slice(0, L.planNameLength))),
});

const folderBody = z.looseObject({
  name: text('Folder name', L.folderNameLength),
  parentId: nullableId,
});

const customerBody = z.looseObject({
  name: text('Customer name', L.customerNameLength),
  age: optionalFormNumber('Age', L.age.min, L.age.max, { integer: true }),
  sex: z.union([z.literal(''), z.null(), z.enum(SEX_VALUES, { error: 'Choose male or female.' })]).optional(),
  weightKg: optionalFormNumber('Weight', L.weightKg.min, L.weightKg.max),
  weight: optionalFormNumber('Weight', L.weightKg.min, L.weightKg.max),
  heightCm: optionalFormNumber('Height', L.heightCm.min, L.heightCm.max),
  height: optionalFormNumber('Height', L.heightCm.min, L.heightCm.max),
  activityLevel: z.union([z.literal(''), z.null(), z.enum(ACTIVITY_VALUES, { error: 'Choose a valid activity level.' })]).optional(),
  activity_level: z.union([z.literal(''), z.null(), z.enum(ACTIVITY_VALUES, { error: 'Choose a valid activity level.' })]).optional(),
});

const sessionBody = z.looseObject({
  idToken: z.string().min(1).max(8192),
  profile: z.looseObject({
    displayName: optionalText('Name', 100),
    firstname: optionalText('First name', L.personNameLength),
    lastname: optionalText('Last name', L.personNameLength),
  }).nullable().optional(),
});

// Query strings are always strings; numbers are validated as digit strings.
const pageParam = z.string().regex(/^\d{1,5}$/, 'Invalid page.')
  .refine((value) => Number(value) >= 1 && Number(value) <= L.maxPage, 'Invalid page.')
  .optional();
const pageSizeParam = z.string().regex(/^\d{1,2}$/, 'Invalid page size.')
  .refine((value) => Number(value) >= 1 && Number(value) <= L.maxPageSize, 'Invalid page size.')
  .optional();
const searchParam = z.string().max(L.searchLength, `Search must be at most ${L.searchLength} characters.`).optional();

const pagedListQuery = z.looseObject({ page: pageParam, pageSize: pageSizeParam, query: searchParam });
const plansListQuery = pagedListQuery.extend({
  calorieRange: z.string().regex(/^\d{1,5}-\d{1,5}$/, 'Invalid calorie range.').optional(),
});
const customersListQuery = z.looseObject({
  query: searchParam,
  limit: z.string().regex(/^\d{1,3}$/, 'Invalid limit.').optional(),
});
const customerMatchQuery = z.looseObject({
  name: z.string().max(L.customerNameLength).optional(),
});
const pdfExportQuery = z.looseObject({
  clientName: z.string().max(L.clientNameLength, `Client name must be at most ${L.clientNameLength} characters.`).optional(),
  id: z.string().regex(/^\d{1,18}$/, 'Invalid plan id.').optional(),
});

module.exports = {
  CONTROL_CHARS,
  TIMELINE_EVENTS,
  createPlanBody,
  customerBody,
  customerMatchQuery,
  customersListQuery,
  duplicatePlanBody,
  folderBody,
  pagedListQuery,
  pdfExportQuery,
  plansListQuery,
  rebalanceBody,
  sessionBody,
  swapSuggestionsBody,
  timelineBody,
  updatePlanBody,
};
