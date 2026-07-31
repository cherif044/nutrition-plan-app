# Nutrition Coaching Calculation Logic — Rules (v8)

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
- Target weekly loss: 0.5%–1% of body weight per week.
- 1 kg of body weight ≈ 7,700 kcal.
```
Weekly deficit (kcal) = (body weight × chosen % ÷ 100) × 7,700
Daily deficit (kcal) = Weekly deficit ÷ 7
Daily target calories = Maintenance − Daily deficit
```

**Gain Weight**
```
Target calories = Maintenance + 200 to 300 kcal (fixed surplus, not weight-scaled)
```

## 5. Daily Macronutrient Distribution (the daily target)

Order of operations: protein first, fat second, carbohydrates fill the remaining calories.

| Macro | Range (g/kg body weight) | Recommended default | kcal per gram |
|---|---|---|---|
| Protein | 1.8 – 2.2 | 2.0 | 4 |
| Fat | 0.66 – 1.0 | 0.7 | 9 |
| Carbohydrate | Remaining calories ÷ 4 | — | 4 |

This produces a **daily gram range** for protein and for fat (e.g. 180g–220g protein for a 100kg client) — the fixed target every meal must ultimately add up to.

## 6. Calorie Distribution Across Meals

Total daily calories are split across meals as a percentage. Four patterns: Balanced, Breakfast-heavy, Lunch-heavy, Dinner-heavy.

### 6.1 Balanced Distribution (reference)

| # of meals | Distribution |
|---|---|
| 2 meals | 40%(breakfast) / 60%(lunch/dinner) |
| 3 meals | 25%(breakfast) / 40%(lunhc) / 35%(dinner) |
| 4 meals | 25%(breakfast) / 15% (snack) / 30%(lunhc) / 30%(dinner) |
| 5 meals | 20%(breakfast) / 10% (snack) / 30%(lunhc) / 10% (snack) / 30%(dinner) |

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

Each meal type has its own naturally-occurring protein/fat/carb ratio **range**, derived from the meal bundle database. This table is fixed — it does not change per client or per plan. It is deliberately a range, not a single point value: a range gives Section 8's scaling room to land the final per-meal window inside realistic, database-matching territory for a wider spread of clients, instead of forcing an exact ratio that can drift from what real meal bundles look like.

| Meal type | Protein % of meal calories | Fat % of meal calories | Carb % of meal calories |
|---|---|---|---|
| Breakfast | 16% – 24% | 33% – 52% | 28% – 51% |
| Lunch | 20% – 28% | 29% – 41% | 34% – 46% |
| Dinner | 20% – 27% | 27% – 40% | 35% – 45% |
| Snack | 15% – 24% | 39% – 63% | 20% – 34% |

**Protein floor rule:** regardless of the natural range above, no meal's protein % may fall below a set minimum floor (e.g. 20%). Where a meal type's lower bound is below the floor (breakfast, snack), the floor overrides it.

## 8. Building a Client's Meal Windows (per plan, per client)

This step converts the fixed Section 7 table into actual gram windows for one specific client's plan, and ensures those windows sum correctly to the daily target — done once, upfront, before any meal is selected.

**Why scaling is required (not optional):** the Section 7 ratios are computed against each meal's *own* calories (a fact about typical food composition). The Section 5 daily target is computed from the client's *body weight* (g/kg). These are two independently-derived numbers with no algebraic relationship — summing the raw Section 7 grams across all meals will not, in general, equal the Section 5 daily target. Scaling is the step that reconciles them while preserving each meal's proportional share.

**Step 1 — raw gram windows.** For each meal, using its Section 6 calorie allocation, convert Section 7's percentages into grams:
```
Protein window (g) = [meal_calories × protein_pct_min, meal_calories × protein_pct_max] ÷ 4
Fat window (g)     = [meal_calories × fat_pct_min, meal_calories × fat_pct_max] ÷ 9
```

**Step 2 — sum the raw windows across all meals.**
```
Σ min = sum of every meal's raw protein minimum
Σ max = sum of every meal's raw protein maximum
```
(Same summation done separately for fat.)

