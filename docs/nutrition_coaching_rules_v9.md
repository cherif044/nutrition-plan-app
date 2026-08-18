# Nutrition Coaching Calculation Logic — Rules (v9)

## 1. Client & Goal

Every client has a single goal:

- Lose weight
- Maintain weight
- Gain weight

## 2. BMR Calculation — Mifflin-St Jeor Equation

Inputs: weight (kg), height (cm), age (years), sex.

**Men**
```
BMR = 10 × weight + 6.25 × height − 5 × age + 5
```

**Women**
```
BMR = 10 × weight + 6.25 × height − 5 × age − 161
```

## 3. Activity Level → TDEE (Maintenance Calories)

```
Maintenance calories = BMR × activity factor
```

| Activity level | Factor | Definition |
|---|---|---|
| Sedentary | 1.2 | Little to no gym or training |
| Light activity | 1.375 | 3–4 activity sessions per week |
| Moderate | 1.55 | 4–5 training sessions per week |
| Athlete | 1.9 | Physically demanding job/lifestyle |

## 4. Adjusting Maintenance for the Goal

**Maintain**
```
Target calories = Maintenance calories (no change)
```

**Lose Weight**
- Target weekly loss: 0.75% of body weight per week.
- 1 kg of body weight ≈ 7,700 kcal.
```
Weekly deficit (kcal) = (body weight × 0.75% ÷ 100) × 7,700
Daily deficit (kcal) = Weekly deficit ÷ 7
Daily target calories = Maintenance − Daily deficit
```

**Gain Weight**
```
Target calories = Maintenance + 250 kcal
```

**Sex-based calorie floor**

After the goal adjustment above, apply a minimum final calorie target:

| Sex | Minimum final target calories |
|---|---:|
| Male | 1700 kcal |
| Female | 1200 kcal |

```
Final target calories = max(goal-adjusted calories, sex calorie floor)
```

This floor is applied **before** daily macros and meal targets are calculated. If the floor raises calories, protein and fat still come from their body-weight gram rules in Section 5; carbohydrates absorb the extra calories.

## 5. Daily Macronutrient Distribution (the daily target)

Order of operations: protein first, fat second, carbohydrates fill the remaining calories.

| Macro | Range (g/kg body weight) | Recommended default | kcal per gram |
|---|---|---|---|
| Protein | 1.8 – 2.2 | 2.0 | 4 |
| Fat | 0.66 – 1.0 | 0.7 | 9 |
| Carbohydrate | Remaining calories ÷ 4 | — | 4 |

This produces a **daily gram range** for protein and for fat (e.g. 180g–220g protein for a 100kg client) — the fixed target every meal must ultimately add up to.

When Section 4's calorie floor is applied, use the floored final calories in the carbohydrate calculation. Do **not** raise protein or fat just because calories were floored; carbs remain the residual compensator.

## 6. Calorie Distribution Across Meals

Total daily calories are split across meals as a percentage. Four patterns: Balanced, Breakfast-heavy, Lunch-heavy, Dinner-heavy.

### 6.1 Balanced Distribution (reference)

| # of meals | Distribution |
|---|---|
| 2 meals | 40%(breakfast) / 60%(lunch/dinner) |
| 3 meals | 25%(breakfast) / 40%(lunch) / 35%(dinner) |
| 4 meals | 25%(breakfast) / 15% (snack) / 30%(lunch) / 30%(dinner) |
| 5 meals | 20%(breakfast) / 10% (snack) / 30%(lunch) / 10% (snack) / 30%(dinner) |

### 6.2 Breakfast-Heavy Distribution (+5pts to breakfast)

| # of meals | Distribution |
|---|---|
| 2 meals | 45% / 55% |
| 3 meals | 30% / 37.3% / 32.7% |
| 4 meals | 30% / 15% (snack) / 27.5% / 27.5% |
| 5 meals | 25% / 10% (snack) / 27.5% / 10% (snack) / 27.5% |

