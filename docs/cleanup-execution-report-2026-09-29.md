# Codebase cleanup execution report

Date: 2026-09-29  
Result: completed and fully tested

## Completed cleanup

- Removed hidden Folder/Explorer pages and APIs, the obsolete standalone customer page, plan duplication, customer match, and their controllers/repositories/models.
- Removed Ramadan mode, alternate diet modes, custom-food creation/compatibility, duplicate preference fields, hidden nutrition knobs, and corresponding CSS/metrics/schema branches.
- Removed unused frontend solver/proposal code, old dashboard renderers, unused backend functions/exports, the disconnected food-swap index and builder, prototypes, generated reports, prompts, and stale mockup assets.
- Reorganized backend code by feature under `src/features/{auth,customers,dashboard,planner,plans}` and browser code under `public/js/<feature>` with shared utilities under `public/js/shared`.
- Replaced stale architecture documentation and created explicit product/API allowlists.
- Added ESLint, complete JavaScript syntax coverage, route-contract tests, an automatic browser-test server, and CI execution of the full suite.
- Narrowed deployment inputs so local experiments, tests, reports, agent material, and unrelated artifacts are not shipped.

## Explicitly preserved

- `testing_data/` remains local, unchanged, ignored by Git, and excluded from Vercel.
- `used_food_repository/foods.json` and `ready_meals/meals.json` were not modified.
- No database row, table, column, index, grant, role, policy, migration, or connection setting was changed.
- Existing authentication, ownership authorization, CSRF/CSP, rate limits, secure sessions, revocation, bounded validation, account-deletion recovery, readiness, logging, and protected metrics remain in place.
- Account deletion still removes legacy folder records owned by the deleting user. That private cleanup query is intentionally retained so abandoned database data is not left behind.
- Legacy database columns may remain physically present, but they are no longer exposed or written by the application model/API.

## Read-only legacy-data check

The production-compatible read-only count found 109 plans, including one historically foldered plan, with zero active Ramadan plans, zero actual custom-food plans, and zero non-standard diet plans. No data was altered. The historical foldered plan remains accessible through the normal general-plan flow because plan ownership and lookup are independent of folder routing.

## Verification

- `npm run check`: passed (77 JavaScript files plus ESLint).
- `npm test`: passed, 55/55 tests.
- Tests cover sessions and revocation, CSRF/origin checks, strict current-plan schemas, route retirement, generator workers, swaps, autosave URLs, customer assignment, mobile food search, plan loading, metrics protection, and browser behavior.
- `npm audit --omit=dev` still reports nine moderate transitive `uuid` advisories through Sequelize/Firebase dependencies. The suggested forced fix would downgrade Sequelize across a breaking major version, so it was not applied as part of this cleanup.

## Maintenance rule

Only features listed in `PRODUCT.md` and endpoints listed in `docs/api-surface.md` belong in production. Any expansion must update those allowlists and their contract tests in the same change.
