const { loadFoods } = require('../repositories/foodRepository');
const { loadReadyMealBundles } = require('../repositories/readyMealRepository');
const { normalizeToken, resolvePreferenceTerms } = require('../config/preferenceTaxonomy');
const { MEAL_DISTRIBUTIONS: MEAL_DISTRIBUTION_FACTORS } = require('../config/nutritionConstants');
const {
  NUTRITION,
  buildMealTargets,
  calculateNutritionDetails,
  macrosForFoodPortion,
  sumTargets,
  roundToNearest,
  clamp,
} = require('./nutritionService');

const ACTIVITY_LEVELS = new Set(Object.keys(NUTRITION.activityMultipliers));
const GOALS = new Set(['maintain', 'lose_weight', 'gain_weight']);
const SEXES = new Set(Object.keys(NUTRITION.calorieFloorBySex));
const MEAL_DISTRIBUTIONS = new Set(Object.keys(MEAL_DISTRIBUTION_FACTORS));
const DIETS = new Set(['standard', 'vegetarian', 'vegan']);
const DEBUG_OPTIMIZER = process.env.NUTRITION_DEBUG === '1';
const DEBUG_MEAL_GENERATION = process.env.DEBUG_MEAL_GENERATION === 'true';
const EXACT_PORTION_SEARCH_STEP_G = 2;

function getFoods() {
  return loadFoods();
}

function generatePlan(rawInput) {
  return _generatePlanInternal(rawInput);
}

function _generatePlanInternal(rawInput) {
  const input = normalizeInput(rawInput);
  const nutritionCalculation = calculateNutritionDetails(input);
  const dailyTargets = nutritionCalculation.targets;
  const mealTargets = buildMealTargets(dailyTargets, input);
  const allowedFoods = filterFoods(loadFoods(), input);

  if (allowedFoods.length === 0) {
    throw new Error('No foods match the selected restrictions. Try removing one filter.');
  }

  const generatedMeals = generateReadyMealDay({ mealTargets, dailyTargets, allowedFoods });
  const diagnostics = buildPlanDiagnostics(totalsForMeals(generatedMeals), dailyTargets, generatedMeals);
  const optimization = {
    meals: generatedMeals,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
    diagnostics,
  };

  const meals = optimization.meals.map((meal) => {
    const plainItems = meal.items.map((item) => ({ food: item.food, quantityG: item.quantityG }));
    const mealTotals = sumTargets(plainItems.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
    const seedTarget = meal.seedTarget ?? meal.target;
    const displayTarget = meal.target;
    const numberOfSwaps = Number.isFinite(meal.numberOfSwaps)
      ? meal.numberOfSwaps
      : (meal.swapsApplied?.length ?? 0);
    const mealOptions = (meal.mealOptions ?? [])
      .map((option) => mealOptionForTarget(option, displayTarget))
      .filter(Boolean)
      .filter((option) => validateMealSwap({
        dailyTargets,
        weightKg: input.weightKg,
        mealTarget: displayTarget,
        proposedMealTotals: option.totals,
      }).valid);
    return {
      name: meal.name,
      tag: meal.tag,
      slotProfile: meal.slotProfile ?? null,
      templateId: meal.templateId ?? null,
      templateName: meal.templateName ?? null,
      readyMealId: meal.readyMealId ?? meal.templateId ?? null,
      readyMealTrack: meal.readyMealTrack ?? null,
      isOriginalTemplate: meal.items.length > 0 && numberOfSwaps === 0 && Boolean(meal.templateId),
      numberOfSwaps,
      candidateSource: meal.candidateSource ?? meal.generationSource ?? null,
      unavailableReason: meal.unavailableReason,
      seedTarget,
      target: displayTarget,
      totals: mealTotals,
      isApproximate: !isWithinTolerance(plainItems, seedTarget),
      items: meal.items.map((item) => ({
        food: item.food,
        quantityG: item.quantityG,
        alternatives: item.alternatives ?? [],
        broaderAlternatives: item.broaderAlternatives ?? [],
        nearestAlternatives: item.nearestAlternatives ?? [],
        component: item.component ?? null,
        totals: item.totals,
      })),
      mealOptions: mealOptions.map((option) => ({
        templateId: option.templateId ?? null,
        templateName: option.templateName ?? 'Alternate meal',
        templateFamily: option.templateFamily ?? null,
        readyMealId: option.readyMealId ?? option.templateId ?? null,
        readyMealTrack: option.readyMealTrack ?? null,
        items: option.items.map((item) => ({
          food: item.food,
          quantityG: item.quantityG,
          alternatives: item.alternatives ?? [],
          broaderAlternatives: item.broaderAlternatives ?? [],
          nearestAlternatives: item.nearestAlternatives ?? [],
          component: item.component ?? null,
          totals: item.totals,
        })),
        totals: option.totals,
        isApproximate: Boolean(option.isApproximate),
      })),
      originalItems: plainItems.map((item) => ({ food: item.food, quantityG: item.quantityG })),
    };
  });

  return {
    input,
    dailyTargets,
    nutritionCalculation: {
      bmr: nutritionCalculation.bmr,
      maintenanceCalories: nutritionCalculation.maintenanceCalories,
      targetCalories: nutritionCalculation.targetCalories,
      calculatedGoalCalories: nutritionCalculation.calculatedGoalCalories,
      calorieFloor: nutritionCalculation.calorieFloor,
      calorieFloorApplied: nutritionCalculation.calorieFloorApplied,
      adjustmentCalories: nutritionCalculation.adjustmentCalories,
      requestedDailyDeficitCalories: nutritionCalculation.requestedDailyDeficitCalories,
      weeklyWeightLossPercent: nutritionCalculation.weeklyWeightLossPercent,
      proteinPerKg: nutritionCalculation.proteinPerKg,
      fatPerKg: nutritionCalculation.fatPerKg,
    },
    meals,
    ...(optimization.diagnostics ? { diagnostics: optimization.diagnostics } : {}),
    ...(optimization.warnings.length > 0 ? {
      warnings: optimization.warnings,
    } : {}),
    ...(optimization.errors?.length > 0 ? {
      errors: optimization.errors,
      status: 'error',
      isImpossible: true,
    } : {}),
  };
}

function debugOptimizer(message, payload = undefined) {
  if (!DEBUG_OPTIMIZER) return;
  if (payload === undefined) {
    console.log(`[nutrition-optimizer] ${message}`);
  } else {
    console.log(`[nutrition-optimizer] ${message}`, JSON.stringify(payload));
  }
}

function totalsForMeals(meals) {
  return sumTargets(meals.map((meal) => meal.totals ?? totalsForItems(meal.items)));
}

function calculateResidual(dayTotals, dailyTarget) {
  return {
    calories: dailyTarget.calories - dayTotals.calories,
    proteinG: dailyTarget.proteinG - dayTotals.proteinG,
    carbG: dailyTarget.carbG - dayTotals.carbG,
    fatG: dailyTarget.fatG - dayTotals.fatG,
  };
}

function computeDailyPlanBounds(dailyTarget) {
  const calories = {
    min: dailyTarget.calories - dailyTarget.calories * NUTRITION.dailyCalorieTolerancePercent,
    max: dailyTarget.calories + dailyTarget.calories * NUTRITION.dailyCalorieTolerancePercent,
  };
  const requiredMacroRange = (key) => {
    const range = dailyTarget.macroRanges?.[key];
    if (!range) {
      throw new Error(`Daily ${key} range is required.`);
    }
    return {
      min: Number(range.min),
      max: Number(range.max),
    };
  };
  const proteinG = requiredMacroRange('proteinG');
  const fatG = requiredMacroRange('fatG');

  return {
    calories,
    proteinG,
    fatG,
  };
}

function residualTolerances(dailyTarget) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  return {
    calories: Math.max(dailyTarget.calories - bounds.calories.min, bounds.calories.max - dailyTarget.calories),
    proteinG: Math.max(dailyTarget.proteinG - bounds.proteinG.min, bounds.proteinG.max - dailyTarget.proteinG),
    fatG: Math.max(dailyTarget.fatG - bounds.fatG.min, bounds.fatG.max - dailyTarget.fatG),
  };
}

