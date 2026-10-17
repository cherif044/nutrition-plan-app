const { Op, fn, col, where } = require('sequelize');
const sequelize = require('../../config/database');
const { CustomFood } = require('../../models');
const { INPUT_LIMITS } = require('../../config/inputLimits');
const { assertCanAddCustomFood } = require('../../shared/accountQuotas');

// Stored to one decimal place, like the column.
function roundMacro(value) {
  return Math.round(Number(value) * 10) / 10;
}

// The planner's food shape, so custom foods sit next to catalog foods in
// search. Calories come from the macros at 4/4/9 kcal per gram.
function toFood(row) {
  const proteinGPer100g = roundMacro(row.protein_g_per_100g);
  const carbGPer100g = roundMacro(row.carb_g_per_100g);
  const fatGPer100g = roundMacro(row.fat_g_per_100g);
  return {
    id: `custom_${row.id}`,
    name: row.name,
    custom: true,
    proteinGPer100g,
    carbGPer100g,
    fatGPer100g,
    caloriesPer100g: Math.round((proteinGPer100g * 4 + carbGPer100g * 4 + fatGPer100g * 9) * 10) / 10,
  };
}

async function listCustomFoods(userId) {
  const rows = await CustomFood.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: INPUT_LIMITS.account.customFoods,
  });
  return rows.map(toFood);
}

async function createCustomFood(userId, { name, proteinGPer100g, carbGPer100g, fatGPer100g }) {
  return sequelize.transaction(async (transaction) => {
    await assertCanAddCustomFood(userId, transaction);
    const duplicate = await CustomFood.findOne({
      where: { user_id: userId, [Op.and]: [where(fn('lower', col('name')), name.toLowerCase())] },
      attributes: ['id'],
      transaction,
    });
    if (duplicate) {
      throw Object.assign(new Error(`You already have a custom food called "${name}".`), { status: 409 });
    }
    const row = await CustomFood.create({
      user_id: userId,
      name,
      protein_g_per_100g: roundMacro(proteinGPer100g),
      carb_g_per_100g: roundMacro(carbGPer100g),
      fat_g_per_100g: roundMacro(fatGPer100g),
    }, { transaction });
    return toFood(row);
  });
}

module.exports = { createCustomFood, listCustomFoods, toFood };
