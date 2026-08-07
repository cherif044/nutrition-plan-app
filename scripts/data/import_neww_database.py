#!/usr/bin/env python3
"""Import the Excel files in new_stage_data/neww as the runtime databases.

The project intentionally has no spreadsheet dependency, so this reads the
simple workbook XML directly from the .xlsx zip.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
NEWW_DIR = ROOT / "new_stage_data" / "neww"
NUTRITION_XLSX = NEWW_DIR / "nutrition_database_final_updated (1).xlsx"
SUBSTITUTION_XLSX = NEWW_DIR / "meal_substitution_system_v2_updated (1).xlsx"
FOODS_JSON = ROOT / "data" / "foods.json"
SUBSTITUTION_JSON = ROOT / "new_stage_data" / "meal_substitution_system.json"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

MEAL_SHEETS = {
    "Breakfast": "breakfast",
    "Lunch": "lunch",
    "Dinner": "dinner",
    "Snack": "snack",
}

INGREDIENT_ALIASES = {
    "Egg whites, cooked (omelette/scrambled)": "Egg, white, raw, fresh",
    "Whey protein isolate, unflavored (mixed with milk)": "Whey protein isolate, unflavored",
    "Whey protein concentrate, unflavored (mixed with milk)": "Whey protein concentrate, unflavored",
}

SKIP_INGREDIENTS = {"(included in bar)", "(included in peanuts)", "-"}


def column_index(cell_ref: str) -> int:
    index = 0
    for char in "".join(ch for ch in cell_ref if ch.isalpha()):
        index = index * 26 + ord(char.upper()) - 64
    return index - 1


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    except KeyError:
        return []

    return [
        "".join(text_node.text or "" for text_node in item.findall(".//main:t", NS))
        for item in root.findall("main:si", NS)
    ]


def workbook_sheet_paths(zip_file: ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pkgrel:Relationship", NS)
    }

    paths: dict[str, str] = {}
    for sheet in workbook.find("main:sheets", NS) or []:
        rel_id = sheet.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        target = rel_targets[rel_id].lstrip("/")
        paths[sheet.attrib["name"]] = (
            target
            if target.startswith("xl/")
            else str(PurePosixPath("xl") / target)
        )

    return paths


def parse_cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t")

    if cell_type == "inlineStr":
        return "".join(text_node.text or "" for text_node in cell.findall(".//main:t", NS))

    value_node = cell.find("main:v", NS)
    if value_node is None:
        return None

    value = value_node.text or ""
    if cell_type == "s":
        return shared_strings[int(value)] if value else ""
    if cell_type == "b":
        return value == "1"

    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def read_xlsx(path: Path) -> dict[str, list[list[Any]]]:
    with ZipFile(path) as zip_file:
        shared_strings = load_shared_strings(zip_file)
        sheets: dict[str, list[list[Any]]] = {}

        for sheet_name, sheet_path in workbook_sheet_paths(zip_file).items():
            root = ET.fromstring(zip_file.read(sheet_path))
            rows: list[list[Any]] = []

            for row in root.findall(".//main:sheetData/main:row", NS):
                values: list[Any] = []
                for cell in row.findall("main:c", NS):
                    index = column_index(cell.attrib.get("r", "A1"))
                    while len(values) <= index:
                        values.append(None)
                    values[index] = parse_cell_value(cell, shared_strings)
                rows.append(values)

            sheets[sheet_name] = rows

    return sheets


def clean_string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def row_to_dict(headers: list[Any], row: list[Any]) -> dict[str, Any]:
    return {
        clean_string(header): row[index] if index < len(row) else None
        for index, header in enumerate(headers)
        if clean_string(header)
    }


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "food"


def split_meal_tags(value: Any) -> list[str]:
    if not value:
        return []
    return [
        part.strip().lower()
        for part in re.split(r"[,/]", str(value))
        if part and part.strip()
    ]


def meal_category_to_tags(value: Any) -> list[str]:
    return [part.lower() for part in re.findall(r"[A-Za-z]+", clean_string(value))]


def nutrition_role_to_macro_role(role: str, category: str) -> str:
    lowered = role.lower()
    if "protein" in lowered:
        return "protein"
    if "carb" in lowered:
        return "carb"
    if "fat" in lowered:
        return "fat"
    if "nut and seed" in category.lower():
        return "fat"
    if "vegetable" in category.lower():
        return "carb"
    return "mixed"


def category_metadata(name: str, category: str) -> tuple[list[str], list[str], str | None]:
    lowered_name = name.lower()
    lowered_category = category.lower()

    if "nut and seed" in lowered_category:
        allergens = ["sesame"] if "sesame" in lowered_name else ["tree_nut"]
        categories = ["nuts_and_seeds", "nuts", "seed"]
        if "sesame" in lowered_name:
            categories.append("sesame")
        return allergens, categories, "nuts_seeds"

    if "vegetable" in lowered_category:
        categories = ["vegetables", "vegetable"]
        if "garlic" in lowered_name:
            categories.append("allium")
        if "ginger" in lowered_name:
            categories.extend(["root_vegetable", "ginger"])
        if "kale" in lowered_name:
            categories.extend(["leafy_greens", "kale"])
        return [], categories, "non_starchy_veg"

    return [], [slugify(category)], None


def default_meal_tags(category: str) -> list[str]:
    if "nut and seed" in category.lower():
        return ["breakfast", "snack"]
    if "vegetable" in category.lower():
        return ["lunch", "dinner"]
    return ["lunch", "dinner"]


def default_serving_bounds(default_serving_g: float, category: str) -> tuple[float, float]:
    if "nut and seed" in category.lower():
        return 5, max(20, min(default_serving_g, 40))
    if "vegetable" in category.lower():
        return 5, max(30, min(default_serving_g * 2, 200))
    return max(1, round(default_serving_g / 2, 2)), max(default_serving_g, 100)


def compact_number(value: Any, fallback: float = 0) -> float | int:
    if value is None or value == "":
        value = fallback
    number = float(value)
    return int(number) if number.is_integer() else number


def build_nutrition_rows(workbook: dict[str, list[list[Any]]]) -> dict[str, dict[str, Any]]:
    rows_by_name: dict[str, dict[str, Any]] = {}

    all_rows = workbook["All Ingredients"]
    for row in all_rows[1:]:
        data = row_to_dict(all_rows[0], row)
        name = clean_string(data.get("Ingredient"))
        if name:
            rows_by_name[name] = data

    for sheet_name, rows in workbook.items():
        if sheet_name in {"All Ingredients", "Summary"} or not rows:
            continue
        for row in rows[1:]:
            data = row_to_dict(rows[0], row)
            name = clean_string(data.get("Ingredient"))
            if name and name not in rows_by_name:
                rows_by_name[name] = data

    return rows_by_name


def build_classification_rows(workbook: dict[str, list[list[Any]]]) -> dict[str, dict[str, Any]]:
    if "Food Classification" not in workbook:
        return {}

    rows = workbook["Food Classification"]
    return {
        clean_string(data.get("Ingredient")): data
        for data in (row_to_dict(rows[0], row) for row in rows[1:])
        if clean_string(data.get("Ingredient"))
    }


def apply_nutrition_update(
    current_foods: list[dict[str, Any]],
    nutrition_rows: dict[str, dict[str, Any]],
    classifications: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    foods_by_name = {food["name"]: food for food in current_foods}
    updated: list[dict[str, Any]] = []

    for food in current_foods:
        row = nutrition_rows.get(food["name"])
        if not row:
            updated.append(food)
            continue

        next_food = dict(food)
        next_food.update(
            {
                "calories_per_100g": compact_number(row.get("Calories (kcal)")),
                "protein_g_per_100g": compact_number(row.get("Protein (g)")),
                "carb_g_per_100g": compact_number(row.get("Carbs (g)")),
                "fat_g_per_100g": compact_number(row.get("Fat (g)")),
                "fiber_g_per_100g": compact_number(row.get("Fiber (g)")),
                "sodium_mg_per_100g": compact_number(row.get("Sodium (mg)")),
                "fdc_id": compact_number(row.get("FDC ID")),
            }
        )

        meal_tags = split_meal_tags(row.get("Meal Type"))
        if not meal_tags and food["name"] in classifications:
            meal_tags = meal_category_to_tags(classifications[food["name"]].get("Meal Category"))
        if meal_tags:
            next_food["meal_tags"] = meal_tags

        updated.append(next_food)

    for name in sorted(set(nutrition_rows) - set(foods_by_name)):
        row = nutrition_rows[name]
        category = clean_string(row.get("Category"))
        classification = classifications.get(name, {})
        role = clean_string(classification.get("Nutrition Role"))
        meal_tags = (
            split_meal_tags(row.get("Meal Type"))
            or meal_category_to_tags(classification.get("Meal Category"))
            or default_meal_tags(category)
        )
        default_serving = compact_number(row.get("Serving (g)"), 100)
        min_serving, max_serving = default_serving_bounds(float(default_serving), category)
        allergens, categories, sub_category = category_metadata(name, category)
        is_vegan = not any(allergen in {"milk", "dairy", "egg", "fish", "shellfish"} for allergen in allergens)

        updated.append(
            {
                "id": slugify(name),
                "name": name,
                "macro_role": nutrition_role_to_macro_role(role, category),
                "calories_per_100g": compact_number(row.get("Calories (kcal)")),
                "protein_g_per_100g": compact_number(row.get("Protein (g)")),
                "carb_g_per_100g": compact_number(row.get("Carbs (g)")),
                "fat_g_per_100g": compact_number(row.get("Fat (g)")),
                "fiber_g_per_100g": compact_number(row.get("Fiber (g)")),
                "sodium_mg_per_100g": compact_number(row.get("Sodium (mg)")),
                "is_vegan": is_vegan,
                "is_vegetarian": True,
                "allergens": allergens,
                "categories": categories,
                "meal_tags": meal_tags,
                "default_serving_g": default_serving,
                "min_serving_g": min_serving,
                "max_serving_g": max_serving,
                "fdc_id": compact_number(row.get("FDC ID")),
                "sub_category": sub_category,
                "cuisine_tag": "mediterranean",
                "diet_tags": ["vegetarian", "vegan"] if is_vegan else ["vegetarian"],
            }
        )

    validate_foods(updated)
    return updated


def build_substitution_json(workbook: dict[str, list[list[Any]]]) -> dict[str, Any]:
    meal_bundles: dict[str, list[dict[str, Any]]] = {}
    meal_counts: dict[str, int] = {}

    for sheet_name, meal_key in MEAL_SHEETS.items():
        rows = workbook[sheet_name]
        bundles: list[dict[str, Any]] = []
        for row in rows[1:]:
            data = row_to_dict(rows[0], row)
            bundle_id = clean_string(data.get("ID"))
            if not bundle_id:
                continue
            bundle = {
                "id": bundle_id,
                "track": clean_string(data.get("Track")),
                "protein": clean_string(data.get("Protein")) or None,
                "carb": clean_string(data.get("Carb")) or None,
                "fat": clean_string(data.get("Fat")) or None,
                "extra": clean_string(data.get("Veg / Extra")) or None,
            }
            if "Sauce / Condiment" in data:
                bundle["sauce"] = clean_string(data.get("Sauce / Condiment")) or None
            bundles.append(bundle)

        meal_bundles[meal_key] = bundles
        meal_counts[meal_key] = len(bundles)

    classification_rows = workbook.get("Food Classification", [])
    food_classification = []
    if classification_rows:
        food_classification = [
            {
                "ingredient": clean_string(data.get("Ingredient")),
                "meal_category": clean_string(data.get("Meal Category")),
                "nutrition_role": clean_string(data.get("Nutrition Role")),
            }
            for data in (row_to_dict(classification_rows[0], row) for row in classification_rows[1:])
            if clean_string(data.get("Ingredient"))
        ]

    return {
        "metadata": {
            "version": "3.0",
            "total_bundles": sum(meal_counts.values()),
            "meal_counts": meal_counts,
        },
        "food_classification": food_classification,
        "meal_bundles": meal_bundles,
    }


def validate_foods(foods: list[dict[str, Any]]) -> None:
    required_fields = {
        "id",
        "name",
        "macro_role",
        "calories_per_100g",
        "protein_g_per_100g",
        "carb_g_per_100g",
        "fat_g_per_100g",
        "is_vegan",
        "is_vegetarian",
        "allergens",
        "categories",
        "meal_tags",
        "default_serving_g",
        "min_serving_g",
        "max_serving_g",
        "cuisine_tag",
    }
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for food in foods:
        missing = sorted(field for field in required_fields if food.get(field) is None)
        if missing:
            raise ValueError(f"{food.get('name', '<unknown>')} missing {', '.join(missing)}")
        if food["id"] in seen_ids:
            raise ValueError(f"duplicate food id: {food['id']}")
        if food["name"].lower() in seen_names:
            raise ValueError(f"duplicate food name: {food['name']}")
        seen_ids.add(food["id"])
        seen_names.add(food["name"].lower())


def validate_substitutions(substitutions: dict[str, Any], foods: list[dict[str, Any]]) -> None:
    food_names = {food["name"].lower() for food in foods}
    seen_ids: set[str] = set()
    total = 0

    for meal_key, bundles in substitutions["meal_bundles"].items():
        expected_count = substitutions["metadata"]["meal_counts"][meal_key]
        if len(bundles) != expected_count:
            raise ValueError(f"{meal_key} count mismatch: {len(bundles)} != {expected_count}")
        total += len(bundles)

        for bundle in bundles:
            if bundle["id"] in seen_ids:
                raise ValueError(f"duplicate meal bundle id: {bundle['id']}")
            seen_ids.add(bundle["id"])

            for key in ("protein", "carb", "fat", "extra", "sauce"):
                ingredient = bundle.get(key)
                if not ingredient or ingredient in SKIP_INGREDIENTS:
                    continue
                lookup_name = INGREDIENT_ALIASES.get(ingredient, ingredient)
                if lookup_name.lower() not in food_names:
                    raise ValueError(f"{bundle['id']} references unknown ingredient: {ingredient}")

    expected_total = substitutions["metadata"]["total_bundles"]
    if total != expected_total:
        raise ValueError(f"total bundle count mismatch: {total} != {expected_total}")


def main() -> None:
    nutrition_workbook = read_xlsx(NUTRITION_XLSX)
    substitution_workbook = read_xlsx(SUBSTITUTION_XLSX)
    current_foods = json.loads(FOODS_JSON.read_text())

    nutrition_rows = build_nutrition_rows(nutrition_workbook)
    classifications = build_classification_rows(substitution_workbook)
    foods = apply_nutrition_update(current_foods, nutrition_rows, classifications)
    substitutions = build_substitution_json(substitution_workbook)

    validate_substitutions(substitutions, foods)

    FOODS_JSON.write_text(json.dumps(foods, indent=2, ensure_ascii=False) + "\n")
    SUBSTITUTION_JSON.write_text(json.dumps(substitutions, indent=2, ensure_ascii=False) + "\n")

    shutil.copyfile(NUTRITION_XLSX, ROOT / "new_stage_data" / "nutrition_database_final.xlsx")
    shutil.copyfile(SUBSTITUTION_XLSX, ROOT / "new_stage_data" / "meal_substitution_system.xlsx")

    print(f"Updated {FOODS_JSON.relative_to(ROOT)} with {len(foods)} foods")
    print(
        f"Updated {SUBSTITUTION_JSON.relative_to(ROOT)} with "
        f"{substitutions['metadata']['total_bundles']} meal bundles"
    )


if __name__ == "__main__":
    main()
