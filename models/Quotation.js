const mongoose = require('mongoose');

const QuotationSchema = new mongoose.Schema(
  {
    orderReference: { type: String, trim: true, default: '' },
    creationDate: { type: Date, default: null },
    salePerson: { type: String, trim: true, default: '' },
    fileNo: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
    productSummary: { type: String, trim: true, default: '' },
    quotationNumber: { type: String, trim: true, default: '' },
    clientName: { type: String, required: [true, 'Client name is required'], trim: true },
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
    totalAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    taxPercentage: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Draft', 'Quotation', 'Sent', 'Under Review', 'Accepted', 'Rejected', 'Expired'],
      default: 'Draft'
    },
    validUntil: { type: Date, default: null },
    validityDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', default: null },
    customerPOId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerPO', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

QuotationSchema.pre('save', async function (next) {
  if (!this.orderReference && !this.quotationNumber) {
    const allQuotes = await mongoose.model('Quotation').find({
      orderReference: { $regex: /^S\d+$/i }
    }).select('orderReference').lean();
    
    let maxNum = 1724;
    allQuotes.forEach(q => {
      const match = q.orderReference && q.orderReference.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    
    const nextRef = 'S0' + String(maxNum + 1);
    this.orderReference = nextRef;
    this.quotationNumber = nextRef;
  } else if (!this.quotationNumber && this.orderReference) {
    this.quotationNumber = this.orderReference;
  } else if (!this.orderReference && this.quotationNumber) {
    this.orderReference = this.quotationNumber;
  }
  
  if (!this.creationDate) {
    this.creationDate = this.createdAt || new Date();
  }
  next();
});

module.exports = mongoose.model('Quotation', QuotationSchema);
