const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  listSupportTickets,
  createSupportTicket,
  updateSupportTicket
} = require('../controllers/supportTicketController');

const router = express.Router();
router.use(protect);
router.get('/', authorize('support', 'admin', 'ceo'), listSupportTickets);
router.post('/', authorize('support'), createSupportTicket);
router.patch('/:id', authorize('support'), updateSupportTicket);

module.exports = router;
