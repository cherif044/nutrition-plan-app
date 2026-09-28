# Pinch Nutrition Planner

Pinch is an Express and vanilla-JavaScript application for generating, editing, saving, and exporting personalized nutrition plans.

The supported product is deliberately narrow. See [PRODUCT.md](PRODUCT.md) for the page and feature allowlist and [docs/api-surface.md](docs/api-surface.md) for every production HTTP surface.

## Project structure

```text
api/                       Vercel function entry points
public/
  css/styles.css           Shared application stylesheet
  js/
    account/               Account page behavior
    auth/                  Login and registration behavior
    dashboard/             Dashboard, customers, plans, and customer detail
    landing/               Public landing page
    planner/               Plan generation and editing UI
    shared/                Browser utilities used across pages
ready_meals/meals.json     Curated ready-meal definitions (protected data)
src/
  features/                Product code grouped by business capability
    auth/
    customers/
    dashboard/
    planner/
    plans/
  config/                  Runtime configuration and nutrition constants
  middleware/              Authentication, validation, rate limits, and security
  models/                  Sequelize models
  services/                Cross-feature services
  shared/                  Small shared persistence helpers
  utils/                   Logging, metrics, errors, and infrastructure helpers
  validation/              Request and persisted-plan schemas
tests/                     Unit, contract, security, and browser tests
used_food_repository/
  foods.json               Curated food catalog (protected data)
testing_data/              Local-only testing material; excluded from deployment
```

Feature directories keep their HTTP route, controller, persistence, and domain logic together. Cross-cutting security stays centralized under `src/middleware`.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required production secrets and database settings are documented in `.env.example`. This cleanup does not require a database migration or data rewrite.

## Verification

```bash
npm run check   # syntax and ESLint
npm test        # check plus the complete Playwright suite
```

The Playwright configuration starts its own static server for browser tests. CI runs `npm test` so route-contract and security regressions block merging.

## Data policy

- Do not casually edit `used_food_repository/foods.json` or `ready_meals/meals.json`; they are active product inputs.
- Keep `testing_data/` local and out of deployment artifacts.
- A new page, route, or product mode must be added to `PRODUCT.md`, `docs/api-surface.md`, and the route-contract tests.
- Database schema and stored data changes require a separate reviewed migration; they are not part of code cleanup.
