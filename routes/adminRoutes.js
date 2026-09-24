const express = require('express');
const router = express.Router();
const {
  getRegistrationRequests,
  getRegistrationRequestById,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  updateUserPassword,
  updateUserEmail,
  resetUserPassword,
  updateUserRole,
  updateUserStatus,
  updateUserDepartment,
  deleteUser,
  createCeoAccount,
  getExecutiveSummary,
  getDirectoryUsers,
  getUserProfileDetails,
  getOrgUsers,
  getOrgUserPerformance,
  getOrgDepartmentStats,
  getOrgMonthlyPerformance
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

// GET /api/admin/executive-summary (Admin & CEO)
router.get('/executive-summary', authorize('admin', 'ceo'), getExecutiveSummary);

// GET /api/admin/directory & profile details (Admin & CEO)
router.get('/directory', authorize('admin', 'ceo', 'administration', 'hr_manager'), getDirectoryUsers);
router.get('/directory/:id', authorize('admin', 'ceo', 'administration', 'hr_manager'), getUserProfileDetails);

// Centralized Organization Monitoring Routes (Admin & CEO)
router.get('/org/users', authorize('admin', 'ceo'), getOrgUsers);
router.get('/org/users/:id/performance', authorize('admin', 'ceo'), getOrgUserPerformance);
router.get('/org/departments', authorize('admin', 'ceo'), getOrgDepartmentStats);
router.get('/org/monthly', authorize('admin', 'ceo'), getOrgMonthlyPerformance);

// Remaining routes require Admin or CEO for viewing
// Registration requests
router.get('/registration-requests', authorize('admin', 'ceo', 'administration'), getRegistrationRequests);
router.get('/registration-requests/:id', authorize('admin', 'ceo', 'administration'), getRegistrationRequestById);
router.patch('/registration-requests/:id/approve', authorize('admin', 'ceo', 'administration'), approveRegistrationRequest);
router.patch('/registration-requests/:id/reject', authorize('admin', 'ceo', 'administration'), rejectRegistrationRequest);
router.delete('/registration-requests/:id', authorize('admin', 'ceo', 'administration'), deleteUser);

// User Management
router.delete('/users/:id', authorize('admin', 'ceo', 'administration'), deleteUser);
router.patch('/users/:id/password', authorize('admin'), updateUserPassword);
router.patch('/users/:id/reset-password', authorize('admin'), resetUserPassword);
router.patch('/users/:id/email', authorize('admin'), updateUserEmail);
router.patch('/users/:id/role', authorize('admin', 'ceo'), updateUserRole);
router.patch('/users/:id/status', authorize('admin', 'ceo', 'administration'), updateUserStatus);
router.patch('/users/:id/department', authorize('admin', 'ceo', 'administration'), updateUserDepartment);

// POST /api/admin/ceo — Admin creates CEO account
router.post('/ceo', createCeoAccount);

module.exports = router;
