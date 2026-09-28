# Codebase Cleanup Audit and Implementation Plan

Date: 2026-09-29  
Scope: current working tree, current Vercel deployment, application/runtime code, public assets, tests, scripts, data, and repository artifacts.  
Status: implemented on 2026-09-29. This file preserves the original audit and rationale; see `cleanup-execution-report-2026-09-29.md` for the completed scope and verification.

> The original pre-implementation observations below are historical. The cleanup added full syntax/lint coverage, a managed browser-test server, strict route-contract tests, and completed the read-only legacy-data counts without changing the database.

## Executive verdict

The application has a clear current product: landing, authentication, dashboard, customers inside the dashboard, planner, PDF export, and account management. The repository still contains three kinds of residue:

1. **Hidden product surfaces still mounted in production**: the folder explorer and the old standalone customer page are not linked from the deployed navigation, but their pages and APIs remain reachable by direct URL.
2. **Former or compatibility-only capabilities accepted by the API**: Ramadan fields/tags, non-standard diet modes, distinct allergy/dislike inputs, custom-food compatibility, folder saves, plan duplication, and caller shapes the current frontend never sends.
3. **Ordinary dead code and repository clutter**: unused functions, an unused precomputed food-swap database, old prototypes, stale reports/prompts, and repeated CSS generations. The 5.9 GB local experiment workspace is intentionally preserved and is outside the cleanup scope.

The deletion should be done in layers. The immediate dead-code list below is low risk. Hidden features that may have persisted data need a read-only usage check before their code is removed. Operational and security code must not be deleted merely because it has no visible button: authentication, CSRF/CSP, rate limits, account-deletion recovery, readiness, metrics, migrations, and tests are legitimate non-UI dependencies.

## Non-negotiable cleanup constraints

- This is a **code-only cleanup**. Do not change database rows, tables, columns, indexes, grants, roles, policies, or migrations.
- Do not edit active application datasets, including `foods.json`, meal JSON, or saved-plan data.
- A standalone data file may be deleted only after proving no runtime, test, migration, or deployment process reads it. This currently applies to the disconnected generated `food_swaps.json`; it does not apply to `foods.json` or meal data.
- If read-only inspection finds legacy records that need old parsing behavior, keep the smallest possible read-only compatibility adapter in a clearly named `legacy` module. Reject creation of new legacy states at the API boundary.
- Preserve all security controls and operational safeguards. The cleanup may narrow APIs and strengthen validation, but must not weaken authentication, authorization/ownership checks, CSRF/CSP, rate limits, secure cookies, session revocation, database access policy, account-deletion recovery, readiness, or protected metrics.

## Audit basis and limitations

- The production landing page at `https://pincherize.vercel.app/` was verified. Direct navigation to `/explorer` is still accepted and then redirects an unauthenticated user to login, confirming that the legacy surface remains deployed.
- The current source-defined UI was traced from every `public/*.html` script into its `fetch()` calls, Express route mounts, controllers, repositories, services, schemas, and data files.
- The working tree is heavily modified and contains untracked account/security work. This report describes the filesystem as it exists now; it does not assume every local change is already deployed.
- `npm run check` passes, but that command only syntax-checks code and omits some current browser files such as `account.js` and `landing.js`.
- The non-browser portion of the Playwright run passed 46 tests. A normal `npx playwright test` does not start a web server, so six UI tests fail with `ERR_CONNECTION_REFUSED`; this is a test-harness configuration gap, not six product failures. With a temporary static server, the exercised planner UI tests passed.
- No production database was queried. Any deletion involving saved-plan JSON or folders must begin with the read-only inventory described below; the database itself remains unchanged.

## Current product surface to retain

### Pages

- `/` — landing page
- `/login` and `/register` — Firebase authentication
- `/dashboard` — home, customer list/create/edit/detail, and general plans
- `/planner` — generate, load, edit, save, delete, and export plans
- `/account` — password change, sign out everywhere, and account deletion

### Product APIs used by that UI

- Auth: `/api/auth/firebase-config`, `/session`, `/client-event`, `/logout`, `/logout-all`, `/me`
- Dashboard: `/api/dashboard`, `/api/dashboard/customers`, `/api/dashboard/plans`
- Customers: `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/:id`, `GET /api/customers/:id/plans`
- Plans: `POST /api/plans`, `GET/PUT/DELETE /api/plans/:id`, `POST /api/plans/:id/opened`, `GET /api/plans/:id/export.pdf`
- Planner: `/api/foods`, `/api/preferences`, `/api/generate-plan`, `/api/rebalance-meal`, `/api/swap-suggestions`, `/api/generation-timeline`
- Browser/operations: `/api/vitals`, the CSP report route, the protected account-deletion cron, readiness/liveness, and protected metrics

