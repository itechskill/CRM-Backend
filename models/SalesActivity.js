const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'Lead Created',
  'Lead Updated',
  'Lead Converted',
  'Quotation Created',
  'Quotation Sent',
  'Quotation Accepted',
  'Quotation Rejected',
  'Sales Order Created',
  'Sales Order Updated',
  'Delivery Note Created',
  'Follow-up Created',
  'Follow-up Completed',
  'Customer Contacted',
  'Target Updated',
  'Other'
];

const SalesActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: [true, 'Activity type is required']
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    relatedModel: {
      type: String,
      enum: ['Lead', 'Quotation', 'SalesOrder', 'DeliveryNote', 'FollowUp', 'SalesTarget', null],
      default: null
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SalesActivity', SalesActivitySchema);
