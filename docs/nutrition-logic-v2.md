# Nutrition Logic v2 Implementation

The application implements the calculation and meal-planning pipeline defined in
`nutrition_facts_1pdf.pdf`.

## Client and target calculation

- Goals: lose weight, maintain weight, and gain weight.
- BMR: Mifflin-St Jeor using weight, height, age, and sex.
- Activity multipliers:
  - sedentary: 1.2
  - light: 1.375
  - moderate: 1.55
  - physical job / very active lifestyle: 1.65
  - elite athlete / heavy daily training: 1.9
- Weight loss: internal default of 0.75% of body weight per week using
  7,700 kcal/kg. The backend accepts validated 0.5%-1.0% policy overrides.
- Weight-loss floor: the greater of 1.2 x BMR or 1,500 kcal for men / 1,200
  kcal for women.
- Weight gain: internal default of 250 kcal. The backend accepts validated
  200-300 kcal policy overrides.

## Daily macronutrients

- Protein: internal default 2.0 g/kg, validated range 1.8-2.2 g/kg.
- Fat: internal default 0.7 g/kg, validated range 0.66-1.0 g/kg.
- Carbohydrates: all remaining calories divided by 4.
- If calories are constrained, fat is reduced toward 0.66 g/kg before protein
  is reduced toward 1.8 g/kg. A target that cannot satisfy both minimums is
  rejected.

## Meal distributions

The exact balanced, breakfast-heavy, lunch-heavy, and dinner-heavy 2/3/4/5
meal percentage tables from the specification are stored in
`src/config/nutritionConstants.js`.

Slot policy:

- 3 meals: breakfast, lunch, dinner.
- 4 meals: breakfast, snack, lunch, dinner.
- 5 meals: breakfast, snack 1, lunch, snack 2, dinner.
- 2 meals:
  - balanced: first meal, main meal
  - breakfast-heavy: breakfast, dinner
  - lunch-heavy: breakfast, lunch
  - dinner-heavy: lunch, dinner

## Database-driven meal macros

`src/services/mealMacroProfileService.js` derives average protein, carbohydrate,
and fat calorie ratios from all 223 ready meals and their linked food nutrition
records. The meal-target allocator uses matrix balancing so that:

- each meal retains its exact calorie allocation;
- meal macro preferences remain informed by its database meal type;
- all meal targets sum exactly to the daily protein, carbohydrate, and fat
  targets; and
- every meal reserves a protein floor equal to 75% of its calorie-proportional
  daily protein allocation.

## Meal swaps

- A proposed meal may differ from its original meal target by at most 5% of
  total daily calories.
- The projected full day must also stay within +/-5% of daily calories.
- Projected daily protein must remain within 1.8-2.2 g/kg.
- Projected daily fat must remain within 0.66-1.0 g/kg.
- Projected carbohydrates cannot be negative.
- The backend requires daily context for interactive rebalance requests and
  revalidates the projected day before accepting a result.

## Verification

Run the full verification suite with:

```sh
npm test
```

The rule-specific combinatorial suite is:

```sh
npm run test:nutrition-v2
```
