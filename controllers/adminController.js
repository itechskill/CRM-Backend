const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const Campaign = require('../models/Campaign');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const SalesOrder = require('../models/SalesOrder');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const DeliveryNote = require('../models/DeliveryNote');
const Payment = require('../models/Payment');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const InventoryItem = require('../models/InventoryItem');
const JobPosting = require('../models/JobPosting');
const JobApplication = require('../models/JobApplication');
const AuditLog = require('../models/AuditLog');
const { createNotificationHelper } = require('./notificationController');
const logAudit = require('../utils/auditLogger');

/**
 * @desc    Get all registration requests (Admin only)
 * @route   GET /api/admin/registration-requests
 * @access  Private/Admin
 */
const getRegistrationRequests = async (req, res) => {
  try {
    const { status, search } = req.query;

    const query = { role: { $ne: 'admin' } };
    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: regex },
        { email: regex },
        { role: regex },
        { department: regex }
      ];
    }

    const requests = await User.find(query)
      .select('-password')
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('[Get Registration Requests Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving registration requests.'
    });
  }
};

/**
 * @desc    Get single registration request details by ID (Admin only)
 * @route   GET /api/admin/registration-requests/:id
 * @access  Private/Admin
 */
const getRegistrationRequestById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('approvedBy', 'fullName email')
      .populate('rejectedBy', 'fullName email');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Registration request not found.'
      });
    }

    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('[Get Registration Request By ID Error]:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid registration request ID format.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving registration request details.'
    });
  }
};

/**
 * @desc    Approve a registration request (Admin only)
 * @route   PATCH /api/admin/registration-requests/:id/approve
 * @access  Private/Admin
 */
const approveRegistrationRequest = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Registration request not found.'
      });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify approval status of an Admin account.'
      });
    }

    user.status = 'active';
    user.isApproved = true;
    user.approvedBy = req.user._id;
    user.approvedAt = new Date();

    user.rejectedBy = null;
    user.rejectedAt = null;
    user.rejectionReason = '';

    await user.save();

    await logAudit({
      action: 'User Approved',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} approved registration request for ${user.fullName} (${user.email})`
    });

    const updatedUser = await User.findById(user._id)
      .select('-password')
      .populate('approvedBy', 'fullName email');

    return res.status(200).json({
      success: true,
      message: `Registration request for ${user.fullName} (${user.email}) has been approved successfully. Account is now active.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('[Approve Registration Request Error]:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid registration request ID format.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error approving registration request.'
    });
  }
};

/**
 * @desc    Reject a registration request (Admin only)
 * @route   PATCH /api/admin/registration-requests/:id/reject
 * @access  Private/Admin
 */
const rejectRegistrationRequest = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Registration request not found.'
      });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reject an Admin account.'
      });
    }

    user.status = 'rejected';
    user.isApproved = false;
    user.rejectedBy = req.user._id;
    user.rejectedAt = new Date();
    user.rejectionReason = rejectionReason && rejectionReason.trim() !== ''
      ? rejectionReason.trim()
      : 'Registration request was rejected by administrator.';

    await user.save();

    await logAudit({
      action: 'User Rejected',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} rejected registration request for ${user.fullName}. Reason: ${user.rejectionReason}`
    });

    const updatedUser = await User.findById(user._id)
      .select('-password')
      .populate('rejectedBy', 'fullName email');

    return res.status(200).json({
      success: true,
      message: `Registration request for ${user.fullName} (${user.email}) has been rejected.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('[Reject Registration Request Error]:', error);
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Invalid registration request ID format.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error rejecting registration request.'
    });
  }
};

/**
 * @desc    Admin Update User Password (Admin only)
 * @route   PATCH /api/admin/users/:id/password
 * @access  Private/Admin
 */
const updateUserPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const targetUserId = req.params.id;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both newPassword and confirmPassword.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match.'
      });
    }

    // Complexity Validation: 8+ chars, upper, lower, number, special char
    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);

    if (newPassword.length < 8 || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.'
      });
    }

    const user = await User.findById(targetUserId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    // Set new password (pre-save hook will hash with bcrypt)
    user.password = newPassword;
    await user.save();

    await logAudit({
      action: 'Password Updated',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} updated password for user ${user.fullName} (${user.email})`
    });

    return res.status(200).json({
      success: true,
      message: `Password for ${user.fullName} (${user.email}) updated successfully.`
    });
  } catch (error) {
    console.error('[Admin Update Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating user password.'
    });
  }
};

/**
 * @desc    Admin Update User Email (Admin only)
 * @route   PATCH /api/admin/users/:id/email
 * @access  Private/Admin
 */
const updateUserEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const targetUserId = req.params.id;

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
    const normalizedEmail = email.toLowerCase().trim();

    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email format.'
      });
    }

    // Check if another account already uses this email
    const existingUser = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: targetUserId }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const oldEmail = user.email;
    if (oldEmail === normalizedEmail) {
      return res.status(200).json({
        success: true,
        message: 'Email is already set to this address.',
        data: user.toJSON()
      });
    }

    user.email = normalizedEmail;
    await user.save();

    await logAudit({
      action: 'User Email Updated',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} changed email of ${user.fullName} from ${oldEmail} to ${user.email}`
    });

    const updatedUser = await User.findById(user._id).select('-password');

    return res.status(200).json({
      success: true,
      message: `Email for ${user.fullName} updated to ${user.email} successfully.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('[Admin Update User Email Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating user email.'
    });
  }
};

/**
 * @desc    Admin Reset User / CEO Password (Admin only)
 * @route   PATCH /api/admin/users/:id/reset-password
 * @access  Private/Admin
 */
const resetUserPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const targetUserId = req.params.id;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both newPassword and confirmPassword.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match.'
      });
    }

    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);

    if (newPassword.length < 8 || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.'
      });
    }

    const user = await User.findById(targetUserId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Target user account not found.'
      });
    }

    user.password = newPassword;
    await user.save();

    const isCeo = user.role === 'ceo';
    await logAudit({
      action: isCeo ? 'CEO Password Reset' : 'User Password Reset',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} performed password reset for ${isCeo ? 'CEO' : 'user'} ${user.fullName} (${user.email})`
    });

    return res.status(200).json({
      success: true,
      message: `Password for ${isCeo ? 'CEO ' : ''}${user.fullName} (${user.email}) has been reset successfully.`
    });
  } catch (error) {
    console.error('[Admin Reset Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error resetting password.'
    });
  }
};

/**
 * @desc    Admin Update User Role (Admin only)
 * @route   PATCH /api/admin/users/:id/role
 * @access  Private/Admin
 */
const updateUserRole = async (req, res) => {
  try {
    const { role, purchaserSubDept } = req.body;
    const targetUserId = req.params.id;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Please specify a role.'
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const oldRole = user.role;
    user.role = role.toLowerCase().trim();
    if (purchaserSubDept) {
      user.purchaserSubDept = purchaserSubDept;
    }
    await user.save();

    await logAudit({
      action: 'Role Changed',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} changed role of ${user.fullName} from ${oldRole} to ${user.role}`
    });

    const updatedUser = await User.findById(user._id).select('-password');

    return res.status(200).json({
      success: true,
      message: `Role for ${user.fullName} updated from ${oldRole} to ${user.role}.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('[Admin Update Role Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating user role.'
    });
  }
};

/**
 * @desc    Admin Update User Status (Suspend/Activate) (Admin only)
 * @route   PATCH /api/admin/users/:id/status
 * @access  Private/Admin
 */
