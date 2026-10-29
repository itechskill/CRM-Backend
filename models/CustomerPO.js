const mongoose = require('mongoose');

const CustomerPOSchema = new mongoose.Schema(
  {
    poNumber: { type: String, trim: true, default: '' },
    poDate: { type: Date, default: null },
    customerName: { type: String, required: [true, 'Customer name is required'], trim: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationNumber: { type: String, trim: true, default: '' },
    fileNumber: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', ''], default: '' },
    productFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFile', default: null },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    amount: { type: Number, default: 0 },
    items: [{
      partNumber: { type: String, trim: true, default: '' },
      sku: { type: String, trim: true, default: '' },
      description: { type: String, default: '' },
      quantity: { type: Number, default: 1 },
      unitPrice: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    }],
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    uploadedDocument: { type: String, default: '' },
    documentName: { type: String, default: '' },
    status: { type: String, enum: ['Draft', 'Received', 'Linked', 'Processed'], default: 'Received' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

CustomerPOSchema.pre('save', async function (next) {
  if (!this.poNumber) {
    const count = await mongoose.model('CustomerPO').countDocuments();
    this.poNumber = 'CPO-' + String(count + 1).padStart(4, '0');
  }
  next();
});

module.exports = mongoose.model('CustomerPO', CustomerPOSchema);
