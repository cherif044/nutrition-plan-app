const { test, expect } = require('@playwright/test');

const {
  closeGenerationPool,
  generatePlanInWorker,
  generationPoolStats,
} = require('../src/services/planGenerationPool');

const validInput = {
  weightKg: 78,
  heightCm: 178,
  age: 29,
  sex: 'male',
  bodyFatPercentage: '',
  activityLevel: 'moderate',
  goal: 'lose_weight',
  dietType: 'standard',
  numberOfMeals: 4,
  mealDistribution: 'balanced',
  allergies: [],
  dislikes: [],
  avoidFoods: [],
};

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await closeGenerationPool();
});

test('generates the existing plan response and trace shape in a worker', async () => {
  const traceEvents = [];
  const plan = await generatePlanInWorker(validInput, {
    requestId: 'worker-test',
    timelineId: 'worker-timeline',
    traceEvents,
  });

  expect(plan.meals).toHaveLength(4);
  expect(plan.dailyTargets).toBeTruthy();
  expect(plan.nutritionCalculation).toBeTruthy();
  expect(traceEvents.length).toBeGreaterThan(0);
  const stats = generationPoolStats();
  expect(stats.workers).toBeGreaterThan(0);
  expect(stats).toMatchObject({ busy: 0, queued: 0 });
});

test('keeps the main event loop available during generation', async () => {
  let immediateRan = false;
  const generation = generatePlanInWorker(validInput);
  await new Promise((resolve) => {
    setImmediate(() => {
      immediateRan = true;
      resolve();
    });
  });

  expect(immediateRan).toBe(true);
  await expect(generation).resolves.toMatchObject({
    meals: expect.any(Array),
  });
});

test('preserves validation errors and failed-generation traces', async () => {
  const traceEvents = [];
  await expect(generatePlanInWorker({ ...validInput, weightKg: 0 }, { traceEvents }))
    .rejects.toThrow('Enter a valid weight.');
  expect(traceEvents.some((event) => event.message.includes('failed'))).toBe(true);
});
