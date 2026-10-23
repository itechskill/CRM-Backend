const SALES_ROLES = ['employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager'];
const GLOBAL_SALES_ROLES = ['admin', 'ceo'];

const isGlobalSalesUser = (user) => GLOBAL_SALES_ROLES.includes(user?.role);
const isSalesUser = (user) => SALES_ROLES.includes(user?.role);

const effectiveOwnerId = (record) => {
  const owner = record?.owner || record?.createdBy || null;
  return owner?._id || owner;
};

const ownsSalesRecord = (record, user) => {
  if (isGlobalSalesUser(user)) return true;
  const ownerId = effectiveOwnerId(record);
  return Boolean(ownerId && user?._id && ownerId.toString() === user._id.toString());
};

const ownerScope = (userId) => ({
  $or: [
    { owner: userId },
    { owner: { $exists: false }, createdBy: userId },
    { owner: null, createdBy: userId }
  ]
});

const applyOwnerScope = (conditions, user) => {
  const scoped = Array.isArray(conditions) ? [...conditions] : [];
  if (!isGlobalSalesUser(user)) scoped.unshift(ownerScope(user._id));
  return scoped.length ? { $and: scoped } : {};
};

module.exports = {
  SALES_ROLES,
  GLOBAL_SALES_ROLES,
  isGlobalSalesUser,
  isSalesUser,
  effectiveOwnerId,
  ownsSalesRecord,
  ownerScope,
  applyOwnerScope
};
