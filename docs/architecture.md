# Architecture

## Project Layout

```
nutrition-plan-app/
├── data/                        # Runtime food database
├── docs/                        # This file and future docs
├── filtering_data/              # USDA source data + build pipeline
├── legacy/                      # Archived Flutter app (read-only reference)
├── public/                      # Frontend (HTML/CSS/JS, served statically)
├── scripts/
│   ├── db/setup.sql             # One-time DB schema creation
│   └── data/enrichFoodData.js   # Merges metadata into foods.json
└── src/                         # Node.js/Express backend
```

---

## Data Layer: `data/foods.json`

The app's food database. 95 foods, loaded once at startup and cached in memory by
`src/repositories/foodRepository.js`. Not committed as raw USDA data — it is the
*enriched* output of the food pipeline (see below).

Each food is normalised by `foodRepository.loadFoods()` from snake_case JSON into
camelCase JS objects with these fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug (e.g. `"chicken_breast"`) |
| `name` / `nameAr` | string | English and Arabic names |
| `macroRole` | string | `"protein"`, `"carb"`, `"fat"`, `"mixed"` |
| `caloriesPer100g` | number | |
| `proteinGPer100g` | number | |
| `carbGPer100g` | number | |
| `fatGPer100g` | number | |
| `categories` | string[] | Broad preference tags (`"poultry"`, `"seafood"`, …) |
| `allergens` | string[] | Strict allergy tags (`"fish"`, `"milk"`, `"gluten"`, …) |
| `mealTags` | string[] | Which meals this food can appear in |
| `minServingG` / `maxServingG` | number | Portion bounds enforced by the generator |
| `defaultServingG` | number | Starting quantity before adjustment |
| `isVegan` / `isVegetarian` | boolean | Diet filter flags |

---

## Food Pipeline: `filtering_data/` + `scripts/data/`

**Step 1 — Filter raw USDA data (`filtering_data/clean.py`):**

Reads the SR Legacy CSV dump from USDA FoodData Central and outputs
`filtering_data/filtered_ingredients.csv` containing the 95 selected foods
with raw macro values.

**Step 2 — Enrich with metadata (`scripts/data/enrichFoodData.js`):**

Reads `data/foods.json` and merges hand-authored metadata (allergens,
categories, meal tags, serving sizes) per food ID. Writes the result back
to `data/foods.json`. Run this any time foods are added or serving/category
data changes:

```bash
node scripts/data/enrichFoodData.js
```

**When to re-run:**
- Adding or removing foods → re-run both steps
- Changing category/allergen metadata only → re-run step 2 only
- Normal development → never needed

---

## Database Setup: `scripts/db/setup.sql`

Creates all PostgreSQL tables. Run once against your database:

```bash
psql -d your_database -f scripts/db/setup.sql
```

Tables created:

| Table | Purpose |
|---|---|
| `users` | Accounts — username, bcrypt password hash, token_version |
| `folders` | Hierarchical plan organisation (self-referencing parent_id) |
| `plans` | Saved nutrition plans — JSONB `plan_data`, linked to a folder |
| `customers` | Clients managed by a coach user |

---

## Frontend: `public/`

Vanilla JS, no framework. Served as static files by Express (`express.static`).

```
public/
├── css/styles.css        # All styles
├── js/
│   ├── app.js            # Planner page: plan state, meal cards, red flags, auto-balance
│   └── auth.js           # Login/register forms, session management
├── index.html            # Home — plan generation form
├── planner.html          # Interactive meal plan editor
├── explorer.html         # Folder tree + plan browser
├── login.html
├── register.html
├── customer.html         # Single customer's plan list
└── customers.html        # Coach's customer list
```

### `public/js/app.js` — Planner state model

Each meal is tracked as a state object:

```javascript
{
  mealIndex, name, tag,
  target: { calories, proteinG, carbG, fatG },  // editable
  targetLocked: false,
  originalItems: [{ food, quantityG }],          // snapshot from generation
  items: [{ food, quantityG, locked, alternatives }],
  cardEl,
}
```

Key behaviours:
- **Gram changes**: update state + re-render, no API call
- **Red flags**: client-side, triggered after every change, check ±10% vs daily targets
- **Auto-balance**: calls `POST /api/auto-balance-meal`, targets `originalItems` totals
- **Redistribute**: splits daily gap proportionally across unlocked meal targets
- **Add food / swap food**: always allowed, no blocking