### 6.3 Lunch-Heavy Distribution (+15pts to lunch)

| # of meals | Distribution |
|---|---|
| 2 meals | 25% / 75% (2nd slot = lunch/main meal) |
| 3 meals | 18.75% / 55% / 26.25% |
| 4 meals | 18.2% / 15% (snack) / 45% / 21.8% |
| 5 meals | 14% / 10% (snack) / 45% / 10% (snack) / 21% |

### 6.4 Dinner-Heavy Distribution (+15pts to dinner)

| # of meals | Distribution |
|---|---|
| 2 meals | 25% / 75% |
| 3 meals | 19.2% / 30.8% / 50% |
| 4 meals | 18.2% / 15% (snack) / 21.8% / 45% |
| 5 meals | 14% / 10% (snack) / 21% / 10% (snack) / 45% |

**Generation rule:** the target meal's percentage is boosted from the balanced version (+5pts breakfast, +15pts lunch/dinner); the difference is pulled proportionally from the other non-snack meals; snack slots are left untouched.

**Assumed meal labels:**
- 2 meals → first meal / main meal
- 5 meals → breakfast, snack, lunch, snack, dinner

## 7. Per-Meal Macro Ratio Table — Database-Derived (fixed, client-independent)

Each meal type has its own naturally-occurring protein/fat ratio **range**, derived from the meal bundle database. The ranges below use rounded central database percentiles so they represent normal database meals without letting extreme outliers define the policy. This table is fixed — it does not change per client or per plan. It is deliberately a range, not a single point value: a range gives Section 8's scaling room to land the final per-meal window inside realistic, database-matching territory for a wider spread of clients, instead of forcing an exact ratio that can drift from what real meal bundles look like.

| Meal type | Protein % of meal calories | Fat % of meal calories |
|---|---|---|
| Breakfast | 16% – 30% | 25% – 54% |
| Lunch | 24% – 36% | 21% – 49% |
| Dinner | 24% – 36% | 21% – 49% |
| Snack | 13% – 30% | 22% – 54% |

**Carb note:** carbs are the flexible macro. They are not scaled or stored as an independent range. They absorb whatever calories remain after protein and fat. The implied daily carb swing across the two edge cases (all meals hitting protein/fat maxes vs. all hitting mins) is considered acceptable by design — both poles produce nutritionally valid days within the daily calorie range.

## 8. Building a Client's Meal Windows (per plan, per client)

This step converts the fixed Section 7 table into actual gram windows for one specific client's plan, and ensures those windows sum correctly to the daily target — done once, upfront, before any meal is selected.

**Why scaling is required (not optional):** the Section 7 ratios are computed against each meal's *own* calories (a fact about typical food composition). The Section 5 daily target is computed from the client's *body weight* (g/kg). These are two independently-derived numbers with no algebraic relationship — summing the raw Section 7 grams across all meals will not, in general, equal the Section 5 daily target. Scaling is the step that reconciles them while preserving each meal's proportional share.

**Step 1 — Compute each meal's calorie budget and window.**
Each meal receives a single target calorie number from Section 6, plus a ±5% window:
```
meal_calorie_target = daily_calorie_target × meal_percentage
meal_calorie_window = [meal_calorie_target × 0.95, meal_calorie_target × 1.05]
```
This window is stored per meal slot. Because every meal's deviation is capped at ±5% of its own target:
```
Σ meal calorie mins = daily_calorie_target × 0.95 = daily calorie min  ✓
Σ meal calorie maxes = daily_calorie_target × 1.05 = daily calorie max  ✓
```

**Step 2 — Raw gram windows for protein and fat.**
For each meal, using its calorie target from Step 1, convert Section 7's percentages into grams:
```
Protein window (g) = [meal_calorie_target × protein_pct_min, meal_calorie_target × protein_pct_max] ÷ 4
Fat window (g)     = [meal_calorie_target × fat_pct_min,     meal_calorie_target × fat_pct_max]     ÷ 9
```

