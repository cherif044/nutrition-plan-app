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
    weeklyPercent: 0.75,
    kcalPerKg: 7700,
  },
  weightGain: {
    surplusCalories: 250,
  },
  calorieFloorBySex: {
    male: 1700,
    female: 1200,
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
      protein: { min: 0.16, max: 0.30 },
      fat: { min: 0.25, max: 0.54 },
    },
    lunch: {
      protein: { min: 0.24, max: 0.36 },
      fat: { min: 0.21, max: 0.49 },
    },
    dinner: {
      protein: { min: 0.24, max: 0.36 },
      fat: { min: 0.21, max: 0.49 },
    },
    snack: {
      protein: { min: 0.13, max: 0.30 },
      fat: { min: 0.22, max: 0.54 },
    },
  },
  mealSwapDailyCalorieWindowPercent: 0.05,
  dailyCalorieTolerancePercent: 0.05,
};

const MEAL_DISTRIBUTIONS = {
  balanced: {
    2: [0.40, 0.60],
    3: [0.25, 0.40, 0.35],
    4: [0.25, 0.15, 0.30, 0.30],
    5: [0.20, 0.15, 0.25, 0.15, 0.25],
  },
  breakfast_heavy: {
    2: [0.45, 0.55],
    3: [0.30, 0.373, 0.327],
    4: [0.30, 0.15, 0.275, 0.275],
    5: [0.25, 0.15, 0.225, 0.15, 0.225],
  },
  lunch_heavy: {
    2: [0.25, 0.75],
    3: [0.1875, 0.55, 0.2625],
    4: [0.182, 0.15, 0.45, 0.218],
    5: [0.15, 0.15, 0.35, 0.15, 0.20],
  },
  dinner_heavy: {
    2: [0.25, 0.75],
    3: [0.192, 0.308, 0.50],
    4: [0.182, 0.15, 0.218, 0.45],
    5: [0.15, 0.15, 0.20, 0.15, 0.35],
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

module.exports = {
  AMBIGUOUS_MEAL_SLOT_POLICY,
  MEAL_DISTRIBUTIONS,
  NUTRITION,
  STANDARD_MEAL_SLOT_POLICY,
};
