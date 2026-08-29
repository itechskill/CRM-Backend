const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    year: {
      type: Number,
      required: true
    },
    baseSalary: {
      type: Number,
      default: 0,
      min: 0
    },
    bonus: {
      type: Number,
      default: 0,
      min: 0
    },
    taxDeduction: {
      type: Number,
      default: 0,
      min: 0
    },
    netPay: {
      type: Number,
      default: 0,
      min: 0
    },
    status: {
      type: String,
      enum: ['Pending', 'Processed', 'On Hold'],
      default: 'Pending'
    },
    notes: {
      type: String,
      default: ''
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// One payroll record per user per month/year
payrollSchema.index({ user: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', payrollSchema);
