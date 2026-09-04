const mongoose = require('mongoose');

const FollowUpSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Follow-up title is required'],
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    contactName: {
      type: String,
      trim: true,
      default: ''
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    contactPhone: {
      type: String,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['Call', 'Email', 'Meeting', 'Demo', 'Proposal', 'Other'],
      default: 'Call'
    },
    status: {
      type: String,
      enum: ['Pending', 'Completed', 'Cancelled', 'Rescheduled'],
      default: 'Pending'
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    outcome: {
      type: String,
      default: ''
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('FollowUp', FollowUpSchema);
