const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const User = require('../models/User');

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
    const { leaveType, startDate, endDate, reason } = req.body;
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
      status: 'Pending'
    });

    return res.status(201).json({ success: true, message: 'Leave request submitted successfully.', data: newLeave });
  } catch (error) {
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
    return res.status(200).json({ success: true, message: `Leave status updated to ${status}.`, data: leave });
  } catch (error) {
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

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Attendance for this employee on this date already exists.'
      });
    }

    const record = await Attendance.create({
      user: targetUserId,
      userName: targetUserName,
      date: attendanceDate,
      status: status || 'Present',
      checkIn: checkIn || '09:00 AM',
      checkOut: checkOut || '05:00 PM',
      notes: notes || ''
    });

    return res.status(201).json({ success: true, message: 'Attendance recorded successfully.', data: record });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error recording attendance.' });
  }
};

module.exports = {
  getEmployees,
  createEmployee,
  getLeaves,
  createLeave,
  updateLeaveStatus,
  getAttendance,
  recordAttendance
};
