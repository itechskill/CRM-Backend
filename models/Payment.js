const mongoose = require('mongoose');
const companySnapshotDefinition = require('./schemas/companySnapshot');
const { allocateReceiptVoucherNumber } = require('../utils/receiptVoucherNumber');

const PaymentAllocationSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, trim: true, default: '' },
  salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
  salesOrderNumber: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 0 }
}, { _id: false });

const PaymentSchema = new mongoose.Schema(
  {
    paymentRefNumber: { type: String, trim: true, default: '' },
    receiptVoucherNumber: { type: String, trim: true, default: '', index: { unique: true, sparse: true } },
    receiptRequestId: { type: String, trim: true, default: undefined, index: { unique: true, sparse: true } },
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    issuingCompany: companySnapshotDefinition(),
    customerName: { type: String, required: [true, 'Customer name is required'], trim: true },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    salesOrderNumber: { type: String, trim: true, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNumber: { type: String, trim: true, default: '' },
    allocations: { type: [PaymentAllocationSchema], default: undefined },
    paymentDate: { type: Date, default: Date.now },
    amount: { type: Number, required: [true, 'Payment amount is required'], min: 0 },
    paymentType: {
      type: String,
      enum: ['Advance', 'Partial', 'Full', 'Pending'],
      default: 'Partial'
    },
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'Cash', 'Cheque', 'Online', 'Other'],
      default: 'Bank Transfer'
    },
    notes: { type: String, default: '' },
    salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    salePerson: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Auto-generate payment reference number before save
PaymentSchema.pre('save', async function (next) {
  if (this.isNew && !this.receiptVoucherNumber) {
    this.receiptVoucherNumber = await allocateReceiptVoucherNumber(this.$session());
  }
  if (!this.paymentRefNumber) {
    const allPayments = await mongoose.model('Payment').find().select('paymentRefNumber').lean();
    let maxNum = 35;
    allPayments.forEach(p => {
      const match = p.paymentRefNumber && p.paymentRefNumber.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    this.paymentRefNumber = 'PAY-' + String(maxNum + 1).padStart(4, '0');
  }
  next();
});

module.exports = mongoose.model('Payment', PaymentSchema);
