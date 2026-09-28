const User = require('./User');
const Plan = require('./Plan');
const Customer = require('./Customer');
const Session = require('./Session');

User.hasMany(Plan, { foreignKey: 'user_id' });
Plan.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Customer, { foreignKey: 'user_id' });
Customer.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Session, { foreignKey: 'user_id' });
Session.belongsTo(User, { foreignKey: 'user_id' });

Customer.hasMany(Plan, { foreignKey: 'customer_id' });
Plan.belongsTo(Customer, { foreignKey: 'customer_id' });

module.exports = {
  User, Plan, Customer, Session,
};
