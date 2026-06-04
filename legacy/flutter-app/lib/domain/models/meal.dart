import '../../core/utils/macro_math.dart';
import 'meal_item.dart';
import 'nutrition_targets.dart';

class Meal {
  const Meal({
    required this.name,
    required this.tag,
    required this.target,
    required this.items,
    required this.isApproximate,
  });

  final String name;
  final String tag;
  final NutritionTargets target;
  final List<MealItem> items;
  final bool isApproximate;

  NutritionTargets get totals => sumTargets(items.map((item) => item.totals));

  Meal copyWith({
    List<MealItem>? items,
    bool? isApproximate,
  }) {
    return Meal(
      name: name,
      tag: tag,
      target: target,
      items: items ?? this.items,
      isApproximate: isApproximate ?? this.isApproximate,
    );
  }
}
