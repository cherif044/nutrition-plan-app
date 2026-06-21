const fs = require('fs');
const path = require('path');

let cache;

function loadTemplates() {
  if (cache) return cache;

  const filePath = path.join(__dirname, '..', '..', 'data', 'mealTemplates.json');
  const decoded = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Support both plain array format (current) and future { templates, rejected, summary } format
  cache = Array.isArray(decoded) ? decoded : (decoded.templates ?? []);
  return cache;
}

module.exports = { loadTemplates };
