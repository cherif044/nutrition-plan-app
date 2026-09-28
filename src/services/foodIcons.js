const fs = require('fs');
const path = require('path');

// Food icons are looked up by id in a map built once from the icon directory,
// so no filesystem path is ever built from a food id taken from a request or
// a stored plan. Symlinks that leave the directory, oversized files and names
// that are not plain ids are left out of the map.

const ICONS_DIR = path.join(__dirname, '..', '..', 'public', 'food-icons');
const FOOD_ICON_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const MAX_ICON_BYTES = 512 * 1024;

let iconPaths;
const imageCache = new Map();

function buildIconMap(dir = ICONS_DIR) {
  const map = new Map();
  let realDir;
  let names;
  try {
    realDir = fs.realpathSync(dir);
    names = fs.readdirSync(realDir);
  } catch {
    return map;
  }

  for (const name of names) {
    const match = /^(.+)\.png$/.exec(name);
    if (!match || !FOOD_ICON_ID_PATTERN.test(match[1])) continue;
    try {
      const realPath = fs.realpathSync(path.join(realDir, name));
      if (!realPath.startsWith(realDir + path.sep)) continue;
      const stat = fs.statSync(realPath);
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;
      map.set(match[1], realPath);
    } catch {
      // A file that disappears or cannot be read simply has no icon.
    }
  }
  return map;
}

function foodIconPaths() {
  if (!iconPaths) iconPaths = buildIconMap();
  return iconPaths;
}

function hasFoodIcon(id) {
  const key = String(id ?? '');
  return FOOD_ICON_ID_PATTERN.test(key) && foodIconPaths().has(key);
}

function foodIconUrl(id) {
  return hasFoodIcon(id) ? `/food-icons/${id}.png` : null;
}

// Returns the icon bytes for a catalog id, or null. The cache is bounded by
// the size of the icon map.
function foodIconImage(id) {
  if (!hasFoodIcon(id)) return null;
  const key = String(id);
  let image = imageCache.get(key);
  if (!image) {
    image = fs.readFileSync(foodIconPaths().get(key));
    imageCache.set(key, image);
  }
  return image;
}

module.exports = {
  FOOD_ICON_ID_PATTERN,
  ICONS_DIR,
  buildIconMap,
  foodIconImage,
  foodIconUrl,
  hasFoodIcon,
};
