import 'dart:math';

import '../../core/constants/nutrition_constants.dart';
import '../models/nutrition_targets.dart';
import '../models/user_input.dart';

class NutritionCalculator {
  NutritionTargets calculateDailyTargets(UserInput input) {
    final maintenance = _maintenanceCalories(input);
    final adjustment =
        NutritionConstants.goalAdjustments[input.goal.value] ?? 0;
    final targetCalories = max(1200.0, maintenance + adjustment);

    final proteinG = input.weightKg * NutritionConstants.proteinPerKg;
    final fatG = input.weightKg * NutritionConstants.fatPerKg;
    final proteinCalories = proteinG * NutritionConstants.proteinKcalPerGram;
    final fatCalories = fatG * NutritionConstants.fatKcalPerGram;
    final remainingCalories =
        max(0.0, targetCalories - proteinCalories - fatCalories);

    return NutritionTargets(
      calories: targetCalories,
      proteinG: proteinG,
      carbG: remainingCalories / NutritionConstants.carbKcalPerGram,
      fatG: fatG,
    );
  }

  double _maintenanceCalories(UserInput input) {
    final bodyFat = input.bodyFatPercentage;
    if (bodyFat != null && bodyFat > 0 && bodyFat < 70) {
      final leanBodyMass = input.weightKg * (1 - bodyFat / 100);
      final bmr = NutritionConstants.katchMcArdleBase +
          NutritionConstants.katchMcArdleLeanMassMultiplier * leanBodyMass;
      final multiplier =
          NutritionConstants.activityMultipliers[input.activityLevel.value] ??
              1.2;
      return bmr * multiplier;
    }

    final factor = NutritionConstants
            .bodyweightActivityFactors[input.activityLevel.value] ??
        30;
    return input.weightKg * factor;
  }
}
