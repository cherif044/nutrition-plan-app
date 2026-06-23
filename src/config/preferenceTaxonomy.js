const preferenceTaxonomy = [
  {
    id: 'fish',
    label: 'Fish',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['fish'],
    aliases: ['fish', 'sea fish', 'tilapia', 'white fish', 'tuna', 'sardines', 'sardine'],
    description: 'Tilapia, white fish, tuna, sardines, and other fish.',
  },
  {
    id: 'shellfish',
    label: 'Shellfish',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['shellfish', 'crustacean'],
    aliases: ['shellfish', 'shrimp', 'prawns', 'prawn', 'crustacean', 'crustaceans'],
    description: 'Shrimp and other shellfish.',
  },
  {
    id: 'seafood',
    label: 'Seafood',
    type: 'category',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['seafood', 'fish', 'shellfish', 'crustacean'],
    aliases: ['seafood', 'sea food'],
    description: 'Broad match for fish and shellfish.',
  },
  {
    id: 'milk',
    label: 'Milk / Dairy',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['milk', 'dairy', 'dairy_and_eggs', 'lactose', 'cheese', 'yogurt', 'whey', 'butter'],
    aliases: ['milk', 'dairy', 'dairy_and_eggs', 'cheese', 'yogurt', 'labneh', 'whey', 'butter'],
    description: 'Milk-based foods including cheese, yogurt, labneh, whey, and butter.',
  },
  {
    id: 'lactose',
    label: 'Lactose',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['lactose', 'milk', 'dairy'],
    aliases: ['lactose', 'lactose intolerance'],
    description: 'Lactose-containing dairy foods.',
  },
  {
    id: 'egg',
    label: 'Eggs',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['egg', 'eggs', 'egg_whites'],
    aliases: ['egg', 'eggs', 'egg white', 'egg whites'],
    description: 'Whole eggs and egg whites.',
  },
  {
    id: 'soy',
    label: 'Soy',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['soy', 'tofu'],
    aliases: ['soy', 'soya', 'tofu'],
    description: 'Soy foods such as tofu.',
  },
  {
    id: 'gluten',
    label: 'Gluten',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['gluten', 'wheat', 'bread', 'pasta', 'freekeh', 'oats'],
    aliases: ['gluten', 'gluten intolerance', 'celiac', 'coeliac'],
    description: 'Gluten-containing grains and wheat-based foods.',
  },
  {
    id: 'wheat',
    label: 'Wheat',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['wheat', 'gluten', 'bread', 'pasta', 'freekeh', 'whole_wheat'],
    aliases: ['wheat', 'whole wheat', 'flour'],
    description: 'Wheat foods including bread, pasta, and freekeh.',
  },
  {
    id: 'sesame',
    label: 'Sesame',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['sesame', 'tahini'],
    aliases: ['sesame', 'tahini'],
    description: 'Sesame and tahini-based foods.',
  },
  {
    id: 'peanut',
    label: 'Peanuts',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['peanut'],
    aliases: ['peanut', 'peanuts', 'peanut butter'],
    description: 'Peanuts and peanut butter.',
  },
  {
    id: 'tree_nut',
    label: 'Tree nuts',
    type: 'allergen',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['tree_nut', 'almond', 'walnut'],
    aliases: ['tree nut', 'tree nuts', 'almond', 'almonds', 'walnut', 'walnuts'],
    description: 'Almonds, walnuts, and other tree nuts.',
  },
  {
    id: 'nuts',
    label: 'Nuts',
    type: 'category',
    scopes: ['allergy', 'dislike'],
    expandsTo: ['nuts', 'nuts_and_seeds', 'peanut', 'tree_nut', 'almond', 'walnut'],
    aliases: ['nut', 'nuts', 'all nuts'],
    description: 'Broad match for peanuts and tree nuts.',
  },
  {
    id: 'meat',
    label: 'Meat',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['meat', 'animal_protein', 'red_meat', 'poultry'],
    aliases: ['meat', 'animal protein'],
    description: 'Broad match for poultry and red meat.',
  },
  {
    id: 'red_meat',
    label: 'Red meat',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['red_meat', 'beef', 'beef_products', 'lamb'],
    aliases: ['red meat', 'beef', 'beef_products', 'lamb'],
    description: 'Beef, lamb, kofta, and liver from red meat.',
  },
  {
    id: 'poultry',
    label: 'Poultry',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['poultry', 'chicken', 'turkey'],
    aliases: ['poultry', 'chicken', 'turkey'],
    description: 'Chicken and turkey foods.',
  },
  {
    id: 'liver',
    label: 'Liver / organ meat',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['liver', 'organ_meat'],
    aliases: ['liver', 'organ meat', 'offal'],
    description: 'Beef liver and chicken liver.',
  },
  {
    id: 'legumes',
    label: 'Legumes',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['legumes', 'legume', 'beans', 'fava_beans', 'lentils', 'chickpeas', 'peanut', 'green_beans'],
    aliases: ['legume', 'legumes', 'beans', 'lentils', 'chickpeas', 'ful'],
    description: 'Ful, lentils, chickpeas, peanuts, and beans.',
  },
  {
    id: 'rice',
    label: 'Rice',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['rice', 'white_rice', 'brown_rice'],
    aliases: ['rice', 'white rice', 'brown rice'],
    description: 'White rice, brown rice, and rice-based mixes.',
  },
  {
    id: 'bread',
    label: 'Bread',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['bread', 'white_bread', 'whole_wheat', 'wheat', 'gluten'],
    aliases: ['bread', 'fino', 'baladi', 'roll'],
    description: 'Fino and baladi bread.',
  },
  {
    id: 'pasta',
    label: 'Pasta',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['pasta', 'wheat', 'gluten'],
    aliases: ['pasta', 'macaroni', 'spaghetti'],
    description: 'Regular and whole wheat pasta.',
  },
  {
    id: 'potato',
    label: 'Potatoes',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['potato', 'sweet_potato', 'white_potato'],
    aliases: ['potato', 'potatoes', 'sweet potato'],
    description: 'Boiled potato and sweet potato.',
  },
  {
    id: 'fruit',
    label: 'Fruit',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['fruit', 'fruits', 'banana', 'mango', 'apple', 'orange', 'watermelon', 'dates', 'dried_fruit'],
    aliases: ['fruit', 'fruits'],
    description: 'Banana, mango, apple, orange, watermelon, dates, and avocado.',
  },
  {
    id: 'vegetable',
    label: 'Vegetables',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['vegetable', 'vegetables', 'non_starchy_vegetable', 'root_vegetable', 'leafy_greens', 'nightshade', 'cruciferous'],
    aliases: ['vegetable', 'vegetables', 'veggies', 'veg'],
    description: 'Fresh and cooked vegetables.',
  },
  {
    id: 'leafy_greens',
    label: 'Leafy greens',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['leafy_greens', 'lettuce', 'spinach'],
    aliases: ['leafy greens', 'greens', 'lettuce', 'spinach'],
    description: 'Lettuce and spinach.',
  },
  {
    id: 'nightshade',
    label: 'Nightshade vegetables',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['nightshade', 'tomato', 'pepper', 'bell_pepper', 'eggplant'],
    aliases: ['nightshade', 'nightshades', 'tomato', 'pepper', 'eggplant'],
    description: 'Tomato, bell pepper, and eggplant.',
  },
  {
    id: 'oil',
    label: 'Oils',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['oil', 'fat', 'fats_and_oils', 'olive_oil', 'sunflower_oil'],
    aliases: ['oil', 'oils', 'olive oil', 'sunflower oil', 'fat', 'fats'],
    description: 'Olive oil and sunflower oil.',
  },
  {
    id: 'seeds',
    label: 'Seeds',
    type: 'category',
    scopes: ['dislike'],
    expandsTo: ['seed', 'sesame', 'tahini', 'flaxseed'],
    aliases: ['seed', 'seeds', 'flaxseed', 'flaxseeds'],
    description: 'Sesame, tahini, and flaxseeds.',
  },
];

