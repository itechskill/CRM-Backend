const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Performance = require('../models/Performance');
const { createNotificationHelper, notifyRoleHelper } = require('./notificationController');

const HR_ROLES = ['admin', 'hr_manager', 'administration'];
const MANAGER_ROLES = [...HR_ROLES, 'ceo'];

const isHrManager = (role) => HR_ROLES.includes(role);
const isManager = (role) => MANAGER_ROLES.includes(role);

const startOfDay = (dateInput) => {
  const d = dateInput ? new Date(dateInput) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (dateInput) => {
  const d = startOfDay(dateInput);
  d.setHours(23, 59, 59, 999);
  return d;
};

// EMPLOYEES API
const getEmployees = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { search } = req.query;
    const query = { role: { $nin: ['admin'] } };

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: regex },
        { email: regex },
        { department: regex },
        { role: regex }
      ];
    }

    const employees = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: employees.length, data: employees });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving employees.' });
  }
};

const createEmployee = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const {
      fullName,
      email,
      phone,
      password,
      confirmPassword,
      role,
      department,
      employeeId
    } = req.body;

    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide fullName, email, password, and confirmPassword.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const assignedRole = (role || 'employee').toLowerCase().trim();
    if (['admin', 'ceo'].includes(assignedRole)) {
      return res.status(403).json({
        success: false,
        message: 'HR cannot create Admin or CEO accounts through this form.'
      });
    }

    const employee = new User({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      password,
      role: assignedRole,
      department: department ? department.trim() : '',
      employeeId: employeeId && employeeId.trim() !== '' ? employeeId.trim() : undefined,
      status: 'active',
      isApproved: true,
      approvedBy: req.user._id,
      approvedAt: new Date()
    });

    await employee.save();

    return res.status(201).json({
      success: true,
      message: 'Employee created successfully.',
      data: employee.toJSON()
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error creating employee.' });
  }
};

// LEAVES API
const getLeaves = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (req.user.role === 'employee') {
      query = { user: req.user._id };
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { userName: regex },
        { leaveType: regex },
        { reason: regex },
        { status: regex }
      ];
    }

    const leaves = await Leave.find(query)
      .populate('user', 'fullName email department')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: leaves.length, data: leaves });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving leave requests.' });
  }
};

const createLeave = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, proofDocument } = req.body;
    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ success: false, message: 'Please fill in all leave request fields.' });
    }

    const newLeave = await Leave.create({
      user: req.user._id,
      userName: req.user.fullName,
      leaveType,
      startDate,
      endDate,
      reason: reason.trim(),
      proofDocument: proofDocument ? proofDocument.trim() : '',
      status: 'Pending'
    });

    await notifyRoleHelper({
      role: 'hr_manager',
      sender: req.user._id,
      title: 'New Leave Request Submitted',
      message: `${req.user.fullName} submitted a ${leaveType} request.`,
      type: 'leave'
    });

    return res.status(201).json({ success: true, message: 'Leave request submitted successfully.', data: newLeave });
  } catch (error) {
    console.error('[Create Leave Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting leave request.' });
  }
};

const updateLeaveStatus = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { status, rejectionReason } = req.body;
    const leave = await Leave.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found.' });
    }

    leave.status = status;
    leave.approvedBy = req.user._id;
    if (rejectionReason) leave.rejectionReason = rejectionReason;

    await leave.save();

    if (status === 'Approved') {
      const today = startOfDay(new Date());
      const existingAtt = await Attendance.findOne({
        user: leave.user,
        date: { $gte: today, $lte: endOfDay(today) }
      });
      if (existingAtt) {
        existingAtt.status = 'On Leave';
        existingAtt.notes = `Approved ${leave.leaveType}`;
        await existingAtt.save();
      } else {
        await Attendance.create({
          user: leave.user,
          userName: leave.userName,
          date: today,
          status: 'On Leave',
          checkIn: '—',
          checkOut: '—',
          workHours: 0,
          notes: `Approved ${leave.leaveType}`
        });
      }
    }

    await createNotificationHelper({
      recipient: leave.user,
      sender: req.user._id,
      title: `Leave Request ${status}`,
      message: `Your ${leave.leaveType} request has been ${status.toLowerCase()}${rejectionReason ? `: ${rejectionReason}` : '.'}`,
      type: 'leave'
    });

    return res.status(200).json({ success: true, message: `Leave status updated to ${status}.`, data: leave });
  } catch (error) {
    console.error('[Update Leave Status Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating leave status.' });
  }
};

