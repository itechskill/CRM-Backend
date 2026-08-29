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
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/stats', getHRStats);
router.get('/report-data', getHRReportData);
router.route('/employees').get(getEmployees).post(createEmployee);
router.route('/leaves').get(getLeaves).post(createLeave);
router.route('/leaves/:id/status').patch(updateLeaveStatus);
router.route('/attendance').get(getAttendance).post(recordAttendance);
router.route('/attendance/:id').patch(updateAttendanceSingle);
router.route('/performance').get(getPerformanceReviews).post(createPerformanceReview);
router.route('/performance/:id').patch(updatePerformanceReview).delete(deletePerformanceReview);

module.exports = router;