const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const targetUserId = req.params.id;

    if (!['active', 'suspended', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status provided.'
      });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const oldStatus = user.status;
    user.status = status;
    if (status === 'active') {
      user.isApproved = true;
    }
    await user.save();

    const actionName = status === 'suspended' ? 'User Suspended' : (status === 'active' ? 'User Activated' : 'Status Updated');

    await logAudit({
      action: actionName,
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: user.fullName,
      details: `Admin ${req.user.fullName} updated status of ${user.fullName} from ${oldStatus} to ${status}`
    });

    const updatedUser = await User.findById(user._id).select('-password');

    return res.status(200).json({
      success: true,
      message: `Status for ${user.fullName} updated to ${status}.`,
      data: updatedUser
    });
  } catch (error) {
    console.error('[Admin Update Status Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating user status.'
    });
  }
};

/**
 * @desc    Admin creates CEO account (Admin only)
 * @route   POST /api/admin/ceo
 * @access  Private/Admin
 */
const createCeoAccount = async (req, res) => {
  try {
    const { fullName, email, phone, password, confirmPassword, status } = req.body;

    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide fullName, email, password, and confirmPassword.'
      });
    }

    const nameRegex = /^[A-Za-z\s]+$/;
    if (!nameRegex.test(fullName.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Full Name must contain only alphabetic letters and spaces.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirmPassword do not match.'
      });
    }

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    if (password.length < 8 || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    const accountStatus = status === 'suspended' ? 'suspended' : 'active';

    const ceoUser = new User({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      password,
      role: 'ceo',
      status: accountStatus,
      isApproved: true,
      department: 'Executive Leadership'
    });

    await ceoUser.save();

    await logAudit({
      action: 'CEO Account Created',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: ceoUser._id,
      targetUserName: ceoUser.fullName,
      details: `Admin ${req.user.fullName} created CEO account for ${ceoUser.fullName} (${ceoUser.email})`
    });

    const userResponse = ceoUser.toJSON();

    return res.status(201).json({
      success: true,
      message: `CEO account for ${ceoUser.fullName} created successfully.`,
      data: userResponse
    });
  } catch (error) {
    console.error('[Create CEO Account Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating CEO account.'
    });
  }
};

/**
 * @desc    Get system-wide executive summary (Admin & CEO)
 * @route   GET /api/admin/executive-summary
 * @access  Private/Admin/CEO
 */
