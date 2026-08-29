const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const crypto = require('crypto');
const logAudit = require('../utils/auditLogger');

const PUBLIC_REGISTRATION_ROLES = [
  'administration',
  'hr_manager',
  'sales_manager',
  'project_manager',
  'marketing',
  'accountant',
  'employee'
];

/**
 * @desc    Public User Registration
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
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

    // 1. Validate required fields
    if (!fullName || !email || !password || !confirmPassword || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields: fullName, email, password, confirmPassword, and role.'
      });
    }

    // 1. Validate full name contains only alphabetic characters and spaces
    const nameRegex = /^[A-Za-z\s]+$/;
    if (!nameRegex.test(fullName.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Full Name must contain only alphabetic letters and spaces.'
      });
    }

    // 2. Validate phone number format if provided
    if (phone && phone.trim() !== '') {
      const phoneRegex = /^[0-9+\-\s]+$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Phone Number can only contain numbers, +, - and spaces.'
        });
      }
    }

    // 3. Validate email format
    const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    // 4. Validate password match
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirmPassword do not match.'
      });
    }

    // 5. Validate password strength (at least 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char)
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

    // 5. Validate Role & Disallow Admin/CEO role public registration
    const normalizedRole = role.toLowerCase().trim();
    if (normalizedRole === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Public registration for the Admin role is strictly prohibited.'
      });
    }

    if (normalizedRole === 'ceo') {
      return res.status(403).json({
        success: false,
        message: 'CEO accounts must be created by a System Administrator.'
      });
    }

    if (!PUBLIC_REGISTRATION_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role selected. Allowed public roles are: ${PUBLIC_REGISTRATION_ROLES.join(', ')}.`
      });
    }

    // 6. Check for duplicate email
    const normalizedEmail = email.toLowerCase().trim();
    const reservedAdminEmail = (process.env.ADMIN_EMAIL || 'admin@yourcompany.com')
      .toLowerCase()
      .trim();

    if (normalizedEmail === reservedAdminEmail) {
      return res.status(403).json({
        success: false,
        message: 'This email address is reserved for system administration and cannot be registered publicly.'
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    // 7. Check for duplicate employeeId if provided
    if (employeeId && employeeId.trim() !== '') {
      const existingEmpId = await User.findOne({ employeeId: employeeId.trim() });
      if (existingEmpId) {
        return res.status(400).json({
          success: false,
          message: 'An employee with this Employee ID already exists.'
        });
      }
    }

    // 8. Create new user with pending status & isApproved = false
    const newUser = new User({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : '',
      password,
      role: normalizedRole,
      department: department ? department.trim() : '',
      employeeId: employeeId && employeeId.trim() !== '' ? employeeId.trim() : undefined,
      status: 'pending',
      isApproved: false
    });

    await newUser.save();

    await logAudit({
      action: 'User Registered',
      targetUser: newUser._id,
      targetUserName: newUser.fullName,
      details: `New account registered with role: ${newUser.role}, email: ${newUser.email}`
    });

    // 9. Prepare sanitized output (without password)
    const userResponse = newUser.toJSON();

    return res.status(201).json({
      success: true,
      message: 'Registration submitted successfully. Your account is pending Admin approval.',
      data: userResponse
    });
  } catch (error) {
    console.error('[Register Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again later.'
    });
  }
};

/**
 * @desc    User Login
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validate input fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password.'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 2. Find user by email (selecting password explicitly)
    const user = await User.findOne({ email: normalizedEmail }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    // 3. Verify password using bcrypt
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    // 4. Check account status & approval in exact priority order
    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Your registration request has been rejected.'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended.'
      });
    }

    if (user.status === 'pending' || !user.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending Admin approval.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active.'
      });
    }

    // 5. Generate JWT token (contains only userId and role)
    const token = generateToken(user._id, user.role);

    // 6. Update lastLogin timestamp
    user.lastLogin = new Date();
    await user.save();

    await logAudit({
      action: 'User Logged In',
      performedBy: user._id,
      performedByName: user.fullName,
      details: `User ${user.fullName} logged in successfully with role: ${user.role}`
    });

    // 7. Sanitize output (password stripped via toJSON)
    const userResponse = user.toJSON();

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      data: userResponse
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again later.'
    });
  }
};

/**
 * @desc    User Logout
 * @route   POST /api/auth/logout
 * @access  Public / Private
 */
const logoutUser = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully.'
  });
};

/**
 * @desc    Get Current Logged-In User Profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
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
    console.error('[Get Me Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user profile.'
    });
  }
};

/**
 * @desc    Forgot Password Request (Generate Secure Reset Token)
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address.'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    // Generic success response to prevent user email enumeration
    const genericSuccessResponse = {
      success: true,
      message: 'If an account with that email exists, password reset instructions have been generated.'
    };

    if (!user) {
      return res.status(200).json(genericSuccessResponse);
    }

    // Generate unhashed random reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash token and store in resetPasswordToken field in DB
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Expiration set to 15 minutes
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;

    await user.save();

    console.log(`[Password Reset Token Generated for ${user.email}]: ${resetToken}`);

    return res.status(200).json({
      ...genericSuccessResponse,
      resetToken
    });
  } catch (error) {
    console.error('[Forgot Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error processing forgot password request.'
    });
  }
};

/**
 * @desc    Reset Password using Token
 * @route   POST /api/auth/reset-password/:token
 * @access  Public
 */
const resetPassword = async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    const { token } = req.params;

    if (!password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both password and confirmPassword.'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirmPassword do not match.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    // Hash candidate token from URL parameter
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with matching unexpired reset token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token.'
      });
    }

    // Update password (pre-save hook will hash with bcrypt!)
    user.password = password;

    // Invalidate token (single-use token)
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('[Reset Password Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset.'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
  forgotPassword,
  resetPassword
};