function calculateResidualScore(dayTotals, dailyTarget, tolerances = residualTolerances(dailyTarget)) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  const residual = calculateResidual(dayTotals, dailyTarget);
  const violationScore = ['calories', 'proteinG', 'fatG'].reduce((score, key) => (
    score + planBoundsViolationAmount(dayTotals[key], bounds[key]) / Math.max(1, tolerances[key])
  ), 0);
  const targetClosenessScore = (
    Math.abs(residual.calories) / Math.max(1, tolerances.calories) +
    Math.abs(residual.proteinG) / Math.max(1, tolerances.proteinG) +
    Math.abs(residual.fatG) / Math.max(1, tolerances.fatG)
  ) * 0.01;
  return violationScore + targetClosenessScore;
}

function planBoundsViolationAmount(total, bounds) {
  if (total < bounds.min) return bounds.min - total;
  if (total > bounds.max) return total - bounds.max;
  return 0;
}

function residualWithinTolerance(dayTotals, dailyTarget, tolerances = residualTolerances(dailyTarget)) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  return Object.entries(bounds).every(([key, range]) => planBoundsViolationAmount(dayTotals[key], range) <= 0);
}

function dailyTotalsWithinPlanBounds(dayTotals, dailyTarget) {
  return residualWithinTolerance(dayTotals, dailyTarget);
}

function buildPlanDiagnostics(dayTotals, dailyTarget, meals) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  const residual = calculateResidual(dayTotals, dailyTarget);
  const residualPct = calculateResidualPercent(dayTotals, dailyTarget);
  const warnings = [];
  const errors = [];
  const missingSlots = meals
    .filter((meal) => isRequiredMainSlot(meal) && meal.items.length === 0)
    .map((meal) => meal.name);

  const onlyNonMainCalories =
    meals.some((meal) => !isRequiredMainSlot(meal) && meal.items.length > 0) &&
    meals.filter(isRequiredMainSlot).every((meal) => meal.items.length === 0);

  if (missingSlots.length > 0) {
    errors.push(
      `Impossible with current templates: no feasible ready templates for ${missingSlots.join(', ')}.`,
    );
  }
  if (onlyNonMainCalories) {
    errors.push('Impossible with current templates: only snack/non-main calories were generated while required main meals are missing.');
  }

  for (const key of ['calories', 'proteinG', 'fatG']) {
    const violationAmount = planBoundsViolationAmount(dayTotals[key], bounds[key]);
    if (violationAmount <= 0) continue;
    const label = {
      calories: 'Calories',
      proteinG: 'Protein',
      fatG: 'Fat',
    }[key];
    const unit = key === 'calories' ? 'kcal' : 'g';
    const direction = residual[key] > 0 ? 'short' : 'high';
    const message =
      `${label} remains ${direction} by ${Math.round(violationAmount)}${unit}. ${structuralCauseFor(key, residual[key], meals)}`;
    if (errors.length === 0) {
      warnings.push(message);
    }
  }

  if (errors.length > 0 || warnings.length > 0) {
    debugOptimizer('fallback reason', { errors, warnings });
  }

  const status = errors.length > 0
    ? 'error'
    : (warnings.length > 0 ? 'warning' : 'pass');

  return {
    status,
    warnings,
    errors,
    missingSlots,
    residual,
    residualPct,
    bounds,
    totals: dayTotals,
    target: dailyTarget,
  };
}

function isRequiredMainSlot(meal) {
  return !['snack'].includes(meal.tag);
}

function calculateResidualPercent(dayTotals, dailyTarget) {
  return Object.fromEntries(
    ['calories', 'proteinG', 'carbG', 'fatG'].map((key) => {
      const target = dailyTarget[key];
      if (!Number.isFinite(target) || target === 0) {
        return [key, null];
      }
      return [key, Math.abs(dayTotals[key] - target) / Math.abs(target) * 100];
    }),
  );
}

function structuralCauseFor(key, residualValue, meals) {
  const emptyMeals = meals.filter((meal) => meal.items.length === 0);
  if (emptyMeals.length > 0) {
    return `No feasible ready templates were found for ${emptyMeals.map((meal) => meal.name).join(', ')}.`;
  }

  const direction = residualValue > 0 ? 'too few' : 'too many';
  if (key === 'proteinG') return `The selected templates contain ${direction} high-protein adjustable foods within serving limits.`;
  if (key === 'fatG') return `The selected templates contain ${direction} fat-dense adjustable foods within serving limits.`;
  return 'The selected templates hit macro serving bounds before calories could be fully corrected.';
}

