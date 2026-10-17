const mongoose = require('mongoose');

const localPayableSchema = new mongoose.Schema(
  {
    payableNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null
    },
    supplierName: {
      type: String,
      required: true
    },
    supplierPO: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupplierPO',
      default: null
    },
    poNumber: {
      type: String,
      default: ''
    },
    salesOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesOrder',
      default: null
    },
    salesOrderNumber: {
      type: String,
      default: ''
    },
    grn: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaserGRN',
      default: null
    },
    grns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaserGRN' }],
    paymentMethod: {
      type: String,
      enum: ['', 'Cash', 'Cheque', 'PDC', 'Bank Transfer'],
      default: ''
    },
    paymentTerms: {
      type: String,
      default: ''
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    totalAmountCents: { type: Number, min: 0, default: undefined },
    paidAmountCents: { type: Number, min: 0, default: undefined },
    outstandingAmountCents: { type: Number, min: 0, default: undefined },
    payments: [{
      paymentId: { type: String, trim: true, default: '' },
      amountCents: { type: Number, min: 1 },
      date: { type: Date, default: Date.now },
      method: { type: String, trim: true, default: '' },
      reference: { type: String, trim: true, default: '' },
      note: { type: String, default: '' },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      recordedByName: { type: String, default: '' },
      recordedAt: { type: Date, default: Date.now }
    }],
    subtotal: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 0, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    paymentDate: {
      type: Date,
      default: null
    },
    // Cheque & PDC specific fields
    chequeNumber: {
      type: String,
      default: ''
    },
    bankName: {
      type: String,
      default: ''
    },
    chequeDate: {
      type: Date,
      default: null
    },
    pdcDate: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['Pending', 'Partially Paid', 'Payment Blocked – Awaiting Customer Advance', 'Advance Partially Received', 'Payment Eligible', 'Paid', 'Cleared', 'Cancelled'],
      default: 'Paid'
    },
    isBlockedByAdvance: {
      type: Boolean,
      default: false
    },
    remarks: {
      type: String,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdByName: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('LocalPayable', localPayableSchema);