const getExecutiveSummary = async (req, res) => {
  try {
    const { period = 'all', startDate, endDate } = req.query;

    // Helper for date filtering
    let dateFilter = {};
    let paymentDateFilter = {};
    const now = new Date();

    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    } else if (period === 'today') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    } else if (period === 'this_week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const s = new Date(now.setDate(diff));
      s.setHours(0, 0, 0, 0);
      const e = new Date();
      e.setHours(23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    } else if (period === 'this_month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    } else if (period === 'last_month') {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    } else if (period === 'this_year') {
      const s = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      dateFilter = { createdAt: { $gte: s, $lte: e } };
      paymentDateFilter = { paymentDate: { $gte: s, $lte: e } };
    }

    // Organization & User Queries
    const [
      allUsers,
      totalProjects,
      activeProjects,
      completedProjects,
      tasks,
      leads,
      deals,
      quotations,
      salesOrders,
      deliveryNotes,
      invoices,
      payments,
      expenses,
      leaves,
      todayAttendance,
      recentAuditLogs
    ] = await Promise.all([
      User.find().select('-password').lean(),
      Project.countDocuments(),
      Project.countDocuments({ status: 'In Progress' }),
      Project.countDocuments({ status: 'Completed' }),
      Task.find(dateFilter).select('status priority category').lean(),
      Lead.find(dateFilter).lean(),
      Deal.find(dateFilter).lean(),
      Quotation.find(dateFilter).lean(),
      SalesOrder.find(dateFilter).sort({ createdAt: -1 }).lean(),
      DeliveryNote.find(dateFilter).sort({ createdAt: -1 }).lean(),
      Invoice.find(dateFilter).sort({ createdAt: -1 }).lean(),
      Payment.find(Object.keys(paymentDateFilter).length > 0 ? paymentDateFilter : dateFilter).lean(),
      Expense.find(dateFilter).lean(),
      Leave.find(dateFilter).lean(),
      Attendance.find({
        date: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999))
        }
      }).lean(),
      AuditLog.find().sort({ createdAt: -1 }).limit(10).lean()
    ]);

    // User breakdown
    const totalUsers = allUsers.length;
    const activeEmployees = allUsers.filter(u => u.status === 'active' && u.isApproved !== false).length;
    const pendingUsers = allUsers.filter(u => u.status === 'pending' || u.isApproved === false).length;
    const inactiveUsers = allUsers.filter(u => ['inactive', 'suspended', 'rejected', 'deactivated'].includes(u.status)).length;
    const approvedUsers = allUsers.filter(u => u.isApproved === true).length;
    const rejectedUsers = allUsers.filter(u => u.status === 'rejected').length;
    const suspendedUsers = allUsers.filter(u => u.status === 'suspended').length;

    // Users by role mapping
    const usersByRole = {};
    allUsers.forEach(u => {
      const r = u.role || 'employee';
      usersByRole[r] = (usersByRole[r] || 0) + 1;
    });

    // Users by department mapping
    const usersByDepartment = {};
    allUsers.forEach(u => {
      const d = u.department || 'General';
      usersByDepartment[d] = (usersByDepartment[d] || 0) + 1;
    });

    const salesTeamCount = allUsers.filter(u => ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'].includes(u.role) && u.status === 'active').length;
    const supportTeamCount = allUsers.filter(u => u.role === 'support' && u.status === 'active').length;
    const accountsTeamCount = allUsers.filter(u => u.role === 'accountant' && u.status === 'active').length;
    const financeTeamCount = allUsers.filter(u => u.role === 'finance' && u.status === 'active').length;
    const hrTeamCount = allUsers.filter(u => ['hr_manager', 'administration'].includes(u.role) && u.status === 'active').length;
    const logisticsTeamCount = allUsers.filter(u => (u.role === 'logistics' || (u.department && u.department.toLowerCase().includes('logistic'))) && u.status === 'active').length;
    const localPurchaserTeamCount = allUsers.filter(u => ((u.role === 'purchaser' && (u.purchaserSubDept === 'Local' || !u.purchaserSubDept)) || (u.department && u.department.toLowerCase().includes('local'))) && u.status === 'active').length;
    const globalPurchaserTeamCount = allUsers.filter(u => ((u.role === 'purchaser' && u.purchaserSubDept === 'Global') || (u.department && u.department.toLowerCase().includes('global'))) && u.status === 'active').length;
    const purchaserTeamCount = allUsers.filter(u => (u.role === 'purchaser' || (u.department && u.department.toLowerCase().includes('purchas'))) && u.status === 'active').length;

    const registeredUsersList = allUsers.map(u => ({
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone || '',
      role: u.role || 'employee',
      department: u.department || '',
      purchaserSubDept: u.purchaserSubDept || null,
      status: u.status || 'active',
      isApproved: u.isApproved,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
      employeeId: u.employeeId || ''
    }));

    // Sales metrics
    const totalLeads = leads.length;
    const qualifiedLeads = leads.filter(l => l.status === 'Qualified').length;
    const totalDeals = deals.length;
    const activeDeals = deals.filter(d => !['Closed Won', 'Closed Lost', 'Won', 'Lost'].includes(d.stage)).length;
    const wonDeals = deals.filter(d => ['Closed Won', 'Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonRevenue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const pipelineValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

    const totalQuotations = quotations.length;
    const activeQuotations = quotations.filter(q => !q.isConverted && !['Converted', 'Ordered', 'Rejected', 'Cancelled'].includes(q.status)).length;
    const convertedQuotations = quotations.filter(q => q.isConverted === true || ['Converted', 'Ordered'].includes(q.status)).length;

    // Sales Orders metrics
    const totalSalesOrders = salesOrders.length;
    const ordersPendingFinance = salesOrders.filter(o => 
      o.workflowStatus === 'Pending Finance Approval' || 
      (o.requiresFinanceApproval && !o.financeApprovedBy && !['Cancelled', 'Finance Rejected'].includes(o.status))
    ).length;
    const ordersFinanceApproved = salesOrders.filter(o => 
      o.workflowStatus === 'Finance Approved' || !!o.financeApprovedBy
    ).length;
    const ordersFinanceRejected = salesOrders.filter(o => 
      o.workflowStatus === 'Finance Rejected' || o.status === 'Finance Rejected'
    ).length;
    const ordersSentToSupport = salesOrders.filter(o => 
      ['Sent to Support', 'Delivery Note Created', 'Delivered', 'Done'].includes(o.workflowStatus) || 
      !!o.deliveryNoteId || 
      ['Delivered', 'Fully Delivered', 'Partially Delivered'].includes(o.deliveryStatus)
    ).length;
    const totalSalesOrderRevenue = salesOrders.reduce((sum, o) => sum + (o.netAmount || o.totalAmount || 0), 0);

    // Support metrics
    const totalDeliveryNotes = deliveryNotes.length;
    const pendingDeliveryNotes = deliveryNotes.filter(d => 
      ['Draft', 'Created', 'Waiting', 'Ready', 'Pending', 'In Transit', 'Dispatched', 'Partially Delivered'].includes(d.status)
    ).length;
    const confirmedDeliveryNotes = deliveryNotes.filter(d => 
      ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)
    ).length;

    // Accounts metrics
    const draftInvoices = invoices.filter(i => i.isDraft || i.status === 'Draft');
    const draftInvoicesCount = draftInvoices.length;
    const draftInvoicesAmount = draftInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const pendingFinanceFinalizationInvoices = invoices.filter(i => 
      ['Pending Finance Finalization', 'Pending Review', 'Submitted'].includes(i.status)
    ).length;

    // Finance metrics
    const finalizedInvoicesList = invoices.filter(i => 
      ['Finalized', 'Approved', 'Paid', 'Partially Paid', 'Overdue', 'Sent'].includes(i.status) && !i.isDraft
    );
    const finalInvoicesCount = finalizedInvoicesList.length;
    const paidInvoicesList = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesCount = paidInvoicesList.length;
    const partiallyPaidInvoicesCount = invoices.filter(i => i.status === 'Partially Paid').length;
    const unpaidInvoicesCount = finalizedInvoicesList.filter(i => i.status !== 'Paid').length;
    
    const overdueInvoicesList = finalizedInvoicesList.filter(i => 
      i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now && i.status !== 'Paid')
    );
    const overdueInvoicesCount = overdueInvoicesList.length;
    const actualOverdueAmount = overdueInvoicesList.reduce((sum, i) => sum + (i.outstandingAmount || i.amount || 0), 0);

    const gstInvoicesCount = finalizedInvoicesList.filter(i => i.invoiceType === 'GST Invoice').length;
    const cashInvoicesCount = finalizedInvoicesList.filter(i => i.invoiceType === 'Cash Invoice').length;

    const totalInvoiced = finalizedInvoicesList.reduce((sum, i) => sum + (i.amount || 0), 0);
    const actualReceivables = finalizedInvoicesList.filter(i => i.status !== 'Paid').reduce((sum, i) => sum + (i.outstandingAmount != null ? i.outstandingAmount : (i.amount - (i.paidAmount || 0))), 0);
    
    // Revenue collected
    const collectedRevenueFromPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const collectedRevenueFromInvoices = finalizedInvoicesList.reduce((sum, i) => sum + (i.paidAmount || 0), 0);
    const collectedRevenue = collectedRevenueFromPayments > 0 ? collectedRevenueFromPayments : collectedRevenueFromInvoices;

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = collectedRevenue - totalExpenses;

    // HR Metrics
    const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;
    const approvedLeaves = leaves.filter(l => l.status === 'Approved').length;
    const presentTodayCount = todayAttendance.filter(a => a.status === 'Present').length;
    const attendanceRate = todayAttendance.length > 0 ? Math.round((presentTodayCount / todayAttendance.length) * 100) : (activeEmployees > 0 ? 100 : 0);

    // Recent records for executive tables
    const recentOrders = salesOrders.slice(0, 10).map(o => ({
      _id: o._id,
      orderNumber: o.orderNumber || o.orderReference || 'SO-000',
      clientName: o.clientName || 'Client',
      amount: o.netAmount || o.totalAmount || 0,
      workflowStatus: o.workflowStatus || o.status || 'Created',
      deliveryStatus: o.deliveryStatus || 'Not Delivered',
      invoiceStatus: o.invoiceStatus || 'Not Invoiced',
      paymentStatus: o.paymentStatus || 'Pending',
      orderDate: o.orderDate || o.createdAt,
      salesPersonName: o.salePerson || ''
    }));

    const recentInvoices = finalizedInvoicesList.slice(0, 10).map(i => ({
      _id: i._id,
      invoiceNumber: i.invoiceNumber || 'INV-000',
      clientName: i.clientName || 'Client',
      amount: i.amount || 0,
      paidAmount: i.paidAmount || 0,
      outstandingAmount: i.outstandingAmount != null ? i.outstandingAmount : (i.amount - (i.paidAmount || 0)),
      status: i.status,
      invoiceType: i.invoiceType || 'Standard',
      dueDate: i.dueDate,
      issueDate: i.issueDate || i.createdAt
    }));

    return res.status(200).json({
      success: true,
      data: {
        period,
        // Executive KPI summary
        totalUsers,
        totalEmployees: activeEmployees,
        activeEmployees,
        pendingUsers,
        inactiveUsers,
        approvedUsers,
        rejectedUsers,
        suspendedUsers,
        usersByRole,
        usersByDepartment,
        salesTeamCount,
        supportTeamCount,
        accountsTeamCount,
        financeTeamCount,
        hrTeamCount,
        logisticsTeamCount,
        purchaserTeamCount,
        localPurchaserTeamCount,
        globalPurchaserTeamCount,
        registeredUsersList,
        
        // Sales Stage
        totalLeads,
        qualifiedLeads,
        totalDeals,
        activeDeals,
        wonDealsCount,
        wonRevenue,
        pipelineValue,
        totalQuotations,
        activeQuotations,
        convertedQuotations,
        totalSalesOrders,
        salesOrders: totalSalesOrders,
        ordersPendingFinance,
        ordersFinanceApproved,
        ordersFinanceRejected,
        ordersSentToSupport,
        totalSalesOrderRevenue,

        // Support Stage
        salesOrdersReceived: ordersSentToSupport,
        totalDeliveryNotes,
        deliveryNotes: totalDeliveryNotes,
        pendingDeliveryNotes,
        confirmedDeliveryNotes,

        // Accounts Stage
        deliveryNotesReceived: confirmedDeliveryNotes,
        draftInvoices: draftInvoicesCount,
        draftInvoicesCount,
        draftInvoicesAmount,
        pendingFinanceFinalization: pendingFinanceFinalizationInvoices,
        pendingFinanceFinalizationInvoices,

        // Finance Stage
        finalInvoices: finalInvoicesCount,
        finalInvoicesCount,
        paidInvoices: paidInvoicesCount,
        paidInvoicesCount,
        partiallyPaidInvoicesCount,
        unpaidInvoices: unpaidInvoicesCount,
        unpaidInvoicesCount,
        overdueInvoices: overdueInvoicesCount,
        overdueInvoicesCount,
        gstInvoicesCount,
        cashInvoicesCount,
        totalInvoiced,
        totalInvoicedRevenue: totalInvoiced,
        collectedRevenue,
        totalCollectedRevenue: collectedRevenue,
        actualReceivables,
        actualOverdueAmount,
        totalExpenses,
        netProfit,

        // HR & Attendance
        totalStaff: totalUsers,
        activeStaff: activeEmployees,
        pendingLeaves,
        approvedLeaves,
        presentToday: presentTodayCount,
        attendanceRate,

        // Projects & Tasks
        totalProjects,
        activeProjects,
        completedProjects,
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'Completed').length,
        pendingTasks: tasks.filter(t => ['Pending', 'In Progress'].includes(t.status)).length,

        // Recent Records
        recentOrders,
        recentInvoices,
        recentAuditLogs
      }
    });
  } catch (error) {
    console.error('[Executive Summary Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error generating executive summary.'
    });
  }
};

