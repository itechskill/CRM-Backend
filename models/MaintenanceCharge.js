const mongoose = require('mongoose');

const MaintenanceChargeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Client/Property name is required'],
    trim: true
  },
  maintenanceType: {
    type: String,
    enum: [
      'Building Maintenance',
      'Equipment Maintenance',
      'Office Maintenance',
      'Software Maintenance',
      'Vehicle Maintenance',
      'Other'
    ],
    default: 'Building Maintenance'
  },
  description: {
    type: String,
    default: ''
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: 0
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required']
  },
  status: {
    type: String,
    enum: ['Paid', 'Pending', 'Overdue'],
    default: 'Pending'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdByName: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MaintenanceCharge', MaintenanceChargeSchema);