function normalizeInput(input = {}) {
  const weightKg = Number(input.weightKg);
  const heightCm = Number(input.heightCm);
  const age = Number(input.age);
  const sex = String(input.sex || '').toLowerCase();
  const bodyFatValue =
    input.bodyFatPercentage === '' || input.bodyFatPercentage === undefined ||
    input.bodyFatPercentage === null
      ? null
      : Number(input.bodyFatPercentage);
  const activityLevel = String(input.activityLevel || 'moderate');
  const goal = String(input.goal || 'maintain');
  const dietType = String(input.dietType || 'standard');
  const numberOfMeals = Number.parseInt(input.numberOfMeals ?? 3, 10);
  const mealDistribution = String(input.mealDistribution || 'balanced');
  const proteinPerKg = input.proteinPerKg === '' || input.proteinPerKg === undefined ||
    input.proteinPerKg === null
    ? NUTRITION.proteinPerKg.default
    : Number(input.proteinPerKg);
  const fatPerKg = input.fatPerKg === '' || input.fatPerKg === undefined ||
    input.fatPerKg === null
    ? NUTRITION.fatPerKg.default
    : Number(input.fatPerKg);

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Enter a valid weight.');
  }
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    throw new Error('Enter a valid height.');
  }
  if (!Number.isFinite(age) || age <= 0 || age > 120) {
    throw new Error('Age must be between 1 and 120 years.');
  }
  if (!SEXES.has(sex)) {
    throw new Error('Choose male or female for the Mifflin-St Jeor calculation.');
  }
  if (bodyFatValue !== null && (!Number.isFinite(bodyFatValue) || bodyFatValue <= 0 || bodyFatValue >= 70)) {
    throw new Error('Body fat should be between 1 and 69%.');
  }
  if (!ACTIVITY_LEVELS.has(activityLevel)) {
    throw new Error('Choose a valid activity level.');
  }
  if (!GOALS.has(goal)) {
    throw new Error('Choose a valid goal.');
  }
  if (!DIETS.has(dietType)) {
    throw new Error('Choose a valid diet type.');
  }
  if (![3, 4, 5].includes(numberOfMeals)) {
    throw new Error('Meals must be between 3 and 5.');
  }
  if (!MEAL_DISTRIBUTIONS.has(mealDistribution)) {
    throw new Error('Choose a valid meal distribution.');
  }
  if (
    !Number.isFinite(proteinPerKg) ||
    proteinPerKg < NUTRITION.proteinPerKg.minimum ||
    proteinPerKg > NUTRITION.proteinPerKg.maximum
  ) {
    throw new Error('Protein must be between 1.8 and 2.2 g/kg.');
  }
  if (
    !Number.isFinite(fatPerKg) ||
    fatPerKg < NUTRITION.fatPerKg.minimum ||
    fatPerKg > NUTRITION.fatPerKg.maximum
  ) {
    throw new Error('Fat must be between 0.66 and 1.0 g/kg.');
  }

  return {
    weightKg,
    heightCm,
    age,
    sex,
    bodyFatPercentage: bodyFatValue,
    activityLevel,
    goal,
    proteinPerKg,
    fatPerKg,
    numberOfMeals,
    numberOfSnacks: numberOfMeals === 4 ? 1 : (numberOfMeals === 5 ? 2 : 0),
    mealDistribution,
    dietType,
    allergies: normalizeList(input.allergies),
    dislikes: normalizeList(input.dislikes),
    avoidFoods: normalizeList(input.avoidFoods ?? []),
    ramadanMode: Boolean(input.ramadanMode),
  };
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function filterFoods(foods, input) {
  const foodIds = new Set(foods.map((food) => food.id));
  const categoryIds = new Set(foods.flatMap((food) => food.categories));
  // avoidFoods merges into both allergies and dislikes
  const mergedAvoid = [...new Set([...input.avoidFoods, ...input.allergies])];
  const allergies = resolvePreferenceTerms(mergedAvoid);
  const dislikes = resolvePreferenceTerms([...new Set([...input.avoidFoods, ...input.dislikes])]);
  const unknownTerms = [...allergies.unknownTerms, ...dislikes.unknownTerms];
  const unknownFoodIds = [...allergies.selectedIds, ...dislikes.selectedIds].filter(
    (id) => !foodIds.has(id),
  );
  const unknownCategoryIds = [...input.allergies, ...input.dislikes]
    .filter((term) => term.startsWith('category:'))
    .map((term) => term.slice(9))
    .filter((id) => !categoryIds.has(id));

  if (unknownTerms.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownTerms.join(', ')}.`,
    );
  }
  if (unknownFoodIds.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownFoodIds.join(', ')}.`,
    );
  }
  if (unknownCategoryIds.length > 0) {
    throw new Error(
      `Choose allergies and dislikes from the suggestion list only: ${unknownCategoryIds.join(', ')}.`,
    );
  }

  return foods.filter((food) => {
    if (input.dietType === 'vegan' && !food.isVegan) {
      return false;
    }
    if (input.dietType === 'vegetarian' && !food.isVegetarian) {
      return false;
    }
    const foodTerms = searchableTermsForFood(food);

    if (hasSemanticMatch(foodTerms, allergies.semanticTags)) {
      return false;
    }
    if (allergies.selectedIds.has(food.id)) {
      return false;
    }
    if (dislikes.selectedIds.has(food.id)) {
      return false;
    }
    if (hasSemanticMatch(foodTerms, dislikes.semanticTags)) {
      return false;
    }

    return true;
  });
}

function searchableTermsForFood(food) {
  return new Set(
    [
      food.id,
      food.name,
      food.nameAr,
      food.macroRole,
      ...food.allergens,
      ...food.categories,
    ]
      .filter(Boolean)
      .map(normalizeToken),
  );
}

function hasSemanticMatch(foodTerms, selectedTerms) {
  for (const term of selectedTerms) {
    if (foodTerms.has(normalizeToken(term))) {
      return true;
    }
  }

  return false;
}

function servingRealismPenalty(items) {
  if (items.length === 0) return 1;
  return items.reduce((sum, item) => {
    const min = Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20;
    const max = Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500;
    const center = (min + max) / 2;
    const span = Math.max(1, max - min);
    return sum + Math.abs(item.quantityG - center) / span;
  }, 0) / items.length;
}

