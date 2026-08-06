const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { loadFoods } = require('../src/repositories/foodRepository');
const { loadReadyMealBundles } = require('../src/repositories/readyMealRepository');
const {
  generatePlan,
  generateAlternateMealOptions,
  validateMealSwap,
} = require('../src/services/planGenerator');
const { NUTRITION, macrosForFoodPortion, sumTargets } = require('../src/services/nutritionService');

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
  numberOfMeals: 4,
  mealDistribution: 'balanced',
  dietType: 'standard',
  allergies: [],
  dislikes: [],
  avoidFoods: [],
};

run();

function run() {
  testReadyMealDataCoverage();
  testGeneratedPlanUsesOnlyReadyMeals();
  testDistributionReadyMealSlotTyping();
  testMealOptionsUseOnlyReadyMeals();
  testReadyMealUiWithFoodCustomization();
  testAiFoodEditEndpointsEnabled();

  console.log('ready-meal generation tests passed');
}

function testReadyMealDataCoverage() {
  const foodsByName = new Map(loadFoods().map((food) => [food.name.toLowerCase(), food]));
  const readyMeals = loadReadyMealBundles();

  assert.equal(readyMeals.length, 223, 'new_stage_data should expose all 223 ready meals');
  for (const readyMeal of readyMeals) {
    assert(readyMeal.id, 'ready meal should have an id');
    assert(readyMeal.mealTag, `${readyMeal.id} should have a meal tag`);
    assert(readyMeal.components.length > 0, `${readyMeal.id} should have usable components`);
    for (const component of readyMeal.components) {
      assert(
        foodsByName.has(component.lookupName.toLowerCase()),
        `${readyMeal.id} ingredient should resolve to nutrition data: ${component.ingredientName}`,
      );
    }
  }
}

function testGeneratedPlanUsesOnlyReadyMeals() {
  const readyIds = new Set(loadReadyMealBundles().map((meal) => meal.id));
  const plan = generatePlan(baseInput);

  assert.equal(plan.status, undefined, 'standard input should generate without an error status');
  assert.equal(plan.meals.length, 4, 'standard input should generate the four-slot policy');

  for (const meal of plan.meals) {
    assert(readyIds.has(meal.readyMealId), `${meal.name} should use a ready meal id`);
    assert.equal(meal.templateId, meal.readyMealId, `${meal.name} should keep templateId aligned for saved-plan compatibility`);
    assert.equal(meal.candidateSource, 'ready_meal_database');
    assert.equal(meal.numberOfSwaps, 0, `${meal.name} should not use swaps`);
    assert.equal(meal.isOriginalTemplate, true, `${meal.name} should be an unmodified ready meal`);
    assertWithinTolerance(meal.items, meal.target, `${meal.name} selected ready meal`);
    for (const item of meal.items) {
      assert.equal(item.alternatives.length, 0, `${meal.name} should not expose ingredient alternatives`);
      assert.equal(item.broaderAlternatives.length, 0, `${meal.name} should not expose broader ingredient alternatives`);
      assert.equal(item.nearestAlternatives.length, 0, `${meal.name} should not expose nearest ingredient alternatives`);
      assert.equal(item.component.readyMealId, meal.readyMealId, `${meal.name} item should belong to the selected ready meal`);
    }
  }
}

function testMealOptionsUseOnlyReadyMeals() {
  const readyById = new Map(loadReadyMealBundles().map((meal) => [meal.id, meal]));
  const plan = generatePlan(baseInput);

  for (const meal of plan.meals) {
    assert(meal.mealOptions.length > 0, `${meal.name} should include valid ready alternatives`);
    for (const option of meal.mealOptions) {
      const readyMeal = readyById.get(option.readyMealId);
      assert(readyMeal, `${meal.name} option should use a ready meal id`);
      assert.equal(readyMeal.mealTag, meal.tag, `${meal.name} option should stay in the same meal category`);
      assertWithinTolerance(option.items, meal.target, `${meal.name} option ${option.readyMealId}`);
      assert.equal(validateMealSwap({
        dailyTargets: plan.dailyTargets,
        weightKg: baseInput.weightKg,
        mealTarget: meal.target,
        proposedMealTotals: option.totals,
      }).valid, true, `${meal.name} option should satisfy its own calorie and macro ranges`);
      assert.equal(option.items.length, readyMeal.components.length, `${option.readyMealId} should keep its fixed ingredients`);
    }

    const apiOptions = generateAlternateMealOptions({
      mealTag: meal.tag,
      mealTarget: meal.target,
      currentItems: meal.items.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
      templateId: meal.readyMealId,
      userPreferences: { dietType: 'standard', avoidFoods: [] },
      dailyContext: {
        dailyTargets: plan.dailyTargets,
        weightKg: baseInput.weightKg,
      },
      limit: 250,
    });
    assert(apiOptions.every((option) => readyById.has(option.readyMealId)), `${meal.name} API options should be ready meals only`);
    assert(apiOptions.every((option) => validateMealSwap({
      dailyTargets: plan.dailyTargets,
      weightKg: baseInput.weightKg,
      mealTarget: meal.target,
      proposedMealTotals: option.totals,
    }).valid), `${meal.name} API options should satisfy their own calorie and macro ranges`);
  }
}

