const mongoose = require('mongoose');

const targetPerformanceSettingSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },
  showToSalespeople: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('TargetPerformanceSetting', targetPerformanceSettingSchema);
