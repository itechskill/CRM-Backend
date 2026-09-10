const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Lead name is required'],
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
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['New', 'Contacted', 'Interested', 'Qualified', 'Converted to Deal', 'Converted', 'Unqualified', 'Lost'],
    default: 'New'
  },
  value: {
    type: Number,
    default: 0
  },
  source: {
    type: String,
    default: 'Website'
  },
  campaign: {
    type: String,
    default: ''
  },
  requirements: {
    type: String,
    default: ''
  },
  followUpDate: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
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

module.exports = mongoose.model('Lead', LeadSchema);
