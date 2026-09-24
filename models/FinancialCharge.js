const mongoose = require('mongoose');

const financialChargeSchema = new mongoose.Schema(
  {
    chargeNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    chargeType: {
      type: String,
      enum: [
        'Bank Charges',
        'Payment Processing Charges',
        'Currency Conversion Fee',
        'Customs & Duty Charges',
        'Overdue Financial Charge',
        'Other Financial Charges'
      ],
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'PKR'
    },
    date: {
      type: Date,
      default: Date.now
    },
    relatedDocumentType: {
      type: String,
      enum: ['Invoice', 'Payment', 'SalesOrder', 'SupplierPO', 'General'],
      default: 'General'
    },
    relatedDocumentNumber: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['Recorded', 'Approved', 'Reconciled'],
      default: 'Recorded'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdByName: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('FinancialCharge', financialChargeSchema);
