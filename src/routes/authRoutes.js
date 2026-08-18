const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createSession,
  deleteUserHandler,
  getFirebaseConfig,
  getMe,
  legacyPasswordAuthDisabled,
  logout,
} = require('../controllers/authController');

const router = express.Router();

router.get('/firebase-config', getFirebaseConfig);
router.post('/session', createSession);
router.post('/register', legacyPasswordAuthDisabled);
router.post('/login', legacyPasswordAuthDisabled);
router.post('/logout', logout);
router.get('/me', requireAuth, getMe);
router.delete('/me', requireAuth, deleteUserHandler);

module.exports = router;