function macroFitDetails(items, target) {
  const totals = totalsForItems(items);
  const residual = {
    calories: totals.calories - target.calories,
    proteinG: totals.proteinG - target.proteinG,
    carbG: totals.carbG - target.carbG,
    fatG: totals.fatG - target.fatG,
  };
  return {
    totals,
    residual,
    withinTolerance: isWithinTolerance(items, target),
    score: mealScore(items, target),
  };
}

function roundedMacros(macros) {
  if (!macros) return null;
  return Object.fromEntries(
    Object.entries(macros).map(([key, value]) => [
      key,
      Number.isFinite(value) ? Number(value.toFixed(key === 'calories' ? 0 : 1)) : value,
    ]),
  );
}

function generateReadyMealDay({ mealTargets, dailyTargets, allowedFoods }) {
  const candidateSets = mealTargets.map((target) => ({
    target,
    candidates: readyMealCandidatesForMeal({
      mealTag: target.tag,
      allowedFoods,
      target: target.targets,
    }),
  }));
  const missing = candidateSets.filter((slot) => slot.candidates.length === 0);
  if (missing.length > 0) {
    return candidateSets.map((slot) => {
      const best = slot.candidates[0];
      if (best) {
        return buildReadyMealFromCandidate({
          target: slot.target,
          candidate: best,
          alternates: slot.candidates.slice(1),
        });
      }

      const generationDebug = logMealGenerationFailure({
        mealType: slot.target.tag,
        targetMacros: slot.target.targets,
        failureReason: `No ready meal from the database matched ${slot.target.name} within the macro constraints.`,
      });
      return emptyMeal(
        slot.target,
        `No ready meal matched ${slot.target.name} with the current targets and restrictions.`,
        generationDebug,
      );
    });
  }

  const selected = selectReadyMealDayCombination(candidateSets, dailyTargets);
  return candidateSets.map((slot, index) => buildReadyMealFromCandidate({
    target: slot.target,
    candidate: selected[index],
    alternates: slot.candidates.filter((candidate) => candidate.readyMeal.id !== selected[index].readyMeal.id),
  }));
}

function readyMealCandidatesForMeal({ mealTag, allowedFoods, target }) {
  const allowedFoodByName = new Map(allowedFoods.map((food) => [normalizeIngredientName(food.name), food]));
  const tags = templateTagsForMealTag(mealTag);
  const acceptanceBounds = computeMealBounds(target);
  return loadReadyMealBundles()
    .filter((readyMeal) => tags.includes(readyMeal.mealTag))
    .map((readyMeal) => solveReadyMealCandidate(readyMeal, allowedFoodByName, target, {
      bounds: acceptanceBounds,
    }))
    .filter(Boolean)
    .filter((candidate) => totalsWithinMealTolerance(candidate.totals, target))
    .sort((a, b) => compareRankedMealCandidates(a, b, target));
}

