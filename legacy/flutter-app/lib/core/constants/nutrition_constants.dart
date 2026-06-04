class NutritionConstants {
  const NutritionConstants._();

  static const double proteinKcalPerGram = 4;
  static const double carbKcalPerGram = 4;
  static const double fatKcalPerGram = 9;

  static const double proteinPerKg = 2.0;
  static const double fatPerKg = 0.6;

  static const double katchMcArdleBase = 370;
  static const double katchMcArdleLeanMassMultiplier = 21.6;

  // Planning convention: about 7700 kcal is equivalent to 1 kg body fat.
  static const double caloriesPerKgBodyFat = 7700;

  static const Map<String, double> activityMultipliers = {
    'sedentary': 1.2,
    'light': 1.375,
    'moderate': 1.55,
    'very_active': 1.725,
    'athlete': 1.9,
  };

  static const Map<String, double> bodyweightActivityFactors = {
    'sedentary': 26,
    'light': 30,
    'moderate': 34,
    'very_active': 38,
    'athlete': 42,
  };

  static const Map<String, double> goalAdjustments = {
    'maintain': 0,
    'lose_weight': -500,
    'lose_weight_aggressive': -1000,
    'gain_weight': 300,
  };

  static const double calorieTolerancePercent = 0.15;
  static const double proteinToleranceG = 10;
  static const double carbToleranceG = 15;
  static const double fatToleranceG = 10;

  static const int maxPortionAdjustmentIterations = 20;
  static const int maxMealAttempts = 8;
}
