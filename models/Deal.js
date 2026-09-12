const mongoose = require('mongoose');

const DealSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Deal title is required'],
    trim: true
  },
  clientName: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    default: ''
  },
  contactPerson: {
    type: String,
    default: ''
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  contactPhone: {
    type: String,
    default: ''
  },
  requirements: {
    type: String,
    default: ''
  },
  products: [
    {
      name: { type: String, default: '' },
      quantity: { type: Number, default: 1 },
      description: { type: String, default: '' }
    }
  ],
  value: {
    type: Number,
    required: true,
    min: 0
  },
  stage: {
    type: String,
    enum: ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Closed Won', 'Closed Lost'],
    default: 'Prospecting'
  },
  probability: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  closingDate: {
    type: Date
  },
  notes: {
    type: String,
    default: ''
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

DealSchema.pre('save', function (next) {
  if (['Won', 'Closed Won'].includes(this.stage)) {
    this.probability = 100;
  } else if (this.stage === 'Closed Lost') {
    this.probability = 0;
  }
  next();
});

module.exports = mongoose.model('Deal', DealSchema);
