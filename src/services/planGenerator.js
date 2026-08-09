const { loadFoods } = require('../repositories/foodRepository');
const { loadTemplates } = require('../repositories/templateRepository');
const { loadSwapSystem } = require('../repositories/swapSystemRepository');
const { loadReadyMealBundles } = require('../repositories/readyMealRepository');
const { getSwapCandidates, applySwapToTemplate } = require('./mealSwapService');
const { normalizeToken, resolvePreferenceTerms } = require('../config/preferenceTaxonomy');
const {
  NUTRITION,
  buildMealTargets,
  calculateNutritionDetails,
  macrosForFoodPortion,
  sumTargets,
  roundToNearest,
  clamp,
} = require('./nutritionService');

const ACTIVITY_LEVELS = new Set([
  'sedentary',
  'light',
  'moderate',
  'athlete',
]);
const GOALS = new Set(['maintain', 'lose_weight', 'lose_weight_aggressive', 'gain_weight']);
const SEXES = new Set(['male', 'female']);
const MEAL_DISTRIBUTIONS = new Set([
  'balanced',
  'breakfast_heavy',
  'lunch_heavy',
  'dinner_heavy',
]);
const DIETS = new Set(['standard', 'vegetarian', 'vegan']);
const DEBUG_OPTIMIZER = process.env.NUTRITION_DEBUG === '1';
const DEBUG_MEAL_GENERATION = process.env.DEBUG_MEAL_GENERATION === 'true';
const NEAREST_ALTERNATIVE_LIMIT = 4;
const MEAL_OPTION_LIMIT = 250;
const EXACT_PORTION_SEARCH_STEP_G = 1;
const EXACT_PORTION_SEARCH_MAX_VISITS = 250000;
const EXACT_PORTION_SEARCH_MAX_MS = 60;
const COFFEE_MILK_GRAMS_PER_COFFEE = 50;
const MILK_TYPE_FOOD_IDS = {
  skimmed: 'skimmed_milk_fat_free',
  whole: 'milk_whole_3_25_milkfat',
};

function getFoods() {
  return loadFoods();
}

function generatePlan(rawInput) {
  return _generatePlanInternal(rawInput, true);
}

function generatePlanFreeform(rawInput) {
  return _generatePlanInternal(rawInput, true);
}

