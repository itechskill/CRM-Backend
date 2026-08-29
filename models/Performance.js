const mongoose = require('mongoose');

const performanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    period: {
      type: String,
      required: true,
      trim: true,
      default: 'Q1 2026'
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    goals: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      comment: 'Goal completion percentage'
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      comment: 'Overall performance score percentage'
    },
    status: {
      type: String,
      enum: ['Excellent', 'Good', 'Average', 'Needs Improvement'],
      default: 'Average'
    },
    notes: {
      type: String,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// One review per user per period
performanceSchema.index({ user: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Performance', performanceSchema);