**Step 3 — Sum the raw windows across all meals.**
```
Σ min = sum of every meal's raw protein minimum
Σ max = sum of every meal's raw protein maximum
```
(Same summation done separately for fat.)

**Step 4 — Compute scale factors against the daily target** (from Section 5):
```
min_scale = daily_min ÷ Σ min
max_scale = daily_max ÷ Σ max
```

**Step 5 — Apply the scale factors to every meal's window.**
```
scaled_meal_protein_min = raw_meal_protein_min × min_scale
scaled_meal_protein_max = raw_meal_protein_max × max_scale
```
Repeat Steps 2–5 independently for fat.

This guarantees, by construction:
```
Σ scaled protein mins = daily protein min  ✓
Σ scaled protein maxes = daily protein max  ✓
Σ scaled fat mins = daily fat min          ✓
Σ scaled fat maxes = daily fat max         ✓
```

**Carbs are not stored as a range.** They are computed as the remaining calories after protein and fat targets are assigned:
```
meal_carb_target = (meal_calories − meal_protein × 4 − meal_fat × 9) ÷ 4
```
This carb number is useful for display and nutrition totals, but it is not a hard selection constraint.

**Worked example** (100kg client, daily protein range 180g–220g, 4 meals, balanced distribution):

| Meal | Calorie target | Raw protein min/max (g) |
|---|---|---|
| Breakfast (25%) | 500 kcal | 20.0 – 30.0 |
| Snack (15%) | 300 kcal | 11.3 – 18.0 |
| Lunch (30%) | 600 kcal | 30.0 – 42.0 |
| Dinner (30%) | 600 kcal | 30.0 – 40.5 |
| **Sum** | **2000 kcal** | **91.3 – 130.5** |

```
min_scale = 180 ÷ 91.3 ≈ 1.97
max_scale = 220 ÷ 130.5 ≈ 1.69
```

| Meal | Scaled protein min/max (g) | Calorie window |
|---|---|---|
| Breakfast | 39.4 – 50.7 | [475, 525] |
| Snack | 22.3 – 30.4 | [285, 315] |
| Lunch | 59.1 – 71.0 | [570, 630] |
| Dinner | 59.1 – 68.5 | [570, 630] |
| **Sum** | **≈180 – ≈220** ✓ | **[1900, 2100]** ✓ |

Repeat Steps 2–5 for fat to produce scaled fat windows per meal.

**Interval guarantee:** because Σ(scaled protein mins) = daily protein min and Σ(scaled protein maxes) = daily protein max by construction, and because every meal's calorie window sums correctly, *any* combination of in-window picks — one per meal — automatically produces a day total inside all daily ranges. This holds regardless of which specific bundle is chosen per meal.

## 9. Meal Selection — Constraint Filtering

For each meal slot in the plan, a candidate bundle must satisfy the calorie, protein, and fat constraints. Carbs are reported and naturally affect calories through the food database, but carbs are not checked as an independent pass/fail constraint.

**Constraint A — Calorie window.**
```
candidate.calories BETWEEN meal_calorie_window.min AND meal_calorie_window.max
```
i.e. within ±5% of that meal's own Section 6 calorie target.

**Constraint B — Protein and fat windows.**
```
candidate.protein BETWEEN scaled_protein_min AND scaled_protein_max
candidate.fat     BETWEEN scaled_fat_min     AND scaled_fat_max
```
Using the scaled windows from Section 8 — never the raw Section 7 windows.

**Selection steps:**
1. Compute the meal's calorie window (Constraint A).
2. Use the meal's scaled protein and fat windows from Section 8 (Constraint B).
3. Filter the database to candidates satisfying both constraints simultaneously.
4. Among passing candidates, rank by closeness to target in this priority order:
   - First: closest to the meal's calorie target (midpoint of calorie window)
   - Second: closest to the meal's protein target (midpoint of scaled protein window)
   - Third: closest to the meal's fat target (midpoint of scaled fat window)
   Select the highest-ranked candidate for the initial plan.

