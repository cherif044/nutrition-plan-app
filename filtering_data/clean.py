import pandas as pd
import json
import os
from datetime import datetime

# ============================================================
# PATH TO YOUR FOLDER CONTAINING ALL USDA CSV FILES
# ============================================================
DATA_DIR = os.path.expanduser("~/nutrition-plan-app/filtering_data")
# ============================================================

OUTPUT_CSV  = os.path.join(DATA_DIR, "filtered_ingredients.csv")
OUTPUT_JSON = os.path.join(DATA_DIR, "filter_stats.json")

print("Loading files...")
food          = pd.read_csv(os.path.join(DATA_DIR, "food.csv"))
food_nutrient = pd.read_csv(os.path.join(DATA_DIR, "food_nutrient.csv"))
food_category = pd.read_csv(os.path.join(DATA_DIR, "food_category.csv"))
food_portion  = pd.read_csv(os.path.join(DATA_DIR, "food_portion.csv"))

sr = food[food["data_type"] == "sr_legacy_food"].copy()

# ============================================================
# EXACT FDC_ID MAP — verified directly from the database
# Format: "display_name": fdc_id
# ============================================================
ITEMS = {

    # ── EGGS ─────────────────────────────────────────────────
    "Egg, whole, cooked, fried":              173423,
    "Egg, whole, cooked, hard-boiled":        173424,
    "Egg, whole, cooked, scrambled":          172187,
    "Egg, white, raw, fresh":                 172183,

    # ── POULTRY & MEAT ──────────────────────────────────────
    "Chicken breast, skinless, boneless, grilled":  171534,
    "Chicken thighs, meat only, cooked, roasted":   172388,
    "Beef, ground, 95% lean, cooked, broiled":      171791,
    "Beef, ground, 80% lean, cooked, broiled":      171797,

    # ── FISH & SEAFOOD ───────────────────────────────────────
    "Fish, salmon, Atlantic, farmed, cooked": 175168,
    "Fish, tuna, light, canned in water":     171986,
    "Fish, tuna, white, canned in oil":       171987,
    "Shrimp, cooked, moist heat":             171971,
    "Fish, cod, Atlantic, cooked":            171956,
    "Fish, tilapia, cooked":                  175177,

    # ── GRAINS ───────────────────────────────────────────────
    "Rice, white, long-grain, cooked":        168878,
    "Rice, brown, long-grain, cooked":        169704,
    "Pasta, cooked, enriched":                169737,
    "Pasta, whole-wheat, cooked":             170285,
    "Oats, raw":                              169705,
    "Oats, cooked with water":                173905,
    "Couscous, cooked":                       169700,
    "Quinoa, cooked":                         168917,
    "Barley, pearled, cooked":                170285,
    "Bulgur, cooked":                         170287,

    # ── BREADS ───────────────────────────────────────────────
    "Bread, white":                           174924,
    "Bread, wheat":                           172686,
    "Bread, whole-wheat":                     172688,
    "Bread, multi-grain":                     168013,
    "Bread, pita, white":                     174915,
    "Bread, pita, whole-wheat":               174916,

    # ── VEGETABLES ───────────────────────────────────────────
    "Potatoes, boiled, without skin":         170440,
    "Sweet potato, baked in skin":            168483,
    "Broccoli, cooked, boiled":               169967,
    "Spinach, cooked, boiled":                168463,
    "Carrots, cooked, boiled":                170394,
    "Tomatoes, red, raw":                     170457,
    "Onions, raw":                            170000,
    "Peppers, sweet, green, raw":             170427,
    "Peppers, sweet, red, raw":               170108,
    "Cauliflower, cooked, boiled":            170397,
    "Cabbage, cooked, boiled":                169976,
    "Peas, green, cooked, boiled":            170420,
    "Corn, sweet, yellow, cooked, boiled":    169999,
    "Mushrooms, white, cooked, boiled":       169252,
    "Zucchini, cooked, boiled":               168470,
    "Eggplant, cooked, boiled":               169229,
    "Asparagus, cooked, boiled":              168390,
    "Beans, snap, green, cooked":             169141,
    "Kale, cooked, boiled":                   169238,
    "Cucumber, with peel, raw":               168409,
    "Lettuce, romaine, raw":                  169247,
    "Garlic, raw":                            169230,
    "Ginger root, raw":                       169231,

    # ── FRUITS ───────────────────────────────────────────────
    "Apples, raw, with skin":                 171688,
    "Bananas, raw":                           173944,
    "Oranges, raw":                           169097,
    "Strawberries, raw":                      167762,
    "Blueberries, raw":                       171711,
    "Grapes, red or green, raw":              174683,
    "Watermelon, raw":                        167765,
    "Mangos, raw":                            169910,
    "Pineapple, raw":                         169124,
    "Peaches, raw":                           169928,
    "Pears, raw":                             169118,
    "Cherries, sweet, raw":                   171719,
    "Dates, medjool":                         168191,
    "Avocados, raw":                          171705,
    "Pomegranates, raw":                      169134,
    "Kiwifruit, green, raw":                  168153,
    "Apricots, raw":                          171697,
    "Plums, raw":                             169949,

    # ── LEGUMES ──────────────────────────────────────────────
    "Broadbeans (fava beans), cooked":        173753,
    "Lentils, cooked, boiled":                172421,
    "Chickpeas, cooked, boiled":              173757,
    "Beans, black, cooked, boiled":           173735,
    "Beans, kidney, cooked, boiled":          173740,
    "Tofu, firm, raw":                        172475,
    "Peanuts, dry-roasted, without salt":     173806,
    "Peanut butter, smooth, without salt":    172470,

    # ── NUTS & SEEDS ─────────────────────────────────────────
    "Nuts, almonds":                          170567,
    "Nuts, walnuts, english":                 170187,
    "Nuts, cashew nuts, raw":                 170162,
    "Nuts, pistachio nuts, raw":              170184,
    "Nuts, hazelnuts":                        170581,
    "Nuts, pecans":                           170182,
    "Nuts, brazilnuts, dried":                170569,
    "Nuts, pine nuts, dried":                 170591,
    "Nuts, almond butter, without salt":      168588,
    "Nuts, coconut meat, raw":                170169,
    "Seeds, pumpkin, roasted, no salt":       170188,
    "Seeds, sunflower, dry roasted, no salt": 170563,
    "Seeds, sesame seeds, whole, dried":      170150,
    "Seeds, tahini":                          170189,
    "Seeds, flaxseed":                        169414,
    "Seeds, chia seeds, dried":               170554,
    "Seeds, hemp seed, hulled":               170148,

    # ── DAIRY ────────────────────────────────────────────────
    "Cheese, cheddar":                        173414,
    "Cheese, gouda":                          171241,
    "Cheese, cottage, creamed":               172179,
    "Cheese, mozzarella, whole milk":         170845,
    "Cheese, feta":                           173420,
    "Cheese, ricotta, whole milk":            170851,
    "Cheese, parmesan, hard":                 170848,
    "Yogurt, plain, whole milk":              171284,
    "Yogurt, Greek, plain, whole milk":       171304,
    "Milk, whole, 3.25% milkfat":             171265,
    "Milk, reduced fat, 2% milkfat":          171267,
    "Butter, without salt":                   173430,
    "Butter, Clarified (ghee)":               171314,
    "Cream, sour, cultured":                  171257,

    # ── OILS ─────────────────────────────────────────────────
    "Oil, olive, salad or cooking":           171413,
    "Oil, coconut":                           171412,
    "Oil, sunflower, linoleic":               171025,
    "Oil, canola":                            171042,
    "Oil, sesame, salad or cooking":          171016,

    # ── SAUCES & CONDIMENTS ──────────────────────────────────
    "Soy sauce, from soy and wheat (shoyu)":  174277,
    "Sauce, teriyaki, ready-to-serve":        171167,
    "Mustard, prepared, yellow":              172234,
}

