import 'meal.dart';
import 'nutrition_targets.dart';
import 'user_input.dart';

class GeneratedPlan {
  const GeneratedPlan({
    required this.input,
    required this.dailyTargets,
    required this.meals,
  });

  final UserInput input;
  final NutritionTargets dailyTargets;
  final List<Meal> meals;
}
