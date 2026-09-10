const mongoose = require('mongoose');

const ProductFileSchema = new mongoose.Schema(
  {
    fileNumber: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow'], default: 'Blue' },
    customerName: { type: String, required: [true, 'Customer name is required'], trim: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationNumber: { type: String, trim: true, default: '' },
    customerPOId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerPO', default: null },
    customerPONumber: { type: String, trim: true, default: '' },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    salesOrderNumber: { type: String, trim: true, default: '' },
    products: [
      {
        name: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unit: { type: String, default: '' },
        description: { type: String, default: '' }
      }
    ],
    notes: { type: String, default: '' },
    status: { type: String, enum: ['Active', 'In Progress', 'Completed', 'Cancelled'], default: 'Active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProductFile', ProductFileSchema);
