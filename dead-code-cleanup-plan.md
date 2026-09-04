# Dead Code Cleanup Plan

## Safe First Steps

- Keep all runtime files untouched until route/integration tests exist.
- Add tests that exercise each Express route, each public page's expected API calls, and plan generation edge cases.
- Add a static dependency check to CI so future unused exports are easier to confirm.
- Create a temporary `archive/` branch or tag before deleting loose artifacts.

## Likely Removable After Owner Confirmation

- `pinch-dashboard_4.html`: no detected route, import, or deployment reference. Treat as prototype/mockup.
- `pp.txt`: historical prompt text, not runtime.
- `src/Pinch_UI_Polish_Report.docx`: binary documentation artifact, not runtime.
- `USDA_database/database.zip`: archive/source data, not runtime for the app.
- `.DS_Store` files: OS artifacts.

## Needs Update Rather Than Deletion

- `test-solver.js`: keep only if converted into current expected behavior. It currently fails because the app allows 2-meal plans while the script expects rejection.
- `README.md` and `docs/*.md`: excluded from the generated code report, but they may be useful human docs. Update or archive separately because existing docs mention historical paths.

## Probably Unused Code, Test Before Removing

- `src/repositories/planRepository.js`: `getPlansByFolder` has no current app-code caller and does not take `userId`, so it is risky if used accidentally.
- `src/repositories/customerRepository.js`: `listCustomersWithPlanSummary` has no current app-code caller.
- `src/repositories/dashboardRepository.js`: `folderPathFor` has no current app-code caller.
- `src/repositories/userRepository.js`: `findUserByFirebaseUid`, `findUserByEmail`, `updateLastLogin`, and `incrementTokenVersion` have no current app-code caller.
- `public/js/app.js`: `addTotals`, `handleDeterministicRebalance`, `itemFromGuidedProposal`, and `compactRejectedProposal` had no local call hits.
- `public/js/dashboard.js`: `customerGoalKey` and `statusPill` had no local call hits.

## Do Not Touch Yet

- `api/index.js` and `api/plan-export.js`, because Vercel rewrites depend on them.
- All `src/routes/*`, `src/controllers/*`, `src/middleware/*`, and Sequelize models that are wired into Express.
- `used_food_repository/foods.json`, `ready_meals/meals.json`, and `icons/*.png`, because generation and UI/PDF rendering depend on them dynamically.
- `public/*.html`, `public/js/*.js`, and `public/css/styles.css`, because page routes and static serving depend on them.
- `src/services/nutritionService.js` exports, until tests confirm they are not part of the intended internal API.

## Suggested Cleanup Order

1. Add route/generation tests and data validation tests.
2. Fix or remove stale `test-solver.js` expectation.
3. Move confirmed loose artifacts to an archive location outside the runtime repo.
4. Remove no-hit frontend helpers one at a time with browser smoke tests.
5. Remove no-hit repository exports one at a time with backend tests.
6. Split large files after cleanup so refactors do not mix with deletion commits.

