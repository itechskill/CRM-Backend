const express = require('express');
const router = express.Router();
const { getProfile, updateProfile, getAllUsers } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

// Protected User Routes
router.get('/', protect, getAllUsers);
router.get('/me', protect, getProfile);
router.patch('/me', protect, updateProfile);

module.exports = router;

