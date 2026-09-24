const mongoose = require('mongoose');

const poItemSchema = new mongoose.Schema({
  productName: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 }
});

const supplierPOSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: false,
      default: null
    },
    supplierName: {
      type: String,
      required: true,
      trim: true
    },
    supplierCountry: {
      type: String,
      default: ''
    },
    poType: {
      type: String,
      enum: ['Local', 'Global'],
      required: true
    },
    poDate: {
      type: Date,
      default: Date.now
    },
    expectedDeliveryDate: {
      type: Date,
      default: null
    },
    portOfLoading: {
      type: String,
      default: ''
    },
    portOfDischarge: {
      type: String,
      default: 'Karachi Port'
    },
    paymentTerms: {
      type: String,
      default: ''
    },
    items: [poItemSchema],
    totalAmount: {
      type: Number,
      required: true,
      min: 0
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
    supplierContact: {
      type: String,
      default: ''
    },
    supplierEmail: {
      type: String,
      default: ''
    },
    supplierPhone: {
      type: String,
      default: ''
    },
    currency: {
      type: String,
      default: 'PKR'
    },
    status: {
      type: String,
      enum: ['Draft', 'Issued', 'In Transit', 'In Logistics', 'Shipped', 'Partially Received', 'Fully Received', 'Completed', 'Cancelled', 'Payment Blocked – Customer Advance Required', 'Payment Blocked – Awaiting Customer Advance', 'Payment Eligible'],
      default: 'Issued'
    },
    notes: {
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

module.exports = mongoose.model('SupplierPO', supplierPOSchema);
