const { loadSwapSystem } = require('../repositories/swapSystemRepository');
const {
  NUTRITION,
  macrosForFoodPortion,
  sumTargets,
  roundToNearest,
  clamp,
} = require('./nutritionService');

const SWAP_POLICY_EXACT = 'same_exact_swap_group_only';
const SWAP_POLICY_FAMILY = 'same_swap_group_then_family_slot';

function getSwapCandidates(template, component, input, allowedFoods) {
  const system = loadSwapSystem();
  const allowedFoodMap = new Map(allowedFoods.map((food) => [food.id, food]));
  const family = system.mealFamilies[template.family];
  const originalGroupId = component.swapGroup || system.foodDefaultSwapGroupById[component.foodId];
  const originalGroup = system.swapGroups[originalGroupId];
  const rejectionLog = [];

  if (template.swapEnabled === false || template.swapMode === 'none' || component.swapEnabled !== true) {
    return {
      candidates: [],
      rejected: [{
        foodId: component.foodId,
        reason: 'component_swap_disabled',
        lockReason: component.lockReason ?? null,
      }],
    };
  }
  if (!family) {
    return { candidates: [], rejected: [{ foodId: component.foodId, reason: 'unknown_template_family' }] };
  }
  if (!originalGroup) {
    return { candidates: [], rejected: [{ foodId: component.foodId, reason: 'unknown_component_swap_group' }] };
  }

  const groupIds = groupIdsForPolicy({ family, component, originalGroupId });
  const unique = new Map();

  for (const groupId of groupIds) {
    const group = system.swapGroups[groupId];
    if (!group) {
      rejectionLog.push({ groupId, reason: 'unknown_swap_group' });
      continue;
    }

    for (const foodId of group.foods) {
      if (foodId === component.foodId) continue;

      const food = allowedFoodMap.get(foodId);
      if (!food) {
        rejectionLog.push({ foodId, groupId, reason: 'food_not_allowed_by_current_restrictions_or_missing' });
        continue;
      }

      const guard = badPairingViolation({
        template,
        component,
        candidateFood: food,
        candidateGroupId: groupId,
        input,
        system,
      });
      if (guard) {
        rejectionLog.push({ foodId, groupId, reason: guard.rule, message: guard.message });
        continue;
      }

      const source = groupId === originalGroupId ? 'same_swap_group' : 'same_family_slot';
      const current = unique.get(food.id);
      const next = { food, foodId: food.id, groupId, source, component };
      if (!current || sourceRank(next.source) < sourceRank(current.source)) {
        unique.set(food.id, next);
      }
    }
  }

  return {
    candidates: Array.from(unique.values()).sort((a, b) => (
      sourceRank(a.source) - sourceRank(b.source) ||
      groupPriority(system, b.groupId) - groupPriority(system, a.groupId) ||
      a.food.name.localeCompare(b.food.name)
    )),
    rejected: rejectionLog,
  };
}

function applySwapToTemplate(template, oldFoodId, newFoodId) {
  return {
    ...template,
    components: template.components.map((component) => (
      component.foodId === oldFoodId
        ? { ...component, foodId: newFoodId, swappedFromFoodId: oldFoodId }
        : { ...component }
    )),
  };
}

function trySameFamilySwaps(template, targetMacros, input, allowedFoods) {
  const allowedFoodMap = new Map(allowedFoods.map((food) => [food.id, food]));
  const reports = [];
  const rejected = [];
  const blockedComponents = template.components.filter((component) => !allowedFoodMap.has(component.foodId));
  const swapPlans = blockedComponents.length > 0
    ? requiredSwapPlans({ template, blockedComponents, input, allowedFoods, rejected })
    : optionalSingleSwapPlans({ template, input, allowedFoods, rejected });

  for (const plan of swapPlans) {
    let swappedTemplate = template;
    for (const step of plan.steps) {
      swappedTemplate = applySwapToTemplate(swappedTemplate, step.oldFoodId, step.newFoodId);
    }

    const items = itemsForTemplate(swappedTemplate, allowedFoodMap);
    if (!items) {
      rejected.push({
        templateId: template.templateId,
        reason: 'swapped_template_still_contains_disallowed_or_missing_food',
        swaps: plan.steps,
      });
      continue;
    }

    const solvedItems = solvePortionsLeastSquares(items, targetMacros);
    const servingViolation = solvedItems.find((item) => !isWithinServingPolicy(item.food, item.quantityG));
    if (servingViolation) {
      rejected.push({
        foodId: servingViolation.food.id,
        reason: 'solved_serving_outside_limits',
        quantityG: servingViolation.quantityG,
      });
      continue;
    }

    const solvedMeal = {
      template: swappedTemplate,
      items: solvedItems,
      totals: totalsForItems(solvedItems),
      swaps: plan.steps,
      source: plan.source,
    };
    reports.push({
      ...solvedMeal,
      rankScore: rankSwapCandidate(plan, solvedMeal, targetMacros),
    });
  }

  reports.sort((a, b) => a.rankScore - b.rankScore);
  return { candidates: reports, rejected };
}

