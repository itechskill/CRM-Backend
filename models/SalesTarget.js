const mongoose = require('mongoose');

const SalesTargetSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    period: {
      type: String,
      trim: true,
      default: '' // e.g., "September 2026", "Q3 2026"
    },
    periodType: {
      type: String,
      enum: ['Monthly', 'Quarterly', 'Yearly'],
      default: 'Monthly'
    },
    targetAmount: {
      type: Number,
      required: [true, 'Target amount is required'],
      default: 0
    },
    achievedAmount: {
      type: Number,
      default: 0
    },
    currency: {
      type: String,
      default: 'PKR'
    },
    status: {
      type: String,
      enum: ['Active', 'Achieved', 'Missed', 'Ongoing'],
      default: 'Active'
    },
    notes: {
      type: String,
      default: ''
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// Virtual: achievement percentage
SalesTargetSchema.virtual('achievementPercentage').get(function () {
  if (!this.targetAmount || this.targetAmount === 0) return 0;
  return Math.round((this.achievedAmount / this.targetAmount) * 100);
});

SalesTargetSchema.set('toJSON', { virtuals: true });
SalesTargetSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('SalesTarget', SalesTargetSchema);
