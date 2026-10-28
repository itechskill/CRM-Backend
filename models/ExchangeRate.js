const mongoose = require('mongoose');
const { SUPPORTED_CURRENCIES } = require('../config/currencies');

const exchangeRateHistorySchema = new mongoose.Schema({
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedByName: { type: String, default: '' },
  changedAt: { type: Date, default: Date.now },
  oldRate: { type: Number, default: null },
  newRate: { type: Number, required: true, min: 0.000001 },
  note: { type: String, trim: true, maxlength: 500, default: '' }
}, { _id: false });

const exchangeRateSchema = new mongoose.Schema({
  currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true, unique: true, uppercase: true, trim: true },
  rateToPKR: { type: Number, required: true, min: 0.000001 },
  lastChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lastChangedByName: { type: String, default: '' },
  lastChangedAt: { type: Date, default: null },
  history: { type: [exchangeRateHistorySchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('ExchangeRate', exchangeRateSchema);
