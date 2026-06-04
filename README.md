# Nutrition Plan Web

A Node.js/Express website for generating nutrition plans from local food data.

The original Flutter project is archived in `legacy/flutter-app/`. The top-level repo is now organized around the Node.js/Express website.

## Project Structure

```text
.
|-- data/                  # Website data files
|   `-- foods.json
|-- public/                # Static browser assets
|   |-- css/
|   |-- js/
|   `-- index.html
|-- src/
|   |-- app.js             # Express app composition
|   |-- server.js          # HTTP server entrypoint
|   |-- config/            # Nutrition and meal-split constants
|   |-- data/              # Data loading/repository layer
|   |-- middleware/        # Express middleware
|   |-- routes/            # API routes
|   `-- services/          # Nutrition plan generation logic
|-- legacy/
|   `-- flutter-app/       # Original Flutter app kept for reference
|-- package.json
`-- package-lock.json
```

## Getting Started

```bash
npm install
npm start
```

Open `http://localhost:3000`.

For development with automatic restart:

```bash
npm run dev
```

## Scripts

- `npm start` starts the Express website.
- `npm run dev` starts the website with Node watch mode.
- `npm run check` runs JavaScript syntax checks.

## API

- `GET /api/health`
- `GET /api/foods`
- `GET /api/preferences`
- `POST /api/generate-plan`

## Food Metadata

Food filtering uses semantic metadata in `data/foods.json`:

- `allergens` are strict allergy tags such as `fish`, `shellfish`, `milk`, `gluten`, `peanut`, and `tree_nut`.
- `categories` are broader preference tags such as `seafood`, `poultry`, `red_meat`, `bread`, `legumes`, and `vegetable`.
- `meal_tags` controls which meals a food can appear in.
- `min_serving_g` and `max_serving_g` keep generated portions within realistic ranges.
- Allergy and dislike inputs are discrete selections from `/api/preferences`; unknown free-text values are rejected.

Run this after changing the food list to reapply category metadata:

```bash
node scripts/enrichFoodData.js
```
# nutrition-plan-app
