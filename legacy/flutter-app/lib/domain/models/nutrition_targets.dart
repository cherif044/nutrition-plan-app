class NutritionTargets {
  const NutritionTargets({
    required this.calories,
    required this.proteinG,
    required this.carbG,
    required this.fatG,
  });

  static const zero = NutritionTargets(
    calories: 0,
    proteinG: 0,
    carbG: 0,
    fatG: 0,
  );

  final double calories;
  final double proteinG;
  final double carbG;
  final double fatG;

  NutritionTargets scale(double factor) {
    return NutritionTargets(
      calories: calories * factor,
      proteinG: proteinG * factor,
      carbG: carbG * factor,
      fatG: fatG * factor,
    );
  }

  NutritionTargets copyWith({
    double? calories,
    double? proteinG,
    double? carbG,
    double? fatG,
  }) {
    return NutritionTargets(
      calories: calories ?? this.calories,
      proteinG: proteinG ?? this.proteinG,
      carbG: carbG ?? this.carbG,
      fatG: fatG ?? this.fatG,
    );
  }

  NutritionTargets operator +(NutritionTargets other) {
    return NutritionTargets(
      calories: calories + other.calories,
      proteinG: proteinG + other.proteinG,
      carbG: carbG + other.carbG,
      fatG: fatG + other.fatG,
    );
  }
}

class MealTarget {
  const MealTarget({
    required this.name,
    required this.tag,
    required this.targets,
  });

  final String name;
  final String tag;
  final NutritionTargets targets;
}
