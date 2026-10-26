const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'Lead Created',
  'Lead Updated',
  'Lead Converted',
  'Quotation Created',
  'Quotation Sent',
  'Quotation Accepted',
  'Quotation Rejected',
  'Quotation Updated',
  'Quotation Converted to Customer PO',
  'Sales Order Created',
  'Sales Order Updated',
  'Order Sent to Finance',
  'Delivery Note Created',
  'Delivery Completed',
  'Follow-up Created',
  'Follow-up Completed',
  'Customer Contacted',
  'Target Updated',
  'Deal Created',
  'Deal Updated',
  'Deal Won',
  'Invoice Created',
  'Invoice Updated',
  'Invoice Sent',
  'Invoice Paid',
  'Invoice Finalized',
  'Customer PO Uploaded',
  'Customer PO Converted to Product File',
  'Product File Created',
  'Product File Converted to Sales Order',
  'Payment Recorded',
  'Inventory IN',
  'Other'
];

const SalesActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: [true, 'Activity type is required']
    },
    description: { type: String, trim: true, default: '' },
    relatedModel: {
      type: String,
      enum: ['Lead', 'Quotation', 'SalesOrder', 'DeliveryNote', 'FollowUp', 'SalesTarget', 'Deal', 'Invoice', 'CustomerPO', 'ProductFile', 'Payment', null],
      default: null
    },
    relatedId: { type: mongoose.Schema.Types.ObjectId, default: null },
    relatedCustomer: { type: String, default: '' },
    salesMemberName: { type: String, default: '' },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SalesActivity', SalesActivitySchema);
