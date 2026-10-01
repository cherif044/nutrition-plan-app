const { z } = require('zod');
const { INPUT_LIMITS: L } = require('../config/inputLimits');
const { MEAL_DISTRIBUTIONS, NUTRITION } = require('../config/nutritionConstants');

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

const foodId = z.union([z.string().min(1).max(L.foodIdLength), z.number().int()]);

const mealActionItem = z.strictObject({
  foodId,
  name: optionalText('Food name', L.foodNameLength),
  quantityG: finite(0, L.gramsPerFood).optional(),
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

const swapSuggestionsBody = z.strictObject({
  foodId,
  userPreferences: z.strictObject({
    avoidFoods: preferenceList.optional(),
  }).nullable().optional(),
  limit: z.union([z.literal('all'), z.number().int().min(1).max(200)]).nullable().optional(),
  cursor: z.number().int().min(0).max(100000).nullable().optional(),
  mealContext: z.strictObject({
    mealTag: z.enum(['breakfast', 'snack', 'lunch', 'dinner', 'main', 'main_meal']),
    itemIndex: z.number().int().min(0).max(L.foodsPerMeal),
    currentItems: mealActionItems,
    mealTarget: macroTarget,
    dailyContext: dailyContext.optional(),
  }),
});

const timelineBody = z.object({
  timelineId: z.string().max(128).optional(),
  generationRequestId: z.string().max(128).optional(),
  event: z.enum(TIMELINE_EVENTS),
  elapsedMs: finite(0, 3600000).optional(),
  // The handler keeps only allowlisted fields; this bounds what is parsed.
  timings: z.record(z.string().max(40), z.union([z.number(), z.string().max(2000), z.boolean(), z.null()]))
    .refine((value) => Object.keys(value).length <= 20, 'Too many timing fields.')
    .optional(),
});

// Saved plans are the planner's own document. Every part that is shown,
// exported, summarised or fed back to the solver has a typed, bounded shape;
// the remaining bookkeeping fields (diagnostics, template metadata) are
// accepted only up to a fixed serialized size, so no key can carry an
// unbounded payload.
const GOAL_VALUES = ['maintain', 'lose_weight', 'gain_weight'];
const DISTRIBUTION_VALUES = Object.keys(MEAL_DISTRIBUTIONS);
const MEAL_TAG_VALUES = ['breakfast', 'snack', 'lunch', 'dinner', 'main', 'main_meal'];

function jsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return Infinity;
  }
}

// Any JSON value, as long as its serialized form stays under maxBytes.
function boundedJson(label, maxBytes) {
  return z.unknown().refine(
    (value) => jsonSize(value) <= maxBytes,
    `${label} is too large.`,
  );
}

const optionalFinite = (min, max) => z.number().min(min).max(max).nullable().optional();
const macroTotals = z.looseObject({
  calories: optionalFinite(0, 20000),
  proteinG: optionalFinite(0, 2000),
  carbG: optionalFinite(0, 4000),
  fatG: optionalFinite(0, 2000),
}).catchall(boundedJson('Totals field', 4 * 1024));

// Saved plans reference catalog foods by id only; names, icons and nutrition
// values are read from the server's catalog, so they can never be forged.
let catalogById;
function catalogFood(id) {
  if (!catalogById) {
    // Lazy: the PDF function loads this module without the food catalog.
    const { loadFoods } = require('../features/planner/foodRepository');
    catalogById = new Map(loadFoods().map((food) => [String(food.id), food]));
  }
  return catalogById.get(String(id));
}

const catalogFoodId = z.union([z.string().max(L.foodIdLength), z.number().int()])
  .transform(String)
  .refine((id) => Boolean(catalogFood(id)), 'Unknown food.');

const savedItem = z.strictObject({
  foodId: catalogFoodId,
  quantityG: finite(0, L.gramsPerFood),
});
const savedItems = z.array(savedItem)
  .max(L.foodsPerMeal, `A meal can have at most ${L.foodsPerMeal} foods.`)
  .optional();

const mealOption = z.looseObject({
  items: savedItems,
  totals: macroTotals.nullable().optional(),
  templateName: optionalText('Meal option name', 120),
}).catchall(boundedJson('Meal option field', 4 * 1024));

const savedMeal = z.looseObject({
  name: optionalText('Meal name', 80),
  tag: z.enum(MEAL_TAG_VALUES).nullable().optional(),
  items: savedItems,
  originalItems: savedItems,
  mealOptions: z.array(mealOption)
    .max(L.mealOptionsPerMeal, `A meal can have at most ${L.mealOptionsPerMeal} options.`)
    .optional(),
  totals: macroTotals.nullable().optional(),
  originalTotals: macroTotals.nullable().optional(),
  target: macroTarget.nullable().optional(),
  seedTarget: boundedJson('Meal target', 16 * 1024).optional(),
}).catchall(boundedJson('Meal field', 16 * 1024));

