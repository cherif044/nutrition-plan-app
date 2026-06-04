import '../../domain/models/food.dart';
import '../../domain/models/nutrition_targets.dart';

NutritionTargets macrosForFoodPortion(Food food, double quantityG) {
  final multiplier = quantityG / 100;
  return NutritionTargets(
    calories: food.caloriesPer100g * multiplier,
    proteinG: food.proteinGPer100g * multiplier,
    carbG: food.carbGPer100g * multiplier,
    fatG: food.fatGPer100g * multiplier,
  );
}

NutritionTargets sumTargets(Iterable<NutritionTargets> values) {
  return values.fold(
    NutritionTargets.zero,
    (total, value) => total + value,
  );
}
