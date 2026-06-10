const bcrypt = require('bcrypt');
const zxcvbn = require('zxcvbn');
const { insertUser } = require('../repositories/userRepository');

const SALT_ROUNDS = 12;

function validateUsername(username) {
  if (typeof username !== 'string') throw new Error('Username must be a string.');
  const u = username.trim();
  if (u.length < 3) throw new Error('Username must be at least 3 characters.');
  if (u.length > 30) throw new Error('Username must be at most 30 characters.');
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) {
    throw new Error('Username may only contain letters, digits, underscores, hyphens, and dots.');
  }
  if (/^[^a-zA-Z]*$/.test(u)) {
    throw new Error('Username must contain at least one letter.');
  }
  if (/^[0-9]+$/.test(u)) {
    throw new Error('Username cannot be only digits.');
  }
  if (/^[^a-zA-Z]{2}$/.test(u) || (u.replace(/[a-zA-Z]/g, '').length >= u.length)) {
    throw new Error('Username must contain at least one letter.');
  }
  return u;
}

function validateName(value, field) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  const v = value.trim();
  if (v.length < 2) throw new Error(`${field} must be at least 2 characters.`);
  if (v.length > 50) throw new Error(`${field} must be at most 50 characters.`);
  if (!/^[a-zA-ZÀ-ɏ؀-ۿ\s'-]+$/.test(v)) {
    throw new Error(`${field} may only contain letters, spaces, hyphens, and apostrophes.`);
  }
  if (/^[\s'-]+$/.test(v)) {
    throw new Error(`${field} must contain at least one letter.`);
  }
  return v;
}

function validatePassword(password) {
  if (typeof password !== 'string') throw new Error('Password must be a string.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password.length > 128) throw new Error('Password must be at most 128 characters.');

  const result = zxcvbn(password);
  const score = result.score;

  console.log(`[auth] Password strength score: ${score}/4`);
  if (result.feedback.warning) console.log(`[auth] Password warning: ${result.feedback.warning}`);
  if (result.feedback.suggestions.length > 0) {
    console.log(`[auth] Password suggestions: ${result.feedback.suggestions.join(' ')}`);
  }

  if (score < 2) {
    const suggestion = result.feedback.suggestions[0] || 'Try mixing uppercase, lowercase, numbers, and symbols.';
    throw new Error(
      `Password is too weak (score ${score}/4). ${result.feedback.warning ? result.feedback.warning + '. ' : ''}${suggestion}`,
    );
  }

  return password;
}

async function createUser({ username, password, firstname, lastname }) {
  const cleanUsername = validateUsername(username);
  const cleanFirstname = validateName(firstname, 'First name');
  const cleanLastname = validateName(lastname, 'Last name');
  validatePassword(password);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  console.log(`[auth] Creating user: ${cleanUsername}`);

  const user = await insertUser({
    username: cleanUsername,
    passwordHash,
    firstname: cleanFirstname,
    lastname: cleanLastname,
  });

  console.log(`[auth] User created: ${cleanUsername} (id: ${user.id})`);
  return user;
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

module.exports = { createUser, verifyPassword };
