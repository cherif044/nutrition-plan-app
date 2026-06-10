# filtering_data

Raw USDA FoodData Central dataset used to build `data/foods.json`.

## What this directory is

These files were downloaded from the [USDA FoodData Central](https://fdc.nal.usda.gov/download-foods)
SR Legacy dataset. They are the source of truth for macro values (calories, protein, carbs, fat)
in the app's food database.

## Files

| File | Description |
|---|---|
| `food.csv` | Master food list with FDC IDs and descriptions |
| `food_nutrient.csv` | Per-food nutrient values (joined with `nutrient.csv` to get macros) |
| `nutrient.csv` | Nutrient lookup table (nutrient IDs → names/units) |
| `food_category.csv` | USDA food category labels |
| `food_portion.csv` | Standard portion sizes per food |
| `food_nutrient_*.csv` | Nutrient derivation/source metadata |
| `filtered_ingredients.csv` | Output of `clean.py` — the 95 foods selected for the app |
| `filter_stats.json` | Stats from the last `clean.py` run |
| `lastversion_data.xlsx` | Annotated spreadsheet used during manual food curation |
| `clean.py` | Filter script — reads raw CSVs, selects foods, outputs `filtered_ingredients.csv` |
| `prompt.txt` | Developer notes / architecture prompts for this project |

## Pipeline

```
USDA CSVs (this directory)
    ↓
python clean.py
    ↓
filtered_ingredients.csv   ← 95 curated foods with macro values
    ↓
(manual step: verify / adjust in lastversion_data.xlsx)
    ↓
node scripts/data/enrichFoodData.js
    ↓
data/foods.json            ← final food database loaded by the app
```

## When to re-run

Only needed if you are **adding, removing, or changing foods** in the database:

1. Edit `clean.py` filters or the source CSVs.
2. Run `python filtering_data/clean.py` from the project root.
3. Review `filtered_ingredients.csv`.
4. Run `node scripts/data/enrichFoodData.js` to merge category/allergen metadata.
5. Verify `data/foods.json` looks correct, then restart the server.

You do **not** need to re-run this for normal development.
