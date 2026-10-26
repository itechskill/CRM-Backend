const express = require('express');
const router = express.Router();
const {
  getClients, createClient, deleteClient,
  getDeals, createDeal, updateDeal, deleteDeal,
  getLeads, createLead, updateLead, deleteLead,
  getSalesContacts, createSalesContact, deleteSalesContact,
  getSalesSummary
} = require('../controllers/crmController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

const salesGuard = authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'admin', 'ceo');
const salesMarketingGuard = authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'marketing', 'admin', 'ceo');

router.route('/clients').get(salesMarketingGuard, getClients).post(salesMarketingGuard, createClient);
router.route('/clients/:id').delete(salesMarketingGuard, deleteClient);

router.route('/deals').get(salesGuard, getDeals).post(salesGuard, createDeal);
router.route('/deals/:id').patch(salesGuard, updateDeal).delete(salesGuard, deleteDeal);

router.route('/leads').get(salesMarketingGuard, getLeads).post(salesMarketingGuard, createLead);
router.route('/leads/:id').patch(salesMarketingGuard, updateLead).delete(salesMarketingGuard, deleteLead);

router.route('/contacts').get(salesMarketingGuard, getSalesContacts).post(salesMarketingGuard, createSalesContact);
router.route('/contacts/:id').delete(salesMarketingGuard, deleteSalesContact);

router.route('/sales-summary').get(salesMarketingGuard, getSalesSummary);

module.exports = router;
