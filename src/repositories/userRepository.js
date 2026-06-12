const { User } = require('../models');

async function insertUser({ username, passwordHash, firstname, lastname }) {
  try {
    const user = await User.create({ username, password_hash: passwordHash, firstname, lastname });
    return user;
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') throw new Error('Username is already taken.');
    throw err;
  }
}

async function findUserByUsername(username) {
  return User.findOne({ where: { username: String(username).trim() } });
}

async function findUserById(id) {
  return User.findByPk(id, {
    attributes: ['id', 'username', 'firstname', 'lastname', 'token_version', 'created_at', 'last_login'],
  });
}

async function updateLastLogin(id) {
  await User.update({ last_login: new Date() }, { where: { id } });
}

async function incrementTokenVersion(id) {
  await User.increment({ token_version: 1 }, { where: { id } });
  const user = await User.findByPk(id, { attributes: ['token_version'] });
  return user?.token_version;
}

async function deleteUser(id) {
  const count = await User.destroy({ where: { id } });
  return count > 0;
}

module.exports = {
  insertUser,
  findUserByUsername,
  findUserById,
  updateLastLogin,
  incrementTokenVersion,
  deleteUser,
};
