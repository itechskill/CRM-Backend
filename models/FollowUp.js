const mongoose = require('mongoose');

const FollowUpSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Follow-up title is required'], trim: true },
    description: { type: String, default: '' },
    customer: { type: String, trim: true, default: '' },
    contactName: { type: String, trim: true, default: '' },
    contactEmail: { type: String, trim: true, lowercase: true, default: '' },
    contactPhone: { type: String, trim: true, default: '' },
    type: {
      type: String,
      enum: ['Call', 'Email', 'Meeting', 'Demo', 'Proposal', 'Other'],
      default: 'Call'
    },
    followUpType: { type: String, default: '' },
    status: {
      type: String,
      enum: ['Pending', 'Completed', 'Cancelled', 'Rescheduled'],
      default: 'Pending'
    },
    scheduledAt: { type: Date, default: null },
    nextFollowUpDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    outcome: { type: String, default: '' },
    // Polymorphic relation
    relatedModel: {
      type: String,
      enum: ['Lead', 'Deal', 'Quotation', 'CustomerPO', 'SalesOrder', null],
      default: null
    },
    relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Legacy: just lead
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('FollowUp', FollowUpSchema);
