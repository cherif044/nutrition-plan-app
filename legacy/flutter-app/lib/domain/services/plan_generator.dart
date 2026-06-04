import 'dart:math';

import '../../core/constants/nutrition_constants.dart';
import '../../core/errors/app_exception.dart';
import '../../core/utils/number_rounding.dart';
import '../models/food.dart';
import '../models/generated_plan.dart';
import '../models/meal.dart';
import '../models/meal_item.dart';
import '../models/nutrition_targets.dart';
import '../models/user_input.dart';
import '../repositories/food_repository.dart';
import 'food_swap_service.dart';
import 'meal_splitter.dart';
import 'nutrition_calculator.dart';

class PlanGenerator {
  PlanGenerator({
    required FoodRepository foodRepository,
    required NutritionCalculator nutritionCalculator,
    required MealSplitter mealSplitter,
    required FoodSwapService foodSwapService,
  })  : _foodRepository = foodRepository,
        _nutritionCalculator = nutritionCalculator,
        _mealSplitter = mealSplitter,
        _foodSwapService = foodSwapService;

  final FoodRepository _foodRepository;
  final NutritionCalculator _nutritionCalculator;
  final MealSplitter _mealSplitter;
  final FoodSwapService _foodSwapService;

  Future<GeneratedPlan> generate(UserInput input) async {
    final dailyTargets = _nutritionCalculator.calculateDailyTargets(input);
    final mealTargets = _mealSplitter.split(
      dailyTargets: dailyTargets,
      input: input,
    );
    final foods = await _foodRepository.getAllFoods();
    final allowedFoods = _filterFoods(foods, input);

    if (allowedFoods.isEmpty) {
      throw const AppException(
        'No foods match the selected restrictions. Try removing one filter.',
      );
    }

    final meals = <Meal>[];
    for (var i = 0; i < mealTargets.length; i++) {
      meals.add(
        _generateMeal(
          target: mealTargets[i],
          allowedFoods: allowedFoods,
          mealIndex: i,
        ),
      );
    }

    return GeneratedPlan(
      input: input,
      dailyTargets: dailyTargets,
      meals: meals,
    );
  }

  List<Food> _filterFoods(List<Food> foods, UserInput input) {
    final allergies = input.allergies.map((item) => item.toLowerCase()).toSet();
    final dislikes = input.dislikes.map((item) => item.toLowerCase()).toSet();

    return foods.where((food) {
      if (input.dietType == DietType.vegan && !food.isVegan) {
        return false;
      }
      if (input.dietType == DietType.vegetarian && !food.isVegetarian) {
        return false;
      }
      if (food.allergens.any((allergen) => allergies.contains(allergen))) {
        return false;
      }

      final searchable = [
        food.id,
        food.name,
        food.nameAr,
        ...food.allergens,
      ].join(' ').toLowerCase();

      return !dislikes.any(searchable.contains);
    }).toList(growable: false);
  }

  Meal _generateMeal({
    required MealTarget target,
    required List<Food> allowedFoods,
    required int mealIndex,
  }) {
    Meal? bestMeal;
    double bestScore = double.infinity;

    for (var attempt = 0;
        attempt < NutritionConstants.maxMealAttempts;
        attempt++) {
      final items = _selectInitialItems(
        target: target,
        allowedFoods: allowedFoods,
        seed: mealIndex + attempt,
      );

      final adjusted = _adjustPortions(items, target.targets);
      final approximate = !_isWithinTolerance(adjusted, target.targets);
      final score = _mealScore(adjusted, target.targets);
      final withAlternatives = adjusted
          .map(
            (item) => item.copyWith(
              alternatives: _foodSwapService.alternativesFor(
                original: item.food,
                allowedFoods: allowedFoods,
                mealTag: target.tag,
              ),
            ),
          )
          .toList(growable: false);

      final meal = Meal(
        name: target.name,
        tag: target.tag,
        target: target.targets,
        items: withAlternatives,
        isApproximate: approximate,
      );

      if (!approximate) {
        return meal;
      }

      if (score < bestScore) {
        bestScore = score;
        bestMeal = meal;
      }
    }

    return bestMeal ??
        Meal(
          name: target.name,
          tag: target.tag,
          target: target.targets,
          items: const [],
          isApproximate: true,
        );
  }

  List<MealItem> _selectInitialItems({
    required MealTarget target,
    required List<Food> allowedFoods,
    required int seed,
  }) {
    final proteinFoods = _foodsForRole(
      allowedFoods,
      MacroRole.protein,
      target.tag,
    );
    final carbFoods = _foodsForRole(allowedFoods, MacroRole.carb, target.tag);
    final fatFoods = _foodsForRole(allowedFoods, MacroRole.fat, target.tag);
    final mixedFoods = _foodsForRole(
      allowedFoods,
      MacroRole.mixed,
      target.tag,
    );

    final items = <MealItem>[];

    final protein = _pick(proteinFoods, seed) ?? _pick(mixedFoods, seed);
    final carb = _pick(carbFoods, seed + 1) ?? _pick(mixedFoods, seed + 1);
    final fat = _pick(fatFoods, seed + 2);
    final mixed = target.tag == 'snack' ? null : _pick(mixedFoods, seed + 3);

    if (protein != null) {
      items.add(_defaultItem(protein));
    }
    if (carb != null && carb.id != protein?.id) {
      items.add(_defaultItem(carb));
    }
    if (fat != null && fat.id != protein?.id && fat.id != carb?.id) {
      items.add(_defaultItem(fat));
    }
    if (mixed != null &&
        items.every((item) => item.food.id != mixed.id) &&
        target.targets.calories > 450) {
      items.add(_defaultItem(mixed, scale: 0.55));
    }

    if (items.isEmpty) {
      final anyFood = _pick(allowedFoods, seed);
      if (anyFood != null) {
        items.add(_defaultItem(anyFood));
      }
    }

    return items;
  }