/**
 * @desc    Delete user account (Admin only)
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role === 'admin' && user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own admin account.' });
    }

    const userName = user.fullName;
    const userEmail = user.email;

    await User.findByIdAndDelete(req.params.id);

    await logAudit({
      action: 'User Deleted',
      performedBy: req.user._id,
      performedByName: req.user.fullName,
      targetUser: user._id,
      targetUserName: userName,
      details: `Admin ${req.user.fullName} deleted user account for ${userName} (${userEmail})`
    });

    return res.status(200).json({
      success: true,
      message: `User account for ${userName} (${userEmail}) deleted successfully.`
    });
  } catch (error) {
    console.error('[Delete User Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting user account.' });
  }
};

/**
 * @desc    Admin Update User Department (Admin only)
 * @route   PATCH /api/admin/users/:id/department
 * @access  Private/Admin
 */
const updateUserDepartment = async (req, res) => {
  try {
    const { department } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.department = department ? department.trim() : '';
    await user.save();

    await createNotificationHelper({
      recipient: user._id,
      sender: req.user._id,
      title: 'Department Updated',
      message: `Your department has been updated to ${user.department || 'General'}.`,
      type: 'role'
    });

    return res.status(200).json({
      success: true,
      message: `Department for ${user.fullName} updated to ${user.department}.`,
      data: user.toJSON()
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating department.' });
  }
};

/**
 * @desc    Get Centralized Employee/User Directory (Admin & CEO)
 * @route   GET /api/admin/directory
 * @access  Private/Admin/CEO
 */
const getDirectoryUsers = async (req, res) => {
  try {
    const { search, department, role, status } = req.query;
    const query = {};

    if (status && status !== 'all') query.status = status;
    if (role && role !== 'all') query.role = role;
    if (department && department !== 'all') query.department = department;

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: regex },
        { email: regex },
        { department: regex },
        { role: regex },
        { employeeId: regex }
      ];
    }

    const users = await User.find(query).select('-password').sort({ fullName: 1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('[Get Directory Users Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching directory.' });
  }
};

/**
 * @desc    Get Detailed Profile of single employee including tasks, attendance, leaves
 * @route   GET /api/admin/directory/:id
 * @access  Private/Admin/CEO
 */
const getUserProfileDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const tasks = await Task.find({ assignedTo: user._id }).sort({ createdAt: -1 });
    const attendance = await Attendance.find({ user: user._id }).sort({ date: -1 }).limit(10);
    const leaves = await Leave.find({ user: user._id }).sort({ createdAt: -1 });
    const projects = await Project.find({ teamMembers: user._id });

    return res.status(200).json({
      success: true,
      data: {
        user,
        tasks,
        attendance,
        leaves,
        projects
      }
    });
  } catch (error) {
    console.error('[Get User Profile Details Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching user profile.' });
  }
};

/**
 * @desc    Get Centralized Organization Users Directory with live metrics (Admin & CEO)
 * @route   GET /api/admin/org/users
 * @access  Private/Admin/CEO
 */
const getOrgUsers = async (req, res) => {
  try {
    const { search, department, role, status, page = 1, limit = 50, sortBy = 'fullName', sortOrder = 'asc' } = req.query;
    const query = {};

    if (status && status !== 'all') query.status = status;
    if (role && role !== 'all') query.role = role;
    if (department && department !== 'all') query.department = department;

    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: regex },
        { email: regex },
        { department: regex },
        { role: regex },
        { employeeId: regex }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const userIds = users.map(u => u._id);

    // Batch aggregate user performance data
    const [salesOrders, deliveryNotes, invoices, tasks] = await Promise.all([
      SalesOrder.find({
        $or: [{ createdBy: { $in: userIds } }, { salesPerson: { $in: userIds } }]
      }).select('createdBy salesPerson status deliveryStatus invoiceStatus paymentStatus netAmount totalAmount createdAt').lean(),
      DeliveryNote.find({ createdBy: { $in: userIds } }).select('createdBy status createdAt').lean(),
      Invoice.find({
        $or: [{ createdBy: { $in: userIds } }, { finalizedBy: { $in: userIds } }, { salesPerson: { $in: userIds } }]
      }).select('createdBy finalizedBy status amount paidAmount createdAt').lean(),
      Task.find({
        $or: [{ assignedTo: { $in: userIds } }, { createdBy: { $in: userIds } }]
      }).select('assignedTo createdBy status createdAt').lean()
    ]);

    const usersWithMetrics = users.map(user => {
      const uidStr = user._id.toString();
      const role = user.role || '';
      const isSales = ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'].includes(role);
      const isSupport = role === 'support';
      const isAccounts = role === 'accountant';
      const isFinance = role === 'finance';

      let totalItems = 0;
      let completedItems = 0;
      let score = 0;
      let revenue = 0;

      if (isSales) {
        const myOrders = salesOrders.filter(o => 
          (o.createdBy && o.createdBy.toString() === uidStr) || 
          (o.salesPerson && o.salesPerson.toString() === uidStr)
        );
        totalItems = myOrders.length;
        completedItems = myOrders.filter(o => ['Delivered', 'Done', 'Invoiced', 'Paid'].includes(o.deliveryStatus) || o.paymentStatus === 'Paid' || o.invoiceStatus === 'Invoiced').length;
        revenue = myOrders.reduce((sum, o) => sum + (o.netAmount || o.totalAmount || 0), 0);
        score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
      } else if (isSupport) {
        const myDNs = deliveryNotes.filter(d => d.createdBy && d.createdBy.toString() === uidStr);
        totalItems = myDNs.length;
        completedItems = myDNs.filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length;
        score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
      } else if (isAccounts) {
        const myInvoices = invoices.filter(i => i.createdBy && i.createdBy.toString() === uidStr);
        totalItems = myInvoices.length;
        completedItems = myInvoices.filter(i => ['Paid', 'Partially Paid', 'Finalized', 'Approved'].includes(i.status)).length;
        revenue = myInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);
        score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
      } else if (isFinance) {
        const myFinalized = invoices.filter(i => i.finalizedBy && i.finalizedBy.toString() === uidStr);
        const myReviewed = invoices.filter(i => (i.finalizedBy && i.finalizedBy.toString() === uidStr) || (i.createdBy && i.createdBy.toString() === uidStr));
        totalItems = myReviewed.length;
        completedItems = myFinalized.length;
        score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
      } else {
        const myTasks = tasks.filter(t => 
          (t.assignedTo && t.assignedTo.toString() === uidStr) ||
          (t.createdBy && t.createdBy.toString() === uidStr)
        );
        totalItems = myTasks.length;
        completedItems = myTasks.filter(t => t.status === 'Completed').length;
        score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
      }

      return {
        ...user,
        metrics: {
          totalItems,
          completedItems,
          score,
          revenue
        }
      };
    });

    return res.status(200).json({
      success: true,
      count: usersWithMetrics.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      data: usersWithMetrics
    });
  } catch (error) {
    console.error('[Get Org Users Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving organization users.' });
  }
};