## Deletion candidates

### A. High-confidence immediate deletions

These have no runtime caller in the current tree and do not need a data migration.

#### `public/js/app.js`

Delete these standalone dead declarations:

- `separator`
- local variables `customerSelect` and `hasCustomerSelection` in `validatePreGenerationSaveDetails`
- `manualModeControlHtml`
- `uniqueFoods`
- `compactRejectedProposal`

Delete the unused rebalance-preview branch:

- `handleDeterministicRebalance`
- `showProposal`
- `showDeclineRetry`
- `applyProposal`
- `formatMacroLine`
- the unused `retryContext` value and `pendingProposal` state/cleanup that becomes unnecessary

All live edit actions (`add_food`, `remove_food`, and `swap_food`) use the immediate-apply path. The only caller capable of entering the proposal-preview branch is the dead `handleDeterministicRebalance` function.

Delete the entire unused client-side solver subgraph; production rebalancing is performed by `/api/rebalance-meal`:

- `localRebalanceMeal`
- `localRebalanceSuccess`
- `findLocalChangedItemOnlyFit`
- `findLocalWholeMealDistributionFit`
- `findLocalBestPortionGridFit`
- `feasibleLocalQuantitiesForVariable`
- `findLocalBoundsViolation`
- `localMacroBoundFitScore`
- `localMealRankTuple`
- `localMacroBoundKeys`
- `servingGridCandidates`
- `servingStepCount`
- `localMacroLeverage`
- `emptyLocalMacroRange`
- `variableLocalMacroRange`
- `addLocalMacroRanges`
- `macrosForRates`
- `subtractTotals`
- `rangeMidpoint`
- `addTotals`
- `itemFromGuidedProposal`
- `foodFromCustom` (its only caller is `itemFromGuidedProposal`)

#### `public/js/dashboard.js`

Delete:

- `AVATAR_TONES`
- `planCalorieRangeKey`
- `emptyState`
- `customerDetailStats`
- `planRow`
- `detailTextValue`
- `renderGoalBar`
- `renderFilterChips`

These belong to older dashboard/card implementations; the current dashboard uses the `ph-*`, `pc-*`, `pd-*`, and `pp-*` renderers instead.

#### Backend functions

Delete:

- `src/services/planGenerator.js`: `calculateResidualScore`, `dailyTotalsWithinPlanBounds`, `mealOptionSignature`
- `src/services/nutritionService.js`: `calculateDailyTargets`, `splitMeals`, `scaleTargets`
- `src/services/firebaseAuthService.js`: `isEmailPasswordProvider`
- `src/repositories/userRepository.js`: `findUserByFirebaseUid`, `findUserByEmail`, `updateLastLogin`
- `src/repositories/foodRepository.js`: `loadFoodSwaps`, `swapCache`, `FOOD_SWAPS_PATH`, and the logger import used only by that dead loader

Also reduce public module APIs by removing exports that are only used inside their own module. Examples include `jwtSecretProblem`, `buildAllowedOrigins`, the customer-normalization helpers, `FOOD_ICON_ID_PATTERN`, `ICONS_DIR`, and most calculation helpers from `nutritionService`. Internal functions may remain; they should not be advertised as module API.

#### Unused swap index and stale build path

Delete:

- `used_food_repository/food_swaps.json` (about 0.4 MB; no runtime code reads it)
- `scripts/buildFoodSwaps.js`
- the `build:food-swaps` package script
- stale comments claiming `foodSwapService` reads the precomputed file

The current `foodSwapService` derives candidates directly from `foods.json`, so the generated swap index is wholly disconnected.

#### Active food and meal data

Do not modify `foods.json`, meal JSON, or their fields during this cleanup, even where a field currently appears unused. The cleanup may remove dead code around those datasets, but their contents and structure remain unchanged.

### B. Whole files/surfaces to remove after data confirmation

#### Old standalone customer page

The dashboard now contains customer detail, editing, assigned plans, deletion, and PDF actions. No current navigation links to the standalone page.

Remove:

- `public/customer.html`
- `public/js/customer.js`
- `app.get('/customers/:id', ...)`
- CSS used only by the standalone/older customer-detail implementation
- metrics route-normalization entries that mention `/customers/:id`

Do not remove `GET /api/customers/:id/plans`; the dashboard SPA uses it.