function selectReadyMealDayCombination(candidateSets, dailyTargets) {
  const beamWidth = 2500;
  let beam = [{
    candidates: [],
    totals: { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
    mealScore: 0,
  }];

  for (const slot of candidateSets) {
    const next = [];
    for (const partial of beam) {
      for (const candidate of slot.candidates) {
        const totals = addMacros(partial.totals, candidate.totals);
        next.push({
          candidates: [...partial.candidates, candidate],
          totals,
          mealScore: partial.mealScore + candidate.score,
        });
      }
    }

    next.sort((a, b) => compareDayCandidates(a, b, dailyTargets));
    beam = next.slice(0, beamWidth);
  }

  return beam[0].candidates;
}

function compareDayCandidates(a, b, dailyTargets) {
  const aWithin = residualWithinTolerance(a.totals, dailyTargets);
  const bWithin = residualWithinTolerance(b.totals, dailyTargets);
  if (aWithin !== bWithin) return aWithin ? -1 : 1;

  const aScore = calculateResidualScore(a.totals, dailyTargets);
  const bScore = calculateResidualScore(b.totals, dailyTargets);
  return (
    aScore - bScore ||
    a.mealScore - b.mealScore ||
    daySignature(a).localeCompare(daySignature(b), undefined, { numeric: true })
  );
}

function daySignature(day) {
  return day.candidates.map((candidate) => candidate.readyMeal.id).join('|');
}

function buildReadyMealFromCandidate({ target, candidate, alternates }) {
  return buildReadyMeal({
    target,
    items: candidate.items,
    readyMeal: candidate.readyMeal,
    alternates,
    generationSource: 'ready_meal_database',
    generationDebug: readyMealGenerationDebug({
      mealTag: target.tag,
      targetMacros: target.targets,
      selected: candidate,
      candidateCount: alternates.length + 1,
    }),
  });
}

function readyMealGenerationDebug({ mealTag, targetMacros, selected, candidateCount }) {
  return {
    mealType: mealTag,
    targetMacros,
    selectedTemplate: {
      templateId: selected.readyMeal.id,
      name: readyMealDisplayName(selected.readyMeal),
      family: selected.readyMeal.track,
    },
    originalTemplateSolved: true,
    originalTemplateMacroFit: selected.fit,
    swapsTried: 0,
    swapsAccepted: 0,
    bestCandidateSource: 'ready_meal_database',
    candidatesTriedBySwapCount: { 0: candidateCount, 1: 0, 2: 0 },
    selectedCandidateSwapCount: 0,
    selectedCandidateSource: 'ready_meal_database',
    selectedCandidateReason: 'ready_meal_day_fit',
    finalMacroFit: selected.fit,
    failureReason: null,
  };
}

function solveReadyMealCandidate(readyMeal, allowedFoodByName, target, options = {}) {
  const items = [];
  for (const component of readyMeal.components) {
    const food = allowedFoodByName.get(normalizeIngredientName(component.lookupName));
    if (!food) return null;
    items.push({
      food,
      quantityG: clampServing(food, food.defaultServingG),
      component: {
        slot: component.slot,
        foodId: food.id,
        ingredientName: component.ingredientName,
        lookupName: component.lookupName,
        readyMealId: readyMeal.id,
        swapEnabled: false,
      },
    });
  }

  const acceptanceBounds = options.bounds ?? targetToleranceBounds(target);
  const gridFit = findBestPortionGridFit(items, target, acceptanceBounds, items, {
    step: EXACT_PORTION_SEARCH_STEP_G,
  });

  if (!gridFit) return null;

  const withTotals = hydrateSolvedItems(gridFit.items);
  const fit = macroFitDetails(withTotals, target);

  return {
    readyMeal,
    items: withTotals,
    totals: fit.totals,
    fit,
    rankTuple: mealRankTuple(fit.totals, target, acceptanceBounds),
    score: fit.score + servingRealismPenalty(withTotals) * 0.25,
  };
}

function buildReadyMeal({
  target,
  items,
  readyMeal,
  alternates = [],
  generationSource = null,
  generationDebug = null,
}) {
  const totals = sumTargets(items.map((item) => item.totals));
  return {
    name: target.name,
    tag: target.tag,
    target: target.targets,
    slotProfile: target.slotProfile ?? null,
    templateId: readyMeal.id,
    templateName: readyMealDisplayName(readyMeal),
    templateFamily: readyMeal.track ?? null,
    readyMealId: readyMeal.id,
    readyMealTrack: readyMeal.track ?? null,
    templateAlternates: [],
    generationSource,
    isOriginalTemplate: true,
    numberOfSwaps: 0,
    candidateSource: generationSource,
    swapsApplied: [],
    generationDebug,
    items,
    mealOptions: buildReadyMealOptions({ target, alternates }),
    totals,
    isApproximate: !isWithinTolerance(items, target.targets),
  };
}

function buildReadyMealOptions({ target, alternates }) {
  return (alternates || []).map((candidate) => ({
    templateId: candidate.readyMeal.id,
    templateName: readyMealDisplayName(candidate.readyMeal),
    templateFamily: candidate.readyMeal.track ?? null,
    readyMealId: candidate.readyMeal.id,
    readyMealTrack: candidate.readyMeal.track ?? null,
    items: candidate.items,
    totals: candidate.totals,
    isApproximate: !isWithinTolerance(candidate.items, target.targets),
  }));
}

function hydrateSolvedItems(items) {
  return items.map((item) => ({
    ...item,
    alternatives: [],
    broaderAlternatives: [],
    nearestAlternatives: [],
    totals: macrosForFoodPortion(item.food, item.quantityG),
  }));
}

function readyMealDisplayName(readyMeal) {
  return readyMeal.track ? `${readyMeal.id} - ${readyMeal.track}` : readyMeal.id;
}

function normalizeIngredientName(name) {
  return String(name || '').trim().toLowerCase();
}

function logMealGenerationFailure({ mealType, targetMacros, failureReason }) {
  const generationDebug = {
    mealType,
    targetMacros: roundedMacros(targetMacros),
    selectedTemplateId: null,
    selectedTemplateName: null,
    family: null,
    originalTemplateSolved: false,
    originalTemplateMacroFit: null,
    swapsTried: 0,
    swapsAccepted: 0,
    bestCandidateSource: null,
    candidatesTriedBySwapCount: { 0: 0, 1: 0, 2: 0 },
    selectedCandidateSwapCount: null,
    selectedCandidateSource: null,
    selectedCandidateReason: null,
    numberOfSwaps: null,
    candidateSource: null,
    finalMacroFit: null,
    failureReason,
  };

  if (DEBUG_MEAL_GENERATION) {
    console.log(JSON.stringify(generationDebug));
  }

  return generationDebug;
}

function mealOptionSignature(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map((item) => item.food?.id).filter(Boolean).join('|');
}

function isStrictMealOptionFit(totals, target) {
  return totalsWithinMealTolerance(totals, target);
}

function mealOptionForTarget(option, target) {
  if (!option || !Array.isArray(option.items) || option.items.length === 0 || !target) return null;
  const currentTotals = sumTargets(option.items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
  if (!isStrictMealOptionFit(currentTotals, target)) return null;
  return {
    ...option,
    items: option.items.map((item) => ({
      ...item,
      totals: macrosForFoodPortion(item.food, item.quantityG),
    })),
    totals: currentTotals,
    isApproximate: false,
  };
}

function emptyMeal(target, reason = null, generationDebug = null) {
  return {
    name: target.name,
    tag: target.tag,
    target: target.targets,
    templateId: null,
    templateName: null,
    isOriginalTemplate: false,
    numberOfSwaps: 0,
    candidateSource: 'failed',
    items: [],
    totals: { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
    isApproximate: true,
    ...(reason ? { unavailableReason: reason } : {}),
    ...(generationDebug ? { generationDebug } : {}),
  };
}

function templateTagsForMealTag(mealTag) {
  if (mealTag === 'iftar') return ['dinner', 'lunch'];
  if (mealTag === 'suhoor') return ['breakfast', 'dinner'];
  if (mealTag === 'main' || mealTag === 'main_meal') return ['lunch', 'dinner'];
  return [mealTag];
}

function clampServing(food, quantityG) {
  const min = Number.isFinite(food.minServingG) ? food.minServingG : 20;
  const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
  return roundServingWithinBounds(quantityG, min, max);
}

function roundServingWithinBounds(quantityG, min, max, step = 5) {
  const clamped = clamp(quantityG, min, max);
  let rounded = roundToNearest(clamped, step);
  if (rounded < min) rounded = Math.ceil(min / step) * step;
  if (rounded > max) rounded = Math.floor(max / step) * step;
  return clamp(rounded, min, max);
}

function totalsForItems(items) {
  return sumTargets(items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
}

function computeMealBounds(target) {
  if (target?.macroWindows) {
    return cloneMacroBounds(target.macroWindows);
  }
  throw new Error('Meal macroWindows are required.');
}

function cloneMacroBounds(bounds) {
  const cloned = {
    calories: { ...bounds.calories },
    proteinG: { ...bounds.proteinG },
    fatG: { ...bounds.fatG },
  };
  if (bounds.scaling) cloned.scaling = bounds.scaling;
  return cloned;
}

function validateMealSwap({
  mealTarget,
  proposedMealTotals,
}) {
  if (!mealTarget?.macroWindows || !proposedMealTotals) {
    return {
      valid: false,
      violations: ['meal_context'],
      bounds: null,
    };
  }

  const bounds = computeMealBounds(mealTarget);
  const violations = findBoundsViolations(proposedMealTotals, bounds)
    .map((violation) => `meal_${violation}`);

  return {
    valid: violations.length === 0,
    violations,
    bounds,
  };
}

function findBoundsViolation(totals, bounds) {
  return findBoundsViolations(totals, bounds)[0] ?? null;
}

function findBoundsViolations(totals, bounds) {
  const violations = [];
  if (totals.calories < bounds.calories.min || totals.calories > bounds.calories.max) {
    violations.push('calories');
  }
  if (totals.proteinG < bounds.proteinG.min || totals.proteinG > bounds.proteinG.max) {
    violations.push('protein');
  }
  if (totals.fatG < bounds.fatG.min || totals.fatG > bounds.fatG.max) {
    violations.push('fat');
  }

  return violations;
}

function isWithinTolerance(items, target) {
  const totals = totalsForItems(items);
  return totalsWithinMealTolerance(totals, target);
}

function targetToleranceBounds(target) {
  return computeMealBounds(target);
}

function totalsWithinMealTolerance(totals, target) {
  return findBoundsViolation(totals, computeMealBounds(target)) === null;
}

function mealScore(items, target) {
  const totals = totalsForItems(items);
  // Weight calories 3× — calorie accuracy is the primary quality signal
  const calorieScore = 3 * Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
  const proteinScore = Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG);
  const fatScore = Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG);
  return calorieScore + proteinScore + fatScore;
}

function produceGroup(food) {
  const categories = new Set(food?.categories || []);
  if (categories.has('fruits') || categories.has('fruit')) return 'fruit';
  if (categories.has('vegetables') || categories.has('vegetable')) return 'vegetable';
  return null;
}

// ── Interactive meal rebalancing ─────────────────────────────────────────────

function resolveMealActionItems(rawItems) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((f) => [f.id, f]));
  return rawItems.map((item) => {
    const food = resolveFoodForMealAction(item, foodMap);
    if (!food) throw new Error(`Unknown food id: ${item.foodId}`);
    return {
      food,
      quantityG: clampServing(food, Number(item.quantityG) || food.defaultServingG),
      custom: Boolean(item.customFood || String(food.id).startsWith('custom_')),
    };
  });
}