const blankToNull = (value) => (value === '' || value === undefined ? null : value);
const formNumberField = (label, min, max, options) => optionalFormNumber(label, min, max, options);
const enumField = (values, message) => z.preprocess(
  blankToNull,
  z.enum(values, { error: message }).nullable(),
).optional();
// The planner form as saved with the plan. Form posts send numbers as
// strings; the generator's own echo sends numbers. Both are accepted, within
// the same bounds the customer routes use.
const planInput = z.strictObject({
  weightKg: formNumberField('Weight', L.weightKg.min, L.weightKg.max),
  heightCm: formNumberField('Height', L.heightCm.min, L.heightCm.max),
  age: formNumberField('Age', L.age.min, L.age.max, { integer: true }),
  sex: enumField(SEX_VALUES, 'Choose male or female.'),
  bodyFatPercentage: formNumberField('Body fat', L.bodyFatPercentage.min, L.bodyFatPercentage.max),
  activityLevel: enumField(ACTIVITY_VALUES, 'Choose a valid activity level.'),
  goal: enumField(GOAL_VALUES, 'Choose a valid goal.'),
  mealDistribution: enumField(DISTRIBUTION_VALUES, 'Choose a valid meal distribution.'),
  numberOfMeals: formNumberField('Number of meals', 3, 5, { integer: true }),
  avoidFoods: preferenceList.optional(),
});

const dailyNumbers = z.looseObject({
  calories: optionalFinite(0, 20000),
  proteinG: optionalFinite(0, 2000),
  carbG: optionalFinite(0, 4000),
  fatG: optionalFinite(0, 2000),
}).catchall(boundedJson('Daily target field', 8 * 1024));

const nutritionCalculation = z.record(
  z.string().max(60),
  z.union([z.number().min(-100000).max(100000), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= 40, 'Nutrition calculation has too many fields.');

const PLAN_TOP_LEVEL_EXTRA_BYTES = 64 * 1024;
const planData = z.object({
  input: planInput.optional(),
  manualMode: z.boolean().optional(),
  dailyTargets: dailyNumbers.nullable().optional(),
  dailyActuals: dailyNumbers.nullable().optional(),
  nutritionCalculation: nutritionCalculation.nullable().optional(),
  meals: z.array(savedMeal).max(L.mealsPerPlan, `A plan can have at most ${L.mealsPerPlan} meals.`).optional(),
  diagnostics: boundedJson('Plan diagnostics', PLAN_TOP_LEVEL_EXTRA_BYTES).optional(),
}, { error: 'planData must be an object.' })
  .catchall(boundedJson('Plan field', PLAN_TOP_LEVEL_EXTRA_BYTES))
  .refine((value) => Object.keys(value).length <= 40, 'planData has too many fields.');

// Checked at the route so a malformed request never takes a worker slot;
// the generator still applies its own rules (required fields, combinations).
const generatePlanBody = planInput.extend({
  timelineId: z.string().max(128).optional(),
  generationRequestId: z.string().max(128).optional(),
});

const customerSelection = z.looseObject({
  id: nullableId,
  name: optionalText('Customer name', L.customerNameLength),
  touchedFields: z.array(z.enum(PROFILE_FIELDS)).max(PROFILE_FIELDS.length).optional(),
}).nullable().optional();

const clientRequestId = z.string().max(128).nullable().optional();

const createPlanBody = z.strictObject({
  name: text('Plan name', L.planNameLength),
  planData,
  customer: customerSelection,
  clientRequestId,
});

const updatePlanBody = z.strictObject({
  name: text('Plan name', L.planNameLength).optional(),
  planData: planData.optional(),
  customer: customerSelection,
  expectedVersion: z.number().int().min(1).nullable().optional(),
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

const firebaseIdToken = z.string({ error: 'Firebase ID token is required.' })
  .min(1, 'Firebase ID token is required.')
  .max(8192);

const sessionBody = z.object({
  idToken: firebaseIdToken,
  profile: z.object({
    displayName: optionalText('Name', 100),
    firstname: optionalText('First name', L.personNameLength),
    lastname: optionalText('Last name', L.personNameLength),
  }).optional(),
});

const AUTH_CLIENT_EVENTS = [
  'password_reset_requested', 'password_reset_throttled', 'password_reset_failed',
  'verification_resent', 'verification_throttled',
];
const authClientEventBody = z.object({ event: z.enum(AUTH_CLIENT_EVENTS) });

const deleteAccountBody = z.object({
  idToken: firebaseIdToken,
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm.' }),
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
const pdfExportQuery = z.looseObject({
  clientName: text('Client name', L.clientNameLength, { min: 0 }).optional(),
  id: z.string().regex(/^\d{1,18}$/, 'Invalid plan id.').optional(),
});

module.exports = {
  generatePlanBody,
  planData,
  planInput,
  authClientEventBody,
  CONTROL_CHARS,
  TIMELINE_EVENTS,
  createPlanBody,
  deleteAccountBody,
  customerBody,
  customersListQuery,
  pagedListQuery,
  pdfExportQuery,
  plansListQuery,
  rebalanceBody,
  sessionBody,
  swapSuggestionsBody,
  timelineBody,
  updatePlanBody,
};