# ── Pull matched rows ─────────────────────────────────────────
all_fdc_ids = list(set(ITEMS.values()))
matched = sr[sr["fdc_id"].isin(all_fdc_ids)].copy()

# Map display name (first label wins per fdc_id)
id_to_label = {}
for label, fdc_id in ITEMS.items():
    if fdc_id not in id_to_label:
        id_to_label[fdc_id] = label
matched["display_name"] = matched["fdc_id"].map(id_to_label)

# ── Pull key nutrients (per 100g) ────────────────────────────
# 1008 = Calories (kcal)
# 1003 = Protein  (g)
# 1005 = Carbs    (g)
# 1004 = Fat      (g)
# 1079 = Fiber    (g)
# 1093 = Sodium   (mg)
NUTRIENT_IDS = {
    1008: "calories_kcal",
    1003: "protein_g",
    1005: "carbs_g",
    1004: "fat_g",
    1079: "fiber_g",
    1093: "sodium_mg",
}

fn_filtered = food_nutrient[
    (food_nutrient["fdc_id"].isin(all_fdc_ids)) &
    (food_nutrient["nutrient_id"].isin(NUTRIENT_IDS.keys()))
][["fdc_id", "nutrient_id", "amount"]].copy()

fn_pivot = fn_filtered.pivot_table(
    index="fdc_id",
    columns="nutrient_id",
    values="amount",
    aggfunc="first"
).reset_index()
fn_pivot.rename(columns=NUTRIENT_IDS, inplace=True)