**Step 3 — compute scale factors against the daily target** (from Section 5):
```
min_scale = daily_min ÷ Σ min
max_scale = daily_max ÷ Σ max
```

**Step 4 — apply the scale factors to every meal's window.**
```
scaled_meal_min = raw_meal_min × min_scale
scaled_meal_max = raw_meal_max × max_scale
```

This guarantees, by construction, that the sum of every meal's scaled minimum equals the daily minimum, and the sum of every meal's scaled maximum equals the daily maximum.

**Worked example** (100kg client, daily protein range 180g–220g, 4 meals):

| Meal | Raw min/max (g) |
|---|---|
| Breakfast | 20 – 30 |
| Snack | 12 – 20 |
| Lunch | 45 – 58 |
| Dinner | 37.5 – 50.6 |
| **Sum** | **114.5 – 158.6** |

```
min_scale = 180 ÷ 114.5 ≈ 1.57
max_scale = 220 ÷ 158.6 ≈ 1.39
```

| Meal | Scaled min/max (g) |
|---|---|
| Breakfast | 31.4 – 41.7 |
| Snack | 18.8 – 27.8 |
| Lunch | 70.7 – 80.6 |
| Dinner | 58.9 – 70.3 |
| **Sum** | **≈180 – ≈220** ✓ |

Carb windows: whatever calories remain in each meal after protein + fat are subtracted, converted at 4 kcal/g.

Repeat Steps 1–4 separately for fat, against the daily fat range from Section 5.

**Interval guarantee:** because Σ(scaled mins) = daily min and Σ(scaled maxes) = daily max by construction, *any* combination of in-window picks — one per meal — automatically sums to a value inside the daily range. This holds regardless of which specific bundle is chosen per meal.

## 9. Meal Selection — Constraint Filtering

For each meal slot in the plan, **both of the following constraints are hard requirements** — a candidate bundle must satisfy both simultaneously, or it is not a valid pick for that slot:

**Constraint A — Calorie window.** A meal's calories must not exceed, and must not fall below, 5% of *that meal's own* target calories away from that meal's Section 6 allocation:
```
meal_calorie_window = [meal_target_calories × 0.95, meal_target_calories × 1.05]
```

*Note:* because every meal's deviation is capped at 5% of its own calories, the sum of all meals is automatically capped at 5% of the daily total too — no separate daily-level check is needed for this to hold.

**Constraint B — Macro windows.** Each macro (protein, fat, carb) for that meal must fall only within its allowed range as derived in Section 8 — the scaled window, not the raw Section 7 window. E.g., if breakfast's scaled protein window is 20g–30g, any candidate bundle's breakfast protein must land inside 20g–30g; a value outside that window (even if it satisfies the calorie window) disqualifies the bundle for that slot.

**Selection steps:**
1. Compute the meal's calorie window (Constraint A).
2. Use the meal's scaled macro-gram windows from Section 8 (Constraint B).
3. Filter the meal bundle database to bundles whose actual calorie and macro totals fall inside **all** windows simultaneously (Constraint A and Constraint B together).
4. Select a matching bundle from the filtered set for that meal slot.

No fallback: if zero bundles match a meal slot's windows, that slot has no valid option under the current constraints — it is not auto-relaxed or approximated.

## 10. Meal Swaps

Swapping a meal means re-running Section 9's steps 1–4 for that slot only, selecting a different bundle from the same filtered set.

