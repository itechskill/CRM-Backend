const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  unitPrice: { type: Number, required: true, min: 0, default: 0 },
  total: { type: Number, required: true, min: 0, default: 0 }
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, trim: true, default: '' },
  clientName: { type: String, required: true, trim: true },
  customerEmail: { type: String, trim: true, default: '' },
  customerPhone: { type: String, trim: true, default: '' },
  customerAddress: { type: String, trim: true, default: '' },
  dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal' },
  dealTitle: { type: String, default: '' },
  saleReference: { type: String, default: '' },
  salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
  salesOrderNumber: { type: String, default: '' },
  deliveryNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote', default: null },
  deliveryNoteNumber: { type: String, default: '' },
  fileNumber: { type: String, default: '' },
  fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
  items: [InvoiceItemSchema],
  subtotal: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  amount: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  outstandingAmount: { type: Number, default: 0, min: 0 },
  status: {
    type: String,
    enum: ['Draft', 'Pending Finance Finalization', 'Pending Review', 'Submitted', 'Approved', 'Finalized', 'Rejected', 'Sent', 'Paid', 'Partially Paid', 'Overdue', 'Cancelled'],
    default: 'Draft'
  },
  isDraft: { type: Boolean, default: true },
  invoiceType: { type: String, enum: ['GST Invoice', 'Cash Invoice', 'Standard', 'Commercial', ''], default: '' },
  paymentTerms: { type: String, default: 'Net 30' },
  issueDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  description: { type: String, default: '' },
  notes: { type: String, default: '' },
  departmentResponsible: { type: String, default: 'Accounts' },
  salePerson: { type: String, default: '' },
  salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  finalizedByName: { type: String, default: '' },
  finalizedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  lateChargeAmount: { type: Number, default: 0, min: 0 },
  lateChargePercentage: { type: Number, default: 3 },
  lateChargeApplied: { type: Boolean, default: false }
}, {
  timestamps: true
});

InvoiceSchema.pre('validate', async function (next) {
  if (!this.invoiceNumber) {
    const allInvoices = await mongoose.model('Invoice').find().select('invoiceNumber').lean();
    let maxNum = 80;
    allInvoices.forEach(inv => {
      const match = inv.invoiceNumber && inv.invoiceNumber.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    this.invoiceNumber = 'INV-' + String(maxNum + 1).padStart(4, '0');
  }
  if (!this.outstandingAmount && this.amount > 0 && !this.paidAmount) {
    this.outstandingAmount = this.amount;
  }
  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
