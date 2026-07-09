const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { loadFoods } = require('../src/repositories/foodRepository');
const { loadTemplates } = require('../src/repositories/templateRepository');
const { loadSwapSystem } = require('../src/repositories/swapSystemRepository');
const { generatePlan, generatePlanFreeform } = require('../src/services/planGenerator');
const { getSwapCandidates } = require('../src/services/mealSwapService');

const foods = loadFoods();
const foodsById = new Map(foods.map((food) => [food.id, food]));
const templates = loadTemplates();
const templatesById = new Map(templates.map((template) => [template.templateId, template]));
const swapSystem = loadSwapSystem();
const allSwapFoodIds = new Set(Object.values(swapSystem.swapGroups).flatMap((group) => group.foods));
const allTemplateFoodIds = new Set(templates.flatMap((template) => template.components.map((component) => component.foodId)));

const baseInput = {
  weightKg: 80,
  heightCm: 175,
  bodyFatPercentage: 20,
  activityLevel: 'light',
  goal: 'maintain',
  numberOfMeals: 3,
  numberOfSnacks: 0,
  dietType: 'standard',
  allergies: [],
  dislikes: [],
  avoidFoods: [],
};

run();

function run() {
  testNoMacroRoleFallbackSource();
  testMealCardDisplaySource();
  testSwapPreservesCurrentPortionSource();
  testBackendMinimalMealMetadata();
  testOriginalTemplateFitsNoSwap();
  testApproximateOriginalBeatsUnnecessarySwaps();
  testApprovedSwapIsTriedWhenOriginalDoesNotFit();
  testOneSwapBeatsTwoSwaps();
  testTwoSwapsOnlyAfterOneSwapFails();
  testNoThreePlusSwapsByDefault();
  testLockedComponentCannotSwap();
  testExactSwapGroupPolicy();
  testFamilySlotPolicyOrder();
  testDairyRestrictionsRejectDairySwaps();
  testSeafoodRestrictionRejectsFishAndShrimp();
  testDislikedFoodRejected();
  testNoValidCandidateFailsGracefully();
  testAllGeneratedSwapsAreDataDriven();

  console.log('deterministic meal generation tests passed');
}

function testNoMacroRoleFallbackSource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'planGenerator.js'), 'utf8');
  assert(!source.includes('selectInitialItems'), 'selectInitialItems macro-role fallback must not exist');
  assert(!source.includes('foodsForRole'), 'foodsForRole macro-role fallback must not exist');
  assert(!source.includes('maxMealAttempts'), 'random attempt loop must not exist in plan generation');

  const freeformPlan = generatePlanFreeform({ ...baseInput, allergies: ['dairy'] });
  const lunch = freeformPlan.meals.find((meal) => meal.name === 'Lunch');
  assert(lunch, 'freeform plan should still return a lunch slot');
  assert.equal(lunch.items.length, 0, 'freeform generation must not invent a random dairy-free lunch');
  assert.match(lunch.unavailableReason ?? '', /No ready meal template/);
}

function testMealCardDisplaySource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert(source.includes('Template: ${state.templateName}'), 'meal card should render original template name');
  assert(source.includes('Original template'), 'meal card should include original template status');
  assert(source.includes('Modified template'), 'meal card should include modified template status');
  assert(source.includes('Approximate template'), 'meal card should include approximate template status');
  assert(source.includes('Failed'), 'meal card should include failed status');
  assert(source.includes('No suggested swaps for this food. Search for another allowed food.'), 'swap panel should handle foods without suggested alternatives');
  assert(source.includes('Find a replacement food'), 'row swap panel should expose replacement search');
  assert(!source.includes('Search any food'), 'swap panel must not use old all-food wording');
  assert(!source.includes('function getAlternatives'), 'frontend must not compute macro-role alternatives');

  const helperSource = source.match(/function mealCardMetaText[\s\S]*?function renderFoodItem/)?.[0]
    .replace(/\nfunction renderFoodItem[\s\S]*$/, '');
  assert(helperSource, 'meal card helper functions should be present');
  const context = { separator: '·' };
  vm.createContext(context);
  vm.runInContext(`${helperSource}; this.mealCardMetaText = mealCardMetaText; this.mealTemplateStatusLabel = mealTemplateStatusLabel;`, context);
  assert.equal(
    context.mealCardMetaText({ templateName: 'Chicken Rice Plate', items: [{}], isApproximate: false, numberOfSwaps: 0, isOriginalTemplate: true }),
    'Template: Chicken Rice Plate · Original template',
  );
  assert.equal(
    context.mealTemplateStatusLabel({ items: [{}], isApproximate: false, numberOfSwaps: 1, isOriginalTemplate: false }),
    'Modified template',
  );
  assert.equal(
    context.mealTemplateStatusLabel({ items: [{}], isApproximate: true, numberOfSwaps: 1, isOriginalTemplate: false }),
    'Approximate template',
  );
  assert.equal(
    context.mealTemplateStatusLabel({ items: [], candidateSource: 'failed' }),
    'Failed',
  );
}

