const express = require('express');
const router = express.Router();
const {
  getInvoices,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getPayroll,
  updatePayroll,
  deletePayroll,
  getFinanceSummary
} = require('../controllers/financeController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/summary', getFinanceSummary);
router.route('/invoices').get(getInvoices).post(createInvoice);
router.route('/invoices/:id').patch(updateInvoice).delete(deleteInvoice);
router.route('/expenses').get(getExpenses).post(createExpense);
router.route('/expenses/:id').patch(updateExpense).delete(deleteExpense);
router.route('/payroll').get(getPayroll);
router.route('/payroll/:id').patch(updatePayroll).delete(deletePayroll);

module.exports = router;