// Maps raw food category strings to their canonical form to eliminate duplicates in the UI.
const CATEGORY_CANONICAL = {
  fruits: 'fruit',
  vegetables: 'vegetable',
  eggs: 'egg',
  egg_whites: 'egg',
  legume: 'legumes',
  beans: 'legumes',
  nuts_and_seeds: 'nuts',
  beef: 'red_meat',
  beef_products: 'red_meat',
  dairy_and_eggs: 'milk',
  dairy: 'milk',
  butter: 'milk',
  fat: 'oil',
  fats_and_oils: 'oil',
  cereal_grains: 'grain',
  chicken: 'poultry',
  crustacean: 'shellfish',
  animal_protein: 'meat',
  sweet_potato: 'potato',
};

function getPreferenceOptions(foods) {
  const categoryOptions = buildCategoryOptions(foods);

  const foodOptions = foods.map((food) => ({
    id: `food:${food.id}`,
    label: food.name,
    type: 'food',
    aliases: [food.id, food.name, food.nameAr, ...food.categories].filter(Boolean),
    description: food.nameAr || 'Individual food item.',
    expandsTo: [food.id],
  }));
  const options = [...categoryOptions, ...foodOptions].sort(preferenceOptionSort);

  return {
    allergyOptions: options,
    dislikeOptions: options,
  };
}

