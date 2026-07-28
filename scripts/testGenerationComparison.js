const { generatePlan } = require('../src/services/planGenerator');

const baseInput = {
  weightKg: 80,
  heightCm: 175,
  age: 30,
  sex: 'male',
  bodyFatPercentage: 20,
  activityLevel: 'light',
  goal: 'maintain',
  weeklyWeightLossPercent: 0.75,
  gainSurplusCalories: 250,
  proteinPerKg: 2,
  fatPerKg: 0.7,
  numberOfMeals: 3,
  mealDistribution: 'balanced',
  dietType: 'standard',
  milkType: 'skimmed',
  coffeesPerDay: 1,
  allergies: [],
  dislikes: [],
  avoidFoods: [],
};

const profiles = [
  profile('standard diet, 3 meals', {}),
  profile('standard diet, 4 meals with snack', { numberOfMeals: 4 }),
  profile('vegetarian', { dietType: 'vegetarian' }),
  profile('vegan', { dietType: 'vegan' }),
  profile('dairy allergy', { allergies: ['dairy'] }),
  profile('gluten allergy', { allergies: ['gluten'] }),
  profile('seafood allergy', { allergies: ['seafood'] }),
  profile('dislikes chicken', { dislikes: ['chicken'] }),
  profile('dislikes rice', { dislikes: ['rice'] }),
  profile('high protein target', { weightKg: 110, activityLevel: 'physical_job' }),
  profile('weight loss target', { goal: 'lose_weight', activityLevel: 'light' }),
  profile('weight gain target', { goal: 'gain_weight', activityLevel: 'moderate' }),
];

const reports = profiles.map((testProfile) => {
  const before = runPlan(testProfile.input, true);
  const after = runPlan(testProfile.input, false);

  return {
    profileName: testProfile.name,
    beforePossible: before.possible,
    afterPossible: after.possible,
    beforeFailedMeals: before.failedMeals,
    afterFailedMeals: after.failedMeals,
    templatesUsedBefore: before.templatesUsed,
    templatesUsedAfter: after.templatesUsed,
    swapsUsedAfter: after.swapsUsed,
    approximateMealsAfter: after.approximateMeals,
    errorsBefore: before.errors,
    errorsAfter: after.errors,
  };
});

const summary = {
  profilesRun: reports.length,
  beforeSuccessCount: reports.filter((report) => report.beforePossible).length,
  afterSuccessCount: reports.filter((report) => report.afterPossible).length,
  beforeFailedMealCount: reports.reduce((sum, report) => sum + report.beforeFailedMeals.length, 0),
  afterFailedMealCount: reports.reduce((sum, report) => sum + report.afterFailedMeals.length, 0),
  swapsUsedAfter: reports.reduce((sum, report) => sum + report.swapsUsedAfter, 0),
  approximateMealsAfter: reports.reduce((sum, report) => sum + report.approximateMealsAfter, 0),
};

console.log(JSON.stringify({ summary, reports }, null, 2));

function profile(name, overrides) {
  return {
    name,
    input: { ...baseInput, ...overrides },
  };
}

function runPlan(input, disableSwaps) {
  const previous = process.env.DISABLE_MEAL_TEMPLATE_SWAPS;
  process.env.DISABLE_MEAL_TEMPLATE_SWAPS = disableSwaps ? 'true' : 'false';

  try {
    const plan = generatePlan(input);
    return summarizePlan(plan);
  } catch (error) {
    return {
      possible: false,
      failedMeals: [],
      templatesUsed: [],
      swapsUsed: 0,
      approximateMeals: 0,
      errors: [error.message],
    };
  } finally {
    if (previous === undefined) {
      delete process.env.DISABLE_MEAL_TEMPLATE_SWAPS;
    } else {
      process.env.DISABLE_MEAL_TEMPLATE_SWAPS = previous;
    }
  }
}

function summarizePlan(plan) {
  const errors = plan.errors ?? plan.diagnostics?.errors ?? [];
  const templatesUsed = unique(
    plan.meals
      .map((meal) => meal.templateId || meal.templateName)
      .filter(Boolean),
  );
  return {
    possible: errors.length === 0,
    failedMeals: plan.meals
      .filter((meal) => meal.items.length === 0)
      .map((meal) => meal.name),
    templatesUsed,
    swapsUsed: plan.meals.reduce((sum, meal) => sum + Number(meal.numberOfSwaps || 0), 0),
    approximateMeals: plan.meals.filter((meal) => meal.isApproximate).length,
    errors,
  };
}

function unique(values) {
  return [...new Set(values)];
}
