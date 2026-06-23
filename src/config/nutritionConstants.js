const NUTRITION = {
  proteinKcalPerGram: 4,
  carbKcalPerGram: 4,
  fatKcalPerGram: 9,
  proteinPerKg: 2,
  fatPerKg: 1.0,
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
  residualScoreImprovementThreshold: 0.10,
  hardErrorCalorieFloorPercent: 0.80,
  severeCalorieFloorPercent: 0.70,
  hardErrorProteinShortfallG: 25,
  hardErrorProteinShortfallPercent: 0.20,
  hardErrorMacroToleranceMultiplier: 3,
  residualPercentNearZeroTarget: 25,
  maxPortionAdjustmentIterations: 20,
  maxMealAttempts: 8,
};

const MEAL_SPLITS = {
  meals: {
    2: [0.5, 0.5],
    3: [0.3, 0.4, 0.3],
    4: [0.25, 0.25, 0.25, 0.25],
    5: [0.2, 0.25, 0.25, 0.2, 0.1],
    6: [0.18, 0.2, 0.2, 0.15, 0.15, 0.12],
  },
  snacks: {
    0: 0,
    1: 0.10,
    2: 0.15,
    3: 0.20,
  },
  ramadanSplits: [0.5, 0.2, 0.3],
  ramadanNames: ['Iftar', 'Snack', 'Suhoor'],
  ramadanTags: ['iftar', 'snack', 'suhoor'],
};

// Hardcoded per-slot macro profiles for template seeding. These should eventually
// be informed by actual template composition once the ready-meal library is larger.
const SLOT_MACRO_PROFILES = {
  breakfast: {
    calorieWeight: 0.28,
    minOffset: 0.05,
    maxOffset: 0.05,
    hardMaxOffset: 0.10,
    macroCalorieRatio: { protein: 0.22, carb: 0.48, fat: 0.30 },
  },
  lunch: {
    calorieWeight: 0.39,
    minOffset: 0.05,
    maxOffset: 0.05,
    hardMaxOffset: 0.10,
    macroCalorieRatio: { protein: 0.35, carb: 0.40, fat: 0.25 },
  },
  dinner: {
    calorieWeight: 0.33,
    minOffset: 0.05,
    maxOffset: 0.05,
    hardMaxOffset: 0.10,
    macroCalorieRatio: { protein: 0.35, carb: 0.30, fat: 0.35 },
  },
  snack: {
    calorieWeight: 0.16,
    minOffset: 0.05,
    maxOffset: 0.05,
    hardMaxOffset: 0.10,
    macroCalorieRatio: { protein: 0.22, carb: 0.48, fat: 0.30 },
  },
  iftar: {
    calorieWeight: 0.50,
    minOffset: 0.08,
    maxOffset: 0.08,
    hardMaxOffset: 0.12,
    macroCalorieRatio: { protein: 0.32, carb: 0.43, fat: 0.25 },
  },
  suhoor: {
    calorieWeight: 0.34,
    minOffset: 0.08,
    maxOffset: 0.08,
    hardMaxOffset: 0.12,
    macroCalorieRatio: { protein: 0.28, carb: 0.42, fat: 0.30 },
  },
};

module.exports = {
  MEAL_SPLITS,
  NUTRITION,
  SLOT_MACRO_PROFILES,
};
