const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema(
  {
    paymentRefNumber: { type: String, trim: true, default: '' },
    customerName: { type: String, required: [true, 'Customer name is required'], trim: true },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    salesOrderNumber: { type: String, trim: true, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNumber: { type: String, trim: true, default: '' },
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
