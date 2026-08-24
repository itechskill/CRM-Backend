const User = require('../models/User');
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
 * @desc    Admin Update User Role (Admin only)
 * @route   PATCH /api/admin/users/:id/role
 * @access  Private/Admin
 */
const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
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

module.exports = {
  getRegistrationRequests,
  getRegistrationRequestById,
  approveRegistrationRequest,
  rejectRegistrationRequest,
  updateUserPassword,
  updateUserRole,
  updateUserStatus,
  createCeoAccount
};
