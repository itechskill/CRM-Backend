const mongoose = require('mongoose');

const PRICE_REQUEST_STATUSES = ['Pending', 'Priced', 'Declined'];
const PRICE_REQUEST_CATEGORIES = [
  'Servers',
  'Desktops/Laptops/Workstations',
  'Networking',
  'Software',
  'Other'
];
const PRICE_REQUEST_CURRENCIES = ['PKR', 'USD', 'EUR', 'AED', 'GBP'];
const PRICE_REQUEST_LEAD_SOURCES = ['WhatsApp', 'Email', 'Phone call', 'Other'];

const priceRequestItemSchema = new mongoose.Schema({
  brand: { type: String, required: true, trim: true, maxlength: 80 },
  category: { type: String, enum: PRICE_REQUEST_CATEGORIES, required: true },
  isBulk: { type: Boolean, default: false },
  partNumber: { type: String, trim: true, maxlength: 160, default: '' },
  requirement: { type: String, required: true, trim: true, maxlength: 4000 },
  quantity: { type: Number, min: 1, required: true },
  unitPriceCents: {
    type: Number, min: 0, default: null,
    validate: { validator: value => value == null || Number.isSafeInteger(value), message: 'Unit price must be stored as integer cents.' }
  },
  totalPriceCents: {
    type: Number, min: 0, default: null,
    validate: { validator: value => value == null || Number.isSafeInteger(value), message: 'Total price must be stored as integer cents.' }
  }
});

const priceRequestEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['Created', 'Priced', 'Declined', 'Reassigned', 'Pending note updated', 'Quotation linked'],
      required: true
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const priceRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true, trim: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    brand: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, enum: PRICE_REQUEST_CATEGORIES, required: true, index: true },
    isBulk: { type: Boolean, default: false },
    leadSource: { type: String, enum: PRICE_REQUEST_LEAD_SOURCES, required: true },
    leadSourceNote: { type: String, trim: true, maxlength: 200, default: '' },
    customerName: { type: String, trim: true, maxlength: 160, default: '' },
    reference: { type: String, trim: true, maxlength: 160, default: '' },
    partNumber: { type: String, trim: true, maxlength: 160, default: '' },
    requirement: { type: String, required: true, trim: true, maxlength: 4000 },
    quantity: { type: Number, min: 1, default: 1 },
    items: {
      type: [priceRequestItemSchema],
      default: undefined,
      validate: { validator: items => items == null || (items.length >= 1 && items.length <= 50), message: 'A Price Request must contain between 1 and 50 items.' }
    },
    status: { type: String, enum: PRICE_REQUEST_STATUSES, default: 'Pending', index: true },
    pendingNote: { type: String, trim: true, maxlength: 1000, default: '' },
    unitPriceCents: {
      type: Number,
      min: 0,
      validate: {
        validator: (value) => value == null || Number.isSafeInteger(value),
        message: 'Unit price must be stored as integer cents.'
      },
      default: null
    },
    totalPriceCents: { type: Number, min: 0, default: null },
    grandTotalCents: { type: Number, min: 0, default: null },
    currency: { type: String, enum: [...PRICE_REQUEST_CURRENCIES, null], default: null },
    validityDate: { type: Date, default: null },
    leadTime: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    declineReason: { type: String, trim: true, maxlength: 2000, default: '' },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    events: { type: [priceRequestEventSchema], default: [] }
  },
  { timestamps: true }
);

priceRequestSchema.index({ status: 1, requestedFrom: 1, createdAt: -1 });
priceRequestSchema.index({ status: 1, category: 1, createdAt: -1 });
priceRequestSchema.index({ 'items.brand': 1, 'items.category': 1 });

const PriceRequest = mongoose.model('PriceRequest', priceRequestSchema);

module.exports = PriceRequest;
module.exports.PRICE_REQUEST_STATUSES = PRICE_REQUEST_STATUSES;
module.exports.PRICE_REQUEST_CATEGORIES = PRICE_REQUEST_CATEGORIES;
module.exports.PRICE_REQUEST_CURRENCIES = PRICE_REQUEST_CURRENCIES;
module.exports.PRICE_REQUEST_LEAD_SOURCES = PRICE_REQUEST_LEAD_SOURCES;
