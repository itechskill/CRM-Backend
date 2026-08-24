const express = require('express');
const router = express.Router();
const {
  getClients, createClient, deleteClient,
  getDeals, createDeal,
  getLeads, createLead
} = require('../controllers/crmController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/clients').get(getClients).post(createClient);
router.route('/clients/:id').delete(deleteClient);

router.route('/deals').get(getDeals).post(createDeal);

router.route('/leads').get(getLeads).post(createLead);

module.exports = router;
