const express = require('express');
const path = require('path');

const apiRoutes = require('./routes/apiRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDir));
app.use('/api', apiRoutes);

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(errorHandler);

module.exports = app;