### `public/css/styles.css`

Single stylesheet. Notable class groups:

| Class group | Purpose |
|---|---|
| `.metric--flagged` | Red border/bg on daily macro summary when >10% off |
| `.food-item--locked` | Teal border on locked foods |
| `.food-item--problematic` | Red border on the food auto-balance can't resolve |
| `.auto-balance-suggestions` | Replacement suggestion list |
| `.meal-target-editor` | Inline 4-field target editor |
| `.redistribute-btn` | Button shown when meal-target sum drifts from daily total |

---

## Legacy: `legacy/flutter-app/`

The original Flutter implementation of this app, kept for reference. It has its own
`foods.json` (may be out of date), `PROJECT_ARCHITECTURE_v1.md`, and `pubspec.yaml`.
It is not connected to the Node.js backend and is never run in production.

---

# Backend Architecture

## Overview

The backend follows a layered Node.js architecture:

```
HTTP Request
    ↓
routes/          ← Express router, maps URL + method → controller function
    ↓
controllers/     ← Request parsing, response shaping, HTTP status codes
    ↓
services/        ← Business logic (nutrition math, user validation, bcrypt)
    ↓
repositories/    ← Raw database / file I/O, no business logic
    ↓
config/          ← Constants, taxonomy, DB pool
```

Each file has one responsibility. No business logic lives in routes or controllers; no HTTP
concerns leak into services or repositories.

---

## File-by-File Explanation

### `src/server.js`
Entry point. Creates the Express app, mounts middleware (cookie-parser, JSON body parser,
error handler), registers route prefixes, and calls `app.listen`.

### `src/app.js`
Express application factory (if present). Sets up global middleware and exports `app` for
testing.

---

### Routes

Each route file contains only: `express.Router()`, `requireAuth` references, and one-line
`router.METHOD(path, [requireAuth,] controllerFn)` calls. No logic.

| File | Prefix | Description |
|---|---|---|
| `routes/authRoutes.js` | `/auth` | Register, login, logout, revoke sessions, /me |
| `routes/folderRoutes.js` | `/folders` | Folder CRUD + save plan inside folder |
| `routes/planRoutes.js` | `/plans` | Plan get/update/delete/duplicate |
| `routes/apiRoutes.js` | `/api` | Health, foods, preferences, generate/rebalance plan |
| `routes/customerRoutes.js` | `/customers` | Customer CRUD + customer-scoped plans |

---

### Controllers

Controllers own the HTTP layer: read from `req`, call service/repository functions, write
to `res`. They return 4xx when inputs are invalid, 404 when resources are missing, and
delegate unexpected errors to `next(err)`.

#### `controllers/authController.js`
- `register` — calls `userService.createUser`, signs JWT, sets httpOnly cookie
- `login` — looks up user, verifies password with bcrypt, signs JWT, sets cookie
- `logout` / `revokeAllSessions` — increments `token_version` (invalidates all existing JWTs), clears cookie
- `getMe` — returns `req.user` fields (set by `requireAuth` middleware)

#### `controllers/folderController.js`
- `getTree` — returns nested folder tree for the folder picker UI
- `getRootContentsHandler` — root-level folders (no parent)
- `createFolderHandler` — validates name, creates folder
- `getBreadcrumbHandler` — recursive CTE path from folder to root
- `getFolderContentsHandler` — folder metadata + subfolders + plans list
- `renameFolderHandler` / `deleteFolderHandler` — name update / cascade delete
- `savePlanInFolder` — verifies folder ownership then inserts plan

#### `controllers/planController.js`
- `getPlan` — fetches plan by id + userId ownership check
- `updatePlanHandler` — accepts partial update (name and/or planData)
- `deletePlanHandler` — deletes plan with ownership check via JOIN on folders
- `duplicatePlanHandler` — copies plan_data to a target folder

#### `controllers/plannerController.js`
Exposes the nutrition engine over HTTP.
- `health` — `/api/health`
- `getFoodsHandler` — returns all foods from in-memory cache
- `getPreferences` — returns allergen/category options derived from food list
- `generatePlanHandler` — full plan generation from user inputs
- `rebalanceMealHandler` — adjusts unlocked food portions to hit a meal target
- `checkSwapHandler` — dry-run feasibility check before a swap
- `autoBalanceMealHandler` — user-triggered balance targeting original generated quantities
- `computeSensitivityHandler` — returns per-food calorie compensation matrix