function testSwapPreservesCurrentPortionSource() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert(source.includes('function attemptSwapFood'), 'row swap should use a focused swap handler');
  assert(source.includes('clampGrams(alt, item.quantityG, 5)'), 'swap should preserve the replaced food grams within replacement bounds');
  assert(source.includes("action: 'swap_food'"), 'swap should pass through deterministic rebalance');
  assert(!source.includes('bestSwapGramsForMeal'), 'old one-food swap optimizer should not remain in frontend');
  assert(!source.includes('bestSingleFoodGramsForTarget'), 'old one-food gram solver should not remain in frontend');
  assert(!source.includes('applyFoodSwapAndRebalance'), 'old swap/rebalance helper should not remain in frontend');
}

function testBackendMinimalMealMetadata() {
  const plan = generatePlan(baseInput);
  const meal = plan.meals[0];
  for (const key of ['templateId', 'templateName', 'isOriginalTemplate', 'numberOfSwaps', 'candidateSource']) {
    assert(Object.prototype.hasOwnProperty.call(meal, key), `meal should include ${key}`);
  }
  assert(!Object.prototype.hasOwnProperty.call(meal, 'generationDebug'), 'meal response should not expose detailed debug JSON');
  assert(!Object.prototype.hasOwnProperty.call(meal, 'swapsApplied'), 'meal response should not expose swap internals');
  assert(!Object.prototype.hasOwnProperty.call(meal, 'templateAlternates'), 'meal response should not expose alternate templates');
}

function testOriginalTemplateFitsNoSwap() {
  const plan = generatePlan(baseInput);
  const breakfast = plan.meals.find((meal) => meal.name === 'Breakfast');
  assert(breakfast, 'standard plan should include breakfast');
  assert.equal(breakfast.candidateSource, 'original_template');
  assert.equal(breakfast.numberOfSwaps, 0);
  assert.equal(breakfast.isOriginalTemplate, true);
  assert(breakfast.templateName, 'original template name should be present');
}

function testApproximateOriginalBeatsUnnecessarySwaps() {
  const plan = generatePlan({ ...baseInput, allergies: ['gluten'] });
  const approximateOriginal = plan.meals.find((meal) =>
    meal.candidateSource === 'original_template' &&
    meal.isApproximate === true &&
    meal.numberOfSwaps === 0
  );

  assert(approximateOriginal, 'safe approximate original template should be kept unchanged');
  assert.equal(approximateOriginal.isOriginalTemplate, true);
}

function testApprovedSwapIsTriedWhenOriginalDoesNotFit() {
  const plan = generatePlan({ ...baseInput, allergies: ['dairy'] });
  const swappedMeal = plan.meals.find((meal) => Number(meal.numberOfSwaps || 0) > 0);
  assert(swappedMeal, 'dairy-restricted plan should try an approved swap');
  assert.equal(swappedMeal.isOriginalTemplate, false);
  assert(['same_swap_group', 'same_family_slot'].includes(swappedMeal.candidateSource));
  assertApprovedAlternativesForMeal(swappedMeal);
}

function testOneSwapBeatsTwoSwaps() {
  const plan = generatePlan({ ...baseInput, allergies: ['dairy'] });
  const oneSwapMeal = plan.meals.find((meal) => meal.numberOfSwaps === 1);
  assert(oneSwapMeal, 'dairy-restricted plan should select a one-swap candidate');
  assert.equal(oneSwapMeal.isOriginalTemplate, false);
}

function testTwoSwapsOnlyAfterOneSwapFails() {
  const plan = generatePlan({ ...baseInput, dietType: 'vegan' });
  const twoSwapMeal = plan.meals.find((meal) => meal.numberOfSwaps === 2);
  assert(twoSwapMeal, 'vegan plan should exercise the two-swap path');
  assert.equal(twoSwapMeal.isOriginalTemplate, false);
}

function testNoThreePlusSwapsByDefault() {
  const plans = [
    generatePlan(baseInput),
    generatePlan({ ...baseInput, dietType: 'vegan' }),
    generatePlan({ ...baseInput, allergies: ['dairy'] }),
    generatePlan({ ...baseInput, allergies: ['gluten'] }),
  ];

  for (const plan of plans) {
    for (const meal of plan.meals) {
      assert(Number(meal.numberOfSwaps || 0) <= 2, `${meal.name} should not use 3+ swaps by default`);
    }
  }
}

