const fs = require('fs');
const path = require('path');

let cache;

function loadTemplates() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'data', 'mealTemplates.json');
  const decoded = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Preserve template/component metadata as the authoritative meal-generation contract.
  cache = Array.isArray(decoded) ? decoded : (decoded.templates ?? []);
  validateTemplates(cache);
  return cache;
}

function validateTemplates(templates) {
  if (!Array.isArray(templates)) {
    throw new Error('Meal template data must be a JSON array or an object with a templates array.');
  }

  for (const template of templates) {
    const templateId = template.templateId ?? template.name;
    if (!templateId) throw new Error('Meal template is missing templateId/name.');
    if (!template.family) throw new Error(`Meal template ${templateId} is missing family.`);
    if (!Array.isArray(template.components) || template.components.length === 0) {
      throw new Error(`Meal template ${templateId} must include components.`);
    }

    for (const component of template.components) {
      if (!component.foodId) throw new Error(`Meal template ${templateId} has a component without foodId.`);
      if (!component.slot) throw new Error(`Meal template ${templateId} component ${component.foodId} is missing slot.`);
      if (!component.swapGroup) {
        throw new Error(`Meal template ${templateId} component ${component.foodId} is missing swapGroup.`);
      }
    }
  }
}

module.exports = { loadTemplates };
