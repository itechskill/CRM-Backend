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
    paymentMethod: {
      type: String,
      enum: ['Cash', 'Cheque', 'PDC'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    paymentDate: {
      type: Date,
      default: Date.now
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
      enum: ['Pending', 'Payment Blocked – Awaiting Customer Advance', 'Advance Partially Received', 'Payment Eligible', 'Paid', 'Cleared', 'Cancelled'],
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
