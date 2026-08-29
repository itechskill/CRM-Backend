const User = require('../models/User');

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
      user.profileImage = profileImage.trim();
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

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long.'
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

module.exports = {
  getProfile,
  updateProfile,
  getAllUsers
};

