const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { authClientEventBody, deleteAccountBody, sessionBody } = require('../../validation/schemas');
const {
  authClientEvent,
  createSession,
  deleteUserHandler,
  getFirebaseConfig,
  getMe,
  logout,
  logoutAll,
} = require('./controller');

const router = express.Router();

router.get('/firebase-config', getFirebaseConfig);
router.post('/session', validateBody(sessionBody), createSession);
router.post('/client-event', validateBody(authClientEventBody), authClientEvent);
router.post('/logout', logout);
router.post('/logout-all', requireAuth, logoutAll);
router.get('/me', requireAuth, getMe);
router.delete('/me', requireAuth, validateBody(deleteAccountBody), deleteUserHandler);

module.exports = router;