function rankSwapCandidate(candidate, solvedMeal, targetMacros) {
  const system = loadSwapSystem();
  const weights = system.solverAndRankingPolicy.rankingWeights ?? {};
  const fitScore = macroFitScore(solvedMeal.items, targetMacros);
  const sourceBonus = candidate.source === 'same_swap_group'
    ? Number(weights.sameExactSwapGroup ?? 0.22)
    : Number(weights.sameFamilySlot ?? 0.16);
  const servingPenalty = servingRealismPenalty(solvedMeal.items) * Number(weights.servingRealism ?? 0.1);

  return (
    fitScore * Number(weights.macroFitAfterSolver ?? 0.42) +
    servingPenalty -
    sourceBonus
  );
}

function groupIdsForPolicy({ family, component, originalGroupId }) {
  if (component.swapCandidatePolicy === SWAP_POLICY_EXACT) {
    return [originalGroupId];
  }

  if (component.swapCandidatePolicy !== SWAP_POLICY_FAMILY) {
    return [originalGroupId];
  }

  const familySlotGroups = family.slotGroups?.[component.slot] ?? [];
  return [originalGroupId, ...familySlotGroups].filter((groupId, index, all) => (
    groupId && all.indexOf(groupId) === index && !(family.forbidGroups ?? []).includes(groupId)
  ));
}

function requiredSwapPlans({ template, blockedComponents, input, allowedFoods, rejected }) {
  const plans = [{ steps: [], source: 'same_swap_group' }];

  for (const component of blockedComponents) {
    const { candidates, rejected: componentRejected } = getSwapCandidates(template, component, input, allowedFoods);
    rejected.push(...componentRejected);
    if (candidates.length === 0) return [];

    const nextPlans = [];
    for (const plan of plans) {
      for (const candidate of candidates.slice(0, 8)) {
        nextPlans.push({
          steps: [
            ...plan.steps,
            {
              oldFoodId: component.foodId,
              newFoodId: candidate.food.id,
              slot: component.slot,
              swapGroup: candidate.groupId,
              source: candidate.source,
            },
          ],
          source: maxSource(plan.source, candidate.source),
        });
      }
    }
    plans.splice(0, plans.length, ...nextPlans.slice(0, 64));
  }

  return plans;
}

function optionalSingleSwapPlans({ template, input, allowedFoods, rejected }) {
  const plans = [];

  for (const component of template.components) {
    const { candidates, rejected: componentRejected } = getSwapCandidates(template, component, input, allowedFoods);
    rejected.push(...componentRejected.slice(0, 10));
    for (const candidate of candidates.slice(0, 8)) {
      plans.push({
        steps: [{
          oldFoodId: component.foodId,
          newFoodId: candidate.food.id,
          slot: component.slot,
          swapGroup: candidate.groupId,
          source: candidate.source,
        }],
        source: candidate.source,
      });
    }
  }

  return plans;
}

