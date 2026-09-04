const mongoose = require('mongoose');

const QuotationSchema = new mongoose.Schema(
  {
    quotationNumber: {
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
      enum: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'],
      default: 'Draft'
    },
    validUntil: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      default: ''
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

// Auto-generate quotation number before save
QuotationSchema.pre('save', async function (next) {
  if (!this.quotationNumber) {
    const count = await mongoose.model('Quotation').countDocuments();
    this.quotationNumber = `QT-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Quotation', QuotationSchema);