function testDistributionReadyMealSlotTyping() {
  const readyById = new Map(loadReadyMealBundles().map((meal) => [meal.id, meal]));
  const cases = [
    { mealDistribution: 'balanced', numberOfMeals: 2 },
    { mealDistribution: 'balanced', numberOfMeals: 5 },
    { mealDistribution: 'lunch_heavy', numberOfMeals: 2 },
    { mealDistribution: 'dinner_heavy', numberOfMeals: 5 },
  ];

  for (const testCase of cases) {
    const plan = generatePlan({ ...baseInput, ...testCase });
    assert.equal(plan.status, undefined, `${testCase.mealDistribution}/${testCase.numberOfMeals} should generate`);
    assert.equal(plan.meals.length, testCase.numberOfMeals);
    for (const meal of plan.meals) {
      const readyMeal = readyById.get(meal.readyMealId);
      assert(readyMeal, `${meal.name} should use a known ready meal`);
      assert(
        allowedReadyMealTags(meal.tag).includes(readyMeal.mealTag),
        `${meal.name} (${meal.tag}) should not use ${readyMeal.mealTag} ready meals`,
      );
    }
  }
}

function allowedReadyMealTags(mealTag) {
  if (mealTag === 'main_meal' || mealTag === 'main') return ['lunch', 'dinner'];
  if (mealTag === 'iftar') return ['dinner', 'lunch'];
  if (mealTag === 'suhoor') return ['breakfast', 'dinner'];
  return [mealTag];
}

function testReadyMealUiWithFoodCustomization() {
  const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

  assert(!plannerHtml.includes('freeform-btn'), 'planner should not show build-your-own/freeform mode');
  assert(!plannerHtml.includes('rebalance-btn'), 'planner should not show manual rebalance');
  assert(!appJs.includes("querySelector('.rebalance-btn')"), 'frontend should not bind manual rebalance control');
  assert(plannerHtml.includes('ai-mode-toggle'), 'planner should show an AI mode switch');
  assert(plannerHtml.includes('meal-add-food-btn'), 'planner should show add-food control');
  assert(plannerHtml.includes('meal-add-tray" hidden'), 'add-food control should be hidden before AI mode');
  assert(appJs.includes("querySelector('.meal-add-food-btn')"), 'frontend should bind add-food control');
  assert(appJs.includes('food-swap-btn'), 'frontend should render ingredient swap buttons');
  assert(appJs.includes('food-delete-btn'), 'frontend should render ingredient delete buttons');
  assert(appJs.includes('state.aiModeEnabled ?'), 'ingredient controls should only render in AI mode');
  assert(appJs.includes("action: 'add_food'"), 'add food should use guided rebalance');
  assert(appJs.includes("action: 'remove_food'"), 'remove food should use guided rebalance');
  assert(appJs.includes("action: 'swap_food'"), 'swap food should use guided rebalance');
  assert(styles.includes('.ai-mode-switch'), 'AI mode should use switch styling');
  assert(styles.includes('.meal-add-tray[hidden]'), 'hidden add tray should not reserve layout space');
  assert(appJs.includes('(currentIndex + step * offset + options.length) % options.length'), 'meal option navigation should wrap around circularly');
  assert(!appJs.includes('state.mealOptionIndex <= 0'), 'previous ready-meal button should not disable at the first option');
  assert(!appJs.includes('state.mealOptionIndex >= options.length - 1'), 'next ready-meal button should not disable at the last option');
  assert(styles.includes('top: 44px;'), 'meal cycle buttons should use fixed header positioning on desktop');
  assert(!styles.includes('top: 50%;'), 'meal cycle buttons should not be vertically centered against variable card height');
}

function testAiFoodEditEndpointsEnabled() {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'generationController.js'), 'utf8');
  assert(!controller.includes('AI meal editing is disabled'), 'guided AI edit endpoint should be enabled');
  assert(!controller.includes('AI meal chat is disabled'), 'meal chat endpoint should be enabled');
  assert(controller.includes('const systemContent = `You are a meal-editing fallback.'), 'guided AI edit prompt should be present');
}

function assertWithinTolerance(items, target, label) {
  const totals = sumTargets(items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
  if (target.macroWindows) {
    assert(totals.calories >= target.macroWindows.calories.min - 0.01, `${label} calories min`);
    assert(totals.calories <= target.macroWindows.calories.max + 0.01, `${label} calories max`);
    assert(totals.proteinG >= target.macroWindows.proteinG.min - 0.01, `${label} protein min`);
    assert(totals.proteinG <= target.macroWindows.proteinG.max + 0.01, `${label} protein max`);
    assert(totals.carbG >= target.macroWindows.carbG.min - 0.01, `${label} carbs min`);
    assert(totals.carbG <= target.macroWindows.carbG.max + 0.01, `${label} carbs max`);
    assert(totals.fatG >= target.macroWindows.fatG.min - 0.01, `${label} fat min`);
    assert(totals.fatG <= target.macroWindows.fatG.max + 0.01, `${label} fat max`);
    return;
  }
  assert(
    Math.abs(totals.calories - target.calories) <= target.calories * NUTRITION.calorieTolerancePercent + 0.01,
    `${label} calories should fit target`,
  );
  assert(Math.abs(totals.proteinG - target.proteinG) <= target.proteinG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} protein should fit target`);
  assert(Math.abs(totals.carbG - target.carbG) <= target.carbG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} carbs should fit target`);
  assert(Math.abs(totals.fatG - target.fatG) <= target.fatG * NUTRITION.mealMacroTolerancePercent + 0.01, `${label} fat should fit target`);
}