/**
 * @desc    Get detailed per-user live details & performance metrics (Admin & CEO)
 * @route   GET /api/admin/org/users/:id/performance
 * @access  Private/Admin/CEO
 */
const getOrgUserPerformance = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const userId = user._id;

    // Parallel fetch of all related documents (un-truncated for exact metric calculations)
    const [
      allSalesOrders,
      allLeads,
      allDeals,
      allQuotations,
      allTasks,
      allLeaves,
      allAttendance,
      allProjects,
      allPayments
    ] = await Promise.all([
      SalesOrder.find({ $or: [{ createdBy: userId }, { salesPerson: userId }] }).sort({ createdAt: -1 }).lean(),
      Lead.find({ $or: [{ createdBy: userId }, { assignedTo: userId }] }).sort({ createdAt: -1 }).lean(),
      Deal.find({ $or: [{ createdBy: userId }, { assignedTo: userId }] }).sort({ createdAt: -1 }).lean(),
      Quotation.find({ createdBy: userId }).sort({ createdAt: -1 }).lean(),
      Task.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] }).sort({ createdAt: -1 }).lean(),
      Leave.find({ user: userId }).sort({ createdAt: -1 }).lean(),
      Attendance.find({ user: userId }).sort({ date: -1 }).lean(),
      Project.find({ teamMembers: userId }).select('title status progress startDate endDate').lean(),
      Payment.find({ $or: [{ createdBy: userId }, { recordedBy: userId }] }).sort({ createdAt: -1 }).lean()
    ]);

    const userOrderIds = allSalesOrders.map(o => o._id);

    // Fetch delivery notes & invoices connected directly or via orders
    const [allDeliveryNotes, allInvoices] = await Promise.all([
      DeliveryNote.find({
        $or: [
          { createdBy: userId },
          { salesOrder: { $in: userOrderIds } }
        ]
      }).sort({ createdAt: -1 }).lean(),
      Invoice.find({
        $or: [
          { createdBy: userId },
          { finalizedBy: userId },
          { salesPerson: userId },
          { salesOrderId: { $in: userOrderIds } }
        ]
      }).sort({ createdAt: -1 }).lean()
    ]);

    // Role-based calculation
    const role = user.role || '';
    const isSales = ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'].includes(role) || (user.department && user.department.toLowerCase().includes('sale'));
    const isSupport = role === 'support' || (user.department && user.department.toLowerCase().includes('support'));
    const isAccounts = role === 'accountant' || (user.department && user.department.toLowerCase().includes('account'));
    const isFinance = role === 'finance' || (user.department && user.department.toLowerCase().includes('finance'));
    const isHR = ['hr_manager', 'administration'].includes(role) || (user.department && user.department.toLowerCase().includes('hr'));

    let totalItems = 0;
    let completedItems = 0;
    let score = 0;
    let revenueAttributed = 0;

    if (isSales) {
      totalItems = allSalesOrders.length;
      completedItems = allSalesOrders.filter(o => ['Delivered', 'Done', 'Invoiced', 'Paid'].includes(o.deliveryStatus) || o.paymentStatus === 'Paid' || o.invoiceStatus === 'Invoiced').length;
      revenueAttributed = allSalesOrders.reduce((acc, o) => acc + (o.netAmount || o.totalAmount || 0), 0);
      score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : (allDeals.length > 0 ? Math.round((allDeals.filter(d => ['Closed Won', 'Won'].includes(d.stage)).length / allDeals.length) * 100) : 0);
    } else if (isSupport) {
      const myDNs = allDeliveryNotes.filter(d => d.createdBy && d.createdBy.toString() === userId.toString());
      totalItems = myDNs.length > 0 ? myDNs.length : allDeliveryNotes.length;
      completedItems = (myDNs.length > 0 ? myDNs : allDeliveryNotes).filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length;
      score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
    } else if (isAccounts) {
      totalItems = allInvoices.length;
      completedItems = allInvoices.filter(i => ['Paid', 'Partially Paid', 'Finalized', 'Approved'].includes(i.status)).length;
      revenueAttributed = allInvoices.reduce((acc, i) => acc + (i.amount || 0), 0);
      score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
    } else if (isFinance) {
      totalItems = allInvoices.length;
      completedItems = allInvoices.filter(i => i.finalizedBy && i.finalizedBy.toString() === userId.toString()).length;
      revenueAttributed = allPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
      score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
    } else {
      totalItems = allTasks.length;
      completedItems = allTasks.filter(t => t.status === 'Completed').length;
      score = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
    }

    // Role-specific detailed metrics for live CEO / Admin inspection
    const roleDetails = {
      sales: {
        totalLeads: allLeads.length,
        totalDeals: allDeals.length,
        totalQuotations: allQuotations.length,
        activeQuotations: allQuotations.filter(q => !q.isConverted && !['Converted', 'Ordered', 'Rejected', 'Cancelled'].includes(q.status)).length,
        convertedQuotations: allQuotations.filter(q => q.isConverted || ['Converted', 'Ordered', 'Converted to Sales Order'].includes(q.status)).length,
        totalSalesOrders: allSalesOrders.length,
        ordersPendingFinance: allSalesOrders.filter(o => o.workflowStatus === 'Pending Finance Approval' || (o.requiresFinanceApproval && !o.financeApprovedBy && !['Cancelled', 'Finance Rejected'].includes(o.status))).length,
        ordersFinanceApproved: allSalesOrders.filter(o => o.workflowStatus === 'Finance Approved' || !!o.financeApprovedBy).length,
        ordersFinanceRejected: allSalesOrders.filter(o => o.workflowStatus === 'Finance Rejected' || o.status === 'Finance Rejected').length,
        ordersSentToSupport: allSalesOrders.filter(o => ['Sent to Support', 'Delivery Note Created', 'Delivered', 'Done'].includes(o.workflowStatus) || !!o.deliveryNoteId || ['Delivered', 'Fully Delivered'].includes(o.deliveryStatus)).length,
        linkedDeliveryNotes: allDeliveryNotes.length,
        linkedDraftInvoices: allInvoices.filter(i => i.isDraft || i.status === 'Draft').length,
        linkedFinalInvoices: allInvoices.filter(i => !i.isDraft && ['Finalized', 'Approved', 'Paid', 'Partially Paid', 'Sent'].includes(i.status)).length,
        totalRevenue: revenueAttributed
      },
      support: {
        salesOrdersReceived: allSalesOrders.length,
        totalDeliveryNotes: allDeliveryNotes.length,
        pendingDeliveryNotes: allDeliveryNotes.filter(d => ['Draft', 'Created', 'Waiting', 'Ready', 'Pending', 'In Transit', 'Dispatched'].includes(d.status)).length,
        confirmedDeliveryNotes: allDeliveryNotes.filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length
      },
      accounts: {
        deliveryNotesReceived: allDeliveryNotes.filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length,
        draftInvoicesCreated: allInvoices.filter(i => i.isDraft || i.status === 'Draft').length,
        pendingFinanceFinalization: allInvoices.filter(i => ['Pending Finance Finalization', 'Pending Review', 'Submitted'].includes(i.status)).length,
        draftInvoicesAmount: allInvoices.filter(i => i.isDraft || i.status === 'Draft').reduce((sum, i) => sum + (i.amount || 0), 0)
      },
      finance: {
        ordersApproved: allSalesOrders.filter(o => o.financeApprovedBy && o.financeApprovedBy.toString() === userId.toString()).length,
        ordersRejected: allSalesOrders.filter(o => o.workflowStatus === 'Finance Rejected').length,
        draftInvoicesReceived: allInvoices.filter(i => ['Pending Finance Finalization', 'Submitted', 'Pending Review'].includes(i.status)).length,
        finalInvoicesFinalized: allInvoices.filter(i => i.finalizedBy && i.finalizedBy.toString() === userId.toString()).length,
        paymentsRecorded: allPayments.length,
        collectedRevenue: allPayments.reduce((sum, p) => sum + (p.amount || 0), 0)
      },
      hr: {
        leavesManaged: allLeaves.length,
        approvedLeaves: allLeaves.filter(l => l.status === 'Approved').length,
        pendingLeaves: allLeaves.filter(l => l.status === 'Pending').length,
        attendanceDays: allAttendance.length,
        presentDays: allAttendance.filter(a => a.status === 'Present').length
      }
    };

    // Monthly breakdown for the last 6 months
    const now = new Date();
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const monthLabel = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      const nextMonth = new Date(year, month + 1, 1);

      const inMonth = item => {
        const itemDate = new Date(item.createdAt || item.date || item.orderDate);
        return itemDate >= d && itemDate < nextMonth;
      };

      const mOrders = allSalesOrders.filter(inMonth);
      const mDNs = allDeliveryNotes.filter(inMonth);
      const mInvoices = allInvoices.filter(inMonth);
      const mTasks = allTasks.filter(inMonth);

      const mTotal = mOrders.length + mDNs.length + mInvoices.length + mTasks.length;
      const mCompleted = mOrders.filter(o => ['Delivered', 'Done', 'Paid'].includes(o.deliveryStatus)).length +
        mDNs.filter(dn => ['Confirmed', 'Delivered', 'Done'].includes(dn.status)).length +
        mInvoices.filter(inv => ['Paid', 'Finalized'].includes(inv.status)).length +
        mTasks.filter(t => t.status === 'Completed').length;

      const mRevenue = mOrders.reduce((s, o) => s + (o.netAmount || 0), 0) +
        mInvoices.reduce((s, i) => s + (i.amount || 0), 0);

      monthlyData.push({
        month: monthLabel,
        totalItems: mTotal,
        completedItems: mCompleted,
        revenue: mRevenue,
        score: mTotal > 0 ? Math.min(100, Math.round((mCompleted / mTotal) * 100)) : 0
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user,
        metrics: {
          totalItems,
          completedItems,
          pendingItems: Math.max(0, totalItems - completedItems),
          score,
          revenueAttributed
        },
        roleDetails,
        monthlyData,
        activities: {
          salesOrders: allSalesOrders.slice(0, 100),
          leads: allLeads.slice(0, 50),
          deals: allDeals.slice(0, 50),
          quotations: allQuotations.slice(0, 50),
          deliveryNotes: allDeliveryNotes.slice(0, 50),
          invoices: allInvoices.slice(0, 50),
          payments: allPayments.slice(0, 50),
          tasks: allTasks.slice(0, 50),
          leaves: allLeaves.slice(0, 50),
          attendance: allAttendance.slice(0, 60),
          projects: allProjects
        }
      }
    });
  } catch (error) {
    console.error('[Get Org User Performance Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving user performance.' });
  }
};

