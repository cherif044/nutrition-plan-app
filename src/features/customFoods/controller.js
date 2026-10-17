const { createCustomFood, listCustomFoods } = require('./repository');

async function listCustomFoodsHandler(req, res, next) {
  try {
    res.json({ foods: await listCustomFoods(req.user.id) });
  } catch (err) { next(err); }
}

async function createCustomFoodHandler(req, res, next) {
  try {
    const food = await createCustomFood(req.user.id, req.body);
    res.status(201).json({ food });
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

module.exports = { createCustomFoodHandler, listCustomFoodsHandler };
