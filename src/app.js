const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const apiRoutes = require('./routes/apiRoutes');
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// API routes must come before static so Express 5 serve-static
// doesn't intercept non-GET requests on /api/* paths
app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api', apiRoutes);

app.use(express.static(publicDir));
// Serve zxcvbn for client-side password strength
app.get('/js/zxcvbn.browser.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'zxcvbn', 'dist', 'zxcvbn.js'));
});

// Page routes
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (_req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/planner', (_req, res) => res.sendFile(path.join(publicDir, 'planner.html')));
app.get('/customers', (_req, res) => res.sendFile(path.join(publicDir, 'customers.html')));
app.get('/customer/:id', (_req, res) => res.sendFile(path.join(publicDir, 'customer.html')));

app.use(errorHandler);

module.exports = app;
