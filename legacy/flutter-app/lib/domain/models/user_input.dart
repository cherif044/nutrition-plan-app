enum ActivityLevel {
  sedentary('sedentary', 'Sedentary'),
  light('light', 'Light'),
  moderate('moderate', 'Moderate'),
  veryActive('very_active', 'Very active'),
  athlete('athlete', 'Athlete');

  const ActivityLevel(this.value, this.label);

  final String value;
  final String label;
}

enum Goal {
  maintain('maintain', 'Maintain'),
  loseWeight('lose_weight', 'Lose weight'),
  loseWeightAggressive('lose_weight_aggressive', 'Aggressive loss'),
  gainWeight('gain_weight', 'Gain weight');

  const Goal(this.value, this.label);

  final String value;
  final String label;
}

enum DietType {
  standard('standard', 'Standard'),
  vegetarian('vegetarian', 'Vegetarian'),
  vegan('vegan', 'Vegan');

  const DietType(this.value, this.label);

  final String value;
  final String label;
}

class UserInput {
  const UserInput({
    required this.weightKg,
    required this.heightCm,
    required this.activityLevel,
    required this.goal,
    required this.numberOfMeals,
    required this.numberOfSnacks,
    required this.dietType,
    required this.allergies,
    required this.dislikes,
    required this.milkType,
    required this.coffeesPerDay,
    this.bodyFatPercentage,
    this.ramadanMode = false,
  });

  final double weightKg;
  final double heightCm;
  final double? bodyFatPercentage;
  final ActivityLevel activityLevel;
  final Goal goal;
  final int numberOfMeals;
  final int numberOfSnacks;
  final DietType dietType;
  final List<String> allergies;
  final List<String> dislikes;
  final String milkType;
  final int coffeesPerDay;
  final bool ramadanMode;
}