// ATTENDANCE API
const getAttendance = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (req.user.role === 'employee') {
      query = { user: req.user._id };
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { userName: regex },
        { status: regex },
        { notes: regex }
      ];
    }

    const attendance = await Attendance.find(query)
      .populate('user', 'fullName email department')
      .sort({ date: -1 });

    return res.status(200).json({ success: true, count: attendance.length, data: attendance });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving attendance logs.' });
  }
};

const calculateWorkingHours = (checkInStr, checkOutStr, status) => {
  if (['Absent', 'On Leave'].includes(status)) return 0;
  if (!checkInStr || !checkOutStr || checkInStr === '—' || checkOutStr === '—') return 8;

  try {
    const parseTimeToMinutes = (timeStr) => {
      const cleaned = String(timeStr).trim();
      const isPm = /pm/i.test(cleaned);
      const isAm = /am/i.test(cleaned);
      const numPart = cleaned.replace(/(am|pm)/i, '').trim();
      const [hStr, mStr] = numPart.split(':');
      let hours = parseInt(hStr, 10);
      const minutes = parseInt(mStr || '0', 10);
      if (isNaN(hours)) return null;

      if (isPm && hours < 12) hours += 12;
      if (isAm && hours === 12) hours = 0;

      return hours * 60 + minutes;
    };

    const inMins = parseTimeToMinutes(checkInStr);
    const outMins = parseTimeToMinutes(checkOutStr);

    if (inMins !== null && outMins !== null && outMins > inMins) {
      const diffMins = outMins - inMins;
      return parseFloat((diffMins / 60).toFixed(2));
    }
  } catch (e) {
    // fallback
  }
  return 8;
};

const recordAttendance = async (req, res) => {
  try {
    const { userId, status, checkIn, checkOut, notes, date } = req.body;

    let targetUserId = req.user._id;
    let targetUserName = req.user.fullName;

    if (userId && userId !== req.user._id.toString()) {
      if (!isHrManager(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to mark attendance for other employees.'
        });
      }

      const targetUser = await User.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Employee not found.' });
      }
      targetUserId = targetUser._id;
      targetUserName = targetUser.fullName;
    }

    const attendanceDate = startOfDay(date);

    const existing = await Attendance.findOne({
      user: targetUserId,
      date: { $gte: attendanceDate, $lte: endOfDay(date) }
    });

    const checkInVal = checkIn || (existing ? existing.checkIn : '09:00 AM');
    const checkOutVal = checkOut || (existing ? existing.checkOut : '05:00 PM');
    const statusVal = status || (existing ? existing.status : 'Present');
    const calculatedHours = calculateWorkingHours(checkInVal, checkOutVal, statusVal);

    if (existing) {
      existing.status = statusVal;
      existing.checkIn = checkInVal;
      existing.checkOut = checkOutVal;
      existing.workHours = calculatedHours;
      existing.notes = notes || existing.notes;
      await existing.save();

      await createNotificationHelper({
        recipient: targetUserId,
        sender: req.user._id,
        title: 'Attendance Record Updated',
        message: `HR updated your attendance record for ${new Date(attendanceDate).toLocaleDateString()} to ${statusVal}.`,
        type: 'attendance'
      });

      return res.status(200).json({ success: true, message: 'Attendance record updated successfully.', data: existing });
    }

    const record = await Attendance.create({
      user: targetUserId,
      userName: targetUserName,
      date: attendanceDate,
      status: statusVal,
      checkIn: checkInVal,
      checkOut: checkOutVal,
      workHours: calculatedHours,
      notes: notes || ''
    });

    await createNotificationHelper({
      recipient: targetUserId,
      sender: req.user._id,
      title: 'Attendance Recorded',
      message: `HR marked your attendance for ${new Date(attendanceDate).toLocaleDateString()} as ${statusVal}.`,
      type: 'attendance'
    });

    return res.status(201).json({ success: true, message: 'Attendance recorded successfully.', data: record });
  } catch (error) {
    console.error('[Record Attendance Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error recording attendance.' });
  }
};

