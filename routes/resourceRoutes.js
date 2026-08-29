const express = require('express');
const router = express.Router();
const { getResources, createResource } = require('../controllers/resourceController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/company-resources').get(getResources).post(createResource);

module.exports = router;
