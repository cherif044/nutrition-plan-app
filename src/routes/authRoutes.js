const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { register, login, logout, revokeAllSessions, getMe } = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.post('/revoke-all-sessions', requireAuth, revokeAllSessions);
router.get('/me', requireAuth, getMe);

module.exports = router;
