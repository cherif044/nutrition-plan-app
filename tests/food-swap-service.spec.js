const { test, expect } = require('@playwright/test');
const Module = require('module');

const servicePath = require.resolve('../src/services/foodSwapService');
const foodRepositoryPath = require.resolve('../src/repositories/foodRepository');
const planGeneratorPath = require.resolve('../src/services/planGenerator');

function makeFood(id, name = id) {
  return {
    id,
    name,
    defaultServingG: 100,
    minServingG: 20,
    maxServingG: 300,
    caloriesPer100g: 100,
    proteinGPer100g: 10,
    carbGPer100g: 10,
    fatGPer100g: 2,
    categories: ['protein'],
    mealTags: ['lunch'],
  };
}

function loadFoodSwapServiceWithMocks({ candidateCount = 35 } = {}) {
  const source = makeFood('source_food', 'Source food');
  const candidates = Array.from({ length: candidateCount }, (_, index) => makeFood(`candidate_${index + 1}`, `Candidate ${index + 1}`));
  const foodSwaps = {
    source_food: candidates.map((food, index) => ({
      candidateId: food.id,
      score: 0.01 + index / 1000,
      tier: 1,
    })),
  };

  let rebalanceCalls = 0;
  const originalLoad = Module._load;
  delete require.cache[servicePath];
  Module._load = function mockedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === foodRepositoryPath) {
      return {
        loadFoods: () => [source, ...candidates],
        loadFoodSwaps: () => foodSwaps,
      };
    }
    if (resolved === planGeneratorPath) {
      return {
        filterFoods: (foods) => foods,
        clampServing: (food, quantityG) => quantityG || food.defaultServingG,
        rebalanceMeal: () => {
          rebalanceCalls += 1;
          return { success: true };
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return {
      service: require(servicePath),
      getRebalanceCalls: () => rebalanceCalls,
    };
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

test('swap suggestions default to every valid candidate instead of ten', () => {
  const { service } = loadFoodSwapServiceWithMocks({ candidateCount: 35 });

  const result = service.getSwapSuggestions({ foodId: 'source_food' });

  expect(result.options).toHaveLength(35);
  expect(result.options[0]).toMatchObject({ foodId: 'candidate_1', name: 'Candidate 1' });
  expect(result.options[34]).toMatchObject({ foodId: 'candidate_35', name: 'Candidate 35' });
});

test('swap suggestions still honor an explicit positive limit', () => {
  const { service } = loadFoodSwapServiceWithMocks({ candidateCount: 35 });

  const result = service.getSwapSuggestions({ foodId: 'source_food', limit: 10 });

  expect(result.options).toHaveLength(10);
  expect(result.options.at(-1)).toMatchObject({ foodId: 'candidate_10' });
});

test('meal-context swap suggestions scan past the old thirty-candidate ceiling', () => {
  const { service, getRebalanceCalls } = loadFoodSwapServiceWithMocks({ candidateCount: 35 });

  const result = service.getSwapSuggestions({
    foodId: 'source_food',
    mealContext: {
      itemIndex: 0,
      currentItems: [{ foodId: 'source_food', quantityG: 100 }],
      mealTarget: { calories: 500 },
    },
  });

  expect(result.options).toHaveLength(35);
  expect(getRebalanceCalls()).toBe(35);
});
