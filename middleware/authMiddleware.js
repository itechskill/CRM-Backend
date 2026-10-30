const jwt = require('jsonwebtoken');
const User = require('../models/User');

const ORDER_TRACKER_MUTATION_EXCEPTIONS = [
  { method: 'PUT', pattern: /^\/api\/auth\/update-password\/?$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout\/?$/ },
  { method: 'PATCH', pattern: /^\/api\/notifications\/read-all\/?$/ },
  { method: 'PATCH', pattern: /^\/api\/notifications\/[^/]+\/read\/?$/ }
];

const isOrderTrackerMutationException = req => ORDER_TRACKER_MUTATION_EXCEPTIONS.some(
  exception => exception.method === req.method && exception.pattern.test(req.path || req.originalUrl.split('?')[0])
);

const enforceOrderTrackerReadOnly = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const token = header.split(' ')[1]?.trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
    const user = await User.findById(decoded.id).select('role');
    if (user?.role === 'order_tracker' && !isOrderTrackerMutationException(req)) {
      return res.status(403).json({
        success: false,
        message: 'Order Tracker is a view-only role and cannot change records or workflow stages.'
      });
    }
  } catch (error) {
    // Authentication errors remain the responsibility of the route's protect middleware.
  }
  return next();
};

/**
 * Middleware to protect routes and verify JWT token
 */
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      const parts = req.headers.authorization.split(' ');
      if (parts.length > 1) {
        token = parts[1] ? parts[1].trim() : null;
      }

      if (!token || token === 'undefined' || token === 'null') {
        return res.status(401).json({
          success: false,
          message: 'Not authorized. Invalid authentication token.'
        });
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026'
      );

      // Fetch user associated with token (excluding password)
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'User account associated with this token no longer exists.'
        });
      }

      // Ensure the account is active and approved
      if (req.user.status !== 'active' || !req.user.isApproved) {
        let statusMsg = 'Your account is not active.';
        if (req.user.status === 'pending') {
          statusMsg = 'Your account is pending Admin approval.';
        } else if (req.user.status === 'rejected') {
          statusMsg = 'Your registration request has been rejected.';
        } else if (req.user.status === 'suspended') {
          statusMsg = 'Your account has been suspended.';
        }
        return res.status(403).json({
          success: false,
          message: statusMsg
        });
      }

      return next();
    } catch (error) {
      console.error('[Auth Middleware Error]:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Invalid or expired token.'
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. No authentication token provided.'
    });
  }
};

/**
 * Middleware to restrict route access to specific user roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. User context missing.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized to access this resource.`
      });
    }

    next();
  };
};

const { requireRole, requirePermission, requireDepartment } = require('./roleMiddleware');

module.exports = {
  protect,
  authorize,
  requireRole,
  requirePermission,
  requireDepartment,
  enforceOrderTrackerReadOnly,
  ORDER_TRACKER_MUTATION_EXCEPTIONS
};