function resolveFoodForMealAction(item, foodMap) {
  const foodId = String(item.foodId ?? item.food?.id ?? '');
  const known = foodMap.get(foodId);
  if (known) return known;
  const custom = item.customFood || item.food;
  if (!custom || !foodId.startsWith('custom_')) return null;
  const servingG = Number(custom.servingG ?? item.quantityG ?? 100) || 100;
  const calories = Number(custom.calories ?? custom.caloriesPerServing ?? custom.caloriesPer100g ?? 0);
  const proteinG = Number(custom.proteinG ?? custom.proteinGPerServing ?? custom.proteinGPer100g ?? 0);
  const carbG = Number(custom.carbG ?? custom.carbGPerServing ?? custom.carbGPer100g ?? 0);
  const fatG = Number(custom.fatG ?? custom.fatGPerServing ?? custom.fatGPer100g ?? 0);
  const factor = 100 / Math.max(1, servingG);
  const macroRole = dominantMacroRole({ proteinG, carbG, fatG });
  return {
    id: foodId,
    name: String(custom.name || item.name || 'Custom food'),
    nameAr: '',
    macroRole,
    caloriesPer100g: calories * factor,
    proteinGPer100g: proteinG * factor,
    carbGPer100g: carbG * factor,
    fatGPer100g: fatG * factor,
    isVegan: Boolean(custom.isVegan),
    isVegetarian: Boolean(custom.isVegetarian),
    allergens: Array.isArray(custom.allergens) ? custom.allergens : [],
    categories: ['custom_food', macroRole],
    mealTags: ['breakfast', 'lunch', 'dinner', 'snack', 'iftar', 'suhoor'],
    defaultServingG: servingG,
    minServingG: 0,
    maxServingG: Math.max(servingG, Number(custom.maxServingG ?? servingG)),
    subCategory: null,
    cuisineTag: 'custom',
    dietTags: [],
    custom: true,
  };
}

function dominantMacroRole({ proteinG, carbG, fatG }) {
  const scores = [
    ['protein', proteinG * NUTRITION.proteinKcalPerGram],
    ['carb', carbG * NUTRITION.carbKcalPerGram],
    ['fat', fatG * NUTRITION.fatKcalPerGram],
  ].sort((a, b) => b[1] - a[1]);
  if (scores[0][1] <= 0) return 'mixed';
  return scores[0][1] >= scores[1][1] * 1.35 ? scores[0][0] : 'mixed';
}

function findBestPortionGridFit(items, target, bounds, seedItems = items, options = {}) {
  const keys = macroBoundKeys(bounds);
  const step = Number.isFinite(options.step) && options.step > 0 ? options.step : EXACT_PORTION_SEARCH_STEP_G;
  const findBest = options.findBest === true;
  const seedByFoodId = new Map(seedItems.map((item) => [item.food.id, item.quantityG]));

  const variables = items
    .map((item, index) => ({ item, index }))
    .map(({ item, index }) => {
      const min = Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20;
      const max = Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500;
      const seed = roundServingWithinBounds(seedByFoodId.get(item.food.id) ?? item.quantityG, min, max, step);
      return {
        item,
        index,
        min,
        max,
        seed,
        rates: {
          calories: item.food.caloriesPer100g / 100,
          proteinG: item.food.proteinGPer100g / 100,
          carbG: item.food.carbGPer100g / 100,
          fatG: item.food.fatGPer100g / 100,
        },
      };
    })
    .filter((entry) => entry.max >= entry.min)
    .sort((a, b) => (
      servingStepCount(a.min, a.max, step) - servingStepCount(b.min, b.max, step) ||
      macroLeverage(b, keys) - macroLeverage(a, keys)
    ));

  if (variables.length === 0) return null;

  const suffix = Array.from({ length: variables.length + 1 }, () => emptyMacroRange());
  for (let i = variables.length - 1; i >= 0; i--) {
    const current = variableMacroRange(variables[i]);
    suffix[i] = addMacroRanges(current, suffix[i + 1]);
  }

  let found = null;
  let foundScore = Infinity;
  let foundTotals = null;
  let visited = 0;
  const chosen = new Map();

  function canStillFit(totals, pos) {
    const remaining = suffix[pos];
    return keys.every((key) => (
      totals[key] + remaining.min[key] <= bounds[key].max &&
      totals[key] + remaining.max[key] >= bounds[key].min
    ));
  }

  function lowerBoundScore(totals, pos) {
    const remaining = suffix[pos];
    const closest = {};
    for (const key of keys) {
      const minPossible = totals[key] + remaining.min[key];
      const maxPossible = totals[key] + remaining.max[key];
      closest[key] = clamp(target[key], minPossible, maxPossible);
    }
    return macroBoundFitScore(closest, target);
  }

  function visit(pos, totals) {
    visited += 1;
    if (!canStillFit(totals, pos)) return;
    if (findBest && lowerBoundScore(totals, pos) >= foundScore) return;

    if (pos >= variables.length) {
      if (findBoundsViolation(totals, bounds)) return;
      const score = macroBoundFitScore(totals, target);
      if (!findBest || score < foundScore) {
        foundScore = score;
        foundTotals = totals;
        found = new Map(chosen);
      }
      return;
    }

    const variable = variables[pos];
    for (const quantityG of feasibleQuantitiesForVariable(variable, totals, suffix[pos + 1], bounds, keys, step)) {
      chosen.set(variable.index, quantityG);
      visit(pos + 1, addMacros(totals, macrosForRates(variable.rates, quantityG)));
      chosen.delete(variable.index);
      if (found && !findBest) break;
    }
  }

  visit(0, { calories: 0, proteinG: 0, carbG: 0, fatG: 0 });
  if (!found) return null;

  return {
    items: items.map((item, index) => (
      found.has(index)
        ? { ...item, quantityG: found.get(index) }
        : item
    )),
    totals: foundTotals,
    score: foundScore,
    visited,
  };
}

