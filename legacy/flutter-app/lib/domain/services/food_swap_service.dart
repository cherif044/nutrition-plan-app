import '../../core/constants/nutrition_constants.dart';
import '../../core/utils/number_rounding.dart';
import '../models/food.dart';
import '../models/meal.dart';
import '../models/meal_item.dart';

class FoodSwapService {
  List<Food> alternativesFor({
    required Food original,
    required List<Food> allowedFoods,
    required String mealTag,
    int limit = 2,
  }) {
    final sameRole = allowedFoods.where(
      (food) =>
          food.id != original.id &&
          food.macroRole == original.macroRole &&
          food.matchesMealTag(mealTag),
    );

    final fallback = allowedFoods.where(
      (food) => food.id != original.id && food.macroRole == original.macroRole,
    );

    final ranked = [...sameRole, ...fallback]..sort((a, b) {
        final aDistance = _macroDistance(original, a);
        final bDistance = _macroDistance(original, b);
        return aDistance.compareTo(bDistance);
      });

    final unique = <String, Food>{};
    for (final food in ranked) {
      unique.putIfAbsent(food.id, () => food);
    }
    return unique.values.take(limit).toList(growable: false);
  }

  Meal swapAndRebalance({
    required Meal meal,
    required int itemIndex,
    required Food replacement,
  }) {
    final items = [...meal.items];
    items[itemIndex] = items[itemIndex].copyWith(
      food: replacement,
      alternatives: const [],
    );

    for (var i = 0;
        i < NutritionConstants.maxPortionAdjustmentIterations;
        i++) {
      final currentMeal = meal.copyWith(items: items);
      final totals = currentMeal.totals;
      final proteinDiff = meal.target.proteinG - totals.proteinG;
      final fatDiff = meal.target.fatG - totals.fatG;
      final carbDiff = meal.target.carbG - totals.carbG;

      final proteinIndex = _firstIndexForRole(items, MacroRole.protein);
      final fatIndex = _firstIndexForRole(items, MacroRole.fat);
      final carbIndex = _firstIndexForRole(items, MacroRole.carb);

      if (proteinIndex != null && proteinDiff.abs() > 2) {
        items[proteinIndex] = _adjustMacro(
          items[proteinIndex],
          proteinDiff,
          items[proteinIndex].food.proteinGPer100g,
        );
        continue;
      }

      if (fatIndex != null && fatDiff.abs() > 2) {
        items[fatIndex] = _adjustMacro(
          items[fatIndex],
          fatDiff,
          items[fatIndex].food.fatGPer100g,
        );
        continue;
      }

      if (carbIndex != null && carbDiff.abs() > 2) {
        items[carbIndex] = _adjustMacro(
          items[carbIndex],
          carbDiff,
          items[carbIndex].food.carbGPer100g,
        );
      }
    }

    return meal.copyWith(items: items);
  }

  double _macroDistance(Food original, Food candidate) {
    return (original.caloriesPer100g - candidate.caloriesPer100g).abs() +
        (original.proteinGPer100g - candidate.proteinGPer100g).abs() * 4 +
        (original.carbGPer100g - candidate.carbGPer100g).abs() * 2 +
        (original.fatGPer100g - candidate.fatGPer100g).abs() * 4;
  }

  int? _firstIndexForRole(List<MealItem> items, MacroRole role) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].food.macroRole == role) {
        return i;
      }
    }
    return null;
  }

  MealItem _adjustMacro(MealItem item, double macroDiff, double per100g) {
    if (per100g <= 0) {
      return item;
    }
    final deltaG = macroDiff / (per100g / 100);
    final next = clampDouble(item.quantityG + deltaG, 20, 450);
    return item.copyWith(quantityG: roundToNearest(next, 5));
  }
}
