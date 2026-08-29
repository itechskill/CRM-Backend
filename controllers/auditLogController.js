const AuditLog = require('../models/AuditLog');

/**
 * @desc    Get all audit logs (Admin only)
 * @route   GET /api/audit-logs
 * @access  Private/Admin
 */
const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .populate('performedBy', 'fullName email role')
      .populate('targetUser', 'fullName email role')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('[Get Audit Logs Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving audit logs.'
    });
  }
};

module.exports = {
  getAuditLogs
};
