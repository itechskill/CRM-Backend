const mongoose = require('mongoose');

const ROUTING_RULE_TYPES = ['category', 'bulkCategory', 'brand'];
const ROUTING_PRIORITIES = {
  category: 300,
  bulkCategory: 200,
  brand: 100
};

const priceRequestRoutingRuleSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    ruleType: { type: String, enum: ROUTING_RULE_TYPES, required: true, index: true },
    matchValues: {
      type: [{ type: String, trim: true }],
      validate: {
        validator: (values) => Array.isArray(values) && values.length > 0,
        message: 'Select at least one match value.'
      }
    },
    normalizedMatchValues: { type: [String], required: true, default: [] },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    priority: { type: Number, required: true },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

priceRequestRoutingRuleSchema.index({ ruleType: 1, active: 1, priority: -1 });

const PriceRequestRoutingRule = mongoose.model('PriceRequestRoutingRule', priceRequestRoutingRuleSchema);

module.exports = PriceRequestRoutingRule;
module.exports.ROUTING_RULE_TYPES = ROUTING_RULE_TYPES;
module.exports.ROUTING_PRIORITIES = ROUTING_PRIORITIES;
