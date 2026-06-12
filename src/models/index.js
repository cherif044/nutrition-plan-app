const User = require('./User');
const Folder = require('./Folder');
const Plan = require('./Plan');

User.hasMany(Folder, { foreignKey: 'user_id' });
Folder.belongsTo(User, { foreignKey: 'user_id' });

Folder.hasMany(Folder, { as: 'children', foreignKey: 'parent_id' });
Folder.belongsTo(Folder, { as: 'parent', foreignKey: 'parent_id' });

Folder.hasMany(Plan, { foreignKey: 'folder_id' });
Plan.belongsTo(Folder, { foreignKey: 'folder_id' });

module.exports = { User, Folder, Plan };
