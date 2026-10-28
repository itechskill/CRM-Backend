const mongoose = require('mongoose');
const companySnapshotDefinition = require('./schemas/companySnapshot');

const poItemSchema = new mongoose.Schema({
  productName: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 }
});

const expenseAttachmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  mimeType: { type: String, default: 'application/octet-stream', trim: true },
  size: { type: Number, required: true, min: 0, max: 3 * 1024 * 1024 },
  data: { type: String, required: true }
}, { _id: false });

const expenseHistorySchema = new mongoose.Schema({
  action: { type: String, enum: ['Added', 'Edited', 'Removed'], required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedByName: { type: String, default: '' },
  changedAt: { type: Date, default: Date.now },
  oldValues: { type: mongoose.Schema.Types.Mixed, default: null },
  newValues: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const purchaseExpenseSchema = new mongoose.Schema({
  grn: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaserGRN', default: null },
  grnNumber: { type: String, default: '', trim: true },
  category: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  calculationType: { type: String, enum: ['Fixed', 'Percentage'], default: 'Fixed' },
  amountCents: { type: Number, default: 0, min: 0 },
  percentage: { type: Number, default: 0, min: 0 },
  taxable: { type: Boolean, default: false },
  currency: { type: String, default: 'PKR', trim: true, uppercase: true },
  exchangeRateToPKR: { type: Number, default: 1, min: 0.000001 },
  amountPKRCents: { type: Number, required: true, min: 0 },
  remarks: { type: String, default: '', trim: true },
  attachments: { type: [expenseAttachmentSchema], default: [] },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  addedByName: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedByName: { type: String, default: '' },
  deletedAt: { type: Date, default: null },
  editHistory: { type: [expenseHistorySchema], default: [] }
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
    subtotal: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, default: 0, min: 0 },
    gstAmount: { type: Number, default: 0, min: 0 },
    vatRate: { type: Number, default: 0, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
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
    exchangeRateToPKR: {
      type: Number,
      default: null,
      min: 0.000001
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
    issuingCompany: companySnapshotDefinition(),
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdByName: {
      type: String,
      default: ''
    },
    goodsReceiptReference: { type: String, default: '', trim: true },
    goodsReceiptDate: { type: Date, default: null },
    goodsReceiptRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    goodsReceiptRecordedAt: { type: Date, default: null },
    supportVerifiedGrn: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaserGRN', default: null },
    supportVerifiedAt: { type: Date, default: null },
    expenses: { type: [purchaseExpenseSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupplierPO', supplierPOSchema);
