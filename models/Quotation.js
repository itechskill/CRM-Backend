const mongoose = require('mongoose');
const companySnapshotDefinition = require('./schemas/companySnapshot');
const { allocateQuotationNumber } = require('../utils/quotationNumber');

const QuotationSchema = new mongoose.Schema(
  {
    orderReference: { type: String, trim: true, default: '' },
    creationDate: { type: Date, default: null },
    salePerson: { type: String, trim: true, default: '' },
    fileNo: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
    productSummary: { type: String, trim: true, default: '' },
    quotationNumber: { type: String, trim: true, default: '' },
    quotationSerial: { type: Number, min: 1, default: undefined },
    quotationSerialCreator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    quotationCode: { type: String, trim: true, uppercase: true, default: '' },
    quotationNumberFormat: { type: String, enum: ['global-v1'], default: undefined },
    clientName: { type: String, required: [true, 'Client name is required'], trim: true },
    clientEmail: { type: String, trim: true, lowercase: true, default: '' },
    clientPhone: { type: String, trim: true, default: '' },
    clientAddress: { type: String, trim: true, default: '' },
    items: [
      {
        inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
        sku: { type: String, trim: true, default: '' },
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
    currency: { type: String, trim: true, default: 'Pakistani Rupee' },
    reference: { type: String, trim: true, default: '' },
    availability: { type: String, trim: true, default: 'Ex-stock (Limited)' },
    paymentTerms: { type: String, trim: true, default: '100% Advance' },
    priceValidity: { type: String, trim: true, default: '5 calendar days' },
    commercialNote: {
      type: String,
      trim: true,
      default: 'In case the Govt. imposes any additional duties/taxes/any change in Pak Rs. customer has to pay the difference.'
    },
    status: {
      type: String,
      enum: ['Draft', 'Quotation', 'Sent', 'Under Review', 'Accepted', 'Rejected', 'Expired', 'Converted to Sales Order', 'Converted to Customer PO', 'Converted'],
      default: 'Draft'
    },
    validUntil: { type: Date, default: null },
    validityDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    issuingCompany: companySnapshotDefinition(),
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', default: null },
    customerPOId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerPO', default: null },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    salesOrderNumber: { type: String, default: '' },
    convertedAt: { type: Date, default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    originalOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    forwardHistory: [{
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      forwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      time: { type: Date, default: Date.now },
      note: { type: String, trim: true, default: '' }
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

QuotationSchema.index(
  { quotationSerialCreator: 1, quotationSerial: 1 },
  {
    unique: true,
    name: 'unique_quotation_serial_per_creator',
    partialFilterExpression: {
      quotationSerialCreator: { $type: 'objectId' },
      quotationSerial: { $type: 'number' }
    }
  }
);
QuotationSchema.index(
  { quotationSerial: 1 },
  {
    unique: true,
    name: 'unique_global_quotation_serial_v1',
    partialFilterExpression: { quotationNumberFormat: 'global-v1' }
  }
);

QuotationSchema.pre('save', async function (next) {
  if (this.isNew && this.createdBy) {
    const allocated = await allocateQuotationNumber({ session: this.$session() });
    this.quotationSerial = allocated.serial;
    this.quotationSerialCreator = undefined;
    this.quotationCode = '';
    this.quotationNumberFormat = 'global-v1';
    this.orderReference = allocated.reference;
    this.quotationNumber = allocated.reference;
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
