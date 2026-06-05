const app = require('./app');
const { initDb } = require('./config/db');

const port = process.env.PORT || 3000;

async function start() {
  try {
    await initDb();
  } catch (err) {
    console.error('[db] Failed to initialize database:', err.message);
    console.error('[db] Continuing without database — auth features will not work.');
  }

  app.listen(port, () => {
    console.log(`Nutrition Plan website running at http://localhost:${port}`);
  });
}

start();
