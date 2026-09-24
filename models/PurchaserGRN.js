const mongoose = require('mongoose');

const grnItemSchema = new mongoose.Schema({
  productId: { type: String, default: '' },
  productName: { type: String, default: 'Item', trim: true },
  orderedQty: { type: Number, default: 1, min: 0 },
  previouslyReceivedQty: { type: Number, default: 0 },
  receivedQty: { type: Number, default: 1, min: 0 },
  quantity: { type: Number, default: 1 },
  quantityReceived: { type: Number, default: 1 },
  remainingQty: { type: Number, default: 0 },
  condition: { type: String, default: 'Good' }
}, { _id: false });

const purchaserGRNSchema = new mongoose.Schema(
  {
    grnNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    grnType: {
      type: String,
      default: 'Logistics'
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null
    },
    supplierName: {
      type: String,
      default: ''
    },
    supplierPO: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupplierPO',
      default: null
    },
    supplierPOId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupplierPO',
      default: null
    },
    poNumber: {
      type: String,
      default: ''
    },
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesOrder',
      default: null
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
    grnDate: {
      type: Date,
      default: Date.now
    },
    items: [grnItemSchema],
    status: {
      type: String,
      enum: ['Received', 'Partial', 'Completed', 'Accepted', 'Rejected'],
      default: 'Completed'
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

module.exports = mongoose.model('PurchaserGRN', purchaserGRNSchema);
