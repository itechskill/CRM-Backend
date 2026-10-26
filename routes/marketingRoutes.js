const express = require('express');
const router = express.Router();
const { getCampaigns, createCampaign, updateCampaign, deleteCampaign } = require('../controllers/marketingController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect, authorize('marketing', 'admin', 'ceo'));

router.route('/campaigns').get(getCampaigns).post(createCampaign);
router.route('/campaigns/:id').patch(updateCampaign).delete(deleteCampaign);

module.exports = router;
