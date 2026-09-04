const mongoose = require('mongoose');

const SalesOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      trim: true,
      default: ''
    },
    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true
    },
    clientEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    clientPhone: {
      type: String,
      trim: true,
      default: ''
    },
    items: [
      {
        description: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    totalAmount: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    tax: {
      type: Number,
      default: 0
    },
    netAmount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Pending'
    },
    orderDate: {
      type: Date,
      default: Date.now
    },
    deliveryDate: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      default: ''
    },
    quotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
      default: null
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

// Auto-generate order number before save
SalesOrderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    const count = await mongoose.model('SalesOrder').countDocuments();
    this.orderNumber = `SO-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('SalesOrder', SalesOrderSchema);
