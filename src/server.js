require('dotenv').config();
const app = require('./app');
const sequelize = require('./config/database');

const port = process.env.PORT || 3000;

sequelize.authenticate()
  .then(() => {
    console.log('[db] Database connected');
    app.listen(port, () => {
      console.log(`Nutrition Plan website running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('[db] Unable to connect to database:', err.message);
    process.exit(1);
  });
