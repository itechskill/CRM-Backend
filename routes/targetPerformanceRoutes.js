const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  getVisibility,
  getMyTargetPerformance,
  getAdminTargetPerformance,
  updateSalary,
  updateVisibility,
  getFinanceOverdueInvoices
} = require('../controllers/targetPerformanceController');

const router = express.Router();

router.use(protect);
router.get('/visibility', authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'admin', 'ceo'), getVisibility);
router.get('/me', authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager'), getMyTargetPerformance);
router.get('/admin', authorize('admin', 'ceo'), getAdminTargetPerformance);
router.patch('/settings', authorize('admin'), updateVisibility);
router.patch('/users/:userId/salary', authorize('admin'), updateSalary);
router.get('/finance-overdue', authorize('finance', 'admin', 'ceo'), getFinanceOverdueInvoices);

module.exports = router;
