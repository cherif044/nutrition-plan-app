require('dotenv').config();
const app = require('./app');

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Nutrition Plan website running at http://localhost:${port}`);
});
