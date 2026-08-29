const express = require('express');
const router = express.Router();
const {
  getRegistrationRequests,
  getRegistrationRequestById,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  updateUserPassword,
  updateUserRole,
  updateUserStatus,
  updateUserDepartment,
  deleteUser,
  createCeoAccount,
  getExecutiveSummary,
  getDirectoryUsers,
  getUserProfileDetails
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

// GET /api/admin/executive-summary (Admin & CEO)
router.get('/executive-summary', authorize('admin', 'ceo'), getExecutiveSummary);

// GET /api/admin/directory & profile details (Admin & CEO)
router.get('/directory', authorize('admin', 'ceo', 'administration', 'hr_manager'), getDirectoryUsers);
router.get('/directory/:id', authorize('admin', 'ceo', 'administration', 'hr_manager'), getUserProfileDetails);

// Remaining routes require Admin role
router.use(authorize('admin'));

// Registration requests
router.get('/registration-requests', getRegistrationRequests);
router.get('/registration-requests/:id', getRegistrationRequestById);
router.patch('/registration-requests/:id/approve', approveRegistrationRequest);
router.patch('/registration-requests/:id/reject', rejectRegistrationRequest);
router.delete('/registration-requests/:id', deleteUser);

// User Management
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/password', updateUserPassword);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', updateUserStatus);
router.patch('/users/:id/department', updateUserDepartment);

// POST /api/admin/ceo — Admin creates CEO account
router.post('/ceo', createCeoAccount);

module.exports = router;
