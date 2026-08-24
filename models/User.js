const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ALLOWED_ROLES = [
  'admin',
  'ceo',
  'administration',
  'hr_manager',
  'sales_manager',
  'project_manager',
  'marketing',
  'accountant',
  'employee'
];

const ACCOUNT_STATUSES = ['pending', 'active', 'rejected', 'suspended'];

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/,
        'Please enter a valid email address'
      ]
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false // Exclude password field from queries by default
    },
    role: {
      type: String,
      enum: {
        values: ALLOWED_ROLES,
        message: '{VALUE} is not a valid user role'
      },
      default: 'employee'
    },
    department: {
      type: String,
      trim: true,
      default: ''
    },
    profileImage: {
      type: String,
      default: ''
    },
    employeeId: {
      type: String,
      trim: true,
      sparse: true
    },
    status: {
      type: String,
      enum: {
        values: ACCOUNT_STATUSES,
        message: '{VALUE} is not a valid account status'
      },
      default: 'pending'
    },
    isApproved: {
      type: Boolean,
      default: false
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: ''
    },
    lastLogin: {
      type: Date,
      default: null
    },
    resetPasswordToken: {
      type: String,
      default: null
    },
    resetPasswordExpire: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Hash password using bcrypt before saving
userSchema.pre('save', async function (next) {
  // Only hash password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare entered password with hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if a role is permitted for public registration (Admin cannot be publicly selected)
userSchema.statics.isPublicRegistrationRoleAllowed = function (role) {
  return role !== 'admin' && ALLOWED_ROLES.includes(role);
};

// Helper method to sanitize User JSON response (removes password)
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