function _generatePlanInternal(rawInput, useTemplates) {
  const input = normalizeInput(rawInput);
  const nutritionCalculation = calculateNutritionDetails(input);
  const dailyTargets = nutritionCalculation.targets;
  const mealTargets = buildMealTargets(dailyTargets, input);
  const allowedFoods = filterFoods(loadFoods(), input);

  if (allowedFoods.length === 0) {
    throw new Error('No foods match the selected restrictions. Try removing one filter.');
  }

  const generatedMeals = useTemplates
    ? generateReadyMealDay({ mealTargets, dailyTargets, allowedFoods })
    : mealTargets.map((target, index) =>
        generateMeal({ target, allowedFoods, mealIndex: index, input, useTemplates })
      );

  const optimization = useTemplates
    ? optimizeTemplateDay(generatedMeals, dailyTargets)
    : {
        meals: generatedMeals,
        warnings: [],
        errors: generatedMeals
          .filter((meal) => meal.items.length === 0 && meal.unavailableReason)
          .map((meal) => meal.unavailableReason),
      };

  const coffeeApplied = applyCoffeeMilkAllowance({
    meals: optimization.meals,
    input,
    allowedFoods,
  });

  const meals = coffeeApplied.meals.map((meal) => {
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
      }).valid)
      .slice(0, MEAL_OPTION_LIMIT);
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
      isApproximate: useTemplates ? !isWithinTolerance(plainItems, seedTarget) : !isWithinTolerance(plainItems, meal.target),
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
      adjustmentCalories: nutritionCalculation.adjustmentCalories,
      requestedDailyDeficitCalories: nutritionCalculation.requestedDailyDeficitCalories,
      weeklyWeightLossPercent: nutritionCalculation.weeklyWeightLossPercent,
      proteinPerKg: nutritionCalculation.proteinPerKg,
      fatPerKg: nutritionCalculation.fatPerKg,
    },
    meals,
    ...(optimization.diagnostics ? { diagnostics: optimization.diagnostics } : {}),
    ...([...optimization.warnings, ...coffeeApplied.warnings].length > 0 ? {
      warnings: [...optimization.warnings, ...coffeeApplied.warnings],
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

function optimizeTemplateDay(meals, dailyTargets) {
  if (meals.some((meal) => meal.target?.macroWindows)) {
    const totals = totalsForMeals(meals);
    const diagnostics = buildPlanDiagnostics(totals, dailyTargets, meals);
    return {
      meals,
      warnings: diagnostics.warnings,
      errors: diagnostics.errors,
      diagnostics,
    };
  }

  debugOptimizer('daily target', dailyTargets);
  meals.forEach((meal) => {
    debugOptimizer('slot solved before repair', {
      name: meal.name,
      tag: meal.tag,
      profile: meal.slotProfile,
      template: meal.templateName,
      totals: meal.totals,
      alternateCount: meal.templateAlternates?.length ?? 0,
    });
  });

  let currentMeals = repairTemplateDay(meals, dailyTargets);
  currentMeals = escalateTemplateDay(currentMeals, dailyTargets);
  const finalTotals = totalsForMeals(currentMeals);
  const diagnostics = buildPlanDiagnostics(finalTotals, dailyTargets, currentMeals);

  debugOptimizer('final total macros vs daily target', { totals: finalTotals, dailyTargets, diagnostics });

  return {
    meals: currentMeals,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
    diagnostics,
  };
}

function applyCoffeeMilkAllowance({ meals, input, allowedFoods }) {
  const coffeesPerDay = Number(input.coffeesPerDay) || 0;
  if (coffeesPerDay <= 0) {
    return { meals, warnings: [] };
  }

  const milkFoodId = MILK_TYPE_FOOD_IDS[input.milkType] || MILK_TYPE_FOOD_IDS.skimmed;
  const allowedById = new Map(allowedFoods.map((food) => [food.id, food]));
  const milkFood = allowedById.get(milkFoodId);

  if (!milkFood) {
    return {
      meals,
      warnings: ['Coffee milk was skipped because the selected milk does not match the current diet or avoid-food rules.'],
    };
  }

  const mealIndex = meals.findIndex((meal) => meal.tag === 'breakfast' && meal.items.length > 0);
  const targetIndex = mealIndex >= 0
    ? mealIndex
    : meals.findIndex((meal) => meal.items.length > 0);

  if (targetIndex < 0) {
    return {
      meals,
      warnings: ['Coffee milk was skipped because no generated meal could receive it.'],
    };
  }

  const quantityG = roundToNearest(coffeesPerDay * COFFEE_MILK_GRAMS_PER_COFFEE, 5);
  const coffeeLabel = `${coffeesPerDay} coffee${coffeesPerDay === 1 ? '' : 's'} milk allowance`;
  const item = {
    food: milkFood,
    quantityG,
    alternatives: [],
    broaderAlternatives: [],
    nearestAlternatives: [],
    component: {
      source: 'coffee_milk_allowance',
      ingredientName: coffeeLabel,
      readyMealId: meals[targetIndex].readyMealId ?? meals[targetIndex].templateId ?? null,
    },
    totals: macrosForFoodPortion(milkFood, quantityG),
  };

  return {
    meals: meals.map((meal, index) => (
      index === targetIndex
        ? { ...meal, items: [...meal.items, item] }
        : meal
    )),
    warnings: [],
  };
}

function repairTemplateDay(meals, dailyTargets) {
  let currentMeals = cloneMeals(meals);
  const tolerances = residualTolerances(dailyTargets);
  let currentTotals = totalsForMeals(currentMeals);
  let currentScore = calculateResidualScore(currentTotals, dailyTargets, tolerances);

  debugOptimizer('day-level residual before repair', calculateResidual(currentTotals, dailyTargets));
  debugOptimizer('residual score before repair', { score: currentScore });

  for (let pass = 1; pass <= 2; pass += 1) {
    if (residualWithinTolerance(currentTotals, dailyTargets, tolerances)) break;

    const residual = calculateResidual(currentTotals, dailyTargets);
    const repairSlots = chooseRepairSlots(currentMeals, residual, dailyTargets, 2);
    debugOptimizer('repair slot candidates', repairSlots.map((slot) => ({
      pass,
      meal: currentMeals[slot.mealIndex]?.name,
      macro: slot.macro,
      score: slot.score,
      reasoning: slot.reasoning,
    })));

    if (repairSlots.length === 0) break;

    const totalRepairScore = repairSlots.reduce((sum, slot) => sum + slot.score, 0) || 1;
    let passMeals = cloneMeals(currentMeals);

    for (const slot of repairSlots) {
      const meal = passMeals[slot.mealIndex];
      const share = slot.score / totalRepairScore;
      const adjustedTarget = targetWithResidualShare(meal, residual, share);
      const solvedItems = solvePortionsLeastSquares(meal.items, adjustedTarget, {
        maxIterations: NUTRITION.maxPortionAdjustmentIterations * 2,
      });
      const solvedTotals = totalsForItems(solvedItems);
      const hardMaxCalories = (meal.slotProfile?.hardMaxCaloriePercent ?? 1) * dailyTargets.calories;

      if (solvedTotals.calories > hardMaxCalories) {
        debugOptimizer('repair rejected hard max calories', {
          meal: meal.name,
          calories: solvedTotals.calories,
          hardMaxCalories,
        });
        continue;
      }
      if (!totalsWithinMealTolerance(solvedTotals, meal.target)) {
        debugOptimizer('repair rejected meal tolerance', {
          meal: meal.name,
          totals: solvedTotals,
          target: meal.target,
        });
        continue;
      }

      passMeals[slot.mealIndex] = mealWithSolvedItems(meal, solvedItems);
    }

    const passTotals = totalsForMeals(passMeals);
    const passScore = calculateResidualScore(passTotals, dailyTargets, tolerances);
    debugOptimizer('day-level residual after repair pass', {
      pass,
      residual: calculateResidual(passTotals, dailyTargets),
      score: passScore,
    });

    if (passScore < currentScore) {
      currentMeals = passMeals;
      currentTotals = passTotals;
      currentScore = passScore;
    } else {
      break;
    }
  }

  return currentMeals;
}

function escalateTemplateDay(meals, dailyTargets) {
  let currentMeals = cloneMeals(meals);
  const tolerances = residualTolerances(dailyTargets);
  let currentTotals = totalsForMeals(currentMeals);
  let currentScore = calculateResidualScore(currentTotals, dailyTargets, tolerances);

  if (residualWithinTolerance(currentTotals, dailyTargets, tolerances)) return currentMeals;

  const residual = calculateResidual(currentTotals, dailyTargets);
  const escalationSlots = chooseRepairSlots(currentMeals, residual, dailyTargets, 2);

  for (const slot of escalationSlots) {
    const meal = currentMeals[slot.mealIndex];
    const alternates = meal.templateAlternates ?? [];
    for (const alternate of alternates.slice(0, 2)) {
      const solvedItems = solvePortionsLeastSquares(alternate.items, {
        proteinG: meal.target.proteinG,
        carbG: meal.target.carbG,
        fatG: meal.target.fatG,
      });
      const candidateMeals = cloneMeals(currentMeals);
      candidateMeals[slot.mealIndex] = mealWithSolvedItems(
        {
          ...meal,
          templateName: alternate.template.name,
          templateAlternates: alternates.filter((candidate) => candidate.template !== alternate.template),
        },
        solvedItems,
      );

      const candidateTotals = totalsForMeals(candidateMeals);
      const candidateScore = calculateResidualScore(candidateTotals, dailyTargets, tolerances);
      const improvedEnough =
        candidateScore <= currentScore * (1 - NUTRITION.residualScoreImprovementThreshold);
      const pushesMacroOut = pushesMacroOutsideTolerance(currentTotals, candidateTotals, dailyTargets, tolerances);

      debugOptimizer('escalation attempt', {
        meal: meal.name,
        alternate: alternate.template.name,
        currentScore,
        candidateScore,
        improvedEnough,
        pushesMacroOut,
      });

      if (improvedEnough && !pushesMacroOut) {
        currentMeals = candidateMeals;
        currentTotals = candidateTotals;
        currentScore = candidateScore;
        break;
      }
    }
  }

  return repairTemplateDay(currentMeals, dailyTargets);
}

function cloneMeals(meals) {
  return meals.map((meal) => ({
    ...meal,
    items: meal.items.map((item) => ({ ...item })),
    templateAlternates: [...(meal.templateAlternates ?? [])],
  }));
}

function mealWithSolvedItems(meal, solvedItems) {
  const items = solvedItems.map((item, index) => ({
    ...meal.items[index],
    ...item,
    alternatives: meal.items[index]?.alternatives ?? [],
    totals: macrosForFoodPortion(item.food, item.quantityG),
  }));
  return {
    ...meal,
    items,
    totals: sumTargets(items.map((item) => item.totals)),
  };
}

function targetWithResidualShare(meal, residual, share) {
  const currentTotals = totalsForItems(meal.items);
  return {
    calories: currentTotals.calories + residual.calories * share,
    proteinG: Math.max(0, currentTotals.proteinG + residual.proteinG * share),
    carbG: Math.max(0, currentTotals.carbG + residual.carbG * share),
    fatG: Math.max(0, currentTotals.fatG + residual.fatG * share),
  };
}

function chooseRepairSlots(meals, residual, dailyTargets, limit) {
  const macro = worstResidualMacro(residual, dailyTargets);
  return meals
    .map((meal, mealIndex) => ({
      mealIndex,
      macro,
      ...repairHeadroomScore(meal, macro, residual[macro], dailyTargets),
    }))
    .filter((slot) => slot.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function repairHeadroomScore(meal, macro, residualValue, dailyTargets) {
  if (meal.items.length === 0) {
    return { score: 0, reasoning: 'slot empty' };
  }

  const field = macroFieldForKey(macro);
  const increasing = residualValue > 0;
  const mealTotals = totalsForItems(meal.items);
  const hardMaxCalories = (meal.slotProfile?.hardMaxCaloriePercent ?? 1) * dailyTargets.calories;
  let bestDensity = 0;
  let totalPotential = 0;
  let bestFood = null;

  meal.items.forEach((item) => {
    const density = item.food[field] / 100;
    if (density <= 0) return;
    const min = Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20;
    const max = Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500;
    const gramHeadroom = increasing ? max - item.quantityG : item.quantityG - min;
    if (gramHeadroom <= 0) return;
    const calorieHeadroom = increasing
      ? Math.max(0, hardMaxCalories - mealTotals.calories)
      : mealTotals.calories;
    if (increasing && calorieHeadroom <= 0) return;
    const calorieLimitedHeadroom = increasing && item.food.caloriesPer100g > 0
      ? Math.min(gramHeadroom, calorieHeadroom / (item.food.caloriesPer100g / 100))
      : gramHeadroom;
    const potential = density * calorieLimitedHeadroom;
    totalPotential += potential;
    if (density > bestDensity) {
      bestDensity = density;
      bestFood = item.food.id;
    }
  });

  return {
    score: totalPotential,
    reasoning: `${macro} ${increasing ? 'deficit' : 'surplus'}; best density food ${bestFood ?? 'none'}; potential ${roundToNearest(totalPotential, 0.1)}`,
  };
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
  const targetTolerance = (key) => ({
    min: dailyTarget[key] - dailyTarget[key] * NUTRITION.totalMacroTolerancePercent,
    max: dailyTarget[key] + dailyTarget[key] * NUTRITION.totalMacroTolerancePercent,
  });
  const rangedMacro = (key) => {
    const range = dailyTarget.macroRanges?.[key];
    if (!range) return targetTolerance(key);
    return {
      min: Number(range.min),
      max: Number(range.max),
    };
  };
  const calories = targetTolerance('calories');
  const proteinG = rangedMacro('proteinG');
  const fatG = rangedMacro('fatG');
  const carbG = {
    min: Math.max(0, (
      calories.min -
      proteinG.max * NUTRITION.proteinKcalPerGram -
      fatG.max * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram),
    max: (
      calories.max -
      proteinG.min * NUTRITION.proteinKcalPerGram -
      fatG.min * NUTRITION.fatKcalPerGram
    ) / NUTRITION.carbKcalPerGram,
  };

  return {
    calories,
    proteinG,
    carbG,
    fatG,
  };
}

function residualTolerances(dailyTarget) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  return {
    calories: Math.max(dailyTarget.calories - bounds.calories.min, bounds.calories.max - dailyTarget.calories),
    proteinG: Math.max(dailyTarget.proteinG - bounds.proteinG.min, bounds.proteinG.max - dailyTarget.proteinG),
    carbG: Math.max(dailyTarget.carbG - bounds.carbG.min, bounds.carbG.max - dailyTarget.carbG),
    fatG: Math.max(dailyTarget.fatG - bounds.fatG.min, bounds.fatG.max - dailyTarget.fatG),
  };
}

function calculateResidualScore(dayTotals, dailyTarget, tolerances = residualTolerances(dailyTarget)) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  const residual = calculateResidual(dayTotals, dailyTarget);
  const violationScore = ['calories', 'proteinG', 'carbG', 'fatG'].reduce((score, key) => (
    score + planBoundsViolationAmount(dayTotals[key], bounds[key]) / Math.max(1, tolerances[key])
  ), 0);
  const targetClosenessScore = (
    Math.abs(residual.calories) / Math.max(1, tolerances.calories) +
    Math.abs(residual.proteinG) / Math.max(1, tolerances.proteinG) +
    Math.abs(residual.carbG) / Math.max(1, tolerances.carbG) +
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

function worstResidualMacro(residual, dailyTarget) {
  const tolerances = residualTolerances(dailyTarget);
  const bounds = computeDailyPlanBounds(dailyTarget);
  return ['proteinG', 'carbG', 'fatG', 'calories']
    .sort((a, b) => (
      planBoundsViolationAmount(dailyTarget[b] - residual[b], bounds[b]) / tolerances[b] -
      planBoundsViolationAmount(dailyTarget[a] - residual[a], bounds[a]) / tolerances[a]
    ))[0];
}

function macroFieldForKey(key) {
  return {
    calories: 'caloriesPer100g',
    proteinG: 'proteinGPer100g',
    carbG: 'carbGPer100g',
    fatG: 'fatGPer100g',
  }[key] ?? 'caloriesPer100g';
}

function pushesMacroOutsideTolerance(currentTotals, candidateTotals, dailyTarget, tolerances) {
  const bounds = computeDailyPlanBounds(dailyTarget);
  return ['calories', 'proteinG', 'carbG', 'fatG'].some((key) => {
    const currentInside = planBoundsViolationAmount(currentTotals[key], bounds[key]) <= 0;
    const candidateInside = planBoundsViolationAmount(candidateTotals[key], bounds[key]) <= 0;
    return currentInside && !candidateInside;
  });
}

function buildPlanDiagnostics(dayTotals, dailyTarget, meals) {
  const tolerances = residualTolerances(dailyTarget);
  const bounds = computeDailyPlanBounds(dailyTarget);
  const residual = calculateResidual(dayTotals, dailyTarget);
  const residualPct = calculateResidualPercent(dayTotals, dailyTarget);
  const warnings = [];
  const errors = [];
  const missingSlots = meals
    .filter((meal) => isRequiredMainSlot(meal) && meal.items.length === 0)
    .map((meal) => meal.name);

  const calorieRatio = dayTotals.calories / Math.max(1, dailyTarget.calories);
  const proteinShortfall = Math.max(0, bounds.proteinG.min - dayTotals.proteinG);
  const proteinShortfallThreshold = Math.max(
    NUTRITION.hardErrorProteinShortfallG,
    bounds.proteinG.min * NUTRITION.hardErrorProteinShortfallPercent,
  );
  const onlyNonMainCalories =
    meals.some((meal) => !isRequiredMainSlot(meal) && meal.items.length > 0) &&
    meals.filter(isRequiredMainSlot).every((meal) => meal.items.length === 0);

  if (missingSlots.length > 0) {
    errors.push(
      `Impossible with current templates: no feasible ready templates for ${missingSlots.join(', ')}.`,
    );
  }
  if (calorieRatio < NUTRITION.hardErrorCalorieFloorPercent) {
    errors.push(
      `Calories remain far below target: ${Math.round(dayTotals.calories)} of ${Math.round(dailyTarget.calories)} kcal.`,
    );
  }
  if (proteinShortfall > proteinShortfallThreshold) {
    errors.push(
      `Protein remains short by ${Math.round(proteinShortfall)}g because the current templates do not include enough high-protein main meals within serving limits.`,
    );
  }
  if (onlyNonMainCalories) {
    errors.push('Impossible with current templates: only snack/non-main calories were generated while required main meals are missing.');
  }
  for (const key of ['carbG', 'fatG']) {
    const violationAmount = planBoundsViolationAmount(dayTotals[key], bounds[key]);
    if (violationAmount > tolerances[key] * NUTRITION.hardErrorMacroToleranceMultiplier) {
      const label = key === 'carbG' ? 'Carbs' : 'Fat';
      const direction = residual[key] > 0 ? 'short' : 'high';
      errors.push(
        `${label} remains ${direction} by ${Math.round(violationAmount)}g because selected templates hit serving or macro-density limits.`,
      );
    }
  }

  for (const key of ['calories', 'proteinG', 'carbG', 'fatG']) {
    const violationAmount = planBoundsViolationAmount(dayTotals[key], bounds[key]);
    if (violationAmount <= 0) continue;
    const label = {
      calories: 'Calories',
      proteinG: 'Protein',
      carbG: 'Carbs',
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
      if (Math.abs(target) < NUTRITION.residualPercentNearZeroTarget) {
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
  if (key === 'carbG') return `The selected templates contain ${direction} carb-dense adjustable foods within serving limits.`;
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
  const rawGoal = String(input.goal || 'maintain');
  const goal = rawGoal === 'lose_weight_aggressive' ? 'lose_weight' : rawGoal;
  const dietType = String(input.dietType || 'standard');
  const numberOfMeals = Number.parseInt(input.numberOfMeals ?? 3, 10);
  const mealDistribution = String(input.mealDistribution || 'balanced');
  const weeklyWeightLossPercent = input.weeklyWeightLossPercent === '' ||
    input.weeklyWeightLossPercent === undefined ||
    input.weeklyWeightLossPercent === null
    ? (rawGoal === 'lose_weight_aggressive'
      ? NUTRITION.weightLoss.maximumWeeklyPercent
      : NUTRITION.weightLoss.defaultWeeklyPercent)
    : Number(input.weeklyWeightLossPercent);
  const gainSurplusCalories = input.gainSurplusCalories === '' ||
    input.gainSurplusCalories === undefined ||
    input.gainSurplusCalories === null
    ? NUTRITION.weightGain.defaultSurplusCalories
    : Number(input.gainSurplusCalories);
  const proteinPerKg = input.proteinPerKg === '' || input.proteinPerKg === undefined ||
    input.proteinPerKg === null
    ? NUTRITION.proteinPerKg.default
    : Number(input.proteinPerKg);
  const fatPerKg = input.fatPerKg === '' || input.fatPerKg === undefined ||
    input.fatPerKg === null
    ? NUTRITION.fatPerKg.default
    : Number(input.fatPerKg);
  const coffeesPerDay = Number.parseInt(input.coffeesPerDay ?? 0, 10);

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
  if (!GOALS.has(rawGoal)) {
    throw new Error('Choose a valid goal.');
  }
  if (!DIETS.has(dietType)) {
    throw new Error('Choose a valid diet type.');
  }
  if (![2, 3, 4, 5].includes(numberOfMeals)) {
    throw new Error('Meals must be between 2 and 5.');
  }
  if (!MEAL_DISTRIBUTIONS.has(mealDistribution)) {
    throw new Error('Choose a valid meal distribution.');
  }
  if (
    !Number.isFinite(weeklyWeightLossPercent) ||
    weeklyWeightLossPercent < NUTRITION.weightLoss.minimumWeeklyPercent ||
    weeklyWeightLossPercent > NUTRITION.weightLoss.maximumWeeklyPercent
  ) {
    throw new Error('Weekly weight loss must be between 0.5% and 1.0%.');
  }
  if (
    !Number.isFinite(gainSurplusCalories) ||
    gainSurplusCalories < NUTRITION.weightGain.minimumSurplusCalories ||
    gainSurplusCalories > NUTRITION.weightGain.maximumSurplusCalories
  ) {
    throw new Error('Weight-gain surplus must be between 200 and 300 kcal.');
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
    weeklyWeightLossPercent,
    gainSurplusCalories,
    proteinPerKg,
    fatPerKg,
    numberOfMeals,
    numberOfSnacks: numberOfMeals === 4 ? 1 : (numberOfMeals === 5 ? 2 : 0),
    mealDistribution,
    dietType,
    allergies: normalizeList(input.allergies),
    dislikes: normalizeList(input.dislikes),
    milkType: String(input.milkType || 'skimmed').trim(),
    coffeesPerDay: Number.isFinite(coffeesPerDay) ? Math.max(0, coffeesPerDay) : 0,
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

function selectTemplateForMeal({ mealTag, allowedFoods, input, target }) {
  const candidates = rankedTemplateCandidates({ mealTag, allowedFoods, input, target });
  if (candidates.length === 0) return null;

  const allowedFoodMap = new Map(allowedFoods.map((food) => [food.id, food]));
  const generationState = {
    mealType: mealTag,
    targetMacros: target,
    candidatesTriedBySwapCount: { 0: 0, 1: 0, 2: 0 },
    rejectedSwaps: [],
  };
  const allTriedCandidates = [];

  for (const candidate of candidates) {
    const original = solveTemplateCandidate({
      template: candidate.template,
      allowedFoodMap,
      target,
      swaps: [],
      source: 'original_template',
      templateRankScore: candidate.rankScore,
    });
    if (!original) continue;
    generationState.candidatesTriedBySwapCount[0] += 1;
    allTriedCandidates.push(original);
  }

  const acceptableOriginal = chooseBestCandidate(
    allTriedCandidates.filter((candidate) => candidate.swapCount === 0 && candidate.acceptable),
  );
  if (acceptableOriginal) {
    return withGenerationDebug(selectionForCandidate({
      candidate: acceptableOriginal,
      candidates,
      generationState,
      reason: acceptableOriginal.fit.withinTolerance ? 'original_template_exact_fit' : 'original_template_safe_approximate',
    }));
  }

  if (process.env.DISABLE_MEAL_TEMPLATE_SWAPS === 'true') {
    const bestZero = chooseBestCandidate(allTriedCandidates.filter((candidate) => candidate.swapCount === 0));
    return bestZero
      ? withGenerationDebug(selectionForCandidate({
          candidate: bestZero,
          candidates,
          generationState,
          reason: 'swap_search_disabled_best_original_approximate',
        }))
      : null;
  }

  for (const candidate of candidates) {
    const oneSwapCandidates = solveSwapCountCandidates({
      template: candidate.template,
      allowedFoodMap,
      allowedFoods,
      input: { ...input, mealTag },
      target,
      swapCount: 1,
      templateRankScore: candidate.rankScore,
      generationState,
    });
    allTriedCandidates.push(...oneSwapCandidates);
  }

  const acceptableOneSwap = chooseBestCandidate(
    allTriedCandidates.filter((candidate) => candidate.swapCount === 1 && candidate.acceptable),
  );
  if (acceptableOneSwap) {
    return withGenerationDebug(selectionForCandidate({
      candidate: acceptableOneSwap,
      candidates,
      generationState,
      reason: acceptableOneSwap.fit.withinTolerance ? 'one_swap_exact_fit' : 'one_swap_safe_approximate',
    }));
  }

  const maxSwapCount = maxSwapCountFromPolicy();
  if (maxSwapCount >= 2) {
    for (const candidate of candidates) {
      const twoSwapCandidates = solveSwapCountCandidates({
        template: candidate.template,
        allowedFoodMap,
        allowedFoods,
        input: { ...input, mealTag },
        target,
        swapCount: 2,
        templateRankScore: candidate.rankScore,
        generationState,
      });
      allTriedCandidates.push(...twoSwapCandidates);
    }
  }

  const acceptableTwoSwap = chooseBestCandidate(
    allTriedCandidates.filter((candidate) => candidate.swapCount === 2 && candidate.acceptable),
  );
  if (acceptableTwoSwap) {
    return withGenerationDebug(selectionForCandidate({
      candidate: acceptableTwoSwap,
      candidates,
      generationState,
      reason: acceptableTwoSwap.fit.withinTolerance ? 'two_swap_exact_fit' : 'two_swap_safe_approximate',
    }));
  }

  const best = chooseBestCandidate(allTriedCandidates);
  if (!best) return null;

  return withGenerationDebug(selectionForCandidate({
    candidate: best,
    candidates,
    generationState,
    reason: best.swapCount === 0
      ? 'best_original_approximate_after_swap_search'
      : 'best_swap_approximate_after_exhausting_lower_swap_counts',
  }));
}

function rankedTemplateCandidates({ mealTag, allowedFoods, input, target }) {
  const templates = loadTemplates();
  const allowedFoodMap = new Map(allowedFoods.map((f) => [f.id, f]));

  const templateMealTags = templateTagsForMealTag(mealTag);
  let filtered = templates.filter((t) =>
    t.generationEnabled !== false &&
    ['production_ready', 'safe_partial_swaps'].includes(t.coherenceStatus) &&
    templateMealTags.includes(t.mealType),
  );

  // A template can enter swap fallback only if blocked components are explicitly swappable.
  filtered = filtered.filter((t) =>
    t.components.every((c) => allowedFoodMap.has(c.foodId) || (t.swapEnabled !== false && c.swapEnabled === true)),
  );

  const candidates = filtered.map((template) => {
    const items = templateItemsFromAllowedFoods(template, allowedFoodMap);
    const totals = items ? totalsForItems(items) : null;
    return {
      template,
      items,
      rankScore: templateRankScore({ template, items, totals, target, input }),
    };
  });

  candidates.sort((a, b) => a.rankScore - b.rankScore);
  return candidates;
}

function templateItemsFromAllowedFoods(template, allowedFoodMap) {
  const items = [];
  for (const component of template.components) {
    const food = allowedFoodMap.get(component.foodId);
    if (!food) return null;
    items.push({
      food,
      quantityG: clampServing(food, food.defaultServingG),
      component,
    });
  }
  return items;
}

function templateRankScore({ template, items, totals, target, input }) {
  const missingAllowedFoods = items ? 0 : template.components.length;
  const dietPenalty = dietCompatibilityPenalty(template, input);
  const coherencePenalty = template.coherenceStatus === 'production_ready' ? 0 : 0.1;
  const swapPenalty = template.swapEnabled === false ? 0.5 : 0;
  const seedScore = totals ? templateSeedScore(totals, target) : 20 + missingAllowedFoods;

  return seedScore + dietPenalty + coherencePenalty + swapPenalty;
}

function dietCompatibilityPenalty(template, input) {
  const tags = new Set(template.dietTags ?? []);
  if (input.dietType === 'vegan') return tags.has('vegan') ? 0 : 4;
  if (input.dietType === 'vegetarian') return tags.has('vegetarian') || tags.has('vegan') ? 0 : 2;
  return 0;
}

function solveSwapCountCandidates({
  template,
  allowedFoodMap,
  allowedFoods,
  input,
  target,
  swapCount,
  templateRankScore,
  generationState,
}) {
  const results = [];
  const plans = swapPlansForCount({ template, allowedFoodMap, allowedFoods, input, target, swapCount, generationState });

  for (const plan of plans) {
    const solved = solveTemplateCandidate({
      template,
      allowedFoodMap,
      target,
      swaps: plan.steps,
      source: sourceForSwaps(plan.steps),
      templateRankScore,
    });
    if (!solved) continue;
    generationState.candidatesTriedBySwapCount[swapCount] =
      (generationState.candidatesTriedBySwapCount[swapCount] ?? 0) + 1;
    results.push(solved);
  }

  return results;
}

function swapPlansForCount({ template, allowedFoodMap, allowedFoods, input, target, swapCount, generationState }) {
  if (swapCount <= 0) return [{ steps: [] }];

  const orderedComponents = orderedComponentsForSwaps({ template, allowedFoodMap, target });
  const candidateByFoodId = new Map();

  for (const component of orderedComponents) {
    const { candidates, rejected } = getSwapCandidates(template, component, input, allowedFoods);
    generationState.rejectedSwaps.push(...rejected.slice(0, 10));
    if (candidates.length > 0) {
      candidateByFoodId.set(component.foodId, candidates.slice(0, swapCount === 1 ? 8 : 4));
    }
  }

  if (swapCount === 1) {
    return orderedComponents.flatMap((component) =>
      (candidateByFoodId.get(component.foodId) ?? []).map((candidate) => ({
        steps: [swapStepFor(component, candidate)],
      })),
    );
  }

  const plans = [];
  for (let first = 0; first < orderedComponents.length; first += 1) {
    for (let second = first + 1; second < orderedComponents.length; second += 1) {
      const firstCandidates = candidateByFoodId.get(orderedComponents[first].foodId) ?? [];
      const secondCandidates = candidateByFoodId.get(orderedComponents[second].foodId) ?? [];
      for (const firstCandidate of firstCandidates) {
        for (const secondCandidate of secondCandidates) {
          plans.push({
            steps: [
              swapStepFor(orderedComponents[first], firstCandidate),
              swapStepFor(orderedComponents[second], secondCandidate),
            ],
          });
          if (plans.length >= 128) return plans;
        }
      }
    }
  }

  return plans;
}

function swapStepFor(component, candidate) {
  return {
    oldFoodId: component.foodId,
    newFoodId: candidate.food.id,
    slot: component.slot,
    swapGroup: candidate.groupId,
    source: candidate.source,
  };
}

function orderedComponentsForSwaps({ template, allowedFoodMap, target }) {
  const components = template.components.map((component, index) => ({ component, index }));
  const originalItems = templateItemsFromAllowedFoods(template, allowedFoodMap);
  const firstComponent = originalItems
    ? componentCausingBiggestMacroProblem(originalItems, target)
    : template.components.find((component) => !allowedFoodMap.has(component.foodId));

  return components
    .sort((a, b) => (
      priorityForComponent(a.component, firstComponent) - priorityForComponent(b.component, firstComponent) ||
      a.index - b.index
    ))
    .map((entry) => entry.component);
}

function priorityForComponent(component, firstComponent) {
  if (firstComponent && component.foodId === firstComponent.foodId) return 0;
  const slot = component.slot;
  if (slot === 'primary_protein') return 1;
  if (['main_carb', 'fruit_carb', 'legume_base'].includes(slot)) return 2;
  if (slot === 'fat') return 3;
  return 4;
}

function componentCausingBiggestMacroProblem(items, target) {
  const totals = totalsForItems(items);
  const residual = {
    calories: target.calories - totals.calories,
    proteinG: target.proteinG - totals.proteinG,
    carbG: target.carbG - totals.carbG,
    fatG: target.fatG - totals.fatG,
  };
  const tolerances = mealTolerances(target);
  const worstMacro = ['proteinG', 'carbG', 'fatG', 'calories']
    .sort((a, b) => Math.abs(residual[b]) / Math.max(1, tolerances[b]) -
      Math.abs(residual[a]) / Math.max(1, tolerances[a]))[0];
  const field = macroFieldForKey(worstMacro);
  const isDeficit = residual[worstMacro] > 0;

  return [...items].sort((a, b) => {
    const aScore = isDeficit ? b.food[field] - a.food[field] : b.food[field] * b.quantityG - a.food[field] * a.quantityG;
    return aScore;
  })[0]?.component ?? null;
}

function solveTemplateCandidate({ template, allowedFoodMap, target, swaps, source, templateRankScore }) {
  let swappedTemplate = template;
  for (const step of swaps) {
    swappedTemplate = applySwapToTemplate(swappedTemplate, step.oldFoodId, step.newFoodId);
  }

  const items = templateItemsFromAllowedFoods(swappedTemplate, allowedFoodMap);
  if (!items) return null;

  const solvedItems = solvePortionsLeastSquares(items, {
    proteinG: target.proteinG,
    carbG: target.carbG,
    fatG: target.fatG,
  });
  const fit = macroFitDetails(solvedItems, target);
  const originalFit = swaps.length === 0 ? fit : originalFitForTemplate(template, allowedFoodMap, target);
  const servingPenalty = servingRealismPenalty(solvedItems);

  return {
    items: solvedItems,
    template: swappedTemplate,
    originalTemplate: template,
    swaps,
    source,
    swapCount: swaps.length,
    fit,
    originalFit,
    acceptable: isAcceptableCandidate(fit, target),
    servingPenalty,
    templateRankScore,
  };
}

function originalFitForTemplate(template, allowedFoodMap, target) {
  const originalItems = templateItemsFromAllowedFoods(template, allowedFoodMap);
  if (!originalItems) return null;
  const solved = solvePortionsLeastSquares(originalItems, {
    proteinG: target.proteinG,
    carbG: target.carbG,
    fatG: target.fatG,
  });
  return macroFitDetails(solved, target);
}

function isAcceptableCandidate(fit, target) {
  return fit.withinTolerance || isWithinMacroFitProfile(fit.totals, target, 'approximateButAcceptable');
}

function isWithinMacroFitProfile(totals, target, profileName) {
  const profile = loadSwapSystem().solverAndRankingPolicy?.macroFitProfiles?.[profileName];
  if (!profile) return false;
  return (
    Math.abs(totals.calories - target.calories) <= target.calories * Number(profile.caloriesPct ?? 0) &&
    Math.abs(totals.proteinG - target.proteinG) <= Number(profile.proteinG ?? 0) &&
    Math.abs(totals.carbG - target.carbG) <= Number(profile.carbsG ?? profile.carbG ?? 0) &&
    Math.abs(totals.fatG - target.fatG) <= Number(profile.fatG ?? 0)
  );
}

function chooseBestCandidate(candidates) {
  return [...candidates].sort(compareGenerationCandidates)[0] ?? null;
}

function compareGenerationCandidates(a, b) {
  return (
    a.swapCount - b.swapCount ||
    candidateSourceRank(a.source) - candidateSourceRank(b.source) ||
    a.fit.score - b.fit.score ||
    a.servingPenalty - b.servingPenalty ||
    a.templateRankScore - b.templateRankScore
  );
}

function sourceForSwaps(swaps) {
  if (swaps.length === 0) return 'original_template';
  return swaps.some((swap) => swap.source === 'same_family_slot') ? 'same_family_slot' : 'same_swap_group';
}

function candidateSourceRank(source) {
  if (source === 'original_template') return 0;
  if (source === 'same_swap_group') return 1;
  if (source === 'same_family_slot') return 2;
  return 3;
}

function maxSwapCountFromPolicy() {
  const policy = loadSwapSystem().solverAndRankingPolicy ?? {};
  const configured = Number(policy.maxSwapsPerMeal ?? policy.maxSwapCount ?? 2);
  return Number.isFinite(configured) ? Math.max(0, configured) : 2;
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

function selectionForCandidate({ candidate, candidates, generationState, reason }) {
  const debugPayload = {
    mealType: generationState.mealType,
    targetMacros: generationState.targetMacros,
    selectedTemplate: candidate.template,
    originalTemplateSolved: candidate.originalFit !== null,
    originalTemplateMacroFit: candidate.originalFit,
    swapsTried: generationState.candidatesTriedBySwapCount[1] + generationState.candidatesTriedBySwapCount[2],
    swapsAccepted: generationState.candidatesTriedBySwapCount[1] + generationState.candidatesTriedBySwapCount[2],
    bestCandidateSource: candidate.source,
    finalMacroFit: candidate.fit,
    failureReason: null,
    rejectedSwaps: generationState.rejectedSwaps.slice(0, 12),
    candidatesTriedBySwapCount: generationState.candidatesTriedBySwapCount,
    selectedCandidateSwapCount: candidate.swapCount,
    selectedCandidateSource: candidate.source,
    selectedCandidateReason: reason,
  };

  return {
    items: candidate.items,
    template: candidate.template,
    alternates: candidates.filter((alternate) => alternate.items),
    filteredCount: candidates.length,
    source: candidate.source,
    swaps: candidate.swaps,
    score: candidate.fit.score,
    debugPayload,
  };
}

function withGenerationDebug(selection, debug) {
  if (!debug && selection?.debugPayload) {
    debug = selection.debugPayload;
    delete selection.debugPayload;
  }

  const generationDebug = {
    mealType: debug.mealType,
    targetMacros: roundedMacros(debug.targetMacros),
    selectedTemplateId: debug.selectedTemplate?.templateId ?? null,
    selectedTemplateName: debug.selectedTemplate?.name ?? null,
    family: debug.selectedTemplate?.family ?? null,
    originalTemplateSolved: debug.originalTemplateSolved,
    originalTemplateMacroFit: debug.originalTemplateMacroFit ? roundedFit(debug.originalTemplateMacroFit) : null,
    swapsTried: debug.swapsTried,
    swapsAccepted: debug.swapsAccepted,
    bestCandidateSource: debug.bestCandidateSource,
    candidatesTriedBySwapCount: debug.candidatesTriedBySwapCount ?? { 0: 0, 1: 0, 2: 0 },
    selectedCandidateSwapCount: debug.selectedCandidateSwapCount ?? 0,
    selectedCandidateSource: debug.selectedCandidateSource ?? debug.bestCandidateSource,
    selectedCandidateReason: debug.selectedCandidateReason ?? null,
    numberOfSwaps: debug.selectedCandidateSwapCount ?? 0,
    candidateSource: debug.selectedCandidateSource ?? debug.bestCandidateSource,
    finalMacroFit: roundedFit(debug.finalMacroFit),
    failureReason: debug.failureReason,
    ...(debug.rejectedSwaps ? { rejectedSwaps: debug.rejectedSwaps } : {}),
  };

  if (DEBUG_MEAL_GENERATION) {
    console.log(JSON.stringify(generationDebug));
  }

  return {
    ...selection,
    generationDebug,
  };
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

function roundedFit(fit) {
  return {
    withinTolerance: fit.withinTolerance,
    score: roundToNearest(fit.score, 0.001),
    totals: roundedMacros(fit.totals),
    residual: roundedMacros(fit.residual),
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

function alternativesForItem({ item, template, allowedFoods, target, input }) {
  let alternatives = [];
  let broaderAlternatives = [];

  if (template && item.component && input) {
    const { candidates } = getSwapCandidates(
      template,
      item.component,
      { ...input, mealTag: target.tag },
      allowedFoods,
    );
    alternatives = candidates
      .filter((candidate) => candidate.source === 'same_swap_group')
      .slice(0, 4)
      .map((candidate) => candidate.food);
    broaderAlternatives = candidates
      .filter((candidate) => candidate.source === 'same_family_slot')
      .slice(0, 4)
      .map((candidate) => candidate.food);
  }

  const excludedIds = new Set([
    item.food.id,
    ...alternatives.map((food) => food.id),
    ...broaderAlternatives.map((food) => food.id),
  ]);

  return {
    alternatives,
    broaderAlternatives,
    nearestAlternatives: nearestAlternativesForFood({
      food: item.food,
      allowedFoods,
      mealTag: target.tag,
      excludedIds,
    }),
  };
}

function nearestAlternativesForFood({ food, allowedFoods, mealTag, excludedIds }) {
  const mealTags = templateTagsForMealTag(mealTag);
  const candidates = allowedFoods.filter((candidate) => (
    !excludedIds.has(candidate.id) &&
    candidate.macroRole === food.macroRole
  ));
  const mealCompatible = candidates.filter((candidate) =>
    mealTags.some((tag) => candidate.mealTags.includes(tag))
  );
  const pool = mealCompatible.length >= NEAREST_ALTERNATIVE_LIMIT ? mealCompatible : candidates;
  const originalCuisine = getCuisineGroup(food);

  return pool
    .map((candidate) => ({
      food: candidate,
      score: nearestAlternativeScore(food, candidate, originalCuisine, mealTags),
    }))
    .sort((a, b) => a.score - b.score || a.food.name.localeCompare(b.food.name))
    .slice(0, NEAREST_ALTERNATIVE_LIMIT)
    .map((entry) => entry.food);
}

function nearestAlternativeScore(original, candidate, originalCuisine, mealTags) {
  const originalCategories = new Set(original.categories || []);
  const candidateCategories = new Set(candidate.categories || []);
  const categoryOverlap = [...candidateCategories].filter((category) => originalCategories.has(category)).length;
  const mealTagPenalty = mealTags.some((tag) => candidate.mealTags.includes(tag)) ? 0 : 25;
  const subCategoryPenalty = original.subCategory && candidate.subCategory && original.subCategory !== candidate.subCategory ? 35 : 0;
  const cuisinePenalty = cuisineCompatible(originalCuisine, getCuisineGroup(candidate)) ? 0 : 40;
  const allergenPenalty = (candidate.allergens || []).filter((allergen) => !(original.allergens || []).includes(allergen)).length * 8;

  return (
    macroDistance(original, candidate) +
    mealTagPenalty +
    subCategoryPenalty +
    cuisinePenalty +
    allergenPenalty -
    Math.min(categoryOverlap, 4) * 10
  );
}

function generateMeal({ target, allowedFoods, mealIndex, input = null, useTemplates = false }) {
  if (useTemplates && input) {
    const selection = selectReadyMealForMeal({
      mealTag: target.tag,
      allowedFoods,
      input,
      target: target.targets,
    });

    if (!selection) {
      const generationDebug = logMealGenerationFailure({
        mealType: target.tag,
        targetMacros: target.targets,
        failureReason: `No ready meal from the database matched ${target.name} within the macro constraints.`,
      });
      return emptyMeal(
        target,
        `No ready meal matched ${target.name} with the current targets and restrictions.`,
        generationDebug,
      );
    }

    debugOptimizer('primary ready meal selected', {
      slot: target.name,
      readyMeal: selection.readyMeal.id,
      filteredReadyMealCount: selection.filteredCount,
      rankedAlternateCount: selection.alternates.length,
    });

    return buildReadyMeal({
      target,
      items: selection.items,
      readyMeal: selection.readyMeal,
      alternates: selection.alternates,
      generationSource: 'ready_meal_database',
      generationDebug: selection.generationDebug,
    });
  }

  const generationDebug = logMealGenerationFailure({
    mealType: target.tag,
    targetMacros: target.targets,
    failureReason: 'Template generation is required; random macro-role fallback is disabled.',
  });
  return emptyMeal(target, generationDebug.failureReason, generationDebug);
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
      forceExact: true,
    }))
    .filter(Boolean)
    .filter((candidate) => totalsWithinMealTolerance(candidate.totals, target))
    .sort((a, b) => (
      a.score - b.score ||
      a.readyMeal.id.localeCompare(b.readyMeal.id, undefined, { numeric: true })
    ));
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

function selectReadyMealForMeal({ mealTag, allowedFoods, target }) {
  const candidates = readyMealCandidatesForMeal({ mealTag, allowedFoods, target });

  const selected = candidates[0] ?? null;
  if (!selected) return null;

  return {
    readyMeal: selected.readyMeal,
    items: selected.items,
    alternates: candidates.slice(1),
    filteredCount: candidates.length,
    generationDebug: readyMealGenerationDebug({
      mealTag,
      targetMacros: target,
      selected,
      candidateCount: candidates.length,
    }),
  };
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
  const largeMealServingScale = clamp(target.calories / 500, 1, 4);
  for (const component of readyMeal.components) {
    const sourceFood = allowedFoodByName.get(normalizeIngredientName(component.lookupName));
    if (!sourceFood) return null;
    const food = largeMealServingScale > 1
      ? {
          ...sourceFood,
          maxServingG: Math.max(
            sourceFood.maxServingG,
            Math.min(
              sourceFood.maxServingG * 3,
              sourceFood.defaultServingG * largeMealServingScale,
            ),
          ),
        }
      : sourceFood;
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
  const solvedItems = solvePortionsLeastSquares(items, {
    proteinG: target.proteinG,
    carbG: target.carbG,
    fatG: target.fatG,
  });
  let withTotals = hydrateSolvedItems(solvedItems);
  const fastSolverViolation = findBoundsViolation(
    sumTargets(withTotals.map((item) => item.totals)),
    acceptanceBounds,
  );
  if (options.forceExact || fastSolverViolation) {
    const gridFit = findBestPortionGridFit(items, target, acceptanceBounds, solvedItems, {
      step: options.exactStep ?? EXACT_PORTION_SEARCH_STEP_G,
      maxVisits: options.maxVisits ?? EXACT_PORTION_SEARCH_MAX_VISITS,
      maxMs: options.maxMs ?? EXACT_PORTION_SEARCH_MAX_MS,
    });
    if (gridFit) {
      withTotals = hydrateSolvedItems(gridFit.items);
    } else if (fastSolverViolation) {
      return null;
    }
  }
  const fit = macroFitDetails(withTotals, target);

  return {
    readyMeal,
    items: withTotals,
    totals: fit.totals,
    fit,
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

function buildMeal({
  target,
  items,
  allowedFoods,
  template = null,
  templateAlternates = [],
  swapsApplied = [],
  generationSource = null,
  generationDebug = null,
  input = null,
}) {
  const withAlternatives = items.map((item) => {
    const swapAlternatives = alternativesForItem({ item, template, allowedFoods, target, input });
    return {
      ...item,
      ...swapAlternatives,
      totals: macrosForFoodPortion(item.food, item.quantityG),
    };
  });

  return {
    name: target.name,
    tag: target.tag,
    target: target.targets,
    slotProfile: target.slotProfile ?? null,
    templateId: template?.templateId ?? null,
    templateName: template?.name ?? null,
    templateFamily: template?.family ?? null,
    templateAlternates,
    generationSource,
    isOriginalTemplate: swapsApplied.length === 0 && Boolean(template?.templateId),
    numberOfSwaps: swapsApplied.length,
    candidateSource: generationSource,
    swapsApplied,
    generationDebug,
    items: withAlternatives,
    mealOptions: buildMealOptions({
      currentItems: withAlternatives,
      target,
      allowedFoods,
      input,
      alternates: templateAlternates,
    }),
    totals: sumTargets(withAlternatives.map((item) => item.totals)),
    isApproximate: !isWithinTolerance(items, target.targets),
  };
}

function buildMealOptions({ currentItems, target, allowedFoods, input, alternates }) {
  const options = [];
  const currentSignature = mealOptionSignature(currentItems);
  const seen = new Set([currentSignature].filter(Boolean));
  for (const alternate of alternates || []) {
    const template = alternate.template;
    if (!template?.templateId || !Array.isArray(alternate.items)) continue;
    const solvedItems = solvePortionsLeastSquares(alternate.items, {
      proteinG: target.targets.proteinG,
      carbG: target.targets.carbG,
      fatG: target.targets.fatG,
    });
    const signature = mealOptionSignature(solvedItems);
    if (!signature || seen.has(signature)) continue;
    const fit = macroFitDetails(solvedItems, target.targets);
    if (!isStrictMealOptionFit(fit.totals, target.targets)) continue;
    const items = solvedItems.map((item) => {
      const swapAlternatives = alternativesForItem({ item, template, allowedFoods, target, input });
      return {
        ...item,
        ...swapAlternatives,
        totals: macrosForFoodPortion(item.food, item.quantityG),
      };
    });
    options.push({
      templateId: template.templateId,
      templateName: template.name,
      templateFamily: template.family ?? null,
      items,
      totals: sumTargets(items.map((item) => item.totals)),
      isApproximate: !isWithinTolerance(items, target.targets),
    });
    seen.add(signature);
    if (options.length >= MEAL_OPTION_LIMIT) break;
  }
  return options;
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
  const solvedItems = solvePortionsLeastSquares(option.items, {
    proteinG: target.proteinG,
    carbG: target.carbG,
    fatG: target.fatG,
  });
  const totals = sumTargets(solvedItems.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
  if (!isStrictMealOptionFit(totals, target)) return null;

  return {
    ...option,
    items: solvedItems.map((item, index) => ({
      ...option.items[index],
      ...item,
      totals: macrosForFoodPortion(item.food, item.quantityG),
    })),
    totals,
    isApproximate: false,
  };
}

function generateAlternateMealOptions({
  mealTag,
  mealTarget,
  currentItems,
  templateId = null,
  userPreferences = {},
  dailyContext,
  limit = MEAL_OPTION_LIMIT,
}) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((food) => [food.id, food]));
  const safeLimit = Math.max(1, Math.min(Number(limit) || MEAL_OPTION_LIMIT, MEAL_OPTION_LIMIT));
  const input = {
    dietType: userPreferences?.dietType || 'standard',
    avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
    allergies: [],
    dislikes: [],
    mealTag: mealTag || 'lunch',
  };
  const allowedFoods = filterFoods(foods, input);
  const allowedFoodByName = new Map(allowedFoods.map((food) => [normalizeIngredientName(food.name), food]));

  const baseItems = (currentItems || [])
    .map((item) => {
      const food = foodMap.get(String(item.foodId || item.food?.id || ''));
      if (!food) return null;
      return {
        food,
        quantityG: clampServing(food, Number(item.quantityG) || Number(item.grams) || food.defaultServingG),
        component: item.component || null,
        clientAlternatives: item,
      };
    })
    .filter(Boolean);

  if (baseItems.length === 0 || !mealTarget || !dailyContext) return [];

  const seen = new Set([mealOptionSignature(baseItems)].filter(Boolean));
  const mealBounds = computeMealBounds(mealTarget, {
    dailyCalories: dailyContext?.dailyTargets?.calories,
    dailyTargets: dailyContext?.dailyTargets,
    weightKg: dailyContext?.weightKg,
  });
  return loadReadyMealBundles()
    .filter((readyMeal) => templateTagsForMealTag(mealTag || 'lunch').includes(readyMeal.mealTag))
    .map((readyMeal) => solveReadyMealCandidate(readyMeal, allowedFoodByName, mealTarget, {
      bounds: mealBounds,
      forceExact: true,
    }))
    .filter(Boolean)
    .filter((candidate) => validateMealSwap({
      ...dailyContext,
      mealTarget,
      proposedMealTotals: candidate.totals,
    }).valid)
    .filter((candidate) => {
      if (candidate.readyMeal.id === templateId) return false;
      const signature = mealOptionSignature(candidate.items);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((a, b) => (
      a.score - b.score ||
      a.readyMeal.id.localeCompare(b.readyMeal.id, undefined, { numeric: true })
    ))
    .slice(0, safeLimit)
    .map((candidate) => ({
      templateId: candidate.readyMeal.id,
      templateName: readyMealDisplayName(candidate.readyMeal),
      templateFamily: candidate.readyMeal.track ?? null,
      readyMealId: candidate.readyMeal.id,
      readyMealTrack: candidate.readyMeal.track ?? null,
      items: candidate.items,
      totals: candidate.totals,
      isApproximate: !isWithinTolerance(candidate.items, mealTarget),
    }));
}

function generateLegacyAlternateMealOptions({
  mealTag,
  mealTarget,
  currentItems,
  templateId = null,
  userPreferences = {},
  limit = MEAL_OPTION_LIMIT,
}) {
  const foods = loadFoods();
  const foodMap = new Map(foods.map((food) => [food.id, food]));
  const safeLimit = Math.max(1, Math.min(Number(limit) || MEAL_OPTION_LIMIT, MEAL_OPTION_LIMIT));
  const input = {
    dietType: userPreferences?.dietType || 'standard',
    avoidFoods: Array.isArray(userPreferences?.avoidFoods) ? userPreferences.avoidFoods : [],
    allergies: [],
    dislikes: [],
    mealTag: mealTag || 'lunch',
  };
  const allowedFoods = filterFoods(foods, input);
  const allowedFoodMap = new Map(allowedFoods.map((food) => [food.id, food]));
  const template = templateId
    ? loadTemplates().find((candidate) => candidate.templateId === templateId)
    : null;

  const baseItems = (currentItems || [])
    .map((item) => {
      const food = foodMap.get(String(item.foodId || item.food?.id || ''));
      if (!food) return null;
      return {
        food,
        quantityG: clampServing(food, Number(item.quantityG) || Number(item.grams) || food.defaultServingG),
        component: item.component || null,
        clientAlternatives: item,
      };
    })
    .filter(Boolean);

  if (baseItems.length === 0 || !mealTarget) return [];

  const target = {
    name: 'Alternate meal',
    tag: mealTag || 'lunch',
    targets: mealTarget,
  };
  const options = [];
  const seen = new Set([mealOptionSignature(baseItems)].filter(Boolean));
  const candidatePools = baseItems.map((item) => alternateFoodsForMealOption({
    item,
    template,
    input,
    allowedFoods,
    allowedFoodMap,
  }));

  function addOption(replacements) {
    const candidateItems = baseItems.map((item, index) => {
      const replacement = replacements.get(index);
      const food = replacement || item.food;
      return {
        ...item,
        food,
        quantityG: replacement ? clampServing(food, food.defaultServingG) : item.quantityG,
      };
    });
    const signature = mealOptionSignature(candidateItems);
    if (!signature || seen.has(signature)) return false;

    const solvedItems = solvePortionsLeastSquares(candidateItems, {
      proteinG: mealTarget.proteinG,
      carbG: mealTarget.carbG,
      fatG: mealTarget.fatG,
    });
    const fit = macroFitDetails(solvedItems, mealTarget);
    if (!isStrictMealOptionFit(fit.totals, mealTarget)) return false;

    const items = solvedItems.map((item) => {
      const swapAlternatives = alternativesForItem({ item, template, allowedFoods, target, input });
      return {
        ...item,
        ...swapAlternatives,
        totals: macrosForFoodPortion(item.food, item.quantityG),
      };
    });
    options.push({
      templateId: template?.templateId ?? templateId ?? null,
      templateName: template?.name ? `${template.name} alternate` : 'Alternate meal',
      templateFamily: template?.family ?? null,
      items,
      totals: sumTargets(items.map((item) => item.totals)),
      isApproximate: !isWithinTolerance(items, mealTarget),
    });
    seen.add(signature);
    return options.length >= safeLimit;
  }

  for (let itemIndex = 0; itemIndex < candidatePools.length; itemIndex += 1) {
    for (const food of candidatePools[itemIndex]) {
      if (addOption(new Map([[itemIndex, food]]))) return options;
    }
  }

  for (let first = 0; first < candidatePools.length; first += 1) {
    for (let second = first + 1; second < candidatePools.length; second += 1) {
      for (const firstFood of candidatePools[first].slice(0, 5)) {
        for (const secondFood of candidatePools[second].slice(0, 5)) {
          if (addOption(new Map([[first, firstFood], [second, secondFood]]))) return options;
        }
      }
    }
  }

  return options;
}

function alternateFoodsForMealOption({ item, template, input, allowedFoods, allowedFoodMap }) {
  const candidates = [];
  const seen = new Set([item.food.id]);

  const addFood = (foodLike) => {
    const id = String(foodLike?.id || foodLike?.foodId || '');
    const food = allowedFoodMap.get(id);
    if (!food || seen.has(food.id)) return;
    seen.add(food.id);
    candidates.push(food);
  };

  if (template && item.component) {
    const { candidates: swapCandidates } = getSwapCandidates(
      template,
      item.component,
      input,
      allowedFoods,
    );
    swapCandidates.forEach((candidate) => addFood(candidate.food));
  }

  for (const key of ['alternatives', 'broaderAlternatives', 'nearestAlternatives']) {
    (item.clientAlternatives?.[key] || []).forEach(addFood);
  }

  if (candidates.length < 4) {
    nearestAlternativesForFood({
      food: item.food,
      allowedFoods,
      mealTag: input.mealTag,
      excludedIds: seen,
    }).forEach(addFood);
  }

  return candidates.slice(0, 10);
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

function computeMealBounds(target, options = {}) {
  const normalizedOptions = typeof options === 'number'
    ? { mealMacroTolerance: options }
    : options;
  if (target?.macroWindows) {
    return cloneMacroBounds(target.macroWindows);
  }

  const dailyCalories = Number(normalizedOptions.dailyCalories);
  const dailyTargets = normalizedOptions.dailyTargets;
  const weightKg = Number(normalizedOptions.weightKg);
  const calorieWindow = target.calories * NUTRITION.mealSwapDailyCalorieWindowPercent;
  const proteinShare = macroAllocationShare(
    target.proteinG,
    dailyTargets?.proteinG,
    target.calories,
    dailyCalories,
  );
  const fatShare = macroAllocationShare(
    target.fatG,
    dailyTargets?.fatG,
    target.calories,
    dailyCalories,
  );
  const hasWeight = Number.isFinite(weightKg) && weightKg > 0;
  return {
    calories: {
      min: Math.max(0, target.calories - calorieWindow),
      max: target.calories + calorieWindow,
    },
    proteinG: {
      min: hasWeight
        ? weightKg * NUTRITION.proteinPerKg.minimum * proteinShare
        : -Infinity,
      max: hasWeight
        ? weightKg * NUTRITION.proteinPerKg.maximum * proteinShare
        : Infinity,
    },
    carbG: {
      min: 0,
      max: Infinity,
    },
    fatG: {
      min: hasWeight
        ? weightKg * NUTRITION.fatPerKg.minimum * fatShare
        : -Infinity,
      max: hasWeight
        ? weightKg * NUTRITION.fatPerKg.maximum * fatShare
        : Infinity,
    },
  };
}

function cloneMacroBounds(bounds) {
  return {
    calories: { ...bounds.calories },
    proteinG: { ...bounds.proteinG },
    carbG: { ...bounds.carbG },
    fatG: { ...bounds.fatG },
  };
}

function macroAllocationShare(mealMacroG, dailyMacroG, mealCalories, dailyCalories) {
  const macroShare = Number(mealMacroG) / Number(dailyMacroG);
  if (Number.isFinite(macroShare) && macroShare >= 0) return macroShare;
  const calorieShare = Number(mealCalories) / Number(dailyCalories);
  return Number.isFinite(calorieShare) && calorieShare >= 0 ? calorieShare : 0;
}

function validateMealSwap({
  dailyTargets,
  weightKg,
  mealTarget,
  proposedMealTotals,
}) {
  if (mealTarget?.macroWindows && proposedMealTotals) {
    const bounds = computeMealBounds(mealTarget);
    const violations = [];
    const violation = findBoundsViolation(proposedMealTotals, bounds);
    if (violation) violations.push(`meal_${violation}`);
    return {
      valid: violations.length === 0,
      violations,
      bounds,
    };
  }

  if (
    !dailyTargets ||
    !Number.isFinite(Number(weightKg)) ||
    !mealTarget ||
    !proposedMealTotals
  ) {
    return {
      valid: false,
      violations: ['meal_context'],
      bounds: null,
    };
  }

  const bounds = computeMealBounds(mealTarget, {
    dailyCalories: Number(dailyTargets.calories),
    dailyTargets,
    weightKg: Number(weightKg),
  });
  const violations = [];
  const violation = findBoundsViolation(proposedMealTotals, bounds);
  if (violation) violations.push(`meal_${violation}`);

  return {
    valid: violations.length === 0,
    violations,
    bounds,
  };
}

function findBoundsViolation(totals, bounds) {
  if (totals.calories < bounds.calories.min || totals.calories > bounds.calories.max) return 'calories';
  if (totals.proteinG < bounds.proteinG.min || totals.proteinG > bounds.proteinG.max) return 'protein';
  if (totals.carbG < bounds.carbG.min || totals.carbG > bounds.carbG.max) return 'carbs';
  if (totals.fatG < bounds.fatG.min || totals.fatG > bounds.fatG.max) return 'fat';
  return null;
}

function isWithinTolerance(items, target) {
  const totals = totalsForItems(items);
  return totalsWithinMealTolerance(totals, target);
}

function mealTolerances(target) {
  return {
    calories: target.calories * NUTRITION.calorieTolerancePercent,
    proteinG: target.proteinG * NUTRITION.mealMacroTolerancePercent,
    carbG: target.carbG * NUTRITION.mealMacroTolerancePercent,
    fatG: target.fatG * NUTRITION.mealMacroTolerancePercent,
  };
}

function targetToleranceBounds(target) {
  if (target?.macroWindows) return computeMealBounds(target);
  const tolerances = mealTolerances(target);
  return {
    calories: {
      min: target.calories - tolerances.calories,
      max: target.calories + tolerances.calories,
    },
    proteinG: {
      min: target.proteinG - tolerances.proteinG,
      max: target.proteinG + tolerances.proteinG,
    },
    carbG: {
      min: target.carbG - tolerances.carbG,
      max: target.carbG + tolerances.carbG,
    },
    fatG: {
      min: target.fatG - tolerances.fatG,
      max: target.fatG + tolerances.fatG,
    },
  };
}

function totalsWithinMealTolerance(totals, target) {
  if (target?.macroWindows) {
    return findBoundsViolation(totals, computeMealBounds(target)) === null;
  }

  const tolerances = mealTolerances(target);
  return (
    Math.abs(totals.calories - target.calories) <=
      tolerances.calories &&
    Math.abs(totals.proteinG - target.proteinG) <= tolerances.proteinG &&
    Math.abs(totals.carbG - target.carbG) <= tolerances.carbG &&
    Math.abs(totals.fatG - target.fatG) <= tolerances.fatG
  );
}

function mealScore(items, target) {
  const totals = totalsForItems(items);
  // Weight calories 3× — calorie accuracy is the primary quality signal
  const calorieScore = 3 * Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
  const proteinScore = Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG);
  const carbScore = Math.abs(totals.carbG - target.carbG) / Math.max(1, target.carbG);
  const fatScore = Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG);
  return calorieScore + proteinScore + carbScore + fatScore;
}

function templateSeedScore(totals, target) {
  const totalMacroCalories =
    totals.proteinG * NUTRITION.proteinKcalPerGram +
    totals.carbG * NUTRITION.carbKcalPerGram +
    totals.fatG * NUTRITION.fatKcalPerGram;
  const targetMacroCalories =
    target.proteinG * NUTRITION.proteinKcalPerGram +
    target.carbG * NUTRITION.carbKcalPerGram +
    target.fatG * NUTRITION.fatKcalPerGram;

  const ratioScore = totalMacroCalories > 0 && targetMacroCalories > 0
    ? Math.abs((totals.proteinG * NUTRITION.proteinKcalPerGram) / totalMacroCalories -
        (target.proteinG * NUTRITION.proteinKcalPerGram) / targetMacroCalories) +
      Math.abs((totals.carbG * NUTRITION.carbKcalPerGram) / totalMacroCalories -
        (target.carbG * NUTRITION.carbKcalPerGram) / targetMacroCalories) +
      Math.abs((totals.fatG * NUTRITION.fatKcalPerGram) / totalMacroCalories -
        (target.fatG * NUTRITION.fatKcalPerGram) / targetMacroCalories)
    : 10;

  const calorieScore = Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
  return ratioScore + calorieScore * 0.25;
}

function getCuisineGroup(food) {
  const cats = new Set(food.categories);
  if (cats.has('fruits') || cats.has('fruit')) return 'sweet';
  if (
    cats.has('beef') || cats.has('poultry') || cats.has('seafood') ||
    cats.has('fish') || cats.has('shellfish') || cats.has('legumes') ||
    cats.has('vegetables') || cats.has('vegetable') || cats.has('sauces')
  ) return 'savory';
  return 'neutral';
}

function cuisineCompatible(groupA, groupB) {
  if (groupA === 'neutral' || groupB === 'neutral') return true;
  return groupA === groupB;
}

function macroDistance(original, candidate) {
  return (
    Math.abs(original.caloriesPer100g - candidate.caloriesPer100g) +
    Math.abs(original.proteinGPer100g - candidate.proteinGPer100g) * 4 +
    Math.abs(original.carbGPer100g - candidate.carbGPer100g) * 2 +
    Math.abs(original.fatGPer100g - candidate.fatGPer100g) * 4
  );
}

// ── Interactive meal rebalancing ─────────────────────────────────────────────

// After the main algorithm converges, nudge the most relevant food to fix
// any remaining bounds violations (e.g. protein drift when no protein-role food exists).
// Runs up to 4 single-food adjustments; gives up if a pass makes no progress.
function nudgeIntoBounds(items, bounds) {
  // Maps the violation label returned by findBoundsViolation to the keys used in totals/bounds
  const VIOLATION_TO_KEY = { calories: 'calories', protein: 'proteinG', carbs: 'carbG', fat: 'fatG' };
  const KEY_TO_FOOD_FIELD = {
    calories: 'caloriesPer100g',
    proteinG: 'proteinGPer100g',
    carbG: 'carbGPer100g',
    fatG: 'fatGPer100g',
  };

  let current = items.map((i) => ({ ...i }));

  for (let pass = 0; pass < 4; pass++) {
    const totals = totalsForItems(current);
    const violation = findBoundsViolation(totals, bounds);
    if (!violation) return current;

    const key = VIOLATION_TO_KEY[violation];
    const field = KEY_TO_FOOD_FIELD[key];
    const currentVal = totals[key];
    const tooLow = currentVal < bounds[key].min;
    const deficit = tooLow ? bounds[key].min - currentVal : bounds[key].max - currentVal;

    let bestIdx = -1;
    let bestRate = 0;
    current.forEach((item, i) => {
      const rate = item.food[field] / 100;
      if (rate <= 0) return;
      const minQ = item.food.minServingG ?? 20;
      const maxQ = item.food.maxServingG ?? 500;
      const atLimit = tooLow ? item.quantityG >= maxQ : item.quantityG <= minQ;
      if (!atLimit && rate > bestRate) {
        bestRate = rate;
        bestIdx = i;
      }
    });

    if (bestIdx === -1) return current;

    const item = current[bestIdx];
    const deltaG = (tooLow ? 1 : -1) * Math.abs(deficit) / bestRate;
    const minQ = item.food.minServingG ?? 20;
    const maxQ = item.food.maxServingG ?? 500;
    const newQ = roundToNearest(Math.min(maxQ, Math.max(minQ, item.quantityG + deltaG)), 5);
    if (newQ === item.quantityG) return current;

    current[bestIdx] = { ...item, quantityG: newQ };
  }

  return current;
}

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

function solvePortionsLeastSquares(items, target, options = {}) {
  const weights = { protein: 1, carb: 1, fat: 1, ...(options.weights ?? {}) };
  const maxIterations = options.maxIterations ?? NUTRITION.maxPortionAdjustmentIterations;
  const learningRate = options.learningRate ?? 0.3;

  const meta = items.map((item) => ({
    p: item.food.proteinGPer100g / 100,
    c: item.food.carbGPer100g / 100,
    f: item.food.fatGPer100g / 100,
    min: Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20,
    max: Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500,
  }));

  // Raw floats during iteration — rounding only applied to final output
  let x = meta.map((m, i) => clamp(items[i].quantityG, m.min, m.max));

  for (let iter = 0; iter < maxIterations; iter++) {
    let P = 0;
    let C = 0;
    let F = 0;
    for (let i = 0; i < x.length; i++) {
      P += x[i] * meta[i].p;
      C += x[i] * meta[i].c;
      F += x[i] * meta[i].f;
    }

    const errP = P - target.proteinG;
    const errC = C - target.carbG;
    const errF = F - target.fatG;

    let gradNormSq = 0;
    const next = x.map((xi, i) => {
      const grad =
        2 * weights.protein * meta[i].p * errP +
        2 * weights.carb   * meta[i].c * errC +
        2 * weights.fat    * meta[i].f * errF;
      gradNormSq += grad * grad;
      return clamp(xi - learningRate * grad, meta[i].min, meta[i].max);
    });

    x = next;
    if (gradNormSq < 1e-6) break;
  }

  return items.map((item, i) => ({
    ...item,
    quantityG: roundServingWithinBounds(x[i], meta[i].min, meta[i].max),
  }));
}

function findPortionGridSolution(items, target, bounds, seedItems = items) {
  const result = findBestPortionGridFit(items, target, bounds, seedItems, {
    step: 5,
    maxVisits: Infinity,
    maxMs: Infinity,
  });
  return result?.items ?? null;
}

function findBestPortionGridFit(items, target, bounds, seedItems = items, options = {}) {
  const keys = ['calories', 'proteinG', 'carbG', 'fatG'];
  const step = Number.isFinite(options.step) && options.step > 0 ? options.step : EXACT_PORTION_SEARCH_STEP_G;
  const maxVisits = Number.isFinite(options.maxVisits) ? options.maxVisits : EXACT_PORTION_SEARCH_MAX_VISITS;
  const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : EXACT_PORTION_SEARCH_MAX_MS;
  const startedAt = Date.now();
  const seedByFoodId = new Map(seedItems.map((item) => [item.food.id, item.quantityG]));

  const variables = items
    .map((item, index) => ({ item, index }))
    .map(({ item, index }) => {
      const candidates = servingGridCandidates(item.food, seedByFoodId.get(item.food.id) ?? item.quantityG, step)
        .map((quantityG) => ({
          quantityG,
          totals: macrosForFoodPortion(item.food, quantityG),
        }));
      return { item, index, candidates };
    })
    .filter((entry) => entry.candidates.length > 0)
    .sort((a, b) => a.candidates.length - b.candidates.length);

  if (variables.length === 0) return null;

  const suffix = Array.from({ length: variables.length + 1 }, () => emptyMacroRange());
  for (let i = variables.length - 1; i >= 0; i--) {
    const current = candidateMacroRange(variables[i].candidates);
    suffix[i] = addMacroRanges(current, suffix[i + 1]);
  }

  let best = null;
  let bestScore = Infinity;
  let bestTotals = null;
  let visited = 0;
  let aborted = false;
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

  function shouldStop() {
    if (visited >= maxVisits) return true;
    return Date.now() - startedAt >= maxMs;
  }

  function visit(pos, totals) {
    if (aborted) return;
    visited += 1;
    if (shouldStop()) {
      aborted = true;
      return;
    }
    if (!canStillFit(totals, pos)) return;
    if (lowerBoundScore(totals, pos) >= bestScore) return;

    if (pos >= variables.length) {
      if (findBoundsViolation(totals, bounds)) return;
      const score = macroBoundFitScore(totals, target);
      if (score < bestScore) {
        bestScore = score;
        bestTotals = totals;
        best = new Map(chosen);
      }
      return;
    }

    const variable = variables[pos];
    for (const candidate of variable.candidates) {
      chosen.set(variable.index, candidate.quantityG);
      visit(pos + 1, addMacros(totals, candidate.totals));
      chosen.delete(variable.index);
    }
  }

  visit(0, { calories: 0, proteinG: 0, carbG: 0, fatG: 0 });
  if (!best) return null;

  return {
    items: items.map((item, index) => (
      best.has(index)
        ? { ...item, quantityG: best.get(index) }
        : item
    )),
    totals: bestTotals,
    score: bestScore,
    visited,
    exhaustive: !aborted,
  };
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

function emptyMacroRange() {
  const empty = { calories: 0, proteinG: 0, carbG: 0, fatG: 0 };
  return { min: { ...empty }, max: { ...empty } };
}

function candidateMacroRange(candidates) {
  const range = {
    min: { calories: Infinity, proteinG: Infinity, carbG: Infinity, fatG: Infinity },
    max: { calories: -Infinity, proteinG: -Infinity, carbG: -Infinity, fatG: -Infinity },
  };

  for (const candidate of candidates) {
    for (const key of Object.keys(range.min)) {
      range.min[key] = Math.min(range.min[key], candidate.totals[key]);
      range.max[key] = Math.max(range.max[key], candidate.totals[key]);
    }
  }

  return range;
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

function macroBoundFitScore(totals, target) {
  return (
    3 * Math.abs(totals.calories - target.calories) / Math.max(1, target.calories) +
    Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG) +
    Math.abs(totals.carbG - target.carbG) / Math.max(1, target.carbG) +
    Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG)
  );
}

function rebalanceMeal({ mealTarget, items: rawItems, mealBounds, dailyContext }) {
  const items = resolveMealActionItems(rawItems);

  const bounds = mealBounds ?? computeMealBounds(mealTarget, {
    dailyCalories: dailyContext?.dailyTargets?.calories,
    dailyTargets: dailyContext?.dailyTargets,
    weightKg: dailyContext?.weightKg,
  });
  const initialTotals = totalsForItems(items);
  if (!findBoundsViolation(initialTotals, bounds)) {
    const mealValidation = dailyContext
      ? validateMealSwap({ ...dailyContext, mealTarget, proposedMealTotals: initialTotals })
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
      items: items.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
      totals: initialTotals,
      ...(mealValidation ? { mealValidation } : {}),
    };
  }

  const adjusted = adjustPortions(items, mealTarget);

  const finalItems = findBoundsViolation(totalsForItems(adjusted), bounds)
    ? nudgeIntoBounds(adjusted, bounds)
    : adjusted;

  const totals = totalsForItems(finalItems);
  const violation = findBoundsViolation(totals, bounds);
  if (violation) {
    const gridItems = findPortionGridSolution(items, mealTarget, bounds, finalItems);
    if (gridItems) {
      const gridTotals = totalsForItems(gridItems);
      const mealValidation = dailyContext
        ? validateMealSwap({ ...dailyContext, mealTarget, proposedMealTotals: gridTotals })
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
        items: gridItems.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
        totals: gridTotals,
        ...(mealValidation ? { mealValidation } : {}),
      };
    }
    return { success: false, violatedMacro: violation };
  }

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
    items: finalItems.map((item) => ({ foodId: item.food.id, quantityG: item.quantityG })),
    totals,
    ...(mealValidation ? { mealValidation } : {}),
  };
}

function adjustPortions(initialItems, target) {
  return solvePortionsLeastSquares(initialItems, target, {
    maxIterations: NUTRITION.maxPortionAdjustmentIterations * 4,
  });
}

function filterFoodsForChatbox({ foods, mealTag, userInput }) {
  const acceptedTags = templateTagsForMealTag(mealTag);
  let filtered = foods.filter((f) =>
    acceptedTags.some((tag) => f.mealTags.includes(tag))
  );

  try {
    const safeInput = {
      dietType: userInput.dietType || 'standard',
      avoidFoods: Array.isArray(userInput.avoidFoods) ? userInput.avoidFoods : [],
      allergies: [],
      dislikes: [],
    };
    filtered = filterFoods(filtered, safeInput);
  } catch {
    // If filter fails (e.g. unknown term), use unfiltered by-tag results
  }

  const byRole = { protein: [], carb: [], fat: [], mixed: [] };
  for (const f of filtered) {
    byRole[f.macroRole]?.push(f);
  }

  const balanced = [
    ...byRole.protein.slice(0, 8),
    ...byRole.carb.slice(0, 8),
    ...byRole.fat.slice(0, 5),
    ...byRole.mixed.slice(0, 4),
  ];

  return balanced.map((f) => ({
    id: f.id,
    name: f.name,
    macroRole: f.macroRole,
    minServingG: f.minServingG,
    maxServingG: f.maxServingG,
    caloriesPer100g: f.caloriesPer100g,
    proteinGPer100g: f.proteinGPer100g,
    carbGPer100g: f.carbGPer100g,
    fatGPer100g: f.fatGPer100g,
  }));
}

module.exports = {
  generatePlan,
  generatePlanFreeform,
  getFoods,
  normalizeInput,
  rebalanceMeal,
  computeDailyPlanBounds,
  dailyTotalsWithinPlanBounds,
  computeMealBounds,
  validateMealSwap,
  filterFoodsForChatbox,
  generateAlternateMealOptions,
  solvePortionsLeastSquares,
  findBestPortionGridFit,
};
