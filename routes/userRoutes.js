const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// Protected User Profile Routes
router.get('/me', protect, getProfile);
router.patch('/me', protect, updateProfile);

module.exports = router;
