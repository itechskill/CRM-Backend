const User = require('../models/User');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Leave = require('../models/Leave');
const JobApplication = require('../models/JobApplication');
const Invoice = require('../models/Invoice');
const Expense = require('../models/Expense');
const Campaign = require('../models/Campaign');
const CompanyResource = require('../models/CompanyResource');
const Notification = require('../models/Notification');

/**
 * @desc    Get current user profile
 * @route   GET /api/users/me
 * @access  Private
 */
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.'
      });
    }

    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('[Get Profile Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user profile.'
    });
  }
};

/**
 * @desc    Update current user permitted profile details
 * @route   PATCH /api/users/me
 * @access  Private
 */
const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.'
      });
    }

    const {
      fullName,
      phone,
      profileImage,
      currentPassword,
      newPassword
    } = req.body;

    // Strict Security Protection: Block updates to authorization/status fields via this endpoint
    const FORBIDDEN_FIELDS = [
      'role',
      'status',
      'isApproved',
      'approvedBy',
      'approvedAt',
      'rejectedBy',
      'rejectedAt',
      'rejectionReason',
      'employeeId'
    ];

    FORBIDDEN_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        console.warn(`[Security Warning] User ${user.email} attempted to modify protected field '${field}' via /api/users/me.`);
      }
    });

    // Update permitted fields if provided
    if (fullName && fullName.trim() !== '') {
      user.fullName = fullName.trim();
    }

    if (phone !== undefined) {
      user.phone = phone.trim();
    }

    if (profileImage !== undefined) {
      // Allow empty string to remove profile photo
      user.profileImage = typeof profileImage === 'string' ? profileImage.trim() : '';
    }

    // Optional password change
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to set a new password.'
        });
      }

      const isMatch = await user.matchPassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Current password does not match.'
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters long.'
        });
      }

      if (!/[A-Z]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'New password must contain at least one uppercase letter.'
        });
      }

      if (!/[0-9]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'New password must contain at least one number.'
        });
      }

      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message: 'New password must contain at least one special character.'
        });
      }

      user.password = newPassword;
    }

    await user.save();

    // Fetch updated user without password
    const updatedUser = await User.findById(user._id).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data: updatedUser
    });
  } catch (error) {
    console.error('[Update Profile Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating user profile.'
    });
  }
};

/**
 * @desc    Get all active approved users (for assignees, leads, team dropdowns)
 * @route   GET /api/users
 * @access  Private
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ status: 'active', isApproved: true })
      .select('fullName email role department employeeId')
      .sort({ fullName: 1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('[Get All Users Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving users list.'
    });
  }
};

/**
 * @desc    Get aggregated live sidebar counts across all portals
 * @route   GET /api/users/sidebar-counts
 * @access  Private
 */
const getSidebarCounts = async (req, res) => {
  try {
    const userId = req.user?._id;

    const [
      usersCount,
      employeesCount,
      pendingRegistrationsCount,
      pendingLeavesCount,
      jobAppsCount,
      leadsCount,
      dealsCount,
      wonDealsCount,
      projectsCount,
      activeProjectsCount,
      tasksCount,
      pendingTasksCount,
      clientsCount,
      resourcesCount,
      invoicesCount,
      expensesCount,
      activeCampaignsCount,
      notificationsCount,
      proposalsCount,
      meetingsCount
    ] = await Promise.all([
      User.countDocuments({ isApproved: true }),
      User.countDocuments({ isApproved: true, role: { $ne: 'admin' } }),
      User.countDocuments({ isApproved: false, status: 'pending' }),
      Leave.countDocuments({ status: 'Pending' }),
      JobApplication.countDocuments(),
      Lead.countDocuments(),
      Deal.countDocuments(),
      Deal.countDocuments({ stage: { $in: ['Closed Won', 'Won'] } }),
      Project.countDocuments(),
      Project.countDocuments({ status: { $in: ['In Progress', 'Active', 'Ongoing'] } }),
      Task.countDocuments(),
      Task.countDocuments({ status: { $ne: 'Completed' } }),
      Client.countDocuments(),
      CompanyResource.countDocuments(),
      Invoice ? Invoice.countDocuments() : Promise.resolve(0),
      Expense ? Expense.countDocuments() : Promise.resolve(0),
      Campaign ? Campaign.countDocuments({ status: { $in: ['Active', 'Running', 'Ongoing'] } }) : Promise.resolve(0),
      userId ? Notification.countDocuments({ recipient: userId, isRead: false }) : Promise.resolve(0),
      Deal.countDocuments({ stage: 'Proposal' }),
      Deal.countDocuments({ stage: { $in: ['Negotiation', 'Proposal'] } })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users: usersCount,
        employees: employeesCount || usersCount,
        pendingRegistrations: pendingRegistrationsCount,
        pendingLeaves: pendingLeavesCount,
        jobApplications: jobAppsCount,
        leads: leadsCount,
        deals: dealsCount,
        wonDeals: wonDealsCount,
        projects: projectsCount,
        activeProjects: activeProjectsCount,
        tasks: tasksCount,
        pendingTasks: pendingTasksCount,
        clients: clientsCount,
        resources: resourcesCount,
        invoices: invoicesCount,
        expenses: expensesCount,
        activeCampaigns: activeCampaignsCount,
        notifications: notificationsCount,
        proposals: proposalsCount,
        meetings: meetingsCount
      }
    });
  } catch (error) {
    console.error('[Get Sidebar Counts Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving sidebar counts.'
    });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getAllUsers,
  getSidebarCounts
};


