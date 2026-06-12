const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { register, login, logout, getMe, deleteUserHandler } = require('../controllers/authController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, getMe);
router.delete('/me', requireAuth, deleteUserHandler);

module.exports = router;
