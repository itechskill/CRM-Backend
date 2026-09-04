const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, getAllUsers, getSidebarCounts } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// Protected User Routes
router.get('/', protect, getAllUsers);
router.get('/sidebar-counts', protect, getSidebarCounts);
router.get('/me', protect, getProfile);
router.patch('/me', protect, updateProfile);

module.exports = router;

