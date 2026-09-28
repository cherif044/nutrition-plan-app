const { createReadStream, existsSync, statSync } = require('fs');
const { createServer } = require('http');
const { extname, join, normalize } = require('path');

const PUBLIC_DIRECTORY = join(__dirname, '..', 'public');
const PORT = Number(process.env.TEST_PORT || 3000);
const PAGE_ROUTES = new Map([
  ['/', 'index.html'],
  ['/login', 'login.html'],
  ['/register', 'register.html'],
  ['/dashboard', 'dashboard.html'],
  ['/planner', 'planner.html'],
  ['/account', 'account.html'],
]);
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

function publicFile(requestUrl) {
  const pathname = new URL(requestUrl, `http://127.0.0.1:${PORT}`).pathname;
  if (pathname === '/healthz') return null;
  const relativePath = PAGE_ROUTES.get(pathname) || pathname.replace(/^\/+/, '');
  const candidate = normalize(join(PUBLIC_DIRECTORY, relativePath));
  if (!candidate.startsWith(`${PUBLIC_DIRECTORY}/`)) return undefined;
  return candidate;
}

createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(204).end();
    return;
  }

  const file = publicFile(request.url || '/');
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(PORT, '127.0.0.1');