#### `controllers/customerController.js`
Manages coach↔customer relationships and customer-scoped plan assignment.

---

### Services

#### `services/userService.js`
Validation + bcrypt. No DB calls (delegates to `userRepository.insertUser`).
- `validateUsername` — 3-30 chars, alphanumeric+_-., must contain a letter
- `validateName` — 2-50 chars, letters/spaces/hyphens/apostrophes
- `validatePassword` — 8-128 chars, zxcvbn score ≥ 2
- `createUser` — validates all fields, bcrypt-hashes password (SALT_ROUNDS=12), inserts
- `verifyPassword` — `bcrypt.compare` wrapper

#### `services/planGenerator.js`
The core nutrition engine (~930 lines). See **Meal Generation Simulation** below.
Exported: `generatePlan`, `getFoods`, `rebalanceMeal`, `autoBalanceMeal`,
`computeSensitivityMatrix`, `checkRebalanceFeasibility`, `computeMealBounds`, `normalizeInput`.

#### `services/nutritionService.js`
Pure math functions used by `planGenerator.js`:
- `calculateDailyTargets` — TDEE → macro split
- `splitMeals` — distributes daily targets across meals/snacks
- `macrosForFoodPortion(food, g)` — `{ calories, proteinG, carbG, fatG }` for one food
- `sumTargets`, `roundToNearest`, `clamp`

---

### Repositories

One file per data source. Only DB queries and file reads — no validation, no hashing.

| File | Source | Functions |
|---|---|---|
| `repositories/userRepository.js` | PostgreSQL `users` table | `insertUser`, `findUserByUsername`, `findUserById`, `updateLastLogin`, `incrementTokenVersion` |
| `repositories/planRepository.js` | PostgreSQL `plans` table | `createPlan`, `getPlansByFolder`, `getPlanById`, `updatePlan`, `deletePlan`, `duplicatePlan` |
| `repositories/folderRepository.js` | PostgreSQL `folders` table | `createFolder`, `getFolderById`, `getRootContents`, `getFolderContents`, `getBreadcrumb`, `getFolderTree`, `renameFolder`, `deleteFolder` |
| `repositories/customerRepository.js` | PostgreSQL `customers` table | `createCustomer`, `getCustomersByCoach`, `getCustomerById`, `deleteCustomer` |
| `repositories/foodRepository.js` | `data/foods.json` (95 items) | `loadFoods` (cached, normalizes snake_case JSON → camelCase JS objects) |

---

### Middleware

#### `middleware/auth.js`
- `signToken(payload)` — signs a 7-day JWT with `JWT_SECRET`
- `verifyToken(token)` — verifies and decodes
- `requireAuth` — extracts token from cookie or `Authorization: Bearer`, verifies it,
  loads user from DB, checks `user.token_version === payload.tokenVersion` (session revocation)

---

### Config

| File | Contents |
|---|---|
| `config/db.js` | `pg.Pool` singleton, reads `DATABASE_URL` or individual PG_* env vars |
| `config/nutritionConstants.js` | `NUTRITION` (macro ratios, tolerances, activity multipliers) and `MEAL_SPLITS` (per-meal calorie fractions) |
| `config/preferenceTaxonomy.js` | Maps user-typed terms ("dairy", "nuts") to food IDs and semantic tags; `getPreferenceOptions` and `resolvePreferenceTerms` |

---

## Full Meal Generation Simulation

**Input:**
```json
{
  "weightKg": 80,
  "heightCm": 175,
  "bodyFatPercentage": null,
  "activityLevel": "moderate",
  "goal": "lose_weight",
  "dietType": "standard",
  "numberOfMeals": 3,
  "numberOfSnacks": 1,
  "allergies": [],
  "dislikes": []
}
```

### Step 1 — Daily Targets (`calculateDailyTargets`)

No body-fat provided → bodyweight formula:
```
maintenance = 80 kg × 34 kcal/kg = 2720 kcal
goal adjustment (lose_weight) = -500 kcal
target calories = 2220 kcal
```

Fixed macro allocations (from `nutritionConstants`):
```
proteinG = 80 × 2.0 = 160 g   → 640 kcal
fatG     = 80 × 1.0 = 80 g    → 720 kcal
remaining for carbs = 2220 - 640 - 720 = 860 kcal → 215 g carbs
```

**Daily targets:**
```
calories: 2220   proteinG: 160   carbG: 215   fatG: 80
```

### Step 2 — Meal Splits (`splitMeals`)