function macroBoundKeys(bounds) {
  return ['calories', 'proteinG', 'fatG'].filter((key) => bounds[key]);
}

function servingGridCandidates(food, seedQuantityG, step = 5) {
  const min = Number.isFinite(food.minServingG) ? food.minServingG : 20;
  const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
  const first = Math.ceil(min / step) * step;
  const last = Math.floor(max / step) * step;
  const candidates = [];

  for (let quantityG = first; quantityG <= last; quantityG += step) {
    candidates.push(quantityG);
  }

  const seed = roundServingWithinBounds(seedQuantityG, min, max, step);
  if (!candidates.includes(seed)) candidates.push(seed);

  return [...new Set(candidates)]
    .sort((a, b) => Math.abs(a - seed) - Math.abs(b - seed) || a - b);
}

function servingStepCount(min, max, step) {
  return Math.max(0, Math.floor(max / step) - Math.ceil(min / step) + 1);
}

function macroLeverage(variable, keys) {
  const span = variable.max - variable.min;
  return keys.reduce((score, key) => score + Math.abs(variable.rates[key] || 0) * span, 0);
}

function feasibleQuantitiesForVariable(variable, totals, remaining, bounds, keys, step) {
  let min = variable.min;
  let max = variable.max;

  for (const key of keys) {
    const rate = variable.rates[key] || 0;
    if (rate <= 0) {
      if (
        totals[key] + remaining.min[key] > bounds[key].max ||
        totals[key] + remaining.max[key] < bounds[key].min
      ) {
        return [];
      }
      continue;
    }

    min = Math.max(min, (bounds[key].min - totals[key] - remaining.max[key]) / rate);
    max = Math.min(max, (bounds[key].max - totals[key] - remaining.min[key]) / rate);
  }

  const first = Math.ceil(min / step) * step;
  const last = Math.floor(max / step) * step;
  if (first > last) return [];

  const candidates = [];
  for (let quantityG = first; quantityG <= last; quantityG += step) {
    candidates.push(quantityG);
  }

  return candidates.sort((a, b) => Math.abs(a - variable.seed) - Math.abs(b - variable.seed) || a - b);
}

function macrosForRates(rates, quantityG) {
  return {
    calories: rates.calories * quantityG,
    proteinG: rates.proteinG * quantityG,
    carbG: rates.carbG * quantityG,
    fatG: rates.fatG * quantityG,
  };
}

function emptyMacroRange() {
  const empty = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
  return { min: { ...empty }, max: { ...empty } };
}

function variableMacroRange(variable) {
  return {
    min: macrosForRates(variable.rates, variable.min),
    max: macrosForRates(variable.rates, variable.max),
  };
}

function addMacroRanges(left, right) {
  const range = emptyMacroRange();
  for (const key of Object.keys(range.min)) {
    range.min[key] = left.min[key] + right.min[key];
    range.max[key] = left.max[key] + right.max[key];
  }
  return range;
}

function addMacros(left, right) {
  return {
    calories: left.calories + right.calories,
    proteinG: left.proteinG + right.proteinG,
    carbG: left.carbG + right.carbG,
    fatG: left.fatG + right.fatG,
  };
}

function subtractMacros(left, right) {
  return {
    calories: left.calories - right.calories,
    proteinG: left.proteinG - right.proteinG,
    carbG: left.carbG - right.carbG,
    fatG: left.fatG - right.fatG,
  };
}

function macroBoundFitScore(totals, target) {
  if (target?.macroWindows) {
    const [calorieScore, proteinScore, fatScore] = mealRankTuple(
      totals,
      target,
      computeMealBounds(target),
    );
    return calorieScore * 1_000_000 + proteinScore * 1_000 + fatScore;
  }
  return (
    3 * Math.abs(totals.calories - target.calories) / Math.max(1, target.calories) +
    Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG) +
    Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG)
  );
}

function compareRankedMealCandidates(a, b, target) {
  const aTuple = a.rankTuple ?? mealRankTuple(a.totals, target, computeMealBounds(target));
  const bTuple = b.rankTuple ?? mealRankTuple(b.totals, target, computeMealBounds(target));
  for (let index = 0; index < aTuple.length; index += 1) {
    if (aTuple[index] !== bTuple[index]) return aTuple[index] - bTuple[index];
  }
  return a.readyMeal.id.localeCompare(b.readyMeal.id, undefined, { numeric: true });
}

function mealRankTuple(totals, target, bounds = computeMealBounds(target)) {
  if (!target?.macroWindows) {
    return [
      Math.abs(totals.calories - target.calories),
      Math.abs(totals.proteinG - target.proteinG),
      Math.abs(totals.fatG - target.fatG),
    ];
  }
  return [
    Math.abs(totals.calories - target.calories),
    Math.abs(totals.proteinG - rangeMidpoint(bounds.proteinG)),
    Math.abs(totals.fatG - rangeMidpoint(bounds.fatG)),
  ];
}

function rangeMidpoint(range) {
  return (range.min + range.max) / 2;
}

