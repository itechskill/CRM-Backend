const mongoose = require('mongoose');

const categoryHistorySchema = new mongoose.Schema({
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedByName: { type: String, default: '' },
  changedAt: { type: Date, default: Date.now },
  oldName: { type: String, default: '' },
  newName: { type: String, default: '' },
  oldActive: { type: Boolean, default: true },
  newActive: { type: Boolean, default: true }
}, { _id: false });

const purchaseExpenseCategorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, unique: true, trim: true, lowercase: true },
  isActive: { type: Boolean, default: true },
  isDefaultOverride: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
  history: { type: [categoryHistorySchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('PurchaseExpenseCategory', purchaseExpenseCategorySchema);
