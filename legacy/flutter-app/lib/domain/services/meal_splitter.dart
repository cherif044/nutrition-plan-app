import '../../core/constants/meal_split_config.dart';
import '../models/nutrition_targets.dart';
import '../models/user_input.dart';

class MealSplitter {
  List<MealTarget> split({
    required NutritionTargets dailyTargets,
    required UserInput input,
  }) {
    if (input.ramadanMode) {
      return List.generate(MealSplitConfig.ramadanSplits.length, (index) {
        final factor = MealSplitConfig.ramadanSplits[index];
        return MealTarget(
          name: MealSplitConfig.ramadanNames[index],
          tag: MealSplitConfig.ramadanTags[index],
          targets: dailyTargets.scale(factor),
        );
      });
    }

    final snackTotalFactor =
        MealSplitConfig.snackTotalSplits[input.numberOfSnacks] ?? 0;
    final mealFactors = MealSplitConfig.mealSplits[input.numberOfMeals] ??
        MealSplitConfig.mealSplits[3]!;
    final mealTotalFactor = 1 - snackTotalFactor;
    final snackFactor = input.numberOfSnacks == 0
        ? 0.0
        : snackTotalFactor / input.numberOfSnacks;

    final targets = <MealTarget>[];
    for (var i = 0; i < mealFactors.length; i++) {
      final factor = mealFactors[i] * mealTotalFactor;
      targets.add(
        MealTarget(
          name: _mealNameFor(i, mealFactors.length),
          tag: _mealTagFor(i, mealFactors.length),
          targets: dailyTargets.scale(factor),
        ),
      );
    }

    for (var i = 0; i < input.numberOfSnacks; i++) {
      targets.add(
        MealTarget(
          name: input.numberOfSnacks == 1 ? 'Snack' : 'Snack ${i + 1}',
          tag: 'snack',
          targets: dailyTargets.scale(snackFactor),
        ),
      );
    }

    return targets;
  }

  String _mealNameFor(int index, int total) {
    if (total == 2) {
      return index == 0 ? 'Meal 1' : 'Meal 2';
    }
    if (index == 0) {
      return 'Breakfast';
    }
    if (index == total - 1) {
      return 'Dinner';
    }
    return total > 3 ? 'Meal ${index + 1}' : 'Lunch';
  }

  String _mealTagFor(int index, int total) {
    if (total == 2) {
      return index == 0 ? 'lunch' : 'dinner';
    }
    if (index == 0) {
      return 'breakfast';
    }
    if (index == total - 1) {
      return 'dinner';
    }
    return 'lunch';
  }
}
