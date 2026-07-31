const NUTRITION = {
  proteinKcalPerGram: 4,
  carbKcalPerGram: 4,
  fatKcalPerGram: 9,
  mifflinStJeor: {
    weightCoefficient: 10,
    heightCoefficient: 6.25,
    ageCoefficient: 5,
    maleConstant: 5,
    femaleConstant: -161,
  },
  activityMultipliers: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    athlete: 1.9,
  },
  weightLoss: {
    minimumWeeklyPercent: 0.5,
    maximumWeeklyPercent: 1.0,
    defaultWeeklyPercent: 0.75,
    kcalPerKg: 7700,
  },
  weightGain: {
    minimumSurplusCalories: 200,
    maximumSurplusCalories: 300,
    defaultSurplusCalories: 250,
  },
  proteinPerKg: {
    minimum: 1.8,
    maximum: 2.2,
    default: 2.0,
  },
  fatPerKg: {
    minimum: 0.66,
    maximum: 1.0,
    default: 0.7,
  },
  mealMacroRatioRanges: {
    breakfast: {
      protein: { min: 0.20, max: 0.24 },
      fat: { min: 0.33, max: 0.52 },
      carb: { min: 0.28, max: 0.51 },
    },
    lunch: {
      protein: { min: 0.20, max: 0.28 },
      fat: { min: 0.29, max: 0.41 },
      carb: { min: 0.34, max: 0.46 },
    },
    dinner: {
      protein: { min: 0.20, max: 0.27 },
      fat: { min: 0.27, max: 0.40 },
      carb: { min: 0.35, max: 0.45 },
    },
    snack: {
      protein: { min: 0.20, max: 0.24 },
      fat: { min: 0.39, max: 0.63 },
      carb: { min: 0.20, max: 0.34 },
    },
  },
  mealSwapDailyCalorieWindowPercent: 0.05,
  calorieTolerancePercent: 0.20,
  mealMacroTolerancePercent: 0.20,
  totalMacroTolerancePercent: 0.05,
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

const MEAL_DISTRIBUTIONS = {
  balanced: {
    2: [0.40, 0.60],
    3: [0.25, 0.40, 0.35],
    4: [0.25, 0.15, 0.30, 0.30],
    5: [0.20, 0.10, 0.30, 0.10, 0.30],
  },
  breakfast_heavy: {
    2: [0.45, 0.55],
    3: [0.30, 0.373, 0.327],
    4: [0.30, 0.15, 0.275, 0.275],
    5: [0.25, 0.10, 0.275, 0.10, 0.275],
  },
  lunch_heavy: {
    2: [0.25, 0.75],
    3: [0.1875, 0.55, 0.2625],
    4: [0.182, 0.15, 0.45, 0.218],
    5: [0.14, 0.10, 0.45, 0.10, 0.21],
  },
  dinner_heavy: {
    2: [0.25, 0.75],
    3: [0.192, 0.308, 0.50],
    4: [0.182, 0.15, 0.218, 0.45],
    5: [0.14, 0.10, 0.21, 0.10, 0.45],
  },
};

const STANDARD_MEAL_SLOT_POLICY = {
  3: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Dinner', tag: 'dinner' },
  ],
  4: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Snack', tag: 'snack' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Dinner', tag: 'dinner' },
  ],
};

const AMBIGUOUS_MEAL_SLOT_POLICY = {
  balanced: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Lunch/Dinner', tag: 'main_meal', profileTag: 'lunch' },
  ],
  breakfast_heavy: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Lunch/Dinner', tag: 'main_meal', profileTag: 'lunch' },
  ],
  lunch_heavy: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Lunch', tag: 'lunch' },
  ],
  dinner_heavy: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Dinner', tag: 'dinner' },
  ],
  balanced_5: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Snack 1', tag: 'snack' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Snack 2', tag: 'snack' },
    { name: 'Dinner', tag: 'dinner' },
  ],
  breakfast_heavy_5: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Snack 1', tag: 'snack' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Snack 2', tag: 'snack' },
    { name: 'Dinner', tag: 'dinner' },
  ],
  lunch_heavy_5: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Snack 1', tag: 'snack' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Snack 2', tag: 'snack' },
    { name: 'Dinner', tag: 'dinner' },
  ],
  dinner_heavy_5: [
    { name: 'Breakfast', tag: 'breakfast' },
    { name: 'Snack 1', tag: 'snack' },
    { name: 'Lunch', tag: 'lunch' },
    { name: 'Snack 2', tag: 'snack' },
    { name: 'Dinner', tag: 'dinner' },
  ],
};

const RAMADAN_DISTRIBUTION = {
  factors: [0.5, 0.2, 0.3],
  slots: [
    { name: 'Iftar', tag: 'iftar', profileTag: 'dinner' },
    { name: 'Snack', tag: 'snack', profileTag: 'snack' },
    { name: 'Suhoor', tag: 'suhoor', profileTag: 'breakfast' },
  ],
};

module.exports = {
  AMBIGUOUS_MEAL_SLOT_POLICY,
  MEAL_DISTRIBUTIONS,
  NUTRITION,
  RAMADAN_DISTRIBUTION,
  STANDARD_MEAL_SLOT_POLICY,
};
