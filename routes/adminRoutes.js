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
  createCeoAccount
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All routes here are protected and require Admin role
router.use(protect);
router.use(authorize('admin'));

// GET /api/admin/registration-requests
router.get('/registration-requests', getRegistrationRequests);

// GET /api/admin/registration-requests/:id
router.get('/registration-requests/:id', getRegistrationRequestById);

// PATCH /api/admin/registration-requests/:id/approve
router.patch('/registration-requests/:id/approve', approveRegistrationRequest);

// PATCH /api/admin/registration-requests/:id/reject
router.patch('/registration-requests/:id/reject', rejectRegistrationRequest);

// PATCH /api/admin/users/:id/password
router.patch('/users/:id/password', updateUserPassword);

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', updateUserRole);

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', updateUserStatus);

// POST /api/admin/ceo — Admin creates CEO account
router.post('/ceo', createCeoAccount);

module.exports = router;