  List<Food> _foodsForRole(
    List<Food> foods,
    MacroRole role,
    String mealTag,
  ) {
    final tagged = foods
        .where((food) => food.macroRole == role && food.matchesMealTag(mealTag))
        .toList(growable: false);
    if (tagged.isNotEmpty) {
      return tagged;
    }
    return foods
        .where((food) => food.macroRole == role)
        .toList(growable: false);
  }

  Food? _pick(List<Food> foods, int seed) {
    if (foods.isEmpty) {
      return null;
    }
    return foods[seed.abs() % foods.length];
  }

  MealItem _defaultItem(Food food, {double scale = 1}) {
    return MealItem(
      food: food,
      quantityG: roundToNearest(food.defaultServingG * scale, 5),
    );
  }

  List<MealItem> _adjustPortions(
    List<MealItem> initialItems,
    NutritionTargets target,
  ) {
    var items = [...initialItems];

    for (var i = 0;
        i < NutritionConstants.maxPortionAdjustmentIterations;
        i++) {
      final totals = _totals(items);
      final proteinDiff = target.proteinG - totals.proteinG;
      final fatDiff = target.fatG - totals.fatG;
      final calorieDiff = target.calories - totals.calories;

      final proteinIndex = _firstIndexForRole(items, MacroRole.protein) ??
          _firstIndexForRole(items, MacroRole.mixed);
      final fatIndex = _firstIndexForRole(items, MacroRole.fat);
      final carbIndex = _firstIndexForRole(items, MacroRole.carb) ??
          _firstIndexForRole(items, MacroRole.mixed);

      if (proteinIndex != null &&
          proteinDiff.abs() > NutritionConstants.proteinToleranceG / 2) {
        items = _replaceAt(
          items,
          proteinIndex,
          _adjustByMacro(
            item: items[proteinIndex],
            macroDiff: proteinDiff,
            per100g: items[proteinIndex].food.proteinGPer100g,
          ),
        );
        continue;
      }

      if (fatIndex != null &&
          fatDiff.abs() > NutritionConstants.fatToleranceG / 2) {
        items = _replaceAt(
          items,
          fatIndex,
          _adjustByMacro(
            item: items[fatIndex],
            macroDiff: fatDiff,
            per100g: items[fatIndex].food.fatGPer100g,
          ),
        );
        continue;
      }

      if (carbIndex != null && calorieDiff.abs() > target.calories * 0.05) {
        items = _replaceAt(
          items,
          carbIndex,
          _adjustByCalories(
            item: items[carbIndex],
            calorieDiff: calorieDiff,
          ),
        );
        continue;
      }

      break;
    }

    return items
        .map((item) => item.copyWith(
              quantityG: roundToNearest(item.quantityG, 5),
            ))
        .toList(growable: false);
  }

  MealItem _adjustByMacro({
    required MealItem item,
    required double macroDiff,
    required double per100g,
  }) {
    if (per100g <= 0) {
      return item;
    }
    final deltaG = macroDiff / (per100g / 100);
    final next = clampDouble(item.quantityG + deltaG, 20, 500);
    return item.copyWith(quantityG: roundToNearest(next, 5));
  }

  MealItem _adjustByCalories({
    required MealItem item,
    required double calorieDiff,
  }) {
    if (item.food.caloriesPer100g <= 0) {
      return item;
    }
    final deltaG = calorieDiff / (item.food.caloriesPer100g / 100);
    final next = clampDouble(item.quantityG + deltaG, 20, 500);
    return item.copyWith(quantityG: roundToNearest(next, 5));
  }

  List<MealItem> _replaceAt(
    List<MealItem> items,
    int index,
    MealItem item,
  ) {
    final next = [...items];
    next[index] = item;
    return next;
  }

  int? _firstIndexForRole(List<MealItem> items, MacroRole role) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].food.macroRole == role) {
        return i;
      }
    }
    return null;
  }

  NutritionTargets _totals(List<MealItem> items) {
    return items.fold(
      NutritionTargets.zero,
      (total, item) => total + item.totals,
    );
  }

  bool _isWithinTolerance(List<MealItem> items, NutritionTargets target) {
    final totals = _totals(items);
    return (totals.calories - target.calories).abs() <=
            target.calories * NutritionConstants.calorieTolerancePercent &&
        (totals.proteinG - target.proteinG).abs() <=
            NutritionConstants.proteinToleranceG &&
        (totals.carbG - target.carbG).abs() <=
            NutritionConstants.carbToleranceG &&
        (totals.fatG - target.fatG).abs() <= NutritionConstants.fatToleranceG;
  }

  double _mealScore(List<MealItem> items, NutritionTargets target) {
    final totals = _totals(items);
    final calorieScore =
        (totals.calories - target.calories).abs() / max(1, target.calories);
    final proteinScore =
        (totals.proteinG - target.proteinG).abs() / max(1, target.proteinG);
    final carbScore =
        (totals.carbG - target.carbG).abs() / max(1, target.carbG);
    final fatScore = (totals.fatG - target.fatG).abs() / max(1, target.fatG);
    return calorieScore + proteinScore + carbScore + fatScore;
  }
}
