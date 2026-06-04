# Nutrition Plan App Architecture

This project is a Flutter mobile MVP for generating nutrition plans entirely on-device. It uses a bundled JSON food dataset today, while keeping the app structured so the data source can later move to SQLite, Supabase, or a backend API without rewriting the UI or nutrition engine.

## Folder Structure

```text
lib/
  main.dart
  app.dart
  core/
    constants/
      app_theme.dart
      meal_split_config.dart
      nutrition_constants.dart
    errors/
      app_exception.dart
    utils/
      macro_math.dart
      number_rounding.dart
  data/
    datasources/
      local_food_data_source.dart
    repositories/
      food_repository_impl.dart
  domain/
    models/
      food.dart
      generated_plan.dart
      meal.dart
      meal_item.dart
      nutrition_targets.dart
      user_input.dart
    repositories/
      food_repository.dart
    services/
      food_swap_service.dart
      meal_splitter.dart
      nutrition_calculator.dart
      plan_generator.dart
  presentation/
    screens/
      home_screen.dart
    widgets/
      food_item_tile.dart
      generate_button.dart
      glass_card.dart
      goal_selector.dart
      input_section.dart
      macro_summary_card.dart
      meal_card.dart
      preferences_section.dart
assets/
  data/
    foods.json
```

## Responsibilities

`main.dart` starts Flutter and launches the app.

`app.dart` defines the root `MaterialApp`, theme, and first screen.

`core/constants` keeps formulas, calorie factors, macro rules, meal split defaults, and app theme values out of UI widgets.

`core/utils` contains small reusable helpers for rounding portions and calculating macros for food quantities.

`core/errors` provides a shared app exception type for readable failures.

`data/datasources/local_food_data_source.dart` loads `assets/data/foods.json` using Flutter assets, parses it into `Food` models, validates required fields, and caches the parsed list in memory.

`data/repositories/food_repository_impl.dart` adapts the local data source to the domain repository contract.

`domain/models` contains structured app data such as foods, user input, nutrition targets, meal items, meals, and generated plans.

`domain/repositories/food_repository.dart` is the abstraction the rest of the app depends on. The UI and generator never read JSON directly.

`domain/services/nutrition_calculator.dart` calculates maintenance calories, goal-adjusted calories, and daily macros.

`domain/services/meal_splitter.dart` converts daily targets into meal and snack targets using configurable split rules, including Ramadan mode.

`domain/services/plan_generator.dart` orchestrates the full generation flow: food filtering, meal item selection, portion adjustment, tolerance checking, and alternative assignment.

`domain/services/food_swap_service.dart` finds similar alternatives and contains swap rebalance logic for a later interactive swap UI.

`presentation/screens/home_screen.dart` owns the one-page Flutter experience. It collects input, calls `PlanGenerator`, and renders the result.

`presentation/widgets` contains reusable UI pieces for the glass panels, inputs, summary, meal cards, and food rows.

## Data Flow

```text
HomeScreen
  -> PlanGenerator
    -> NutritionCalculator
    -> MealSplitter
    -> FoodRepository
      -> FoodRepositoryImpl
        -> LocalFoodDataSource
          -> assets/data/foods.json
    -> FoodSwapService
  -> GeneratedPlan
  -> MacroSummaryCard / MealCard / FoodItemTile
```

The screen builds a `UserInput` object from the form. `PlanGenerator` calculates daily targets, splits them across meals and snacks, loads allowed foods through `FoodRepository`, filters the foods, creates meals, adjusts gram quantities, and returns a `GeneratedPlan`.

## Loading `foods.json`

`assets/data/foods.json` is declared in `pubspec.yaml`. `LocalFoodDataSource` reads it with `rootBundle.loadString`, decodes the JSON array, validates each item through `Food.fromJson`, and stores the resulting `List<Food>` in `_cache`. Later calls return the cached list and avoid repeated asset reads or JSON parsing.

## Food Repository Abstraction

The domain layer depends only on:

```dart
abstract class FoodRepository {
  Future<List<Food>> getAllFoods();
}
```

Today, `FoodRepositoryImpl` delegates to `LocalFoodDataSource`. A future implementation could read from SQLite, Supabase, or a REST API while preserving the same `getAllFoods` contract. The UI and plan generation service would not need to change.

## Nutrition Calculator

`NutritionCalculator` uses Katch-McArdle when body fat percentage is available:

```text
lean_body_mass = weight_kg * (1 - body_fat_percentage / 100)
BMR = 370 + (21.6 * lean_body_mass)
maintenance = BMR * activity_multiplier
```

If body fat percentage is missing, it falls back to:

```text
maintenance = weight_kg * activity_factor
```

It then applies the selected goal adjustment and calculates macros with:

```text
protein_g = weight_kg * 2.0
fat_g = weight_kg * 0.6
carbs_g = remaining_calories / 4
```

The formula values live in `nutrition_constants.dart`.

## Plan Generator

`PlanGenerator` performs the MVP algorithm:

1. Calculate daily calorie and macro targets.
2. Split daily targets into meal and snack targets.
3. Load foods through `FoodRepository`.
4. Filter foods by allergies, dislikes, vegan, and vegetarian settings.
5. Pick protein, carb, fat, and optional mixed foods for each meal.
6. Start from each food's `default_serving_g`.
7. Adjust portions toward calorie and macro targets with a maximum iteration count.
8. Check calorie, protein, carb, and fat tolerances.
9. Retry with different food combinations when needed.
10. Return the closest reasonable result and mark it approximate if tolerances are not met.
11. Add up to two alternatives per item through `FoodSwapService`.

## UI Consumption

`HomeScreen` stores only UI state and form controllers. It builds `UserInput`, calls `PlanGenerator.generate`, and stores the resulting `GeneratedPlan`.

`MacroSummaryCard` displays daily calories, protein, carbs, and fat.

`MealCard` displays each meal's target calories, actual calories/macros, approximation status, and food rows.

`FoodItemTile` displays quantity in grams, item macros, and same-quantity alternatives.

Business rules stay in domain services rather than widgets.

## Future Migration

To move from JSON to another data source:

1. Create a new data source, such as `SqliteFoodDataSource` or `RemoteFoodDataSource`.
2. Create or update a repository implementation that still implements `FoodRepository`.
3. Keep returning `Future<List<Food>>`.
4. Swap the dependency in app composition.

The `Food` model, `PlanGenerator`, `NutritionCalculator`, `MealSplitter`, and UI can remain intact. For larger datasets or remote updates, repository methods can later add pagination, search, or syncing while preserving the current MVP behavior for generation.
