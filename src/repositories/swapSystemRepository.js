const fs = require('fs');
const path = require('path');

let cache;

function loadSwapSystem() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'data', 'meal_swap_system.production.json');
  const decoded = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  validateSwapSystem(decoded);
  cache = decoded;
  return cache;
}

function validateSwapSystem(system) {
  if (!system || typeof system !== 'object' || Array.isArray(system)) {
    throw new Error('Swap system data must be a JSON object.');
  }

  assertObject(system.swapGroups, 'swapGroups');
  assertObject(system.mealFamilies, 'mealFamilies');
  assertObject(system.foodDefaultSwapGroupById, 'foodDefaultSwapGroupById');
  assertObject(system.badPairingGuards, 'badPairingGuards');
  assertObject(system.solverAndRankingPolicy, 'solverAndRankingPolicy');

  for (const [groupId, group] of Object.entries(system.swapGroups)) {
    assertObject(group, `swapGroups.${groupId}`);
    if (!Array.isArray(group.foods)) {
      throw new Error(`swapGroups.${groupId}.foods must be an array.`);
    }
  }

  for (const [familyId, family] of Object.entries(system.mealFamilies)) {
    assertObject(family, `mealFamilies.${familyId}`);
    assertObject(family.slotGroups, `mealFamilies.${familyId}.slotGroups`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Swap system ${label} must be an object.`);
  }
}

module.exports = { loadSwapSystem };
