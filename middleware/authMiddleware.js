const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

const { requireRole, requirePermission } = require('./roleMiddleware');

module.exports = {
  protect,
  authorize,
  requireRole,
  requirePermission
};
