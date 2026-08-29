/**
 * Role-Based Authorization & Permission Matrix Middleware
 */

// All valid system roles
const ROLES = {
  ADMIN: 'admin',
  CEO: 'ceo',
  ADMINISTRATION: 'administration',
  HR_MANAGER: 'hr_manager',
  SALES_MANAGER: 'sales_manager',
  PROJECT_MANAGER: 'project_manager',
  MARKETING: 'marketing',
  ACCOUNTANT: 'accountant',
  EMPLOYEE: 'employee'
};

// Domain permission registry mapping roles to capabilities
const PERMISSIONS = {
  // System Administration
  MANAGE_SYSTEM: 'manage_system',
  MANAGE_REGISTRATION_REQUESTS: 'manage_registration_requests',
  MANAGE_USERS: 'manage_users',
  MANAGE_SYSTEM_SETTINGS: 'manage_system_settings',

  // Executive & Cross-Departmental Business Insights
  VIEW_CEO_DASHBOARD: 'view_ceo_dashboard',
  VIEW_BUSINESS_OVERVIEW: 'view_business_overview',
  VIEW_ALL_REPORTS: 'view_all_reports',

  // Departmental Domains
  MANAGE_ADMINISTRATION: 'manage_administration',
  MANAGE_HR: 'manage_hr',
  MANAGE_SALES: 'manage_sales',
  MANAGE_PROJECTS: 'manage_projects',
  MANAGE_MARKETING: 'manage_marketing',
  MANAGE_FINANCE: 'manage_finance',

  // Employee Self Service
  ACCESS_EMPLOYEE_PORTAL: 'access_employee_portal',
  MANAGE_OWN_TASKS: 'manage_own_tasks'
};

// Role-Permission Capabilities Matrix
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: [
    PERMISSIONS.MANAGE_SYSTEM,
    PERMISSIONS.MANAGE_REGISTRATION_REQUESTS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_SYSTEM_SETTINGS,
    PERMISSIONS.VIEW_ALL_REPORTS
  ],
  [ROLES.CEO]: [
    PERMISSIONS.VIEW_CEO_DASHBOARD,
    PERMISSIONS.VIEW_BUSINESS_OVERVIEW,
    PERMISSIONS.VIEW_ALL_REPORTS,
    PERMISSIONS.MANAGE_ADMINISTRATION,
    PERMISSIONS.MANAGE_HR,
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.MANAGE_PROJECTS,
    PERMISSIONS.MANAGE_MARKETING,
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.ADMINISTRATION]: [
    PERMISSIONS.MANAGE_ADMINISTRATION,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.HR_MANAGER]: [
    PERMISSIONS.MANAGE_HR,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.SALES_MANAGER]: [
    PERMISSIONS.MANAGE_SALES,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.PROJECT_MANAGER]: [
    PERMISSIONS.MANAGE_PROJECTS,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.MARKETING]: [
    PERMISSIONS.MANAGE_MARKETING,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.ACCOUNTANT]: [
    PERMISSIONS.MANAGE_FINANCE,
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL
  ],
  [ROLES.EMPLOYEE]: [
    PERMISSIONS.ACCESS_EMPLOYEE_PORTAL,
    PERMISSIONS.MANAGE_OWN_TASKS
  ]
};

/**
 * Reusable role-based authorization middleware
 * Supports single or multiple role arguments:
 * e.g., requireRole('admin'), requireRole('admin', 'ceo'), requireRole(['admin', 'hr_manager'])
 */
const requireRole = (...allowedRoles) => {
  // Flatten array arguments if passed as an array
  const flatRoles = allowedRoles.flat();

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. User context missing.'
      });
    }

    if (!flatRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized to perform this action.`
      });
    }

    next();
  };
};

/**
 * Reusable permission-based authorization middleware
 * e.g., requirePermission('manage_finance')
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. User context missing.'
      });
    }

    const userPermissions = ROLE_PERMISSIONS[req.user.role] || [];

    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' lacks '${permission}' permission.`
      });
    }

    next();
  };
};

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  requireRole,
  requirePermission
};
