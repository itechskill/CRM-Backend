const mongoose = require('mongoose');

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
