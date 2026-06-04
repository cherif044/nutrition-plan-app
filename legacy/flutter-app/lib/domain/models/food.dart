import '../../core/errors/app_exception.dart';

enum MacroRole {
  protein('protein'),
  carb('carb'),
  fat('fat'),
  mixed('mixed');

  const MacroRole(this.value);

  final String value;

  static MacroRole fromJson(String value) {
    return MacroRole.values.firstWhere(
      (role) => role.value == value,
      orElse: () => throw AppException('Unknown macro role: $value'),
    );
  }
}

class Food {
  const Food({
    required this.id,
    required this.name,
    required this.nameAr,
    required this.macroRole,
    required this.caloriesPer100g,
    required this.proteinGPer100g,
    required this.carbGPer100g,
    required this.fatGPer100g,
    required this.isVegan,
    required this.isVegetarian,
    required this.allergens,
    required this.mealTags,
    required this.defaultServingG,
  });

  final String id;
  final String name;
  final String nameAr;
  final MacroRole macroRole;
  final double caloriesPer100g;
  final double proteinGPer100g;
  final double carbGPer100g;
  final double fatGPer100g;
  final bool isVegan;
  final bool isVegetarian;
  final List<String> allergens;
  final List<String> mealTags;
  final double defaultServingG;

  factory Food.fromJson(Map<String, dynamic> json) {
    final requiredFields = [
      'id',
      'name',
      'macro_role',
      'calories_per_100g',
      'protein_g_per_100g',
      'carb_g_per_100g',
      'fat_g_per_100g',
      'is_vegan',
      'is_vegetarian',
      'allergens',
      'meal_tags',
      'default_serving_g',
    ];

    for (final field in requiredFields) {
      if (!json.containsKey(field) || json[field] == null) {
        throw AppException('Food item is missing required field: $field');
      }
    }

    return Food(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: (json['name_ar'] as String?) ?? '',
      macroRole: MacroRole.fromJson(json['macro_role'] as String),
      caloriesPer100g: (json['calories_per_100g'] as num).toDouble(),
      proteinGPer100g: (json['protein_g_per_100g'] as num).toDouble(),
      carbGPer100g: (json['carb_g_per_100g'] as num).toDouble(),
      fatGPer100g: (json['fat_g_per_100g'] as num).toDouble(),
      isVegan: json['is_vegan'] as bool,
      isVegetarian: json['is_vegetarian'] as bool,
      allergens: List<String>.from(json['allergens'] as List),
      mealTags: List<String>.from(json['meal_tags'] as List),
      defaultServingG: (json['default_serving_g'] as num).toDouble(),
    );
  }

  bool matchesMealTag(String tag) {
    return mealTags.contains(tag);
  }
}
