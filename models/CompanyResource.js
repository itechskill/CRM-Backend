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
  serialNumber: {
    type: String,
    default: ''
  },
  assignedTo: {
    type: String,
    default: 'Unassigned'
  },
  status: {
    type: String,
    enum: ['In Use', 'Active', 'Maintenance', 'Available'],
    default: 'In Use'
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CompanyResource', CompanyResourceSchema);
