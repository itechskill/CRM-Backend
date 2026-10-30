const mongoose = require('mongoose');

const InventoryCostHistorySchema = new mongoose.Schema({
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  changedByName: { type: String, trim: true, default: '' },
  changedAt: { type: Date, default: Date.now },
  oldUnitCostPKRCents: { type: Number, default: null },
  newUnitCostPKRCents: { type: Number, required: true, min: 0 },
  reason: { type: String, trim: true, default: '' }
}, { _id: false });

const InventoryCostBatchSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ['Support Receive Goods from Supplier PO', 'Manual stock entry', 'Inventory IN', 'Opening stock'],
    required: true
  },
  supplierPO: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierPO', default: null },
  supplierPONumber: { type: String, trim: true, default: '' },
  supplierPOLineId: { type: mongoose.Schema.Types.ObjectId, default: null },
  grn: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaserGRN', default: null },
  grnNumber: { type: String, trim: true, default: '' },
  receivedAt: { type: Date, default: Date.now },
  quantityReceived: { type: Number, required: true, min: 0 },
  quantityRemaining: { type: Number, required: true, min: 0 },
  unitCostPKRCents: { type: Number, default: null, min: 0 },
  costStatus: { type: String, enum: ['recorded', 'not recorded'], default: 'not recorded' },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  enteredByName: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  costHistory: { type: [InventoryCostHistorySchema], default: [] }
}, { timestamps: false });

const InventoryItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product / Item name is required'],
      trim: true,
      index: true
    },
    sku: {
      type: String,
      trim: true,
      default: ''
    },
    partNumber: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    },
    unit: {
      type: String,
      trim: true,
      default: 'pcs'
    },
    quantityOnHand: {
      type: Number,
      default: 0,
      min: 0
    },
    reservedQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    minStockLevel: {
      type: Number,
      default: 5
    },
    unitPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    location: {
      type: String,
      trim: true,
      default: 'WH/Stock'
    },
    description: {
      type: String,
      default: ''
    },
    supplierName: {
      type: String,
      trim: true,
      default: ''
    },
    supplierPoNumber: {
      type: String,
      trim: true,
      default: ''
    },
    orderReference: {
      type: String,
      trim: true,
      default: ''
    },
    stockMovements: [
      {
        type: { type: String, enum: ['IN', 'OUT'], default: 'IN' },
        quantity: { type: Number, default: 0 },
        reference: { type: String, trim: true, default: '' },
        grnNumber: { type: String, trim: true, default: '' },
        salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
        orderNumber: { type: String, trim: true, default: '' },
        remarks: { type: String, default: '' },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        performedByName: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now }
      }
    ],
    costBatches: { type: [InventoryCostBatchSchema], default: [] },
    status: {
      type: String,
      enum: ['In Stock', 'Low Stock', 'Out of Stock'],
      default: 'In Stock'
    }
  },
  { timestamps: true }
);

InventoryItemSchema.pre('save', function (next) {
  const available = Math.max(0, (this.quantityOnHand || 0) - (this.reservedQuantity || 0));
  if (available <= 0) {
    this.status = 'Out of Stock';
  } else if (available <= (this.minStockLevel || 5)) {
    this.status = 'Low Stock';
  } else {
    this.status = 'In Stock';
  }
  next();
});

module.exports = mongoose.model('InventoryItem', InventoryItemSchema);