// PATCH /api/hr/attendance/:id — Update a specific attendance record (status change / times edit)
const updateAttendanceSingle = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { status, checkIn, checkOut, notes } = req.body;
    const record = await Attendance.findById(req.params.id).populate('user', 'fullName email department');

    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found.' });
    }

    if (status) record.status = status;
    if (checkIn !== undefined) record.checkIn = checkIn;
    if (checkOut !== undefined) record.checkOut = checkOut;
    if (notes !== undefined) record.notes = notes;

    record.workHours = calculateWorkingHours(record.checkIn, record.checkOut, record.status);

    await record.save();

    // Notify the employee
    if (record.user) {
      await createNotificationHelper({
        recipient: record.user._id || record.user,
        sender: req.user._id,
        title: 'Attendance Status Updated',
        message: `Your attendance record for ${new Date(record.date).toLocaleDateString()} has been updated to ${record.status}.`,
        type: 'attendance'
      });
    }

    return res.status(200).json({ success: true, message: 'Attendance record updated.', data: record });
  } catch (error) {
    console.error('[Update Attendance Single Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating attendance record.' });
  }
};

// GET /api/hr/stats
const getHRStats = async (req, res) => {
  try {
    const totalEmployees = await User.countDocuments({ status: 'active', role: { $ne: 'admin' } });

    const today = startOfDay(new Date());
    const todayAttendance = await Attendance.find({
      date: { $gte: today, $lte: endOfDay(today) }
    });

    const presentToday = todayAttendance.filter(a => ['Present', 'Late'].includes(a.status)).length;
    const absentToday = todayAttendance.filter(a => a.status === 'Absent').length;
    const onLeaveToday = todayAttendance.filter(a => a.status === 'On Leave').length;

    const pendingLeavesCount = await Leave.countDocuments({ status: 'Pending' });

    return res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        presentToday,
        absentToday,
        onLeaveToday,
        pendingLeavesCount
      }
    });
  } catch (error) {
    console.error('[Get HR Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching HR stats.' });
  }
};

// PERFORMANCE API
// GET /api/hr/performance
const getPerformanceReviews = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { period, search } = req.query;
    let query = {};
    if (period && period.trim()) {
      query.period = period.trim();
    }

    let reviews = await Performance.find(query)
      .populate('user', 'fullName email department role employeeId')
      .populate('reviewedBy', 'fullName')
      .sort({ createdAt: -1 });

    // Apply search filter on populated user name
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      reviews = reviews.filter(r =>
        (r.user?.fullName || '').toLowerCase().includes(term) ||
        (r.user?.department || '').toLowerCase().includes(term)
      );
    }

    return res.status(200).json({ success: true, count: reviews.length, data: reviews });
  } catch (error) {
    console.error('[Get Performance Reviews Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving performance reviews.' });
  }
};

// POST /api/hr/performance
const createPerformanceReview = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { userId, period, rating, goals, score, status, notes } = req.body;

    if (!userId || !period) {
      return res.status(400).json({ success: false, message: 'User ID and period are required.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    // Check if review already exists for this user+period
    const existing = await Performance.findOne({ user: userId, period });
    if (existing) {
      return res.status(409).json({ success: false, message: `A review for this employee for ${period} already exists. Please edit the existing review.` });
    }

    const review = await Performance.create({
      user: userId,
      period,
      rating: rating !== undefined ? Number(rating) : 0,
      goals: goals !== undefined ? Number(goals) : 0,
      score: score !== undefined ? Number(score) : 0,
      status: status || 'Average',
      notes: notes || '',
      reviewedBy: req.user._id
    });

    const populated = await Performance.findById(review._id)
      .populate('user', 'fullName email department role')
      .populate('reviewedBy', 'fullName');

    // Notify employee
    await createNotificationHelper({
      recipient: userId,
      sender: req.user._id,
      title: 'Performance Review Created',
      message: `Your ${period} performance review has been submitted. Rating: ${rating}/5, Overall Score: ${score}%.`,
      type: 'system'
    });

    return res.status(201).json({ success: true, message: 'Performance review created.', data: populated });
  } catch (error) {
    console.error('[Create Performance Review Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating performance review.' });
  }
};