/**
 * @desc    Get aggregated Department-wise live statistics (Admin & CEO)
 * @route   GET /api/admin/org/departments
 * @access  Private/Admin/CEO
 */
const getOrgDepartmentStats = async (req, res) => {
  try {
    const [
      users,
      salesOrders,
      leads,
      deals,
      quotations,
      deliveryNotes,
      invoices,
      payments,
      expenses,
      leaves,
      attendance,
      jobPostings,
      jobApplications,
      shipments,
      supplierPOs,
      purchaserGRNs,
      localPayables,
      inventoryItems
    ] = await Promise.all([
      User.find().select('-password').lean(),
      SalesOrder.find().lean(),
      Lead.find().lean(),
      Deal.find().lean(),
      Quotation.find().lean(),
      DeliveryNote.find().lean(),
      Invoice.find().lean(),
      Payment.find().lean(),
      Expense.find().lean(),
      Leave.find().lean(),
      Attendance.find().sort({ date: -1 }).limit(500).lean(),
      JobPosting.find().lean(),
      JobApplication.find().lean(),
      Shipment.find().lean(),
      SupplierPO.find().lean(),
      PurchaserGRN.find().lean(),
      LocalPayable.find().lean(),
      InventoryItem.find().lean()
    ]);

    // Department Users
    const salesUsers = users.filter(u => ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'].includes(u.role) || (u.department && u.department.toLowerCase().includes('sale')));
    const supportUsers = users.filter(u => u.role === 'support' || (u.department && u.department.toLowerCase().includes('support')));
    const accountsUsers = users.filter(u => u.role === 'accountant' || (u.department && u.department.toLowerCase().includes('account')));
    const financeUsers = users.filter(u => u.role === 'finance' || (u.department && u.department.toLowerCase().includes('finance')));
    const hrUsers = users.filter(u => ['hr_manager', 'administration'].includes(u.role) || (u.department && u.department.toLowerCase().includes('hr')));
    const logisticsUsers = users.filter(u => u.role === 'logistics' || (u.department && u.department.toLowerCase().includes('logistic')));
    const localPurchaserUsers = users.filter(u => ((u.role === 'purchaser' && (u.purchaserSubDept === 'Local' || !u.purchaserSubDept)) || (u.department && u.department.toLowerCase().includes('local'))));
    const globalPurchaserUsers = users.filter(u => ((u.role === 'purchaser' && u.purchaserSubDept === 'Global') || (u.department && u.department.toLowerCase().includes('global'))));

    // --- LOCAL PURCHASER STATS ---
    const localSupplierPOs = (supplierPOs || []).filter(p => p.supplierType === 'Local' || p.poType === 'Local' || !p.fileType || p.fileType !== 'Blue');
    const totalLocalSpend = (localPayables || []).reduce((sum, p) => sum + (p.totalAmount || p.amount || 0), 0);
    const paidLocalPayables = (localPayables || []).filter(p => p.status === 'Paid').length;
    const pendingLocalPayables = (localPayables || []).filter(p => p.status !== 'Paid').length;
    const localPurchaserScore = (localPayables || []).length > 0 ? Math.min(100, Math.round((paidLocalPayables / (localPayables || []).length) * 100)) : 100;

    // --- GLOBAL PURCHASER STATS ---
    const globalSupplierPOs = (supplierPOs || []).filter(p => p.supplierType === 'Global' || p.poType === 'Global' || p.fileType === 'Blue');
    const deliveredGlobalPOs = globalSupplierPOs.filter(p => ['Delivered', 'Received', 'Done'].includes(p.status)).length;
    const globalPurchaserScore = globalSupplierPOs.length > 0 ? Math.min(100, Math.round((deliveredGlobalPOs / globalSupplierPOs.length) * 100)) : 100;

    // --- SALES STATS ---
    const wonDeals = deals.filter(d => ['Closed Won', 'Won'].includes(d.stage));
    const wonRevenue = wonDeals.reduce((sum, d) => sum + (d.value || 0), 0);
    const pipelineValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);
    const totalSalesOrderAmount = salesOrders.reduce((sum, o) => sum + (o.netAmount || o.totalAmount || 0), 0);
    const completedSalesOrders = salesOrders.filter(o => ['Delivered', 'Done', 'Invoiced', 'Paid'].includes(o.deliveryStatus) || o.paymentStatus === 'Paid').length;
    const salesScore = salesOrders.length > 0 ? Math.min(100, Math.round((completedSalesOrders / salesOrders.length) * 100)) : 0;

    // --- SUPPORT STATS ---
    const confirmedDNs = deliveryNotes.filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length;
    const inTransitDNs = deliveryNotes.filter(d => ['In Transit', 'Dispatched'].includes(d.status)).length;
    const pendingDNs = deliveryNotes.filter(d => ['Ready', 'Draft', 'Waiting', 'Pending', 'Created'].includes(d.status)).length;
    const supportScore = deliveryNotes.length > 0 ? Math.min(100, Math.round((confirmedDNs / deliveryNotes.length) * 100)) : 0;

    // --- LOGISTICS STATS ---
    const inTransitShipments = shipments.filter(s => s.status === 'In Transit').length;
    const receivedShipments = shipments.filter(s => s.receivedInOffice || s.status === 'Received in Office').length;
    const pendingShipments = shipments.filter(s => ['PO Issued', 'Shipment Pending', 'Booked', 'Dispatched'].includes(s.status) && !s.receivedInOffice).length;
    const delayedShipments = shipments.filter(s => s.status === 'Delayed').length;
    const blueFileOrders = salesOrders.filter(o => o.fileType === 'Blue');
    const logisticsScore = shipments.length > 0 ? Math.min(100, Math.round((receivedShipments / shipments.length) * 100)) : 100;

    // --- ACCOUNTS STATS ---
    const totalInvoiced = invoices.reduce((sum, i) => sum + (i.amount || 0), 0);
    const totalPaidInvoices = invoices.filter(i => i.status === 'Paid').length;
    const submittedInvoices = invoices.filter(i => ['Submitted', 'Pending Review', 'Pending Finance Finalization'].includes(i.status)).length;
    const draftInvoices = invoices.filter(i => i.status === 'Draft' || i.isDraft).length;
    const outstandingReceivables = invoices.filter(i => i.status !== 'Paid').reduce((sum, i) => sum + (i.outstandingAmount || i.amount || 0), 0);
    const accountsScore = invoices.length > 0 ? Math.min(100, Math.round((totalPaidInvoices / invoices.length) * 100)) : 0;

    // --- FINANCE STATS ---
    const finalizedInvoices = invoices.filter(i => ['Finalized', 'Approved', 'Paid'].includes(i.status)).length;
    const rejectedInvoices = invoices.filter(i => i.status === 'Rejected').length;
    const totalCollectedRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalCollectedRevenue - totalExpenses;
    const financeScore = (finalizedInvoices + rejectedInvoices) > 0 ? Math.min(100, Math.round((finalizedInvoices / (finalizedInvoices + rejectedInvoices)) * 100)) : 0;

    // --- HR STATS ---
    const activeEmployees = users.filter(u => u.status === 'active').length;
    const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;
    const approvedLeaves = leaves.filter(l => l.status === 'Approved').length;
    const attendancePresent = attendance.filter(a => a.status === 'Present').length;
    const attendanceRate = attendance.length > 0 ? Math.round((attendancePresent / attendance.length) * 100) : 100;
    const hrScore = leaves.length > 0 ? Math.round(((leaves.length - pendingLeaves) / leaves.length) * 100) : 100;

    const departmentStats = {
      sales: {
        name: 'Sales',
        userCount: salesUsers.length,
        users: salesUsers,
        score: salesScore,
        kpis: {
          totalOrders: salesOrders.length,
          completedOrders: completedSalesOrders,
          totalOrderAmount: totalSalesOrderAmount,
          totalLeads: leads.length,
          totalDeals: deals.length,
          wonDeals: wonDeals.length,
          wonRevenue,
          pipelineValue,
          quotationsCount: quotations.length
        },
        records: {
          salesOrders: salesOrders.slice(0, 50),
          leads: leads.slice(0, 50),
          deals: deals.slice(0, 50)
        }
      },
      support: {
        name: 'Support & Operations',
        userCount: supportUsers.length,
        users: supportUsers,
        score: supportScore,
        kpis: {
          totalDeliveryNotes: deliveryNotes.length,
          confirmedDNs,
          inTransitDNs,
          pendingDNs,
          deliveredPercentage: deliveryNotes.length > 0 ? Math.round((confirmedDNs / deliveryNotes.length) * 100) : 0
        },
        records: {
          deliveryNotes: deliveryNotes.slice(0, 50)
        }
      },
      logistics: {
        name: 'Logistics',
        userCount: logisticsUsers.length,
        users: logisticsUsers,
        score: logisticsScore,
        kpis: {
          totalShipments: shipments.length,
          inTransitShipments,
          receivedShipments,
          pendingShipments,
          delayedShipments,
          blueFileOrders: blueFileOrders.length
        },
        records: {
          shipments: shipments.slice(0, 50),
          blueFileOrders: blueFileOrders.slice(0, 50)
        }
      },
      accounts: {
        name: 'Accounts',
        userCount: accountsUsers.length,
        users: accountsUsers,
        score: accountsScore,
        kpis: {
          totalInvoices: invoices.length,
          totalInvoiced,
          totalPaidInvoices,
          submittedInvoices,
          draftInvoices,
          outstandingReceivables
        },
        records: {
          invoices: invoices.slice(0, 50)
        }
      },
      finance: {
        name: 'Finance',
        userCount: financeUsers.length,
        users: financeUsers,
        score: financeScore,
        kpis: {
          finalizedInvoices,
          rejectedInvoices,
          paymentsCount: payments.length,
          totalCollectedRevenue,
          totalExpenses,
          netProfit
        },
        records: {
          payments: payments.slice(0, 50),
          invoices: invoices.filter(i => ['Finalized', 'Approved', 'Rejected'].includes(i.status)).slice(0, 50)
        }
      },
      hr: {
        name: 'Human Resources',
        userCount: hrUsers.length,
        users: hrUsers,
        score: hrScore,
        kpis: {
          totalStaff: users.length,
          activeEmployees,
          pendingLeaves,
          approvedLeaves,
          attendanceRate,
          jobPostingsCount: jobPostings.length,
          jobApplicationsCount: jobApplications.length
        },
        records: {
          leaves: leaves.slice(0, 50),
          jobPostings: jobPostings.slice(0, 50)
        }
      },
      local_purchaser: {
        name: 'Local Purchaser Department',
        userCount: localPurchaserUsers.length,
        users: localPurchaserUsers,
        score: localPurchaserScore,
        kpis: {
          totalSupplierPOs: (localSupplierPOs || []).length,
          totalGRNs: (purchaserGRNs || []).length,
          totalInventoryItems: (inventoryItems || []).length,
          totalLocalSpend,
          paidLocalPayables,
          pendingLocalPayables
        },
        records: {
          supplierPOs: (localSupplierPOs || []).slice(0, 50),
          grns: (purchaserGRNs || []).slice(0, 50),
          payables: (localPayables || []).slice(0, 50),
          inventory: (inventoryItems || []).slice(0, 50)
        }
      },
      global_purchaser: {
        name: 'Global Purchaser Department',
        userCount: globalPurchaserUsers.length,
        users: globalPurchaserUsers,
        score: globalPurchaserScore,
        kpis: {
          totalGlobalPOs: globalSupplierPOs.length,
          deliveredGlobalPOs,
          totalShipments: shipments.length,
          inTransitShipments: shipments.filter(s => s.status === 'In Transit').length,
          receivedInOffice: shipments.filter(s => s.receivedInOffice || s.status === 'Received in Office').length
        },
        records: {
          supplierPOs: globalSupplierPOs.slice(0, 50),
          shipments: shipments.slice(0, 50)
        }
      }
    };

    return res.status(200).json({
      success: true,
      data: departmentStats
    });
  } catch (error) {
    console.error('[Get Org Department Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving department statistics.' });
  }
};

