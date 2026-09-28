// Every limit enforced on user input, in one place. The planner and dashboard
// mirror the user-facing ones (see INPUT_LIMITS in public/js/app.js and the
// min/max attributes in the HTML) so people see the limit before the server
// has to reject anything.
const INPUT_LIMITS = Object.freeze({
  weightKg: { min: 30, max: 250 },
  heightCm: { min: 120, max: 230 },
  age: { min: 12, max: 100 },
  bodyFatPercentage: { min: 3, max: 60 },

  foodsPerMeal: 12,
  gramsPerFood: 1000,
  mealsPerPlan: 6,
  // Generated plans carry at most ~34 options per meal (measured across all
  // meal counts, distributions and diets); 60 leaves headroom.
  mealOptionsPerMeal: 60,

  preferenceItems: 60,
  preferenceTermLength: 60,

  planNameLength: 100,
  folderNameLength: 60,
  customerNameLength: 80,
  clientNameLength: 80,
  personNameLength: 50,
  searchLength: 100,
  foodIdLength: 64,
  foodNameLength: 120,

  customFood: {
    nameLength: 80,
    servingGMax: 1000,
    kcalPer100gMax: 900,
    macroPer100gMax: 100,
  },

  maxPage: 10000,
  maxPageSize: 50,

  // Wall-clock budget for the interactive portion search, which runs on the
  // request thread. Normal meals solve in milliseconds; this only stops
  // pathological inputs from freezing the instance.
  rebalanceSearchMs: 2000,
  swapSearchMs: 3000,

  // Per-account totals, checked on every insert. Far above real use; they
  // exist so one account cannot fill the database.
  account: {
    plans: 2000,
    customers: 1000,
    folders: 200,
    folderDepth: 8,
    planDataBytes: 500 * 1024 * 1024,
  },

  defaultBodyBytes: '100kb',
  planBodyBytes: '2mb',
});

module.exports = { INPUT_LIMITS };