#### Folder explorer and folder API

The dashboard has no Explorer navigation and no folder-management UI. The directly reachable legacy page is the largest hidden product surface.

After a read-only usage check, remove the unreachable code surface while leaving all database data and schema untouched:

- `public/explorer.html`
- `public/js/explorer.js`
- `/explorer`
- all `/api/folders*` routes
- `src/routes/folderRoutes.js`
- `src/controllers/folderController.js`
- `src/repositories/folderRepository.js`
- `src/models/Folder.js` and model associations only if removing them does not affect current plan reads; otherwise keep a minimal private mapping
- `assertCanAddFolder`, folder quota/limit constants, and `folderBody`
- planner `folderId` URL handling and folder-specific save URL
- folder breadcrumb/tree/rename/delete UI and CSS

Do not flatten, update, or delete folder records, and do not drop `plans.folder_id` or the `folders` table. If historical foldered plans require legacy code to remain readable in the current planner, isolate only that read path and remove every write route and hidden page. Database grants and roles remain unchanged.

#### Plan duplication

`POST /api/plans/:id/duplicate` is called only by the two legacy pages above. The current dashboard and planner do not expose duplication.

Remove:

- route and `duplicatePlanBody`
- `duplicatePlanHandler`
- repository `duplicatePlan`
- duplicate-specific metrics normalization and documentation

#### Customer match endpoint

`GET /api/customers/match` has no frontend caller. The planner loads the current customer list and uses a native select.

Remove `customerMatchQuery`, `matchCustomerHandler`, the route, and any now-private repository export. Keep normalized-name matching used internally when a plan is saved.

### C. Former capabilities to remove from accepted API input

These branches are not represented in the current planner form. They increase maintenance and allow hand-written requests to invoke states the UI cannot create.

#### Ramadan compatibility

Remove all of the following together:

- `ramadanMode` from frontend defaults, `readForm`, populate/load logic, saved-plan schemas, and generation schemas
- `ramadanToggle` and `syncRamadanControls`
- `iftar`/`suhoor` icon and meal-tag aliases in frontend, generator, swap service, validation, metrics, and PDF rendering
- `ramadan` metrics label and observability docs
- all `.ramadan-card` CSS rules (nine detected rule occurrences)

Before deletion, perform only a read-only count of saved plans containing `input.ramadanMode`, `iftar`, or `suhoor`. Do not rewrite or archive them. If they exist and current-plan loading must remain compatible, preserve a narrowly isolated read adapter while rejecting Ramadan fields on all new writes.

#### Diet modes not exposed by the UI

The frontend always sends `dietType: 'standard'`; there is no selector for vegetarian or vegan.

Plan:

- stop accepting arbitrary `dietType`; inject `standard` on the server or require the literal value `standard`
- remove vegetarian/vegan filter branches and the unused dashboard `diet_type` summary data
- remove diet from generation metric labels
- after a read-only usage check, remove only the unused code branches; do not change `plans.diet_type`, `foods.json`, or any stored diet data

#### Duplicate preference shapes

The UI exposes one field: “Avoid foods.” It currently sends that same set as both `avoidFoods` and `dislikes`, while the backend also accepts `allergies`.

Keep one field, `avoidFoods`, and one validation/filtering path. Remove distinct `allergies`/`dislikes` request properties, duplicate taxonomy response arrays (`allergyOptions` and `dislikeOptions`), and the duplicated merge/error logic. Rename the response to `avoidFoodOptions` during the same coordinated frontend/backend change.

#### Hidden nutrition knobs

The current UI never sends `numberOfSnacks`, `proteinPerKg`, or `fatPerKg`. Remove them from request schemas. Keep the fixed server constants and derived snack count that current meal-count behavior needs.

#### Custom-food compatibility

There is no current control for creating a custom food. Custom-food handling remains in saved-plan validation, planner persistence, rebalance input, and generator item resolution.

First perform a read-only query for saved plan JSON containing `customFood` and `custom_*` ids. If none exist, remove the custom-food schema, aliases, payload builders, rendering branches, and generator resolution. If rows exist, preserve a narrowly isolated read-only legacy renderer; do not rewrite stored plans or keep accepting new custom foods through the API without a UI.

#### Swap API legacy/fallback shapes

The planner always sends `mealContext`. Remove the non-planner fallback that returns unvalidated suggestions without meal-fit checking. Make `mealContext` required. Remove response fields `matchPct` and `tier`, which the frontend does not render.

### D. Repository artifacts to delete or move outside the runtime repository

