const express = require('express');
const router = express.Router();
const { getInvoices, createInvoice, getExpenses, createExpense } = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/invoices').get(getInvoices).post(createInvoice);
router.route('/expenses').get(getExpenses).post(createExpense);

module.exports = router;
