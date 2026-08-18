const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const generationRoutes = require('./routes/generationRoutes');
const authRoutes = require('./routes/authRoutes');
const folderRoutes = require('./routes/folderRoutes');
const planRoutes = require('./routes/planRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const customerRoutes = require('./routes/customerRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const foodIconsDir = path.join(__dirname, '..', 'icons');

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/plans', planRoutes);
app.use('/api', generationRoutes);

app.use('/food-icons', express.static(foodIconsDir));
app.use(express.static(publicDir));
app.get('/js/zxcvbn.browser.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'zxcvbn', 'dist', 'zxcvbn.js'));
});

// Page routes
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (_req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/customers/:id', (_req, res) => res.sendFile(path.join(publicDir, 'customer.html')));
app.get('/planner', (_req, res) => res.sendFile(path.join(publicDir, 'planner.html')));
app.get('/explorer', (_req, res) => res.sendFile(path.join(publicDir, 'explorer.html')));

app.use(errorHandler);

module.exports = app;