function testLockedComponentCannotSwap() {
  const template = templateById('breakfast_cheese_with_bread_and_butter_f8a08ba6cb');
  const component = template.components.find((candidate) => candidate.foodId === 'butter_without_salt');
  assert(component, 'fixture template should include butter');
  assert.equal(component.swapEnabled, false);

  const result = getSwapCandidates(template, component, { ...baseInput, mealTag: template.mealType }, foods);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejected[0].reason, 'component_swap_disabled');
  assert.equal(result.rejected[0].lockReason, component.lockReason);
}

function testExactSwapGroupPolicy() {
  const template = templateById('breakfast_cheese_with_apples_and_butter_8e2ae5219f');
  const component = template.components.find((candidate) => candidate.foodId === 'apples_raw_with_skin');
  assert.equal(component.swapCandidatePolicy, 'same_exact_swap_group_only');

  const result = getSwapCandidates(template, component, { ...baseInput, mealTag: template.mealType }, foods);
  assert(result.candidates.length > 0, 'exact-group fixture should have candidates');
  assert(result.candidates.every((candidate) => candidate.groupId === component.swapGroup));
  assert(result.candidates.every((candidate) => candidate.source === 'same_swap_group'));
}

function testFamilySlotPolicyOrder() {
  const template = templateById('breakfast_cheese_with_bread_and_butter_f8a08ba6cb');
  const component = template.components.find((candidate) => candidate.foodId === 'cheese_cottage_creamed');
  assert.equal(component.swapCandidatePolicy, 'same_swap_group_then_family_slot');

  const result = getSwapCandidates(template, component, { ...baseInput, mealTag: template.mealType }, foods);
  const sources = result.candidates.map((candidate) => candidate.source);
  assert(sources.includes('same_swap_group'), 'family-slot fixture should include exact-group candidates');
  assert(sources.includes('same_family_slot'), 'family-slot fixture should include fallback family-slot candidates');
  assert(
    sources.lastIndexOf('same_swap_group') < sources.indexOf('same_family_slot'),
    'exact swapGroup candidates should be ordered before family-slot candidates',
  );
}

function testDairyRestrictionsRejectDairySwaps() {
  const template = templateById('breakfast_cheese_with_bread_and_butter_f8a08ba6cb');
  const component = template.components.find((candidate) => candidate.foodId === 'cheese_cottage_creamed');
  const dairyFreeVeganFoods = foods.filter((food) => food.isVegan && !matchesAny(food, ['dairy', 'milk', 'cheese', 'yogurt', 'whey', 'butter']));

  const result = getSwapCandidates(
    template,
    component,
    { ...baseInput, dietType: 'vegan', allergies: ['dairy'], mealTag: template.mealType },
    dairyFreeVeganFoods,
  );

  assert(result.candidates.every((candidate) => !matchesAny(candidate.food, ['dairy', 'milk', 'cheese', 'yogurt', 'whey'])));
  assert(
    result.rejected.some((rejection) =>
      ['cheese_gouda', 'skimmed_milk_fat_free', 'milk_whole_3_25_milkfat'].includes(rejection.foodId) &&
      rejection.reason === 'food_not_allowed_by_current_restrictions_or_missing',
    ),
    'dairy candidates should be rejected by the allowed food pool',
  );
}

function testSeafoodRestrictionRejectsFishAndShrimp() {
  const { template, component } = firstComponent({
    mealType: 'lunch',
    slot: 'primary_protein',
    swapGroup: 'protein.main.animal.lean',
    foodId: 'chicken_breast_skinless_boneless_grilled',
  });
  const seafoodFreeFoods = foods.filter((food) => !matchesAny(food, ['seafood', 'fish', 'shellfish', 'shrimp', 'tuna', 'salmon', 'tilapia']));

  const result = getSwapCandidates(
    template,
    component,
    { ...baseInput, allergies: ['seafood'], mealTag: template.mealType },
    seafoodFreeFoods,
  );

  assert(!result.candidates.some((candidate) => matchesAny(candidate.food, ['seafood', 'fish', 'shellfish', 'shrimp'])));
  for (const seafoodId of ['shrimp_cooked', 'fish_tilapia_cooked', 'fish_tuna_light_canned_in_water']) {
    assert(
      result.rejected.some((rejection) => rejection.foodId === seafoodId && rejection.reason === 'food_not_allowed_by_current_restrictions_or_missing'),
      `${seafoodId} should be rejected`,
    );
  }
}

function testDislikedFoodRejected() {
  const { template, component } = firstComponent({
    mealType: 'lunch',
    slot: 'primary_protein',
    swapGroup: 'protein.main.animal.lean',
    foodId: 'chicken_breast_skinless_boneless_grilled',
  });
  const noShrimpFoods = foods.filter((food) => food.id !== 'shrimp_cooked');

  const result = getSwapCandidates(
    template,
    component,
    { ...baseInput, dislikes: ['shrimp'], mealTag: template.mealType },
    noShrimpFoods,
  );

  assert(!result.candidates.some((candidate) => candidate.food.id === 'shrimp_cooked'));
  assert(
    result.rejected.some((rejection) => rejection.foodId === 'shrimp_cooked' && rejection.reason === 'food_not_allowed_by_current_restrictions_or_missing'),
    'disliked shrimp should be rejected',
  );
}