function rebalanceMeal({
  mealTarget,
  items: rawItems,
  mealBounds,
  dailyContext,
  action,
  changedItemIndex,
}) {
  const items = resolveMealActionItems(rawItems);
  const bounds = mealBounds ?? computeMealBounds(mealTarget);

  const initialTotals = totalsForItems(items);
  if (!findBoundsViolation(initialTotals, bounds)) {
    return rebalanceSuccess(items, mealTarget, dailyContext, initialTotals, 'already_inside_ranges');
  }

  if (action === 'swap_food' && Number.isInteger(changedItemIndex)) {
    const swappedOnlyItems = findChangedItemOnlyFit(items, changedItemIndex, mealTarget, bounds);
    if (swappedOnlyItems) {
      return rebalanceSuccess(
        swappedOnlyItems,
        mealTarget,
        dailyContext,
        totalsForItems(swappedOnlyItems),
        'changed_item_only',
      );
    }
  }

  const fullMealItems = findWholeMealDistributionFit(items, mealTarget, bounds);
  if (fullMealItems) {
    return rebalanceSuccess(
      fullMealItems,
      mealTarget,
      dailyContext,
      totalsForItems(fullMealItems),
      'whole_meal_distribution',
    );
  }

  return { success: false, violatedMacro: findBoundsViolation(initialTotals, bounds) };
}

function rebalanceSuccess(items, mealTarget, dailyContext, totals, fitSource) {
  const mealValidation = dailyContext
    ? validateMealSwap({ ...dailyContext, mealTarget, proposedMealTotals: totals })
    : null;
  if (mealValidation && !mealValidation.valid) {
    return {
      success: false,
      violatedMacro: mealValidation.violations[0],
      mealValidation,
    };
  }

  return {
    success: true,
    fitSource,
    items: items.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
    totals,
    ...(mealValidation ? { mealValidation } : {}),
  };
}

function findChangedItemOnlyFit(items, changedItemIndex, target, bounds) {
  if (changedItemIndex < 0 || changedItemIndex >= items.length) return null;
  const changedItem = items[changedItemIndex];
  if (!changedItem?.food) return null;

  const baseTotals = subtractMacros(
    totalsForItems(items),
    macrosForFoodPortion(changedItem.food, changedItem.quantityG),
  );
  let bestQuantityG = null;
  let bestScore = Infinity;

  for (const quantityG of servingGridCandidates(changedItem.food, changedItem.quantityG, 1)) {
    const totals = addMacros(baseTotals, macrosForFoodPortion(changedItem.food, quantityG));
    if (findBoundsViolation(totals, bounds)) continue;
    const score = macroBoundFitScore(totals, target);
    const currentBestDistance = Math.abs((bestQuantityG ?? changedItem.quantityG) - changedItem.quantityG);
    const candidateDistance = Math.abs(quantityG - changedItem.quantityG);
    if (
      score < bestScore ||
      (score === bestScore && candidateDistance < currentBestDistance)
    ) {
      bestQuantityG = quantityG;
      bestScore = score;
    }
  }

  if (bestQuantityG === null) return null;
  return items.map((item, index) => (
    index === changedItemIndex ? { ...item, quantityG: bestQuantityG } : item
  ));
}

function findWholeMealDistributionFit(items, target, bounds) {
  const result = findBestPortionGridFit(items, target, bounds, items, {
    step: 1,
  });
  return result?.items ?? null;
}

function getProduceSwapOptions({
  itemIndex,
  currentItems,
  mealTarget,
  dailyContext,
  userPreferences = {},
  limit = 20,
}) {
  if (!Number.isInteger(itemIndex) || !Array.isArray(currentItems) || !mealTarget || !dailyContext) {
    throw new Error('itemIndex, currentItems, mealTarget, and dailyContext are required.');
  }

  const resolvedItems = resolveMealActionItems(currentItems);
  const currentItem = resolvedItems[itemIndex];
  const group = produceGroup(currentItem?.food);
  if (!currentItem || !group) {
    return { group: null, options: [] };
  }

  const foods = loadFoods();
  const safeInput = {
    dietType: userPreferences?.dietType || 'standard',
    avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
    allergies: [],
    dislikes: Array.isArray(userPreferences?.dislikes) ? userPreferences.dislikes : [],
  };

  let allowedFoods;
  try {
    allowedFoods = filterFoods(foods, safeInput);
  } catch {
    const avoided = new Set(safeInput.avoidFoods.map(String));
    allowedFoods = foods.filter((food) => !avoided.has(food.id));
  }

  const sortedGroupFoods = allowedFoods
    .filter((food) => produceGroup(food) === group)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (sortedGroupFoods.length <= 1) {
    return { group, options: [] };
  }

  const startIndex = Math.max(0, sortedGroupFoods.findIndex((food) => food.id === currentItem.food.id));
  const orderedCandidates = [];
  for (let offset = 1; offset <= sortedGroupFoods.length; offset += 1) {
    const candidate = sortedGroupFoods[(startIndex + offset) % sortedGroupFoods.length];
    if (candidate.id !== currentItem.food.id) orderedCandidates.push(candidate);
  }

  const options = [];
  for (const candidate of orderedCandidates) {
    if (options.length >= limit) break;

    const replacementQuantityG = clampServing(candidate, currentItem.quantityG);
    const attemptedItems = currentItems.map((rawItem, index) => {
      if (index === itemIndex) {
        return { foodId: candidate.id, quantityG: replacementQuantityG };
      }
      return {
        foodId: rawItem.foodId ?? rawItem.food?.id,
        quantityG: rawItem.quantityG,
        customFood: rawItem.customFood || null,
      };
    });

    let result;
    try {
      result = rebalanceMeal({ mealTarget, items: attemptedItems, dailyContext });
    } catch {
      continue;
    }
    if (!result.success) continue;

    options.push({
      food: candidate,
      items: hydrateProduceSwapItems(attemptedItems, result.items),
      totals: result.totals,
    });
  }

  return { group, options };
}

function hydrateProduceSwapItems(requestItems, solvedItems) {
  const foods = loadFoods();
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const requestById = new Map(requestItems.map((item) => [String(item.foodId), item]));

  return (solvedItems || []).map((item) => {
    const foodId = String(item.foodId);
    const request = requestById.get(foodId);
    const food = foodById.get(foodId) || resolveFoodForMealAction(request || item, foodById);
    if (!food) return null;
    return {
      food,
      quantityG: item.quantityG,
      customFood: request?.customFood || null,
    };
  }).filter(Boolean);
}

module.exports = {
  generatePlan,
  getFoods,
  rebalanceMeal,
  getProduceSwapOptions,
};
