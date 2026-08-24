const mongoose = require('mongoose');

const CompanyResourceSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Resource title is required'],
    trim: true
  },
  type: {
    type: String,
    enum: ['Document', 'Policy', 'Software', 'Template', 'Asset', 'Other'],
    default: 'Document'
  },
  link: {
    type: String,
    default: ''
  },
  department: {
    type: String,
    default: 'All'
  },
  description: {
    type: String,
    default: ''
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CompanyResource', CompanyResourceSchema);