Safe to remove/archive because they are not routed, imported, or deployed product assets:

- `pinch-dashboard_4.html`
- `src/pinch-landing_2.html`
- `home.hbs`, `plans.hbs`, `customer-detail.hbs`
- `home.css`, `plans.css`, `customer-detail.css`
- `pp.txt`, `prompt.txt`
- `src/Pinch_UI_Polish_Report.docx`
- `codebase-documentation-report.pdf` and the superseded generated report/cleanup-plan files after this report is accepted
- `USDA_database/database.zip` if the source archive is retained elsewhere
- `test-solver.js` (stale expectation: it says two-meal plans must fail although the current UI explicitly offers two meals)
- `.DS_Store` files

`testing_data/` is ignored, local-only, and approximately **5.9 GB**. Keep this directory and its contents exactly as they are. Do not delete, move, rename, reorganize, or edit it during the cleanup. Continue excluding it from Git and production deployment.

`.agents/` is active local development tooling. `.claude/` appears to contain a second copy of the same skill. Keep only the harnesses the team actually uses, preferably installed globally or pinned once rather than duplicated in the application repository.

## CSS cleanup

`public/css/styles.css` is 13,402 lines and is an append-only history of multiple redesign passes. A static class scan found 131 class tokens with no HTML/JS reference; some dynamic class names are false positives, so do not bulk-delete solely from that list.

High-confidence dead CSS groups include:

- Ramadan card rules
- legacy standalone customer/explorer rules after those pages are removed
- old dashboard card systems such as `.dashboard-customer-card`, `.customer-detail-overview`, `.customer-detail-plans`, `.dashboard-action-grid`, and `.dashboard-stats`
- old shared landing/navigation groups such as `.site-nav`, `.topbar`, `.feature-card`, and `.stats-bar` where no current public page uses the shared stylesheet for those components
- obsolete save-customer autocomplete/result styles replaced by the native select
- obsolete proposal/decline UI styles after the dead preview branch is removed
- `.pdf-export-document`, `.food-item--edit`, and `.food-macros` groups with no current runtime reference

Do this by deleting a feature at a time and checking desktop/mobile screenshots; do not attempt a single selector purge.

## Secondary UI implementation health

This is not the primary purpose of the cleanup, but the detector results reinforce the need to consolidate the frontend.

| Dimension | Score | Main evidence |
|---|---:|---|
| Accessibility | 2/4 | verified low-contrast text, tiny functional text, and a skipped landing-page heading level |
| Performance | 2/4 | 13.4k-line global CSS, 4.1k-line planner JS, 1.2k-line dashboard JS, and duplicated/dead branches |
| Responsive design | 3/4 | dedicated responsive rules and mobile tests exist; shared CSS has accumulated conflicting generations |
| Theming | 2/4 | tokens exist, but many inline/hard-coded colors and page-specific visual systems remain |
| Implementation integrity | 1/4 | hidden deployed surfaces, legacy API shapes, and 149 detector findings (many repeated through shared CSS) |
| **Total** | **10/20** | **Acceptable, but significant consolidation is needed** |

Positive findings to preserve: authenticated state-changing routes are protected; schemas bound request sizes; same-origin, CSP, rate limiting, session revocation, account-deletion recovery, worker isolation, PDF validation, metrics, and database ownership checks are real production safeguards.

## Complete implementation plan

### Phase 0 — agree on the product allowlist

1. Approve the page/API list in “Current product surface to retain.”
2. Explicitly decide that folders, duplicate-plan, Ramadan, non-standard diets, and custom foods are retired.
3. Record the decision in a new `PRODUCT.md` and a short `docs/api-surface.md` containing product routes plus a separate operational allowlist.
4. Tag the repository before deletion. A database backup is optional defense-in-depth; no database write or schema operation is part of this plan.

### Phase 1 — make verification reliable

1. Change `npm test` to run syntax/lint/unit/integration tests, not only `node --check`.
2. Make syntax checks discover all `public/js/**/*.js` automatically.
3. Configure Playwright `webServer` so a clean `npx playwright test` starts the static/app server and is green without manual setup.
4. Add route contract tests that fail if an Express product route has neither a frontend caller nor an explicit `operations` classification.
5. Add ESLint `no-unused-vars` and an unused-export/dependency check suitable for CommonJS and browser modules.

### Phase 2 — low-risk deletion commit