Because each meal's window was fixed independently in Section 8 (and Σmin/Σmax already match the daily target), a swap:
- **Never affects any other meal's window** — each meal's window was set once, independently, at plan-generation time.
- **Never breaks the daily total** — by the interval guarantee in Section 8, any in-window pick for the swapped meal keeps the whole day's sum inside the daily range, automatically.
- **Never breaks Constraint A or B** — the swap candidate is drawn only from bundles that already satisfy both constraints (Section 9, Step 3's filtered set).

No re-reconciliation step is needed after a swap.

## 11. Implementation & Verification Prompt (for an AI coding agent)

Use the block below as-is when handing this document to an AI agent to implement the system, or to verify/audit an existing implementation against it.

```
You are implementing (or auditing) a nutrition-coaching meal-planning engine against
the rules in this document (Sections 1–10). Do the following:

1. IMPLEMENT OR LOCATE the following pipeline stages, matching the document exactly:
   a. BMR (Section 2) and TDEE (Section 3) calculation.
   b. Goal-based calorie target adjustment (Section 4).
   c. Daily macro gram RANGE calculation from g/kg bounds (Section 5).
   d. Meal-calorie distribution by pattern + meal count (Section 6).
   e. Section 7's fixed, client-independent per-meal-type macro % RANGE table.
   f. Section 8's scaling pipeline: raw windows -> sum -> min_scale/max_scale ->
      scaled per-meal windows. Confirm min_scale and max_scale are computed and
      applied SEPARATELY (not a single averaged scale factor).
   g. Section 9's TWO hard constraints applied together (not either/or) when
      filtering candidate bundles:
        - Constraint A: meal calories within ±5% of THAT MEAL'S OWN Section 6
          target calories (not the daily total).
        - Constraint B: each macro within that meal's SCALED window from Section 8
          (never the raw Section 7 window).
   h. Section 10's swap logic: re-filter only the swapped slot; no re-scaling of
      other meals; no re-check of the daily total (it's guaranteed structurally).

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

   Section 7 (ratio table):
   - Every meal type's protein/fat/carb % ranges are internally non-inverted
     (min < max).
   - Confirm the table is NOT re-derived or altered per client/plan (client
     independence).

   Section 8 (scaling):
   - For at least 3 different clients (varying weight, calories, meal count,
     and distribution pattern), confirm:
       Σ(scaled_meal_min across all meals) == daily_min (within rounding tolerance)
       Σ(scaled_meal_max across all meals) == daily_max (within rounding tolerance)
   - Confirm min_scale != max_scale whenever daily_min != daily_max, and that
     each is applied to the correct side (min raw -> min_scale, max raw -> max_scale).
   - Edge case: a client whose raw Σmin/Σmax is very far from their daily target
     (e.g. very high or very low g/kg choice) — confirm scaling still produces a
     valid, non-inverted, correctly-summing window and does not produce negative
     or zero values.

   Section 9 (constraint filtering):
   - Construct a bundle that satisfies Constraint A but violates Constraint B ->
     confirm it is REJECTED (both constraints are mandatory, not either/or).
   - Construct a bundle that satisfies Constraint B but violates Constraint A ->
     confirm it is REJECTED.
   - Construct a bundle satisfying neither -> confirm rejected.
   - Construct a bundle satisfying both -> confirm accepted.
   - Confirm Constraint A uses each meal's OWN target calories as the base for
     the ±5% window, not the daily total (e.g. for a 600-kcal meal the window
     is 570-630, not [meal ± 5% of a 2500-kcal day]).
   - Construct a full day where every meal lands at the edge of its own ±5%
     window in the same direction (all at +5%) -> confirm the resulting daily
     total is still within ±5% of the daily target (the aggregate bound that
     falls out of the per-meal constraint, not a separately enforced rule).
   - Edge case: a meal slot where the filtered set is empty -> confirm the system
     surfaces "no valid option" and does NOT auto-relax constraints or silently
     substitute an out-of-window bundle.
   - Edge case: values exactly on a window boundary (e.g. calories exactly at
     +5%, or a macro exactly at its scaled min/max) -> confirm documented
     inclusive/exclusive behavior is applied consistently (state and follow one
     convention if the document is silent).

   Section 10 (swaps):
   - Swap one meal slot; confirm no other slot's stored window changed.
   - Swap one meal slot multiple times in a row; confirm the daily total stays
     within [daily_min, daily_max] after every swap.
   - Confirm a swap candidate is always drawn from Section 9's filtered set (i.e.
     a swap can never introduce a bundle violating Constraint A or B).

4. Report results as a checklist: for each lettered pipeline stage (1a–1h) and
   each test above, state IMPLEMENTED/VERIFIED or MISSING/FAILING, with the
   specific values or reproduction steps for any failure.
```
