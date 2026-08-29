const express = require('express');
const router = express.Router();
const {
  getClients, createClient, deleteClient,
  getDeals, createDeal, updateDeal, deleteDeal,
  getLeads, createLead, updateLead, deleteLead
} = require('../controllers/crmController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/clients').get(getClients).post(createClient);
router.route('/clients/:id').delete(deleteClient);

router.route('/deals').get(getDeals).post(createDeal);
router.route('/deals/:id').patch(updateDeal).delete(deleteDeal);

router.route('/leads').get(getLeads).post(createLead);
router.route('/leads/:id').patch(updateLead).delete(deleteLead);

module.exports = router;