/**
 * @desc    Get month-wise organizational performance & rankings (Admin & CEO)
 * @route   GET /api/admin/org/monthly
 * @access  Private/Admin/CEO
 */
const getOrgMonthlyPerformance = async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;

    const parsedYear = parseInt(year, 10);
    const parsedMonth = parseInt(month, 10);

    const startDate = new Date(parsedYear, parsedMonth - 1, 1);
    const endDate = new Date(parsedYear, parsedMonth, 1);

    // Also get previous month for delta comparison
    const prevStartDate = new Date(parsedYear, parsedMonth - 2, 1);
    const prevEndDate = startDate;

    const dateFilter = { createdAt: { $gte: startDate, $lt: endDate } };
    const prevDateFilter = { createdAt: { $gte: prevStartDate, $lt: prevEndDate } };

    const [
      curOrders, prevOrders,
      curDNs, prevDNs,
      curInvoices, prevInvoices,
      curPayments, prevPayments,
      curLeads, prevLeads,
      users
    ] = await Promise.all([
      SalesOrder.find(dateFilter).lean(),
      SalesOrder.find(prevDateFilter).lean(),
      DeliveryNote.find(dateFilter).lean(),
      DeliveryNote.find(prevDateFilter).lean(),
      Invoice.find(dateFilter).lean(),
      Invoice.find(prevDateFilter).lean(),
      Payment.find({ paymentDate: { $gte: startDate, $lt: endDate } }).lean(),
      Payment.find({ paymentDate: { $gte: prevStartDate, $lt: prevEndDate } }).lean(),
      Lead.find(dateFilter).lean(),
      Lead.find(prevDateFilter).lean(),
      User.find({ status: 'active' }).select('-password').lean()
    ]);

    const curOrderRevenue = curOrders.reduce((s, o) => s + (o.netAmount || o.totalAmount || 0), 0);
    const prevOrderRevenue = prevOrders.reduce((s, o) => s + (o.netAmount || o.totalAmount || 0), 0);

    const curInvoicedAmount = curInvoices.reduce((s, i) => s + (i.amount || 0), 0);
    const prevInvoicedAmount = prevInvoices.reduce((s, i) => s + (i.amount || 0), 0);

    const curCollectedRevenue = curPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const prevCollectedRevenue = prevPayments.reduce((s, p) => s + (p.amount || 0), 0);

    const calcGrowth = (current, previous) => {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // User ranking for this month
    const userRankings = users.map(user => {
      const uidStr = user._id.toString();
      const role = user.role || '';
      const isSales = ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'].includes(role);
      const isSupport = role === 'support';
      const isAccounts = role === 'accountant';
      const isFinance = role === 'finance';

      let items = 0;
      let completed = 0;
      let revenue = 0;

      if (isSales) {
        const uOrders = curOrders.filter(o => 
          (o.createdBy && o.createdBy.toString() === uidStr) || 
          (o.salesPerson && o.salesPerson.toString() === uidStr)
        );
        items = uOrders.length;
        completed = uOrders.filter(o => ['Delivered', 'Done', 'Invoiced', 'Paid'].includes(o.deliveryStatus) || o.paymentStatus === 'Paid').length;
        revenue = uOrders.reduce((s, o) => s + (o.netAmount || o.totalAmount || 0), 0);
      } else if (isSupport) {
        const uDNs = curDNs.filter(d => d.createdBy && d.createdBy.toString() === uidStr);
        items = uDNs.length;
        completed = uDNs.filter(d => ['Confirmed', 'Done', 'Delivered', 'Fully Delivered'].includes(d.status)).length;
      } else if (isAccounts) {
        const uInvs = curInvoices.filter(i => i.createdBy && i.createdBy.toString() === uidStr);
        items = uInvs.length;
        completed = uInvs.filter(i => ['Paid', 'Partially Paid', 'Finalized', 'Approved'].includes(i.status)).length;
        revenue = uInvs.reduce((s, i) => s + (i.amount || 0), 0);
      } else if (isFinance) {
        const uInvs = curInvoices.filter(i => i.finalizedBy && i.finalizedBy.toString() === uidStr);
        items = uInvs.length;
        completed = uInvs.length;
      }

      const score = items > 0 ? Math.min(100, Math.round((completed / items) * 100)) : 0;

      return {
        userId: user._id,
        fullName: user.fullName,
        email: user.email,
        department: user.department || 'General',
        role: user.role,
        items,
        completed,
        revenue,
        score
      };
    }).sort((a, b) => (b.score !== a.score ? b.score - a.score : b.revenue - a.revenue));

    return res.status(200).json({
      success: true,
      data: {
        period: {
          year: parsedYear,
          month: parsedMonth,
          monthName: new Date(parsedYear, parsedMonth - 1, 1).toLocaleString('default', { month: 'long' }),
          startDate,
          endDate
        },
        kpis: {
          salesOrders: { count: curOrders.length, revenue: curOrderRevenue, growth: calcGrowth(curOrders.length, prevOrders.length) },
          deliveryNotes: { count: curDNs.length, confirmed: curDNs.filter(d => ['Confirmed', 'Done', 'Delivered'].includes(d.status)).length, growth: calcGrowth(curDNs.length, prevDNs.length) },
          invoices: { count: curInvoices.length, amount: curInvoicedAmount, growth: calcGrowth(curInvoices.length, prevInvoices.length) },
          revenueCollected: { amount: curCollectedRevenue, growth: calcGrowth(curCollectedRevenue, prevCollectedRevenue) },
          leadsGenerated: { count: curLeads.length, growth: calcGrowth(curLeads.length, prevLeads.length) }
        },
        userRankings
      }
    });
  } catch (error) {
    console.error('[Get Org Monthly Performance Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving monthly performance.' });
  }
};

module.exports = {
  getRegistrationRequests,
  getRegistrationRequestById,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  updateUserPassword,
  updateUserEmail,
  resetUserPassword,
  updateUserRole,
  updateUserStatus,
  updateUserDepartment,
  deleteUser,
  createCeoAccount,
  getExecutiveSummary,
  getDirectoryUsers,
  getUserProfileDetails,
  getOrgUsers,
  getOrgUserPerformance,
  getOrgDepartmentStats,
  getOrgMonthlyPerformance
};

