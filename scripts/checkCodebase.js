const { readdirSync, statSync } = require('fs');
const { extname, join, relative } = require('path');
const { spawnSync } = require('child_process');

const ROOT = join(__dirname, '..');
const SOURCE_DIRECTORIES = ['api', 'public/js', 'scripts', 'src', 'tests'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'testing_data', '.git']);

function javascriptFiles(directory) {
  const absolute = join(ROOT, directory);
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...javascriptFiles(relative(ROOT, path)));
    } else if (extname(entry.name) === '.js') {
      files.push(path);
    }
  }
  return files;
}

const files = SOURCE_DIRECTORIES.flatMap(javascriptFiles).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);

const SIZE_BUDGETS = [
  ['public/css/styles.css', Number(process.env.CSS_SIZE_BUDGET_BYTES) || 330 * 1024],
  ['public/js/planner/app.js', Number(process.env.PLANNER_JS_SIZE_BUDGET_BYTES) || 170 * 1024],
  ['public/js/dashboard/app.js', Number(process.env.DASHBOARD_JS_SIZE_BUDGET_BYTES) || 80 * 1024],
  ['public/js/auth/app.js', Number(process.env.AUTH_JS_SIZE_BUDGET_BYTES) || 80 * 1024],
  ['public/js/account/app.js', Number(process.env.ACCOUNT_JS_SIZE_BUDGET_BYTES) || 80 * 1024],
];

for (const [asset, budget] of SIZE_BUDGETS) {
  const size = statSync(join(ROOT, asset)).size;
  if (size > budget) {
    console.error(`${asset} is ${size} bytes, above budget ${budget}.`);
    process.exit(1);
  }
}

console.log(`Checked ${SIZE_BUDGETS.length} frontend asset size budgets.`);
