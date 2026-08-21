# Nutrition Plan App Flow Audit

Generated from the current codebase, not from the older architecture doc. Use this as a reading map while you go file by file.

## What This App Is

This is currently a Node.js/Express backend plus vanilla HTML/CSS/JS frontend. The original Flutter app in `legacy/flutter-app/` is archived reference code, not part of the running web app.

Runtime flow:

```text
Browser page in public/
  -> public/js/*.js fetches /api/... endpoints
  -> src/app.js routes requests
  -> src/routes/*.js maps endpoint to controller
  -> src/controllers/*.js validates HTTP request/response shape
  -> src/services/*.js performs auth, nutrition math, generation, and deterministic rebalance logic
  -> src/repositories/*.js reads JSON data or writes PostgreSQL through Sequelize models
  -> src/models/*.js maps database tables
```

Runtime data:

```text
used_food_repository/foods.json
ready_meals/meals.json
icons/*.png
PostgreSQL tables: users, folders, customers, plans
Firebase Auth: browser login and server session cookie
```

## Full Signup To Generated And Saved Meal Flow

### 1. User lands on the app

Files:

- `src/server.js`: starts the server, authenticates Sequelize/PostgreSQL, calls `app.listen`.
- `src/app.js`: builds the Express app, mounts JSON parser, cookies, API route prefixes, static file serving, and page routes.
- `public/index.html`: marketing/home page. It checks `/api/auth/me`; logged-in users go to `/dashboard`, anonymous users can go to `/login`.
- `public/css/styles.css`: all styling for home, auth, dashboard, planner, explorer, and customer pages.

Important note: `public/index.html` still says "hashed passwords and JWT sessions" in the feature text. The current auth flow is Firebase session cookies, so that text is stale.

### 2. User signs up or logs in

Frontend files:

- `public/register.html`: registration form shell.
- `public/login.html`: login, forgot-password, resend-verification shell.
- `public/js/auth.js`: owns the full browser auth page behavior.

Backend files:

- `src/routes/authRoutes.js`: maps `/api/auth/firebase-config`, `/api/auth/session`, `/api/auth/logout`, `/api/auth/me`, and disabled legacy auth endpoints.
- `src/controllers/authController.js`: returns Firebase browser config, creates server session cookies, serializes current user, logs out, deletes user.
- `src/services/firebaseAuthService.js`: normalizes email/name, checks verified email for password accounts, extracts a profile from the Firebase token, exposes Firebase web config from env.
- `src/config/firebaseAdmin.js`: initializes Firebase Admin SDK from `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- `src/middleware/auth.js`: verifies `__session` cookie or Bearer token, checks Firebase access rules, loads the app user from DB, attaches `req.user`.
- `src/repositories/userRepository.js`: creates or updates the internal `users` row for a Firebase user.
- `src/models/User.js`: Sequelize mapping for `users`.

Exact sequence:

1. `public/js/auth.js:initAuthPage()` checks `/api/auth/me`; if already logged in, redirects to `/dashboard`.
2. It fetches `/api/auth/firebase-config`.
3. It dynamically imports Firebase browser SDK from Google CDN.
4. Email signup uses `createUserWithEmailAndPassword`, updates Firebase display name, sends verification email, then waits for verified login.
5. Email login uses `signInWithEmailAndPassword`, rejects unverified email, then calls `createServerSession`.
6. Google login uses popup first, redirect fallback if popup is blocked, then calls `createServerSession`.
7. `createServerSession()` sends Firebase ID token to `POST /api/auth/session`.
8. `authController.createSession()` verifies ID token with Firebase Admin, checks email verification, syncs/creates the app `users` row, creates a Firebase session cookie named `__session`, and returns the public app user.
9. Browser redirects to `/dashboard`.

### 3. User opens dashboard

Frontend files:

- `public/dashboard.html`: dashboard page shell.
- `public/js/dashboard.js`: dashboard behavior.

Backend files:

- `src/routes/dashboardRoutes.js`: maps `GET /api/dashboard`.
- `src/controllers/dashboardController.js`: calls repository and returns JSON.
- `src/repositories/dashboardRepository.js`: counts plans/customers/active plans, loads recent opened plans, loads customers with plan summaries.
- `src/repositories/customerRepository.js`: shared customer summary logic.
- `src/models/Folder.js`, `src/models/Plan.js`, `src/models/Customer.js`: DB table mappings used by dashboard queries.

Dashboard sequence:

1. `public/js/dashboard.js:initDashboard()` fetches `/api/dashboard`.
2. It also calls `/api/folders` and `/api/folders/tree` to build "general plans".
3. It renders stats, customers, general plans, action menu, delete plan behavior, and customer plan expansion.
4. "Create plan" links to `/planner`.
5. Existing plans link to `/planner?planId=<id>`.

### 4. User opens planner and fills plan setup

Frontend files:

- `public/planner.html`: full planner form and HTML templates for summary and meal cards.
- `public/js/app.js`: main planner application. This is the largest frontend file and owns most user-visible behavior.
- `public/css/styles.css`: all planner layout, cards, badges, modals, sticky save bar, and PDF/export styles.

Backend files used before generation:

- `src/routes/generationRoutes.js`: maps `GET /api/foods` and `GET /api/preferences`.
- `src/controllers/generationController.js`: serves food list and preference options.
- `src/services/planGenerator.js:getFoods`: delegates to food repository.
- `src/repositories/foodRepository.js`: loads and normalizes `used_food_repository/foods.json`.
- `src/config/preferenceTaxonomy.js`: generates food/category/allergen options.
- `new_stage_data/icons/*.png`: food icons served through `/food-icons`.

Planner setup sequence:

1. `public/js/app.js` reads query params into `plannerCtx`: `planId`, `folderId`, `export=pdf`.
2. It immediately checks `/api/auth/me`; anonymous users are redirected to `/login`.
3. If `planId` exists, it loads the saved plan with `GET /api/plans/:id`.
4. If `folderId` exists, it loads folder metadata with `GET /api/folders/:id`.
5. It fetches `/api/preferences` to populate the "Avoid foods" picker.
6. It can fetch `/api/foods` to hydrate food metadata for preference options and search behavior.
7. The user fills body data, goal, meal count, distribution, diet type, customer name, active toggle, plan name, and avoided foods.

The form data collected by `readForm()`:

- `weightKg`
- `heightCm`
- `age`
- `sex`
- `bodyFatPercentage`
- `activityLevel`
- `goal`
- `numberOfMeals`
- `mealDistribution`
- `dietType`
- `avoidFoods`

### 5. User generates the plan

Frontend files:

- `public/js/app.js:generateAndRender(apiUrl)`: validates save details, sends form JSON, renders result.
- `public/js/app.js:readForm()`: converts form fields into raw generation input.
- `public/js/app.js:renderPlan()`: turns backend response into `mealStates` and DOM.

Backend files:

- `src/routes/generationRoutes.js`: `POST /api/generate-plan`.
- `src/controllers/generationController.js`: `generatePlanHandler`.
- `src/services/planGenerator.js`: central plan-generation engine.
- `src/services/nutritionService.js`: BMR, maintenance calories, goal calories, macro targets, meal target splitting.
- `src/repositories/readyMealRepository.js`: loads `ready_meals/meals.json`.
- `src/repositories/foodRepository.js`: loads `used_food_repository/foods.json`.
- `src/config/nutritionConstants.js`: calorie/macro constants and fixed meal distributions.
- `src/config/preferenceTaxonomy.js`: resolves avoid-food terms into semantic tags and food IDs.

Generation sequence:

1. Browser calls `POST /api/generate-plan` with `readForm()` output.
2. `requireAuth` verifies the app JWT session and loads `req.user`.
3. `generationController.generatePlanHandler()` calls `generatePlan(req.body)`.
4. `planGenerator.normalizeInput()` converts strings to numbers/booleans and validates all body inputs.
5. `nutritionService.calculateNutritionDetails()` computes BMR, maintenance calories, goal calories, calorie floor, protein/fat targets, and carb grams as remaining calories.
6. `nutritionService.buildMealTargets()` splits daily targets into meal slots based on meal count, distribution, and macro profiles.
7. `planGenerator.filterFoods()` removes foods blocked by diet type and avoid-food semantic matching.
8. `planGenerator.generateReadyMealDay()` builds candidate ready meals for each slot.
9. `readyMealRepository.loadReadyMealBundles()` reads ready-meal bundles from `ready_meals/meals.json`.
10. Each ready meal is matched to allowed foods by ingredient name, then solved toward calories, protein, and fat.
11. `findBestPortionGridFit()` adjusts gram quantities to satisfy calorie/protein/fat bounds.
12. `selectReadyMealDayCombination()` searches candidate combinations across the day and picks the best daily fit.
13. Response contains `input`, `dailyTargets`, `nutritionCalculation`, `meals`, optional `warnings`, optional `diagnostics`, and optional impossible-plan `errors`.

Important behavior:

- `planGenerator.js` uses ready-meal candidates from `ready_meals/meals.json`; the older template/swap-generation path has been removed.

### 6. Browser renders generated meals

Frontend file:

- `public/js/app.js`, especially `renderPlan`, `renderSummary`, `renderMealCard`, `renderFoodList`, `updateFoodRow`, `refreshRedFlags`, and `buildPlanData`.

Client state created in `renderPlan()`:

```text
mealStates[] = one state object per meal
dailyTargets = plan.dailyTargets
currentPlanInput = plan.input
```

Each meal state includes:

- `mealIndex`, `name`, `tag`
- `target`
- ready-meal metadata: `templateId`, `templateName`, `templateFamily`, `readyMealTrack`
- `originalItems`
- editable `items`
- alternate ready-meal options
- proposal/chat/edit state
- `cardEl`

Rendering sequence:

1. `renderPlan()` clears previous output and resets `mealStates`.
2. It renders diagnostics/warnings if present.
3. It renders daily summary unless in PDF export mode.
4. It creates a save bar: edit mode uses `showEditBar`, new plan uses `showPlanSaveBar`.
5. For each backend meal, it creates a meal state and calls `renderMealCard`.
6. `renderMealCard` and `renderFoodList` render food rows, portions, totals, meal buttons, cycle buttons, and edit controls.
7. `refreshRedFlags()` compares actual totals against daily targets and flags metrics outside the allowed range.

### 7. User edits a meal before saving

Frontend:

- `public/js/app.js` owns all meal editing.

Backend:

- `POST /api/rebalance-meal`: deterministic portion solver.
- `POST /api/produce-swap-options`: fruit/vegetable cycle swap.

Main edit flows:

- Change grams locally: `updateFoodRow()`/input handlers update state and totals without API calls.
- Try another ready meal: `handleCycleMealOption()` uses the current `mealOptions` returned by plan generation.
- Add/remove/swap food: action-panel functions build attempted items and call `attemptGuidedRebalance()`.
- Deterministic rebalance: `attemptGuidedRebalance()` calls `/api/rebalance-meal`; on success it either applies immediately or shows a proposal.
- Produce cycle: `handleCycleProduceSwap()` calls `/api/produce-swap-options`.
- Apply proposal: `applyProposal()` and `applyMealItems()` update meal state, re-render row/card, refresh daily flags.

### 8. User saves the generated plan

Frontend files:

- `public/js/app.js:showPlanSaveBar()`: save newly generated plan.
- `public/js/app.js:showEditBar()`: update existing saved plan.
- `public/js/app.js:buildPlanData()`: builds the JSON persisted in PostgreSQL.
- `public/js/app.js:buildCustomerPayload()`: links or creates customer metadata while saving.

Backend files:

- `src/routes/planRoutes.js`: `POST /api/plans`, `PUT /api/plans/:id`.
- `src/routes/folderRoutes.js`: `POST /api/folders/:id/plans`.
- `src/controllers/planController.js`: create/update/delete/duplicate/set active handlers.
- `src/controllers/folderController.js`: folder-scoped save handler.
- `src/repositories/planRepository.js`: creates/updates plan rows in a transaction.
- `src/repositories/customerRepository.js`: resolves selected customer by ID/name, creates if needed, syncs touched profile fields, handles active-plan ownership.
- `src/models/Plan.js`, `src/models/Customer.js`, `src/models/Folder.js`: DB mappings.

Save sequence for a new plan:

1. `showPlanSaveBar()` decides save URL: `/api/plans` for General, `/api/folders/:id/plans` for folder save.
2. User clicks Save plan.
3. `validatePreGenerationSaveDetails()` checks plan name and customer details.
4. `buildPlanData()` builds persisted JSON:
   - `input`
   - `dailyTargets`
   - `dailyActuals`
   - `meals[]`
   - each meal's target, original items, current items, alternatives, meal options, totals, ready-meal metadata
5. Frontend sends `{ name, planData, customer, isActive }`.
6. `planController.createPlanHandler()` or `folderController.savePlanInFolder()` validates required fields.
7. `planRepository.createPlan()` verifies folder ownership if needed.
8. `customerRepository.resolveCustomerForPlan()` links existing customer, creates a new customer, or leaves plan unlinked.
9. If `isActive` is true, `unsetActivePlansForCustomer()` clears other active plans for that customer.
10. Sequelize creates `plans` row with `plan_data` JSONB.
11. Browser shows saved message, then redirects to `/dashboard`.

Save sequence for an existing plan:

1. `/planner?planId=<id>` calls `GET /api/plans/:id`.
2. Backend marks `last_opened_at`.
3. Browser populates form and customer picker from saved plan.
4. `showEditBar()` sends `PUT /api/plans/:id` with updated `{ name, planData, customer, isActive }`.
5. `planRepository.updatePlan()` updates row, folder/customer/active state as requested.

## Endpoint Map

All mounted by `src/app.js`.

| Method | Path | Auth | Route file | Controller | Purpose |
|---|---:|---|---|---|---|
| GET | `/api/health` | No | `generationRoutes.js` | `health` | Health check |
| GET | `/api/foods` | No | `generationRoutes.js` | `getFoodsHandler` | Food list |
| GET | `/api/preferences` | No | `generationRoutes.js` | `getPreferences` | Food/category/allergen options |
| POST | `/api/generate-plan` | Yes | `generationRoutes.js` | `generatePlanHandler` | Generate plan |
| POST | `/api/rebalance-meal` | Yes | `generationRoutes.js` | `rebalanceMealHandler` | Deterministic meal solver |
| POST | `/api/produce-swap-options` | Yes | `generationRoutes.js` | `produceSwapOptionsHandler` | Fruit/vegetable swap cycle |
| GET | `/api/auth/firebase-config` | No | `authRoutes.js` | `getFirebaseConfig` | Browser Firebase config |
| POST | `/api/auth/session` | No | `authRoutes.js` | `createSession` | Create Firebase session cookie |
| POST | `/api/auth/register` | No | `authRoutes.js` | `legacyPasswordAuthDisabled` | Disabled compatibility endpoint |
| POST | `/api/auth/login` | No | `authRoutes.js` | `legacyPasswordAuthDisabled` | Disabled compatibility endpoint |
| POST | `/api/auth/logout` | No | `authRoutes.js` | `logout` | Clear session, revoke refresh tokens if possible |
| GET | `/api/auth/me` | Yes | `authRoutes.js` | `getMe` | Current app user |
| DELETE | `/api/auth/me` | Yes | `authRoutes.js` | `deleteUserHandler` | Delete app and Firebase user |
| GET | `/api/dashboard` | Yes | `dashboardRoutes.js` | `getDashboard` | Dashboard summary |
| GET | `/api/customers` | Yes | `customerRoutes.js` | `listCustomersHandler` | Customer search/list |
| GET | `/api/customers/match` | Yes | `customerRoutes.js` | `matchCustomerHandler` | Exact customer-name match |
| GET | `/api/customers/:id/plans` | Yes | `customerRoutes.js` | `getCustomerPlansHandler` | Customer detail plans |
| DELETE | `/api/customers/:id` | Yes | `customerRoutes.js` | `deleteCustomerHandler` | Delete customer |
| GET | `/api/folders/tree` | Yes | `folderRoutes.js` | `getTree` | Folder picker tree |
| GET | `/api/folders` | Yes | `folderRoutes.js` | `getRootContentsHandler` | Root folders/plans |
| POST | `/api/folders` | Yes | `folderRoutes.js` | `createFolderHandler` | Create folder |
| GET | `/api/folders/:id/breadcrumb` | Yes | `folderRoutes.js` | `getBreadcrumbHandler` | Breadcrumb path |
| GET | `/api/folders/:id` | Yes | `folderRoutes.js` | `getFolderContentsHandler` | Folder contents |
| PATCH | `/api/folders/:id` | Yes | `folderRoutes.js` | `renameFolderHandler` | Rename folder |
| DELETE | `/api/folders/:id` | Yes | `folderRoutes.js` | `deleteFolderHandler` | Delete folder |
| POST | `/api/folders/:id/plans` | Yes | `folderRoutes.js` | `savePlanInFolder` | Save plan inside folder |
| POST | `/api/plans` | Yes | `planRoutes.js` | `createPlanHandler` | Save root/general plan |
| GET | `/api/plans/:id` | Yes | `planRoutes.js` | `getPlan` | Load saved plan and mark opened |
| PUT | `/api/plans/:id` | Yes | `planRoutes.js` | `updatePlanHandler` | Save edits |
| DELETE | `/api/plans/:id` | Yes | `planRoutes.js` | `deletePlanHandler` | Delete plan |
| POST | `/api/plans/:id/duplicate` | Yes | `planRoutes.js` | `duplicatePlanHandler` | Duplicate plan |
| POST | `/api/plans/:id/active` | Yes | `planRoutes.js` | `setPlanActiveHandler` | Make customer-linked plan active |

## File Inventory And Roles

### Root and deployment

| File | Role |
|---|---|
| `package.json` | App metadata, scripts, runtime dependencies. Important scripts: `start`, `dev`, `check`, full `test`. |
| `package-lock.json` | Locked npm dependency tree. Library file, do not hand-edit. |
| `.env.example` | Public template for required env vars. |
| `.env`, `.env.local`, `.vercel.env`, `.northflank-env.json` | Local/deployment secrets/config. Useful but should be treated carefully. |
| `vercel.json` | Vercel serverless rewrite to `api/index.js`, Firebase auth handler rewrite, includeFiles list. |
| `api/index.js` | Vercel entrypoint exporting `src/app`. |
| `ecosystem.config.cjs` | PM2 production process config. |
| `.vercel/README.txt`, `.vercel/project.json` | Vercel local metadata. Library/tooling state. |
| `.vercelignore` | Vercel ignore rules. |
| `.gitignore` | Git ignore rules. |
| `.claude/launch.json` | Local editor/tool config. Not runtime. |

### Express app

| File | Role |
|---|---|
| `src/server.js` | Local/PM2 server entrypoint. Authenticates DB before listening. |
| `src/app.js` | Express composition: middleware, route prefixes, static folders, page routes, error handler. |
| `src/middleware/auth.js` | Firebase session/Bearer verification, app user lookup, `requireAuth`. |
| `src/middleware/errorHandler.js` | Converts thrown errors into JSON errors. |

### Config

| File | Role |
|---|---|
| `src/config/database.js` | Sequelize PostgreSQL connection, SSL decision, pool config. |
| `src/config/firebaseAdmin.js` | Firebase Admin initialization and private-key cleanup. |
| `src/config/nutritionConstants.js` | Nutrition constants, Mifflin-St Jeor constants, macro tolerances, and meal distributions. |
| `src/config/preferenceTaxonomy.js` | Allergen/category/food preference taxonomy, option builder, token normalizer, semantic expansion. |

### Routes

| File | Role |
|---|---|
| `src/routes/authRoutes.js` | Auth endpoints. |
| `src/routes/generationRoutes.js` | Foods/preferences/generation/rebalance/meal-edit endpoints. |
| `src/routes/dashboardRoutes.js` | Dashboard endpoint. |
| `src/routes/customerRoutes.js` | Customer list/match/detail/delete endpoints. |
| `src/routes/folderRoutes.js` | Folder tree/content/CRUD/folder save endpoints. |
| `src/routes/planRoutes.js` | Plan CRUD/duplicate/active endpoints. |

### Controllers

| File | Role |
|---|---|
| `src/controllers/authController.js` | Firebase config/session/logout/current-user/delete-user response logic. |
| `src/controllers/generationController.js` | HTTP wrapper around generation, deterministic rebalance, and produce swaps. |
| `src/controllers/dashboardController.js` | Thin dashboard JSON handler. |
| `src/controllers/customerController.js` | Thin customer JSON handlers. |
| `src/controllers/folderController.js` | Folder JSON handlers plus folder-scoped plan save. |
| `src/controllers/planController.js` | Plan JSON handlers. |

### Services

| File | Role |
|---|---|
| `src/services/firebaseAuthService.js` | Auth-domain business rules, profile extraction, public Firebase config. |
| `src/services/nutritionService.js` | Core macro math: BMR, maintenance, goal calories, macro ranges, meal splitting, macro summing. |
| `src/services/planGenerator.js` | Main generation engine and deterministic meal-edit solver. Biggest backend file. |

### Repositories

| File | Role |
|---|---|
| `src/repositories/foodRepository.js` | Loads `used_food_repository/foods.json`, normalizes fields, attaches icon URLs, caches in memory. |
| `src/repositories/readyMealRepository.js` | Loads `ready_meals/meals.json`, maps ready meal bundles into components, validates data. |
| `src/repositories/userRepository.js` | Internal user lookup/sync/delete with Sequelize transactions. |
| `src/repositories/planRepository.js` | Plan create/read/update/delete/duplicate/active state, customer resolution, folder validation. |
| `src/repositories/folderRepository.js` | Folder tree/content/CRUD queries. |
| `src/repositories/customerRepository.js` | Customer lookup, profile sync, plan summaries, customer delete. |
| `src/repositories/dashboardRepository.js` | Dashboard stats/recent plans/customer summaries. |

### Models

| File | Role |
|---|---|
| `src/models/User.js` | Sequelize model for `users`. |
| `src/models/Folder.js` | Sequelize model for `folders`. |
| `src/models/Plan.js` | Sequelize model for `plans`. |
| `src/models/Customer.js` | Sequelize model for `customers`. |
| `src/models/index.js` | Defines model associations and exports models. |

### Frontend pages

| File | Role |
|---|---|
| `public/index.html` | Home page with inline auth-aware nav and CTA behavior. Contains stale JWT/password marketing text. |
| `public/login.html` | Login page shell. |
| `public/register.html` | Registration page shell. |
| `public/planner.html` | Planner form, result containers, summary template, meal-card template. |
| `public/dashboard.html` | Dashboard shell. |
| `public/customer.html` | Single-customer detail shell. |
| `public/explorer.html` | Folder/plan explorer. Contains all its JS inline instead of in `public/js`. |
| `public/css/styles.css` | Single global stylesheet for every page. Large shared UI file. |

### Frontend JavaScript

| File | Role |
|---|---|
| `public/js/auth.js` | Firebase browser auth, email signup/login, Google auth, forgot password, password strength UI. |
| `public/js/app.js` | Planner app: auth guard, form read/render, generation fetch, meal state, meal edits, rebalance, alternatives, save/update, preference picker, PDF export. |
| `public/js/dashboard.js` | Dashboard stats/customers/general plans/menu/delete behavior. |
| `public/js/customer.js` | Single customer plan list, delete/duplicate plan behavior. |

### Runtime data

| File or folder | Role |
|---|---|
| `used_food_repository/foods.json` | Main nutrition food database. Runtime-critical. |
| `ready_meals/meals.json` | Current ready-meal bundle source used by the generator. Runtime-critical. |
| `icons/*.png` | Food icons served from `/food-icons`. Runtime UI assets. |
| `new_stage_data/*.xlsx`, `new_stage_data/neww/*.xlsx` | Source spreadsheets for data import/build process. Not read by runtime server. |

### Database setup and migrations

| File | Role |
|---|---|
| `scripts/db/setup.sql` | Current full database schema setup. |
| `migrations/001_bigint_ids.sql` | Historical destructive migration to BIGSERIAL/BIGINT. |
| `migrations/002_root_plans.sql` | Allows root/general plans. |
| `migrations/003_customers.sql` | Adds customers and active plan fields. |
| `migrations/004_plan_last_opened.sql` | Adds `last_opened_at`. |
| `migrations/005_firebase_auth.sql` | Adds Firebase UID/email and nullable password hash. |
| `scripts/db/runFirebaseAuthMigration.js` | Runs Firebase auth migration from Node. |

### Data pipeline and tests

| File or folder | Role |
|---|---|
| `filtering_data/` | USDA/source-data filtering workspace. Not runtime. |
| `filtering_data/clean.py` | Filters raw USDA CSVs into curated ingredient CSV. |
| `filtering_data/README.md` | Instructions for data filtering workspace. |
| `scripts/data/enrichFoodData.js` | Data enrichment script for food metadata. |
| `scripts/data/import_neww_database.py` | Imports new spreadsheet data into JSON assets. |
| `scripts/test*.js`, `test-solver.js` | Script-style tests for auth migration, DB sync, generation quality, optimizer, customers, deterministic generation. |
| `scripts/deploy/oracle-setup.sh` | Oracle deployment setup helper. |

### Docs and archived material

| File or folder | Role |
|---|---|
| `README.md` | Project overview. Some counts/routes/auth claims are stale. |
| `docs/architecture.md` | Older architecture deep dive. Useful background but stale around auth and some file names. |
| `docs/oracle-deploy.md` | Oracle deployment notes. |
| `docs/nutrition_coaching_rules_v9.md` | Nutrition rule reference/audit input. Not directly imported by app. |
| `docs/nutrition_coaching_rules_v9.textClipping` | macOS clipping artifact, likely cleanup candidate. |
| `legacy/flutter-app/` | Archived Flutter app. Not connected to web runtime. |
| `output/pdf/nutrition_rules_v9_audit_report.pdf` | Generated report artifact. Not runtime. |
| `july 31 fixeds.pdf`, `pp.txt` | Loose artifacts. Not runtime unless you know they are personal references. |

## Cleanup And Unused-Looking Flags

These are static-analysis findings, not deletion instructions. Verify with tests and your own reading before removing.

### High confidence cleanup candidates

- `.DS_Store`, `new_stage_data/.DS_Store`, `new_stage_data/neww/.DS_Store`, `output/.DS_Store`: macOS artifacts.
- `filtering_data/filtering_data.lastversion_data.xlsx-autosaveods`: autosave artifact.
- `docs/nutrition_coaching_rules_v9.textClipping`: macOS clipping artifact.
- `public/index.html` feature text about hashed passwords/JWT: stale and misleading.
- `README.md` and `docs/architecture.md`: both have stale auth details and older file counts. Keep or update, but do not trust as source of truth.

### Compatibility endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`

These intentionally return `410` through `legacyPasswordAuthDisabled`. Keep only if you want compatibility/error messaging for old clients.

### Exports/functions that look app-unused

- `src/repositories/userRepository.js`: `findUserById` and `updateLastLogin` are exported but not used by app code. `findUserByEmail` is used by tests.
- `src/repositories/planRepository.js`: `getPlansByFolder` is exported but not used by app code.
- `src/services/nutritionService.js`: many exported helpers are useful for tests and generation internals, but not all are used by app code directly.

### Areas to review before deleting

- `legacy/flutter-app/`: safe to ignore for web behavior, but keep if you want historical reference.
- `filtering_data/`: safe to ignore during runtime debugging, but keep if you need to rebuild food data.
- `output/`, loose PDFs, and `pp.txt`: artifact/reference area, not runtime.

## Suggested Reading Order

To understand the app with minimum pain:

1. `src/app.js`
2. `src/server.js`
3. `src/routes/authRoutes.js`, `src/controllers/authController.js`, `src/middleware/auth.js`, `src/services/firebaseAuthService.js`
4. `public/js/auth.js`
5. `public/dashboard.html`, `public/js/dashboard.js`, `src/repositories/dashboardRepository.js`
6. `public/planner.html`, then the top of `public/js/app.js`
7. In `public/js/app.js`, read these in order: auth guard, `readForm`, `generateAndRender`, `renderPlan`, `buildPlanData`, `showPlanSaveBar`, `showEditBar`
8. `src/routes/generationRoutes.js`, `src/controllers/generationController.js` first 120 lines
9. `src/services/nutritionService.js`
10. `src/services/planGenerator.js` in chunks: input normalization, food filtering, ready meal candidate building, solver/rebalance exports
11. `src/repositories/foodRepository.js`, `src/repositories/readyMealRepository.js`
12. `src/repositories/planRepository.js`, `src/repositories/customerRepository.js`
13. `src/models/*.js` and `scripts/db/setup.sql`
14. Only then read data pipeline, old template/swap system, and legacy Flutter reference.

## Mental Model For The Important Data Shapes

Generated plan response:

```text
{
  input,
  dailyTargets,
  nutritionCalculation,
  meals: [
    {
      name,
      tag,
      target,
      totals,
      items,
      originalItems,
      mealOptions,
      templateId/readyMealId metadata
    }
  ],
  diagnostics?,
  warnings?,
  errors?
}
```

Saved plan database row:

```text
plans {
  id,
  user_id,
  folder_id,
  customer_id,
  name,
  plan_data,       // the full generated/edited plan JSON
  is_active,
  last_opened_at,
  created_at,
  updated_at
}
```

Planner client state:

```text
dailyTargets = plan.dailyTargets
currentPlanInput = plan.input
mealStates[] = editable browser-side version of plan.meals[]
```

## Where Optimization Actually Lives

- Daily target math: `src/services/nutritionService.js`
- Input validation and restrictions: `src/services/planGenerator.js:normalizeInput`, `filterFoods`
- Ready meal loading: `src/repositories/readyMealRepository.js`
- Food macro records: `src/repositories/foodRepository.js`
- Candidate solving: `src/services/planGenerator.js:solveReadyMealCandidate`, `findBestPortionGridFit`
- Daily candidate selection: `selectReadyMealDayCombination`
- Meal edit rebalance: `rebalanceMeal`
- Frontend daily red flags: `public/js/app.js:refreshRedFlags`
- Persisted edited output: `public/js/app.js:buildPlanData`