No fallback: if zero bundles match a meal slot's windows, that slot has no valid option under the current constraints — it is not auto-relaxed or approximated.

## 10. Meal Swaps

Swapping a meal means re-running Section 9's steps 1–5 for that slot only, selecting a different bundle from the same filtered set.

Because each meal's window was fixed independently in Section 8 (and Σmin/Σmax already match the daily target), a swap:
- **Never affects any other meal's window** — each meal's window was set once, independently, at plan-generation time.
- **Never breaks the daily total** — by the interval guarantee in Section 8, any in-window pick for the swapped meal keeps the whole day's sum inside the daily range, automatically.
- **Never breaks Constraints A or B** — the swap candidate is drawn only from bundles that already satisfy both constraints (Section 9, Step 3's filtered set).

No re-reconciliation step is needed after a swap.

## 11. Full Worked Example — End to End

**Client:** 100kg male, 180cm, 30 years old, moderate activity, maintain weight, 3 meals, balanced distribution.

---

### Step 1 — BMR and TDEE (Sections 2–3)
```
BMR = 10 × 100 + 6.25 × 180 − 5 × 30 + 5 = 1000 + 1125 − 150 + 5 = 1980 kcal
TDEE = 1980 × 1.55 = 3069 kcal
```
Goal is maintain → target calories = 3069 kcal (rounded to 3000 for this example for cleaner numbers).

---

### Step 2 — Daily macro targets (Section 5)
```
Protein : 2.0 × 100 = 200g   range: [1.8 × 100, 2.2 × 100] = [180, 220]g
Fat     : 0.7 × 100 = 70g    range: [0.66 × 100, 1.0 × 100] = [66, 100]g
Carbs   : (3000 − 200×4 − 70×9) ÷ 4 = (3000 − 800 − 630) ÷ 4 = 1570 ÷ 4 = 392.5g (flexible)
```

---

### Step 3 — Meal calorie budgets and windows (Sections 6 + 8 Step 1)

Balanced 3-meal split: 25% breakfast / 40% lunch / 35% dinner.

| Meal | % | Calorie target | Calorie window (±5%) |
|---|---|---|---|
| Breakfast | 25% | 750 kcal | [712.5, 787.5] |
| Lunch | 40% | 1200 kcal | [1140, 1260] |
| Dinner | 35% | 1050 kcal | [997.5, 1102.5] |
| **Sum** | 100% | **3000 kcal** | **[2850, 3150]** ✓ |

---

### Step 4 — Raw protein windows from shape table (Section 8 Step 2)

| Meal | Protein % range | Raw protein window |
|---|---|---|
| Breakfast | 20%–30% of 750 kcal (20% floor applied) | [750×0.20÷4, 750×0.30÷4] = [37.5, 56.3]g |
| Lunch | 20%–33% of 1200 kcal (20% floor applied) | [1200×0.20÷4, 1200×0.33÷4] = [60.0, 99.0]g |
| Dinner | 20%–33% of 1050 kcal (20% floor applied) | [1050×0.20÷4, 1050×0.33÷4] = [52.5, 86.6]g |
| **Sum** | | **[150.0, 241.9]g** |

---

### Step 5 — Scale protein windows (Section 8 Steps 3–5)
```
min_scale = 180 ÷ 150.0 = 1.200
max_scale = 220 ÷ 241.9 = 0.910
```

| Meal | Scaled protein window |
|---|---|
| Breakfast | [37.5 × 1.200, 56.3 × 0.910] = [45.0, 51.2]g |
| Lunch | [60.0 × 1.200, 99.0 × 0.910] = [72.0, 90.0]g |
| Dinner | [52.5 × 1.200, 86.6 × 0.910] = [63.0, 78.8]g |
| **Sum** | **[180.0, 220.0] ≈ [180, 220]g** ✓ |

Repeat the same process for fat to produce scaled fat windows (omitted here for brevity).

---

### Step 7 — Stored values per meal slot

| Meal | Protein window | Fat window | Calorie window |
|---|---|---|---|
| Breakfast | [45.0, 51.2]g | [X, Y]g | [712.5, 787.5] kcal |
| Lunch | [72.0, 90.0]g | [X, Y]g | [1140, 1260] kcal |
| Dinner | [63.0, 78.8]g | [X, Y]g | [997.5, 1102.5] kcal |

No carb range stored.

---

### Step 8 — Filter a candidate breakfast (Section 9)

Candidate: protein=48g, fat=28g, carbs=?

**Constraint A:**
```
Candidate calories must land in [712.5, 787.5].
```

**Constraint B:**
```
Protein: 48g BETWEEN 45.0 AND 51.2 ✓
Fat: 28g BETWEEN X AND Y ✓ (assume yes)
```

If candidate has carbs=80g:
Actual calories = 48×4 + 28×9 + 80×4 = 192 + 252 + 320 = 764 kcal ✓ (inside [712.5, 787.5])
The candidate passes because calories, protein, and fat are inside their windows. Carbs are displayed, but no separate carb range is checked.

---

### Step 9 — Ranking among valid candidates (Section 9 Step 5)

Protein target = midpoint of [45.0, 51.2] = 48.1g
Calorie target = 750 kcal

Among all passing candidates, rank by:
1. |candidate.calories − 750|  (closest first)
2. |candidate.protein − 48.1|
3. |candidate.fat − fat_target|

Pick the top-ranked candidate for the initial plan.

---

### The guarantee

Every breakfast in range → hits [712.5, 787.5] kcal and [45.0, 51.2]g protein
Every lunch in range   → hits [1140, 1260] kcal and [72.0, 90.0]g protein
Every dinner in range  → hits [997.5, 1102.5] kcal and [63.0, 78.8]g protein

```
Day calories : 712.5+1140+997.5 to 787.5+1260+1102.5 = [2850, 3150] = 3000 ±5% ✓
Day protein  : 45.0+72.0+63.0 to 51.2+90.0+78.8 = [180, 220]g ✓
Day fat      : guaranteed by same construction ✓
```

No final check needed. Guaranteed by construction.

## 12. Implementation & Verification Prompt (for an AI coding agent)

Use the block below as-is when handing this document to an AI agent to implement the system, or to verify/audit an existing implementation against it.

```
You are implementing (or auditing) a nutrition-coaching meal-planning engine against
the rules in this document (Sections 1–11). Do the following:

1. IMPLEMENT OR LOCATE the following pipeline stages, matching the document exactly:
   a. BMR (Section 2) and TDEE (Section 3) calculation.
   b. Goal-based calorie target adjustment plus sex-based calorie floor (Section 4).
   c. Daily macro gram RANGE calculation from g/kg bounds (Section 5).
   d. Meal-calorie distribution by pattern + meal count (Section 6).
      Each meal receives a calorie TARGET (single number) and a calorie WINDOW
      (target ±5%). Both are stored per meal slot.
   e. Section 7's fixed, client-independent per-meal-type macro % RANGE table.
   f. Section 8's scaling pipeline:
      Step 1: meal calorie target and ±5% window per meal.
      Step 2: raw gram windows from Section 7 percentages × meal calorie target.
      Step 3: Σ min and Σ max across all meals.
      Step 4: min_scale = daily_min ÷ Σ min, max_scale = daily_max ÷ Σ max.
              Confirm min_scale and max_scale are computed and applied SEPARATELY.
      Step 5: scaled per-meal windows applied.
      NO carb range is stored. Carbs are computed as the remaining calories
      after protein and fat.
   g. Section 9's TWO hard constraints applied together (not either/or):
        - Constraint A: candidate.calories within meal's ±5% calorie window.
        - Constraint B: candidate.protein within scaled protein window,
                        candidate.fat within scaled fat window.
      After filtering, rank passing candidates by: (1) calorie closeness to target,
      (2) protein closeness to midpoint, (3) fat closeness to midpoint.
   h. Section 10's swap logic: re-filter only the swapped slot using both
      constraints; no re-scaling of other meals; no re-check of the daily total
      (it is guaranteed structurally).

2. If any stage is missing, implement it. If a stage already exists, verify it
   matches the document's formulas and ordering exactly — do not "fix" it to a
   different but seemingly-equivalent formula without flagging the discrepancy.

3. WRITE AND RUN EDGE-CASE TESTS for each feature below. For each test, assert
   the documented invariant holds, and report pass/fail explicitly — do not
   silently skip a failing case.

   Section 5 (daily target range):
   - Min g/kg and max g/kg produce a valid, non-inverted range (min < max) for
     a range of body weights (e.g. 40kg, 100kg, 180kg).

   Section 6 (calorie distribution):
   - All meal percentages for every pattern × meal-count combination sum to 100%.
   - Breakfast-heavy/Lunch-heavy/Dinner-heavy boosts apply only to the intended
     meal and pull proportionally from non-snack meals only (snack unchanged).
   - Σ meal calorie window mins = daily calorie min for all patterns.
   - Σ meal calorie window maxes = daily calorie max for all patterns.

   Section 7 (ratio table):
   - Every meal type's protein/fat % ranges are internally non-inverted
     (min < max).
   - Confirm the table is NOT re-derived or altered per client/plan (client
     independence).

   Section 8 (scaling):
   - For at least 3 different clients (varying weight, calories, meal count,
     and distribution pattern), confirm:
       Σ(scaled_meal_protein_min) == daily_protein_min (within rounding tolerance)
       Σ(scaled_meal_protein_max) == daily_protein_max (within rounding tolerance)
       Same for fat.
   - Confirm min_scale != max_scale whenever daily_min != daily_max, and that
     each is applied to the correct side.
   - Confirm no carb range is stored per meal slot anywhere in the output of
     Section 8.

   Section 9 (constraint filtering):
   - Construct a bundle satisfying calories and fat but protein outside B → confirm REJECTED.
   - Construct a bundle satisfying protein and fat but calories outside A → confirm REJECTED.
   - Construct a bundle satisfying calories, protein, and fat → confirm ACCEPTED,
     regardless of whether carbs differ from the displayed residual carb target.
   - Construct a full day where every meal lands at the edge of its own ±5%
     window in the same direction (all at +5%) → confirm daily total = daily
     calorie max (falls out structurally, not a separate check).
   - Edge case: a meal slot where the filtered set is empty → confirm the system
     surfaces "no valid option" and does NOT auto-relax constraints or silently
     substitute an out-of-window bundle.
   - Edge case: values exactly on a window boundary → confirm inclusive behavior
     is applied consistently (boundary values are accepted).
   - Ranking: given multiple passing candidates, confirm the one closest to the
     calorie target is ranked first; ties broken by protein closeness; further
     ties broken by fat closeness.

   Section 10 (swaps):
   - Swap one meal slot; confirm no other slot's stored window changed.
   - Swap one meal slot multiple times in a row; confirm the daily total stays
     within [daily_min, daily_max] after every swap.
   - Confirm a swap candidate is always drawn from Section 9's filtered set (i.e.
     a swap can never introduce a bundle violating Constraint A, B, or C).

4. Report results as a checklist: for each lettered pipeline stage (1a–1h) and
   each test above, state IMPLEMENTED/VERIFIED or MISSING/FAILING, with the
   specific values or reproduction steps for any failure.
```