function testNoValidCandidateFailsGracefully() {
  const plan = generatePlan({ ...baseInput, allergies: ['dairy'] });
  const lunch = plan.meals.find((meal) => meal.name === 'Lunch');
  assert(lunch, 'dairy allergy plan should include lunch slot');
  assert.equal(lunch.items.length, 0);
  assert.equal(lunch.isApproximate, true);
  assert.equal(lunch.candidateSource, 'failed');
  assert.match(lunch.unavailableReason, /No ready meal template/);
}

function testAllGeneratedSwapsAreDataDriven() {
  const plans = [
    generatePlan(baseInput),
    generatePlan({ ...baseInput, allergies: ['gluten'] }),
    generatePlan({ ...baseInput, dietType: 'vegetarian' }),
    generatePlan({ ...baseInput, dietType: 'vegan' }),
    generatePlan({ ...baseInput, allergies: ['dairy'] }),
    generatePlan({ ...baseInput, allergies: ['seafood'] }),
    generatePlan({ ...baseInput, dislikes: ['chicken'] }),
  ];

  for (const plan of plans) {
    for (const meal of plan.meals) {
      for (const item of meal.items) {
        assert(foodsById.has(item.food.id), `${item.food.id} must exist in foods.json`);
        assert(
          allTemplateFoodIds.has(item.food.id) || allSwapFoodIds.has(item.food.id),
          `${item.food.id} must come from templates or swap-system groups`,
        );
      }

      assertApprovedAlternativesForMeal(meal);
    }
  }
}

function assertApprovedAlternativesForMeal(meal) {
  if (!meal.templateId) return;
  const template = templatesById.get(meal.templateId);
  assert(template, `${meal.templateId} should exist in mealTemplates.json`);
  const family = swapSystem.mealFamilies[template.family];
  assert(family, `${template.family} should exist in meal_swap_system.production.json`);

  for (const item of meal.items) {
    const component = item.component;
    if (!component || !Array.isArray(item.alternatives)) continue;
    if (component.swapEnabled !== true) {
      assert.equal(item.alternatives.length, 0, `${component.foodId} is locked and should not expose alternatives`);
      assert.equal((item.broaderAlternatives || []).length, 0, `${component.foodId} is locked and should not expose broader alternatives`);
      continue;
    }

    const exactGroup = swapSystem.swapGroups[component.swapGroup];
    const familySlotGroups = family.slotGroups?.[component.slot] ?? [];
    for (const alt of item.alternatives) {
      assert(foodsById.has(alt.id), `${alt.id} should exist in foods.json`);
      const inExactGroup = exactGroup?.foods?.includes(alt.id) ?? false;
      assert(inExactGroup, `${alt.id} must be an exact swapGroup alternative for ${component.swapGroup}`);
    }

    for (const alt of item.broaderAlternatives || []) {
      assert(foodsById.has(alt.id), `${alt.id} should exist in foods.json`);
      const inExactGroup = exactGroup?.foods?.includes(alt.id) ?? false;
      const inFamilySlot = familySlotGroups.some((groupId) => swapSystem.swapGroups[groupId]?.foods?.includes(alt.id));
      assert(!inExactGroup, `${alt.id} should not be duplicated as a broader alternative`);
      if (component.swapCandidatePolicy === 'same_exact_swap_group_only') {
        assert.fail(`${component.foodId} has exact-only policy and should not expose broader alternative ${alt.id}`);
      }
      assert(inFamilySlot, `${alt.id} must be from an approved family slot group`);
    }
  }
}

function templateById(templateId) {
  const template = templatesById.get(templateId);
  assert(template, `missing template fixture ${templateId}`);
  return template;
}

function firstComponent({ mealType, slot, swapGroup, foodId }) {
  for (const template of templates) {
    if (template.mealType !== mealType) continue;
    const component = template.components.find((candidate) =>
      candidate.slot === slot &&
      candidate.swapGroup === swapGroup &&
      (!foodId || candidate.foodId === foodId) &&
      candidate.swapEnabled === true,
    );
    if (component) return { template, component };
  }
  assert.fail(`missing component fixture ${mealType} ${slot} ${swapGroup} ${foodId ?? ''}`);
}

function matchesAny(food, terms) {
  const haystack = [
    food.id,
    food.name,
    food.nameAr,
    food.macroRole,
    food.subCategory,
    ...food.allergens,
    ...food.categories,
    ...food.mealTags,
  ].filter(Boolean).join(' ').toLowerCase();

  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}
