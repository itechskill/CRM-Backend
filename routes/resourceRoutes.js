const express = require('express');
const router = express.Router();
const { getResources, createResource } = require('../controllers/resourceController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect, authorize('administration', 'admin', 'ceo'));

router.route('/company-resources').get(getResources).post(createResource);

module.exports = router;