function buildCategoryOptions(foods) {
  const rawCategories = [...new Set(foods.flatMap((food) => food.categories))].sort();
  const seen = new Map();

  for (const category of rawCategories) {
    const canonical = CATEGORY_CANONICAL[category] || category;
    if (seen.has(canonical)) continue;

    const taxonomyEntry =
      findTaxonomyEntry(normalizeToken(canonical)) ||
      findTaxonomyEntry(normalizeToken(category));

    seen.set(canonical, {
      id: `category:${canonical}`,
      label: taxonomyEntry?.label || humanizeCategory(canonical),
      type: 'category',
      aliases: [
        canonical,
        category,
        humanizeCategory(canonical),
        ...(taxonomyEntry?.aliases || []),
      ].filter((v, i, arr) => v && arr.indexOf(v) === i),
      description:
        taxonomyEntry?.description || `All foods tagged ${humanizeCategory(canonical)}.`,
      expandsTo: taxonomyEntry?.expandsTo || [canonical, category].filter(Boolean),
    });
  }

  return [...seen.values()];
}

function preferenceOptionSort(a, b) {
  if (a.type !== b.type) {
    return a.type === 'category' ? -1 : 1;
  }

  return a.label.localeCompare(b.label);
}

function resolvePreferenceTerms(terms) {
  const selectedIds = new Set();
  const semanticTags = new Set();
  const unknownTerms = new Set();

  for (const term of terms) {
    const raw = String(term || '').trim().toLowerCase();
    if (raw.startsWith('food:')) {
      selectedIds.add(raw.slice(5));
      continue;
    }
    if (raw.startsWith('category:')) {
      const category = raw.slice(9);
      const matched = findTaxonomyEntry(normalizeToken(category));

      if (matched) {
        matched.expandsTo.forEach((tag) => semanticTags.add(tag));
        semanticTags.add(matched.id);
      } else {
        semanticTags.add(category);
      }
      continue;
    }

    const normalized = normalizeToken(term);
    if (!normalized) {
      continue;
    }

    const matched = findTaxonomyEntry(normalized);
    if (matched) {
      matched.expandsTo.forEach((tag) => semanticTags.add(tag));
      semanticTags.add(matched.id);
      continue;
    }

    unknownTerms.add(String(term || '').trim());
  }

  return {
    selectedIds,
    semanticTags,
    unknownTerms,
  };
}

function findTaxonomyEntry(normalizedTerm) {
  return preferenceTaxonomy.find((entry) => {
    if (normalizeToken(entry.id) === normalizedTerm || normalizeToken(entry.label) === normalizedTerm) {
      return true;
    }

    return entry.aliases.some((alias) => normalizeToken(alias) === normalizedTerm);
  });
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ');
}

function humanizeCategory(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  getPreferenceOptions,
  normalizeToken,
  resolvePreferenceTerms,
};
