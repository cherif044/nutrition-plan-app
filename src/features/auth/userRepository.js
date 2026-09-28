const { User } = require('../../models');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');
const { normalizeEmail } = require('./firebaseService');

const PUBLIC_USER_ATTRIBUTES = [
  'id',
  'firebase_uid',
  'email',
  'username',
  'firstname',
  'lastname',
  'token_version',
  'deletion_pending_at',
  'created_at',
  'last_login',
];

async function findUserById(id) {
  return User.findByPk(id, {
    attributes: PUBLIC_USER_ATTRIBUTES,
  });
}

async function reloadPublicUser(user, transaction) {
  return User.findByPk(user.id, { attributes: PUBLIC_USER_ATTRIBUTES, transaction });
}

async function incrementTokenVersion(id) {
  const [count] = await User.update(
    { token_version: sequelize.literal('token_version + 1') },
    { where: { id } },
  );
  return count > 0;
}

function usernameBaseFromSeed(seed) {
  const base = String(seed || 'user')
    .split('@')[0]
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '')
    .replace(/^[^a-zA-Z]+/, '')
    .slice(0, 24)
    .toLowerCase();
  return base && /[a-zA-Z]/.test(base) ? base : 'user';
}

async function buildUniqueUsername(seed, transaction) {
  const base = usernameBaseFromSeed(seed);
  let candidate = base.slice(0, 30);

  for (let i = 0; i < 100; i += 1) {
    const existing = await User.findOne({
      where: { username: candidate },
      attributes: ['id'],
      transaction,
    });
    if (!existing) return candidate;
    const suffix = `-${i + 1}`;
    candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`;
  }

  return `${base.slice(0, 18)}-${Date.now().toString(36)}`.slice(0, 30);
}

async function syncFirebaseUser(profile) {
  const firebaseUid = String(profile.firebaseUid || '').trim();
  const email = normalizeEmail(profile.email);

  if (!firebaseUid) {
    const err = new Error('Firebase UID is required.');
    err.status = 401;
    throw err;
  }
  if (!email) {
    const err = new Error('Firebase account must include an email address.');
    err.status = 400;
    throw err;
  }

  return sequelize.transaction(async (transaction) => {
    const uidUser = await User.findOne({
      where: { firebase_uid: firebaseUid },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (uidUser) {
      // The stored email only ever changes to an address the provider has
      // verified, so an unverified token cannot rewrite it.
      const nextEmail = profile.emailVerified === true ? email : uidUser.email;
      if (nextEmail && uidUser.email && uidUser.email !== nextEmail) {
        const existingEmailUser = await User.findOne({
          where: { email: nextEmail, id: { [Op.ne]: uidUser.id } },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (existingEmailUser) {
          const err = new Error('This email is already linked to another account.');
          err.status = 409;
          throw err;
        }
      }

      await uidUser.update({
        email: nextEmail,
        firstname: profile.firstname || uidUser.firstname || 'User',
        lastname: profile.lastname ?? uidUser.lastname ?? '',
        last_login: new Date(),
      }, { transaction });
      return reloadPublicUser(uidUser, transaction);
    }

    const emailUser = await User.findOne({
      where: { email },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (emailUser) {
      if (emailUser.firebase_uid && emailUser.firebase_uid !== firebaseUid) {
        const err = new Error('This email is already linked to another account.');
        err.status = 409;
        throw err;
      }
      // Attaching a sign-in to an existing account by email is only safe when
      // the provider has proven the person owns that email address.
      if (!emailUser.firebase_uid && profile.emailVerified !== true) {
        const err = new Error('Please verify your email address before continuing.');
        err.status = 403;
        err.code = 'email-not-verified';
        throw err;
      }

      await emailUser.update({
        firebase_uid: firebaseUid,
        firstname: profile.firstname || emailUser.firstname || 'User',
        lastname: profile.lastname ?? emailUser.lastname ?? '',
        last_login: new Date(),
      }, { transaction });
      return reloadPublicUser(emailUser, transaction);
    }

    if (profile.emailVerified !== true) {
      const err = new Error('Please verify your email address before continuing.');
      err.status = 403;
      err.code = 'email-not-verified';
      throw err;
    }

    const username = await buildUniqueUsername(profile.usernameSeed || email || firebaseUid, transaction);
    const user = await User.create({
      firebase_uid: firebaseUid,
      email,
      username,
      firstname: profile.firstname || 'User',
      lastname: profile.lastname || '',
      last_login: new Date(),
    }, { transaction });

    return reloadPublicUser(user, transaction);
  });
}

module.exports = {
  findUserById,
  incrementTokenVersion,
  syncFirebaseUser,
  usernameBaseFromSeed,
};
