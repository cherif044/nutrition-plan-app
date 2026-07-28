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
  - athlete / physically demanding job or lifestyle: 1.9
- Weight loss: internal default of 0.75% of body weight per week using
  7,700 kcal/kg. The backend accepts validated 0.5%-1.0% policy overrides.
- Weight gain: internal default of 250 kcal. The backend accepts validated
  200-300 kcal policy overrides.

## Daily macronutrients

- Protein: internal default 2.0 g/kg, validated range 1.8-2.2 g/kg.
- Fat: internal default 0.7 g/kg, validated range 0.66-1.0 g/kg.
- Carbohydrates: all remaining calories divided by 4.
- The calculation is applied literally in that order. It does not add an
  undocumented carbohydrate floor or trim the selected protein/fat factors.

## Meal distributions

The exact balanced, breakfast-heavy, lunch-heavy, and dinner-heavy 2/3/4/5
meal percentage tables from the specification are stored in
`src/config/nutritionConstants.js`.

The document does not resolve the identity of every non-snack slot in the
2-meal and 5-meal tables. The app therefore leaves those slots generic instead
of adopting the labels suggested later in a verdict:

- 3 meals: breakfast, lunch, dinner.
- 4 meals: breakfast, snack, lunch, dinner.
- 2 meals: generic Meal 1 / Meal 2, except the explicitly targeted heavy slot
  is named breakfast, lunch, or dinner.
- 5 meals: generic main-meal slots with snack slots in positions 2 and 4;
  the explicitly targeted heavy slot is named breakfast, lunch, or dinner.

## Database-driven meal macros

`src/services/mealMacroProfileService.js` derives average protein, carbohydrate,
and fat calorie ratios from all 223 ready meals and their linked food nutrition
records. The meal-target allocator uses matrix balancing so that:

- each meal retains its exact calorie allocation;
- meal macro preferences remain informed by its database meal type;
- all meal targets sum exactly to the daily protein, carbohydrate, and fat
  targets.

No protein floor is overlaid because that appears only in the document's
verdict/improvement commentary, not in the Section 7 rules.

## Meal swaps

- A proposed meal may differ from its original meal target by at most 5% of
  total daily calories.
- Each proposed individual meal must contain protein within 1.8-2.2 g/kg of
  body weight and fat within 0.66-1.0 g/kg of body weight.
- The rule does not define a carbohydrate g/kg range, so the swap validator
  does not invent one.
- The backend requires daily context for interactive rebalance requests and
  validates the individual meal before accepting a result.

This is the literal Section 8 behavior. The alternative of checking the
projected full day appears only in the verdict and is intentionally not used.

## Verification

Run the full verification suite with:

```sh
npm test
```

The rule-specific combinatorial suite is:

```sh
npm run test:nutrition-v2
```
