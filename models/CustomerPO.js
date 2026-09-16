const mongoose = require('mongoose');

const CustomerPOSchema = new mongoose.Schema(
  {
    poNumber: { type: String, trim: true, default: '' },
    poDate: { type: Date, default: null },
    customerName: { type: String, required: [true, 'Customer name is required'], trim: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationNumber: { type: String, trim: true, default: '' },
    productFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFile', default: null },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    amount: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    uploadedDocument: { type: String, default: '' },
    documentName: { type: String, default: '' },
    status: { type: String, enum: ['Draft', 'Received', 'Linked', 'Processed'], default: 'Received' },
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
