const AuditLog = require('../models/AuditLog');

const logAudit = async ({ action, performedBy, performedByName, targetUser, targetUserName, details, ipAddress }) => {
  try {
    await AuditLog.create({
      action,
      performedBy: performedBy || null,
      performedByName: performedByName || (performedBy ? performedBy.fullName : 'System'),
      targetUser: targetUser || null,
      targetUserName: targetUserName || '',
      details: details || '',
      ipAddress: ipAddress || ''
    });
  } catch (error) {
    console.error('[Audit Logger Error]: Failed to create audit log entry:', error);
  }
};

module.exports = logAudit;