3 meals + 1 snack. Snack fraction = 0.10 → meals share 0.90.
Meal factors for 3 meals = `[0.30, 0.40, 0.30]` × 0.90:

| Meal | Factor | Calories | Protein (g) | Carbs (g) | Fat (g) |
|---|---|---|---|---|---|
| Breakfast | 0.27 | 599 | 43 | 58 | 22 |
| Lunch | 0.36 | 799 | 58 | 77 | 29 |
| Dinner | 0.27 | 599 | 43 | 58 | 22 |
| Snack | 0.10 | 222 | 16 | 22 | 8 |

### Step 3 — Food Pool Filtering (`filterFoods`)

All 95 foods pass (no allergies, standard diet). Coffee and dislikes are empty.

### Step 4 — Meal Generation (`generateMeal`, repeated per meal)

For **Lunch** (target: 799 kcal, 58g protein, 77g carb, 29g fat):

**4a. Initial item selection (`selectInitialItems`):**

Foods are partitioned by `macroRole` × `mealTags`:
- `protein` foods for `lunch` tag: chicken breast, tuna, eggs, …
- `carb` foods for `lunch` tag: rice, bread, pasta, …
- `fat` foods for `lunch` tag: olive oil, avocado, nuts, …

A deterministic `pick(foods, seed)` selects one from each role using `seed = mealIndex`.
Example selection:
```
protein: Chicken Breast   default 150g
carb:    White Rice       default 100g  
fat:     Olive Oil        default 15g
```

Initial calories before scaling: `(150×165 + 100×130 + 15×884) / 100 = 525 kcal`

Since `calTarget (799) > defaultCal (525) × 1.2`, initial portions scale up:
```
scale = 799 / 525 = 1.52
chicken → 150 × 1.52 = 230g (clamped to maxServingG if needed)
rice    → 100 × 1.52 = 150g
olive oil → 15 × 1.52 = 23g
```

**4b. Portion adjustment (`adjustPortions`):**

Iterative priority loop (up to 20 iterations):

*Iteration 1:*
```
totals: cal=799, prot=62, carb=63, fat=26
proteinDiff = 58 - 62 = -4  (>2g threshold) → shrink chicken
  deltaG = -4 / (31.0/100) = -12.9g → chicken = 217g
```

*Iteration 2:*
```
totals: cal=795, prot=58, carb=63, fat=26
proteinDiff = 0  ✓
fatDiff = 29 - 26 = +3  (>2g threshold) → grow olive oil
  deltaG = +3 / (100/100) = +3g → olive oil = 26g
```

*Iteration 3:*
```
totals: cal=822, prot=58, carb=63, fat=29
calorieDiff = 799 - 822 = -23  (>5% threshold) → shrink rice
  deltaG = -23 / (1.30) = -18g → rice = 132g
```

*Iteration 4:*
```
totals: cal=799, prot=58, carb=61, fat=29
carbDiff = 77 - 61 = +16  →  grow rice
  deltaG = +16 / (0.280) = +57g → rice = 189g → hit maxServingG cap
```

Converges. Final items (rounded to nearest 5g):
```
Chicken Breast  215g → 335 kcal, 67g protein, 0g carb, 7g fat
White Rice      190g → 247 kcal, 5g protein, 54g carb, 0g fat
Olive Oil        25g → 221 kcal, 0g protein, 0g carb, 25g fat
                      ─────────────────────────────────────────
totals          430g   803 kcal   72g prot   54g carb  32g fat
```
(Within 15% tolerance — marked `isApproximate: false`.)

**4c. Alternatives pre-computation:**

For each item, `alternativesFor` finds up to 4 foods with the same `macroRole` and
compatible `mealTags`, sorted by `macroDistance`. Same-category foods rank first.
Example for Chicken Breast: Turkey Breast, Tuna, Salmon, Egg Whites.

**4d. Sensitivity matrix (`computeSensitivityMatrix`):**

Each food gets a row: "if I increase this food by 10g, which other food decreases by how much?"
The calorie compensator is the best carb/mixed/protein food (not the trigger food itself).

```
trigger=Chicken (+10g → +16.5 kcal) → compensator=Rice
  Rice delta = -16.5 / (1.30 kcal/g) = -12.7g
```

The matrix is stored on each meal in `plan_data` and used by the frontend for real-time gram dragging.

**4e. Original items snapshot:**

