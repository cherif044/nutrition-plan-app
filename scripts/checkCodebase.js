const { readdirSync } = require('fs');
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