# ── Pull default serving size ─────────────────────────────────
portions = food_portion[food_portion["fdc_id"].isin(all_fdc_ids)].copy()
portions = portions.sort_values("id").groupby("fdc_id").first().reset_index()
portions = portions[["fdc_id", "gram_weight", "amount", "modifier"]].rename(columns={
    "gram_weight": "serving_size_g",
    "amount":      "serving_amount",
    "modifier":    "serving_unit"
})

# ── Add category name ─────────────────────────────────────────
food_category = food_category.rename(columns={
    "id": "food_category_id",
    "description": "category_name"
})
matched = matched.merge(
    food_category[["food_category_id", "category_name"]],
    on="food_category_id", how="left"
)

# ── Merge everything ──────────────────────────────────────────
result = matched[["fdc_id", "display_name", "description", "food_category_id", "category_name"]].copy()
result = result.merge(fn_pivot, on="fdc_id", how="left")
result = result.merge(portions, on="fdc_id", how="left")

nutrient_cols = list(NUTRIENT_IDS.values())
for col in nutrient_cols:
    if col in result.columns:
        result[col] = result[col].round(2)

result = result.sort_values(["category_name", "display_name"]).reset_index(drop=True)

# ── Manual ingredients (not in USDA SR Legacy) ───────────────
# Values are per 100g, sourced from verified nutrition databases
# fdc_id 90001-90009 are custom IDs that won't clash with USDA IDs
MANUAL_ITEMS = [
    {
        "fdc_id":          90001,
        "display_name":    "Whey protein isolate, unflavored",
        "description":     "Whey protein isolate, unflavored (manual entry)",
        "food_category_id": 1,
        "category_name":   "Dairy and Egg Products",
        "calories_kcal":   370.0,
        "protein_g":        90.0,
        "carbs_g":           3.0,
        "fat_g":             1.0,
        "fiber_g":           0.0,
        "sodium_mg":       150.0,
        "serving_size_g":   30.0,
        "serving_amount":    1.0,
        "serving_unit":    "scoop",
    },
    {
        "fdc_id":          90002,
        "display_name":    "Whey protein concentrate, unflavored",
        "description":     "Whey protein concentrate, unflavored (manual entry)",
        "food_category_id": 1,
        "category_name":   "Dairy and Egg Products",
        "calories_kcal":   400.0,
        "protein_g":        80.0,
        "carbs_g":          10.0,
        "fat_g":             5.0,
        "fiber_g":           0.0,
        "sodium_mg":       180.0,
        "serving_size_g":   30.0,
        "serving_amount":    1.0,
        "serving_unit":    "scoop",
    },
    {
        "fdc_id":          90003,
        "display_name":    "Rice, basmati, cooked",
        "description":     "Rice, basmati, cooked (manual entry)",
        "food_category_id": 20,
        "category_name":   "Cereal Grains and Pasta",
        "calories_kcal":   130.0,
        "protein_g":         2.7,
        "carbs_g":          28.0,
        "fat_g":             0.3,
        "fiber_g":           0.4,
        "sodium_mg":         1.0,
        "serving_size_g":  185.0,
        "serving_amount":    1.0,
        "serving_unit":    "cup cooked",
    },
    {
        "fdc_id":          90004,
        "display_name":    "Granola, plain, homemade-style",
        "description":     "Granola, plain, homemade-style (manual entry)",
        "food_category_id": 8,
        "category_name":   "Breakfast Cereals",
        "calories_kcal":   490.0,
        "protein_g":        15.0,
        "carbs_g":          53.0,
        "fat_g":            24.0,
        "fiber_g":           8.6,
        "sodium_mg":        22.0,
        "serving_size_g":   50.0,
        "serving_amount":    0.5,
        "serving_unit":    "cup",
    },
    {
        "fdc_id":          90005,
        "display_name":    "Bread, Egyptian baladi (eish baladi)",
        "description":     "Bread, Egyptian baladi (eish baladi), whole wheat (manual entry)",
        "food_category_id": 18,
        "category_name":   "Baked Products",
        "calories_kcal":   257.0,
        "protein_g":        10.1,
        "carbs_g":          52.7,
        "fat_g":             1.3,
        "fiber_g":           1.3,
        "sodium_mg":       304.0,
        "serving_size_g":   90.0,
        "serving_amount":    1.0,
        "serving_unit":    "loaf",
    },
    {
        "fdc_id":          90006,
        "display_name":    "Bread, brown, whole grain",
        "description":     "Bread, brown, whole grain (manual entry)",
        "food_category_id": 18,
        "category_name":   "Baked Products",
        "calories_kcal":   245.0,
        "protein_g":         8.5,
        "carbs_g":          53.5,
        "fat_g":             2.8,
        "fiber_g":           4.2,
        "sodium_mg":       380.0,
        "serving_size_g":   30.0,
        "serving_amount":    1.0,
        "serving_unit":    "slice",
    },
    {
        "fdc_id":          90007,
        "display_name":    "Turkey breast, deli slices",
        "description":     "Turkey breast, deli slices, prepackaged (manual entry)",
        "food_category_id": 5,
        "category_name":   "Poultry Products",
        "calories_kcal":   104.0,
        "protein_g":        15.0,
        "carbs_g":           2.0,
        "fat_g":             4.0,
        "fiber_g":           0.0,
        "sodium_mg":       600.0,
        "serving_size_g":   56.0,
        "serving_amount":    2.0,
        "serving_unit":    "slices",
    },
    {
        "fdc_id":          90008,
        "display_name":    "Protein bar, average",
        "description":     "Protein bar, average macros (manual entry)",
        "food_category_id": 19,
        "category_name":   "Sweets",
        "calories_kcal":   374.0,
        "protein_g":        23.0,
        "carbs_g":          44.0,
        "fat_g":            11.0,
        "fiber_g":           6.0,
        "sodium_mg":       195.0,
        "serving_size_g":   60.0,
        "serving_amount":    1.0,
        "serving_unit":    "bar",
    },
    {
        "fdc_id":          90009,
        "display_name":    "Sauce, BBQ, regular",
        "description":     "Sauce, barbecue (BBQ), regular (manual entry)",
        "food_category_id": 6,
        "category_name":   "Soups, Sauces, and Gravies",
        "calories_kcal":   172.0,
        "protein_g":         0.8,
        "carbs_g":          41.5,
        "fat_g":             0.6,
        "fiber_g":           0.9,
        "sodium_mg":       985.0,
        "serving_size_g":   34.0,
        "serving_amount":    2.0,
        "serving_unit":    "tbsp",
    },
]

