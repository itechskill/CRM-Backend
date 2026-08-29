const express = require('express');
const router = express.Router();
const { getCampaigns, createCampaign, updateCampaign, deleteCampaign } = require('../controllers/marketingController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/campaigns').get(getCampaigns).post(createCampaign);
router.route('/campaigns/:id').patch(updateCampaign).delete(deleteCampaign);

module.exports = router;