After generation, `originalItems` stores a plain copy of `{ food, quantityG }` for each
item. This snapshot is what `autoBalanceMeal` targets when the user presses "Auto-balance".

### Step 5 — Output shape

```json
{
  "input": { ... },
  "dailyTargets": { "calories": 2220, "proteinG": 160, "carbG": 215, "fatG": 80 },
  "meals": [
    {
      "name": "Lunch",
      "tag": "lunch",
      "target": { "calories": 799, "proteinG": 58, "carbG": 77, "fatG": 29 },
      "items": [
        {
          "food": { "id": "chicken_breast", "name": "Chicken Breast", ... },
          "quantityG": 215,
          "locked": false,
          "alternatives": [ ... ],
          "totals": { "calories": 335, "proteinG": 67, "carbG": 0, "fatG": 7 }
        },
        ...
      ],
      "totals": { "calories": 803, "proteinG": 72, "carbG": 54, "fatG": 32 },
      "isApproximate": false,
      "sensitivityMatrix": [[0, -12.7, 0], [0, 0, 0], [0, -9.4, 0]],
      "originalItems": [
        { "food": { ... }, "quantityG": 215 },
        ...
      ]
    },
    ...
  ]
}
```

---

## Auto-Balance / Rebalance Logic Explanation

### Background

The user can freely change gram amounts, swap foods, or insert new foods. Any change may
push meal totals away from the original generated values. Two mechanisms exist to restore
balance:

### 1. `rebalanceMeal` — Target-based (legacy, interactive drag)

Called with `mealTarget` (current target) and per-item `locked` flags.
Uses `adjustPortionsWithLocks` + `nudgeIntoBounds`:

1. **Priority loop** adjusts the first unlocked food of each role in order: protein → fat → carb → calories.
2. Each pass computes the deficit for that macro and moves the relevant food by `deficit / (macroRate/100)`.
3. If a food hits its min/max boundary the pass falls through to the next priority.
4. After convergence, `nudgeIntoBounds` makes up to 4 single-food corrections for any remaining bound violation.
5. Returns `{ success, items[{foodId, quantityG}], totals }` or `{ success: false, violatedMacro }`.

### 2. `autoBalanceMeal` — Original-value targeting (user-triggered button)

Called from the frontend "Auto-balance" button. Takes current `items` + `originalItems` snapshot.

**Target:** `origTotals` — the macro sum of `originalItems` (not the current meal `target`).

**Priority order:** protein → carbs → calories → fats (different from rebalanceMeal).

```
Iteration example:
  origTotals:  { cal: 800, prot: 55, carb: 80, fat: 28 }
  current totals: { cal: 720, prot: 40, carb: 90, fat: 28 }

  proteinDiff = 55 - 40 = +15g → adjust protein-role food
  carbDiff    = 80 - 90 = -10g → adjust carb-role food
  calDiff     = 800 - 720 = +80 kcal → satisfied by protein fix above
  fatDiff     = 0 ✓
```

**Acceptable threshold:** ≤ 10% deviation on protein, carbs, and calories simultaneously.

**If unresolvable** (all unlocked foods at their min/max limits):
- `findMostProblematicFood` finds the unlocked food most responsible for the worst-deviated
  macro (highest deviation × highest contribution rate × at its boundary).
- `suggestReplacementsForFood` scans all foods:
  - Computes `gramAmount` to fill the protein budget (or calorie budget if protein is low).
  - Rejects foods where `gramAmount` falls outside `[minServingG, maxServingG]`.
  - Ranks same-category foods first, then by `macroDistance` to the original food.
  - Returns up to 5 suggestions, each with `{ food, gramAmount, isSwap }`.
- Frontend shows these as swappable or insertable options.

### Red Flag System

After any gram change (client-side, no API call):

1. Compute daily totals by summing all meals.
2. For each macro (calories, protein, carbs, fats):
   - If `|actual - dailyTarget| / dailyTarget > 0.10` → flag that metric in the summary bar.
3. Also check: `|sum(meal targets) - dailyTarget| / dailyTarget > 0.10` → show redistribute warning.

Flags are cosmetic only — no state is blocked or reverted. Plans save with flags visible.

### Auto-redistribute

When the user edits a meal's target (inline editor) and the sum of meal targets drifts from
the daily target:
- The difference is split proportionally across all **unlocked** meal targets based on their
  current fraction of the total.
- Only the target numbers change; food items are not touched until the user presses
  "Auto-balance" on each meal.
