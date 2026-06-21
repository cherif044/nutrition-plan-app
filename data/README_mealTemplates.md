# mealTemplates.json

Currently an empty array. Each entry will have the following shape once populated by the template generation script:

```json
{
  "id": "string",
  "name": "string",
  "mealType": "breakfast | lunch | dinner | snack",
  "cuisineTag": "egyptian | levantine | mediterranean | continental",
  "dietTags": ["string", "..."],
  "components": [
    { "foodId": "string", "role": "carb | protein | fat | mixed" }
  ]
}
```

## sub_category vocabulary (for reference)

| macro_role | valid sub_category values |
|---|---|
| carb | `starch`, `bread`, `non_starchy_veg`, `fruit`, `legume` |
| protein | `animal_protein`, `egg`, `dairy_protein`, `legume` |
| fat | `oil_fat`, `nuts_seeds`, `dairy_fat` |
| mixed | `null` |
```
