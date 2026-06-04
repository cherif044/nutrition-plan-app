import '../../core/utils/macro_math.dart';
import 'food.dart';
import 'nutrition_targets.dart';

class MealItem {
  const MealItem({
    required this.food,
    required this.quantityG,
    this.alternatives = const [],
  });

  final Food food;
  final double quantityG;
  final List<Food> alternatives;

  NutritionTargets get totals => macrosForFoodPortion(food, quantityG);

  MealItem copyWith({
    Food? food,
    double? quantityG,
    List<Food>? alternatives,
  }) {
    return MealItem(
      food: food ?? this.food,
      quantityG: quantityG ?? this.quantityG,
      alternatives: alternatives ?? this.alternatives,
    );
  }
}