// PATCH /api/hr/performance/:id
const updatePerformanceReview = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { period, rating, goals, score, status, notes } = req.body;
    const review = await Performance.findById(req.params.id);

    if (!review) {
      return res.status(404).json({ success: false, message: 'Performance review not found.' });
    }

    if (period !== undefined) review.period = period;
    if (rating !== undefined) review.rating = Number(rating);
    if (goals !== undefined) review.goals = Number(goals);
    if (score !== undefined) review.score = Number(score);
    if (status !== undefined) review.status = status;
    if (notes !== undefined) review.notes = notes;
    review.reviewedBy = req.user._id;

    await review.save();

    const populated = await Performance.findById(review._id)
      .populate('user', 'fullName email department role')
      .populate('reviewedBy', 'fullName');

    return res.status(200).json({ success: true, message: 'Performance review updated.', data: populated });
  } catch (error) {
    console.error('[Update Performance Review Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating performance review.' });
  }
};

// DELETE /api/hr/performance/:id
const deletePerformanceReview = async (req, res) => {
  try {
    if (!isHrManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const review = await Performance.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Performance review not found.' });
    }

    return res.status(200).json({ success: true, message: 'Performance review deleted.' });
  } catch (error) {
    console.error('[Delete Performance Review Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting performance review.' });
  }
};

// GET /api/hr/report-data — Aggregated data for HR Reports/PDF exports
const getHRReportData = async (req, res) => {
  try {
    if (!isHrManager(req.user.role) && !isManager(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // All active employees
    const employees = await User.find({ status: 'active', role: { $ne: 'admin' } })
      .select('-password')
      .sort({ fullName: 1 });

    // Today's attendance
    const today = startOfDay(new Date());
    const todayAttendance = await Attendance.find({
      date: { $gte: today, $lte: endOfDay(today) }
    }).populate('user', 'fullName department');

    // Recent attendance (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentAttendance = await Attendance.find({
      date: { $gte: thirtyDaysAgo }
    }).populate('user', 'fullName department');

    // Latest performance reviews
    const performanceReviews = await Performance.find()
      .populate('user', 'fullName department role')
      .sort({ createdAt: -1 });

    // Pending leaves
    const pendingLeaves = await Leave.find({ status: 'Pending' })
      .populate('user', 'fullName department')
      .sort({ createdAt: -1 });

    // All leaves
    const allLeaves = await Leave.find()
      .populate('user', 'fullName department');

    // Department breakdown
    const deptMap = {};
    employees.forEach(emp => {
      const dept = emp.department || 'Unassigned';
      if (!deptMap[dept]) deptMap[dept] = 0;
      deptMap[dept]++;
    });

    const departmentStats = Object.entries(deptMap).map(([dept, headcount]) => ({
      dept,
      headcount,
      avgPerf: (() => {
        const deptReviews = performanceReviews.filter(r => r.user?.department === dept);
        if (!deptReviews.length) return 0;
        return Math.round(deptReviews.reduce((sum, r) => sum + r.score, 0) / deptReviews.length);
      })()
    }));

    return res.status(200).json({
      success: true,
      data: {
        employees,
        todayAttendance,
        recentAttendance,
        performanceReviews,
        pendingLeaves,
        allLeaves,
        departmentStats,
        summary: {
          totalEmployees: employees.length,
          presentToday: todayAttendance.filter(a => ['Present', 'Late'].includes(a.status)).length,
          absentToday: todayAttendance.filter(a => a.status === 'Absent').length,
          onLeaveToday: todayAttendance.filter(a => a.status === 'On Leave').length,
          pendingLeavesCount: pendingLeaves.length,
          totalReviews: performanceReviews.length,
          avgScore: performanceReviews.length
            ? Math.round(performanceReviews.reduce((sum, r) => sum + r.score, 0) / performanceReviews.length)
            : 0
        }
      }
    });
  } catch (error) {
    console.error('[Get HR Report Data Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching HR report data.' });
  }
};

module.exports = {
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
};
