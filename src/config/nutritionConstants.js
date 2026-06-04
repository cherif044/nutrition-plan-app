const NUTRITION = {
  proteinKcalPerGram: 4,
  carbKcalPerGram: 4,
  fatKcalPerGram: 9,
  proteinPerKg: 2,
  fatPerKg: 0.6,
  katchMcArdleBase: 370,
  katchMcArdleLeanMassMultiplier: 21.6,
  activityMultipliers: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very_active: 1.725,
    athlete: 1.9,
  },
  bodyweightActivityFactors: {
    sedentary: 26,
    light: 30,
    moderate: 34,
    very_active: 38,
    athlete: 42,
  },
  goalAdjustments: {
    maintain: 0,
    lose_weight: -500,
    lose_weight_aggressive: -1000,
    gain_weight: 300,
  },
  calorieTolerancePercent: 0.15,
  proteinToleranceG: 10,
  carbToleranceG: 15,
  fatToleranceG: 10,
  maxPortionAdjustmentIterations: 20,
  maxMealAttempts: 8,
};

const MEAL_SPLITS = {
  meals: {
    2: [0.5, 0.5],
    3: [0.3, 0.4, 0.3],
    4: [0.25, 0.25, 0.25, 0.25],
    5: [0.2, 0.25, 0.25, 0.2, 0.1],
  },
  snacks: {
    0: 0,
    1: 0.1,
    2: 0.15,
  },
  ramadanSplits: [0.5, 0.2, 0.3],
  ramadanNames: ['Iftar', 'Snack', 'Suhoor'],
  ramadanTags: ['iftar', 'snack', 'suhoor'],
};

module.exports = {
  MEAL_SPLITS,
  NUTRITION,
};
