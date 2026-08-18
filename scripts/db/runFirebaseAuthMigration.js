const fs = require('fs');
const path = require('path');

require('dotenv').config();

const sequelize = require('../../src/config/database');

const migrationPath = path.join(__dirname, '..', '..', 'migrations', '005_firebase_auth.sql');

(async () => {
  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await sequelize.authenticate();
    await sequelize.query(sql);
    console.log('Firebase auth migration applied successfully.');
  } finally {
    await sequelize.close();
  }
})().catch((err) => {
  console.error('Firebase auth migration failed:', err.message);
  process.exit(1);
});
