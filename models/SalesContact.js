const mongoose = require('mongoose');

const SalesContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Contact name is required'],
    trim: true
  },
  role: {
    type: String,
    default: ''
  },
  company: {
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
  tags: {
    type: [String],
    default: []
  },
  notes: {
    type: String,
    default: ''
  },
  nextFollowUp: {
    type: Date,
    default: null
  },
  lastContact: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SalesContact', SalesContactSchema);
