const express = require('express');
const router = express.Router();
const {
  getEmployees,
  createEmployee,
  getLeaves,
  createLeave,
  updateLeaveStatus,
  getAttendance,
  recordAttendance
} = require('../controllers/hrController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.route('/employees').get(getEmployees).post(createEmployee);
router.route('/leaves').get(getLeaves).post(createLeave);
router.route('/leaves/:id/status').patch(updateLeaveStatus);
router.route('/attendance').get(getAttendance).post(recordAttendance);

module.exports = router;
