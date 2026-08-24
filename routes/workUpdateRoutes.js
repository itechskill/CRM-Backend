const express = require('express');
const router = express.Router();
const { getWorkUpdates, createWorkUpdate } = require('../controllers/workUpdateController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/')
  .get(getWorkUpdates)
  .post(createWorkUpdate);

module.exports = router;