manual_df = pd.DataFrame(MANUAL_ITEMS)

# Ensure column order matches result
for col in result.columns:
    if col not in manual_df.columns:
        manual_df[col] = None
manual_df = manual_df[result.columns]

# Append to result
result = pd.concat([result, manual_df], ignore_index=True)

# ── Save CSV ──────────────────────────────────────────────────
result.to_csv(OUTPUT_CSV, index=False)
print(f"Saved: {OUTPUT_CSV}  ({len(result)} rows, including {len(MANUAL_ITEMS)} manual entries)")

# ── Stats JSON ────────────────────────────────────────────────
category_breakdown = (
    result.groupby("category_name")
    .size()
    .sort_values(ascending=False)
    .to_dict()
)

nutrient_coverage = {}
for col in nutrient_cols:
    if col in result.columns:
        filled = int(result[col].notna().sum())
        nutrient_coverage[col] = {
            "filled":       filled,
            "missing":      len(result) - filled,
            "coverage_pct": round(filled / len(result) * 100, 1)
        }

missing_from_usda = []
# All previously missing items added as manual entries (fdc_id 90001-90009)

stats = {
    "generated_at":        datetime.now().isoformat(),
    "total_items":         len(result),
    "category_breakdown":  category_breakdown,
    "nutrient_coverage":   nutrient_coverage,
    "missing_from_usda":   missing_from_usda,
    "note": "Items in missing_from_usda need to be added to manual_ingredients.csv"
}

with open(OUTPUT_JSON, "w") as f:
    json.dump(stats, f, indent=2)

print(f"Saved: {OUTPUT_JSON}")
print(f"\n── Summary ───────────────────────────────────────────")
print(f"  Total items: {len(result)}")
print(f"\nCategory breakdown:")
for cat, count in category_breakdown.items():
    print(f"  {cat:<42} {count}")
print(f"\nNutrient coverage:")
for col, info in nutrient_coverage.items():
    print(f"  {col:<20} {info['coverage_pct']}%  ({info['missing']} missing)")
print(f"\nItems NOT in USDA (add manually):")
for item in missing_from_usda:
    print(f"  - {item}")