1. Remove the immediate dead functions/constants listed above.
2. Remove the unused swap index, builder, package script, and stale comments.
3. Preserve active food and meal JSON exactly; delete only the disconnected generated swap index.
4. Remove loose prototypes and stale generated reports/prompts.
5. Run syntax, unit, route-contract, and browser tests; compare planner/dashboard desktop and mobile screenshots.

Keep this commit mechanical. Do not mix file reorganization into it.

### Phase 3 — read-only legacy-data compatibility check

Run a read-only database audit that reports:

- plans with non-null `folder_id`
- folder and nested-folder counts
- plans with `ramadanMode`, `iftar`, or `suhoor`
- plans with non-standard `dietType`
- plans containing `customFood` or `custom_*` ids
- client/request shapes still seen in logs for candidate endpoints

Do not migrate, rewrite, archive, or delete any rows, columns, or tables. Use the counts only to decide whether code can be removed completely or whether a small, clearly named read-only legacy adapter must remain. New API writes must reject retired fields.

### Phase 4 — remove hidden pages and endpoints

1. Delete the standalone customer page/JS/route.
2. Delete explorer page/JS, folder write APIs, unused model/repository/controller/routes, schema, quotas, and CSS while leaving folder rows, columns, tables, grants, and policies unchanged; retain only a minimal read path if the compatibility check proves it necessary.
3. Delete duplicate-plan and customer-match endpoints.
4. Remove their route labels, rate-limit exceptions if any, docs, and tests.
5. Confirm direct requests return 404, not a login redirect or a functioning API.

### Phase 5 — narrow the planner contract

1. Remove Ramadan input/tags/rendering/metrics/CSS in one coordinated change.
2. Fix new requests to `standard` and remove unused diet code branches without changing stored data or active JSON datasets.
3. Collapse preferences to `avoidFoods`.
4. Remove hidden protein/fat/snack request fields.
5. Remove custom-food acceptance after its data decision.
6. Require the exact swap context the UI sends and remove legacy response fields.
7. Prefer strict Zod objects for externally accepted product requests; reject unknown feature flags instead of silently carrying compatibility fields.

### Phase 6 — reorganize by feature

After deletion, move backend code into feature slices so each feature can be understood and removed locally:

```text
src/
  app.js
  platform/          database, firebase, logging, metrics, security, limits
  features/
    auth/            routes, controller, service, repository, schemas
    customers/       routes, controller, repository, schemas
    plans/           routes, controller, repository, PDF, schemas
    planner/         generation, nutrition, swaps, worker pool, schemas
  shared/            narrowly reused helpers only
```

Split the frontend into native ES modules without introducing a framework solely for organization:

```text
public/
  pages/             landing, auth, dashboard, planner, account HTML
  js/
    shared/          api client, DOM helpers, icons, pagination, telemetry
    dashboard/       route, state, customers, plans, menus, renderers
    planner/         state, form, generation, meal editor, save/export, preferences
    account/
    auth/
  css/
    tokens.css
    base.css
    components.css
    pages/            landing, auth, dashboard, planner, account
```

Rules:

- one canonical API wrapper and one error-response parser
- one nav/user control renderer rather than copies in planner/dashboard/account
- no feature file above roughly 400–600 lines without a clear reason
- colocate schemas with the route that consumes them
- keep service functions private unless another module imports them
- no `looseObject` for new externally accepted request shapes without a documented compatibility reason
- no CSS “polish pass” appended at the end; edit the owning component/page file

### Phase 7 — deployment hygiene and prevention

1. Make the Vercel package allowlist explicit: runtime source, current public assets, current data, and required PDF fonts only.
2. Exclude tests, docs, screenshots, agent skills, experiments, prototypes, archives, and local reports from deployment.
3. Keep operational routes in a named allowlist with owner, authentication, and purpose; do not classify them as dead merely because the UI does not call them.
4. Add CI checks for unused exports/dependencies, route ownership, migration safety, syntax/lint, tests, and bundle/static-asset size budgets.
5. Re-run the dead-code and UI audit after every phase, not only at the end.

## Recommended execution order

1. Phase 0 product decision and backup
2. Phase 1 reliable test harness
3. Phase 2 immediate dead code/data/artifact deletion
4. Phase 3 read-only legacy-data compatibility check
5. Phase 4 hidden surface/API removal
6. Phase 5 strict current-UI contract
7. Phase 6 file/module/CSS reorganization
8. Phase 7 deployment/CI guardrails
9. Final security review and UI smoke test

Do not combine all phases into one pull request. Use one reviewable commit/PR per phase, with deletions before movement/renaming, so regressions and rollback remain easy to understand.