function itemsForTemplate(template, allowedFoodMap) {
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

function badPairingViolation({ template, component, candidateFood, candidateGroupId, input, system }) {
  const rules = system.badPairingGuards?.hardRejectRules ?? [];
  for (const rule of rules) {
    if (hardRuleApplies(rule.rule, { template, component, candidateFood, candidateGroupId, input })) {
      return rule;
    }
  }
  return null;
}

function hardRuleApplies(rule, { template, component, candidateFood, candidateGroupId, input }) {
  const mealTypes = templateTagsForMealTag(input?.mealTag ?? template.mealType);
  const lunchDinner = mealTypes.some((mealType) => ['lunch', 'dinner'].includes(mealType));
  const coreSlot = ['primary_protein', 'main_carb', 'fat', 'legume_base'].includes(component.slot);

  if (rule === 'condiment_as_primary_component') {
    return coreSlot && candidateGroupId.startsWith('condiment.');
  }
  if (rule === 'protein_powder_in_lunch_or_dinner_plate') {
    return lunchDinner && candidateGroupId === 'protein.supplement.powder';
  }
  if (rule === 'fruit_as_lunch_dinner_main_carb_with_meat') {
    return lunchDinner && component.slot === 'main_carb' && candidateGroupId.startsWith('carb.fruit.');
  }
  if (rule === 'quinoa_in_classic_plate_unless_family_is_grain_bowl') {
    return candidateFood.id === 'quinoa_cooked' && template.family !== 'grain_bowl';
  }
  if (rule === 'vegetable_side_as_main_macro_filler') {
    return coreSlot && candidateGroupId.startsWith('side.vegetable.');
  }
  if (rule === 'nuts_or_peanut_butter_as_meat_replacement') {
    return component.slot === 'primary_protein' &&
      (candidateGroupId.startsWith('fat.nuts') || candidateFood.id.includes('peanut_butter'));
  }
  if (rule === 'avocado_as_main_carb') {
    return component.slot === 'main_carb' && candidateFood.id.includes('avocado');
  }
  if (rule === 'butter_as_default_lunch_dinner_fat') {
    return lunchDinner && candidateGroupId === 'fat.butter.spread';
  }

  return false;
}

function isWithinServingPolicy(food, quantityG) {
  const min = Number.isFinite(food.minServingG) ? food.minServingG : 20;
  const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
  return quantityG >= min - 0.01 && quantityG <= max + 0.01;
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

function solvePortionsLeastSquares(items, target, options = {}) {
  const weights = { protein: 1, fat: 1, ...(options.weights ?? {}) };
  const maxIterations = options.maxIterations ?? NUTRITION.maxPortionAdjustmentIterations;
  const learningRate = options.learningRate ?? 0.3;

  const meta = items.map((item) => ({
    p: item.food.proteinGPer100g / 100,
    f: item.food.fatGPer100g / 100,
    min: Number.isFinite(item.food.minServingG) ? item.food.minServingG : 20,
    max: Number.isFinite(item.food.maxServingG) ? item.food.maxServingG : 500,
  }));

  let x = meta.map((m, i) => clamp(items[i].quantityG, m.min, m.max));

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let protein = 0;
    let fat = 0;
    for (let i = 0; i < x.length; i += 1) {
      protein += x[i] * meta[i].p;
      fat += x[i] * meta[i].f;
    }

    const errP = protein - target.proteinG;
    const errF = fat - target.fatG;

    let gradNormSq = 0;
    x = x.map((xi, i) => {
      const grad =
        2 * weights.protein * meta[i].p * errP +
        2 * weights.fat * meta[i].f * errF;
      gradNormSq += grad * grad;
      return clamp(xi - learningRate * grad, meta[i].min, meta[i].max);
    });

    if (gradNormSq < 1e-6) break;
  }

  return items.map((item, i) => ({
    ...item,
    quantityG: roundServingWithinBounds(x[i], meta[i].min, meta[i].max),
  }));
}

function roundServingWithinBounds(quantityG, min, max, step = 5) {
  const clamped = clamp(quantityG, min, max);
  let rounded = roundToNearest(clamped, step);
  if (rounded < min) rounded = Math.ceil(min / step) * step;
  if (rounded > max) rounded = Math.floor(max / step) * step;
  return clamp(rounded, min, max);
}

function clampServing(food, quantityG) {
  const min = Number.isFinite(food.minServingG) ? food.minServingG : 20;
  const max = Number.isFinite(food.maxServingG) ? food.maxServingG : 500;
  return roundServingWithinBounds(quantityG, min, max);
}

function totalsForItems(items) {
  return sumTargets(items.map((item) => macrosForFoodPortion(item.food, item.quantityG)));
}

function macroFitScore(items, target) {
  const totals = totalsForItems(items);
  const calorieScore = Math.abs(totals.calories - target.calories) / Math.max(1, target.calories);
  const proteinScore = Math.abs(totals.proteinG - target.proteinG) / Math.max(1, target.proteinG);
  const fatScore = Math.abs(totals.fatG - target.fatG) / Math.max(1, target.fatG);
  return calorieScore + proteinScore + fatScore;
}

function sourceRank(source) {
  return source === 'same_swap_group' ? 0 : 1;
}

function maxSource(a, b) {
  return sourceRank(a) >= sourceRank(b) ? a : b;
}

function groupPriority(system, groupId) {
  return Number(system.swapGroups[groupId]?.defaultPriority ?? 0);
}

function templateTagsForMealTag(mealTag) {
  if (mealTag === 'iftar') return ['dinner', 'lunch'];
  if (mealTag === 'suhoor') return ['breakfast', 'dinner'];
  return [mealTag];
}

module.exports = {
  getSwapCandidates,
  applySwapToTemplate,
  trySameFamilySwaps,
  rankSwapCandidate,
};
