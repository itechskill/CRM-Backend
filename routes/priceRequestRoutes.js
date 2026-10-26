const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  PRICE_REQUEST_ROLES,
  getLabelledUsers,
  getPriceRequests,
  createPriceRequest,
  priceRequest,
  declinePriceRequest,
  reassignPriceRequest,
  updatePendingNote,
  getAvailableQuotations,
  linkQuotation,
  getRoutingSuggestion,
  getRoutingRules,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule
} = require('../controllers/priceRequestController');

router.use(protect, authorize(...PRICE_REQUEST_ROLES));

router.get('/', getPriceRequests);
router.get('/labelled-users', getLabelledUsers);
router.post('/', createPriceRequest);
router.get('/assignee-suggestion', getRoutingSuggestion);
router.get('/quotations', getAvailableQuotations);
router.get('/routing-rules', getRoutingRules);
router.post('/routing-rules', authorize('admin', 'ceo'), createRoutingRule);
router.patch('/routing-rules/:id', authorize('admin', 'ceo'), updateRoutingRule);
router.delete('/routing-rules/:id', authorize('admin', 'ceo'), deleteRoutingRule);
router.post('/:id/price', priceRequest);
router.post('/:id/decline', declinePriceRequest);
router.post('/:id/reassign', reassignPriceRequest);
router.patch('/:id/pending-note', updatePendingNote);
router.post('/:id/link-quotation', linkQuotation);

module.exports = router;
