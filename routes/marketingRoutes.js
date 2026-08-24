const express = require('express');
const router = express.Router();
const { getCampaigns, createCampaign } = require('../controllers/marketingController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/campaigns').get(getCampaigns).post(createCampaign);

module.exports = router;
