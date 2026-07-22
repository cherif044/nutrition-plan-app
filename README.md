# Nutrition Plan Web

A Node.js/Express web app for generating personalised nutrition plans from a curated food database.

The original Flutter project is archived in `legacy/flutter-app/`. The top-level repo is now
organised around the Node.js/Express backend + vanilla JS frontend.

---

## Project Structure

```
nutrition-plan-app/
├── data/                        # Static app data (loaded at runtime)
│   └── foods.json               # 95-food database with macros, categories, allergens
│
├── docs/                        # Developer documentation
│   └── architecture.md          # Full architecture guide, meal generation simulation
│
├── filtering_data/              # USDA food pipeline (run once to rebuild foods.json)
│   ├── README.md                # How to use this directory
│   ├── clean.py                 # Filters raw USDA CSVs → filtered_ingredients.csv
│   ├── *.csv                    # Raw USDA FoodData Central SR Legacy dataset
│   └── lastversion_data.xlsx    # Annotated curation spreadsheet
│
├── legacy/                      # Archived Flutter implementation (reference only)
│   └── flutter-app/
│
├── public/                      # Frontend — served as static files by Express
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js               # Planner UI logic
│   │   └── auth.js              # Login/register/session logic
│   ├── index.html               # Home / plan generator form
│   ├── planner.html             # Interactive meal plan editor
│   ├── explorer.html            # Folder/plan browser
│   ├── login.html
│   ├── register.html
│   ├── customer.html            # Single customer view
│   └── customers.html           # Customer list
│
├── scripts/                     # Developer tooling (not part of the server)
│   ├── db/
│   │   └── setup.sql            # Creates all PostgreSQL tables (run once)
│   └── data/
│       └── enrichFoodData.js    # Merges allergen/category metadata into foods.json
│
├── src/                         # Backend server (Node.js/Express)
│   ├── server.js                # HTTP server entry point
│   ├── app.js                   # Express app composition
│   ├── config/                  # Constants and DB pool
│   ├── middleware/              # Auth (JWT) and error handler
│   ├── routes/                  # URL → controller mapping (thin)
│   ├── controllers/             # Request/response handling
│   ├── services/                # Business logic (nutrition math, user validation)
│   └── repositories/           # Database and file I/O
│
├── .env.example                 # Environment variable template
├── package.json
└── package-lock.json
```

See `docs/architecture.md` for a deep-dive on every file, the meal generation algorithm,
and the auto-balance logic.

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, and GEMINI_API_KEY
```

For a hosted PostgreSQL database, use the provider connection string:

```bash
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
DB_SSL=true
```

If you are using a local PostgreSQL database instead, remove or comment out `DATABASE_URL`
and fill in the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` values.

For AI meal chat, create a Gemini API key in Google AI Studio and set:

```bash
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-3.1-flash-lite
```

`gemini-3.1-flash-lite` is the default because it is built for low-latency, high-volume app usage. Use a larger model only if you want higher reasoning quality and are okay with higher cost/latency.

### 3. Create the database

```bash
psql "postgresql://user:password@host/database?sslmode=require" -f scripts/db/setup.sql
```

### 4. Start the server

```bash
npm start
```

Open `http://localhost:3000`.

For development with auto-restart:

```bash
npm run dev
```

---

## NPM Scripts

| Command | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start with Node.js `--watch` (auto-restart on file change) |
| `npm run check` | Syntax-check all JS files in `src/`, `public/js/`, and `scripts/data/` |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| GET | `/api/foods` | — | Full food list |
| GET | `/api/preferences` | — | Allergen/category options |
| POST | `/api/generate-plan` | ✓ | Generate a nutrition plan |
| POST | `/api/auto-balance-meal` | ✓ | Balance a meal toward original values |
| POST | `/api/rebalance-meal` | ✓ | Rebalance a meal to a target |
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Log in |
| POST | `/auth/logout` | ✓ | Log out |
| GET | `/auth/me` | ✓ | Current user |
| GET/POST | `/folders` | ✓ | Folder CRUD |
| GET/PUT/DELETE | `/plans/:id` | ✓ | Plan CRUD |

---

## Food Database

Foods live in `data/foods.json` (95 items). Each food has:

- `macro_role` — `protein`, `carb`, `fat`, or `mixed`
- `meal_tags` — which meals this food can appear in (`breakfast`, `lunch`, `dinner`, `snack`, etc.)
- `categories` — broad preference tags (`poultry`, `seafood`, `red_meat`, `bread`, `legumes`, …)
- `allergens` — strict allergy tags (`fish`, `milk`, `gluten`, `peanut`, `tree_nut`, …)
- `min_serving_g` / `max_serving_g` — realistic portion bounds
- Macro values per 100g: calories, protein, carbs, fat

To add or change foods, see `filtering_data/README.md`.
To re-apply category/allergen metadata after editing foods: `node scripts/data/enrichFoodData.js`
