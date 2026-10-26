const express = require('express');
const router = express.Router();
const {
  getEmployees,
  createEmployee,
  getLeaves,
  createLeave,
  updateLeaveStatus,
  getAttendance,
  recordAttendance,
  updateAttendanceSingle,
  getHRStats,
  getPerformanceReviews,
  createPerformanceReview,
  updatePerformanceReview,
  deletePerformanceReview,
  getHRReportData
} = require('../controllers/hrController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

const hrAdminGuard = authorize('hr_manager', 'administration', 'admin', 'ceo');
const personalHrGuard = authorize(
  'employee', 'support', 'finance', 'logistics', 'accountant', 'purchaser',
  'project_manager', 'marketing', 'hr_manager', 'administration', 'admin', 'ceo'
);

router.get('/stats', hrAdminGuard, getHRStats);
router.get('/report-data', hrAdminGuard, getHRReportData);
router.route('/employees').get(hrAdminGuard, getEmployees).post(hrAdminGuard, createEmployee);
router.route('/leaves').get(personalHrGuard, getLeaves).post(personalHrGuard, createLeave);
router.route('/leaves/:id/status').patch(hrAdminGuard, updateLeaveStatus);
router.route('/attendance').get(personalHrGuard, getAttendance).post(hrAdminGuard, recordAttendance);
router.route('/attendance/:id').patch(hrAdminGuard, updateAttendanceSingle);
router.route('/performance').get(hrAdminGuard, getPerformanceReviews).post(hrAdminGuard, createPerformanceReview);
router.route('/performance/:id').patch(hrAdminGuard, updatePerformanceReview).delete(hrAdminGuard, deletePerformanceReview);

module.exports = router;
