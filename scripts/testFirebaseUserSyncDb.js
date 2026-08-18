const assert = require('assert/strict');
const crypto = require('crypto');

require('dotenv').config();

const sequelize = require('../src/config/database');
const { User } = require('../src/models');
const {
  deleteUser,
  findUserByEmail,
  findUserByFirebaseUid,
  syncFirebaseUser,
} = require('../src/repositories/userRepository');

(async () => {
  const suffix = crypto.randomBytes(5).toString('hex');
  const firebaseUid = `test-firebase-${suffix}`;
  const otherFirebaseUid = `test-firebase-other-${suffix}`;
  const email = `firebase-sync-${suffix}@example.test`;

  await sequelize.authenticate();

  const first = await syncFirebaseUser({
    firebaseUid,
    email,
    usernameSeed: email,
    firstname: 'Firebase',
    lastname: 'Sync',
  });

  try {
    assert(first.id, 'first sync creates an internal PostgreSQL user');
    assert.equal(first.firebase_uid, firebaseUid);
    assert.equal(first.email, email);
    assert.equal(first.password_hash, undefined, 'public synced user does not expose password_hash');

    const second = await syncFirebaseUser({
      firebaseUid,
      email,
      usernameSeed: email,
      firstname: 'Firebase',
      lastname: 'Updated',
    });
    assert.equal(String(second.id), String(first.id), 'repeat sync resolves the same PostgreSQL user');

    const count = await User.count({ where: { email } });
    assert.equal(count, 1, 'repeat sync does not create duplicate PostgreSQL users');

    const byUid = await findUserByFirebaseUid(firebaseUid);
    const byEmail = await findUserByEmail(email);
    assert.equal(String(byUid.id), String(first.id), 'firebase_uid resolves to internal user id');
    assert.equal(String(byEmail.id), String(first.id), 'email lookup resolves the same internal user');

    await assert.rejects(
      syncFirebaseUser({
        firebaseUid: otherFirebaseUid,
        email,
        usernameSeed: email,
        firstname: 'Firebase',
        lastname: 'Collision',
      }),
      (err) => err.status === 409,
      'same email with different Firebase UID is rejected instead of creating a duplicate user',
    );
  } finally {
    await deleteUser(first.id);
    await sequelize.close();
  }

  console.log('Firebase UID to PostgreSQL user sync DB checks passed.');
})().catch(async (err) => {
  await sequelize.close().catch(() => {});
  console.error(err);
  process.exit(1);
});
