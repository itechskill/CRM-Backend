const mongoose = require('mongoose');

const ProformaInvoiceSchema = new mongoose.Schema(
  {
    proformaNumber: { type: String, trim: true, default: '' },
    salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', required: [true, 'Sales Order reference is required'] },
    salesOrderNumber: { type: String, trim: true, default: '' },
    orderReference: { type: String, trim: true, default: '' },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotationNumber: { type: String, trim: true, default: '' },
    customerPOId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerPO', default: null },
    customerPONumber: { type: String, trim: true, default: '' },
    productFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFile', default: null },
    clientName: { type: String, required: [true, 'Client/Customer name is required'], trim: true },
    clientEmail: { type: String, trim: true, lowercase: true, default: '' },
    clientPhone: { type: String, trim: true, default: '' },
    clientAddress: { type: String, trim: true, default: '' },
    items: [
      {
        description: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    totalAmount: { type: Number, default: 0 }, // Subtotal
    discount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    taxPercentage: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 }, // Grand Total in PKR
    currency: { type: String, default: 'PKR' },
    status: {
      type: String,
      enum: ['Draft', 'Issued', 'Sent', 'Approved', 'Cancelled'],
      default: 'Issued'
    },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, default: null },
    paymentTerms: { type: String, trim: true, default: 'Advance 100%' },
    deliveryTerms: { type: String, trim: true, default: 'Ex-Works / Standard Dispatch' },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

ProformaInvoiceSchema.pre('save', async function (next) {
  if (!this.proformaNumber) {
    const allPIs = await mongoose.model('ProformaInvoice').find({
      proformaNumber: { $regex: /^PI\d+$/i }
    }).select('proformaNumber').lean();

    let maxNum = 100;
    allPIs.forEach(p => {
      const match = p.proformaNumber && p.proformaNumber.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });

    this.proformaNumber = 'PI' + String(maxNum + 1).padStart(4, '0');
  }

  // Calculate items total
  if (this.items && this.items.length > 0) {
    let subtotal = 0;
    this.items.forEach(item => {
      const q = Number(item.quantity) || 0;
      const u = Number(item.unitPrice) || 0;
      item.total = q * u;
      subtotal += item.total;
    });
    this.totalAmount = subtotal;
    const disc = Number(this.discount) || 0;
    const tx = Number(this.tax) || 0;
    this.netAmount = Math.max(0, subtotal - disc + tx);
  }

  next();
});

module.exports = mongoose.model('ProformaInvoice', ProformaInvoiceSchema);
