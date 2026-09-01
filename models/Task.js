const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true
  },
  project: {
    type: String,
    default: 'General'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedToName: {
    type: String,
    default: ''
  },
  assignedToRole: {
    type: String,
    default: ''   // e.g. 'hr_manager', 'sales_manager', 'project_manager', 'accountant', 'marketing', 'administration', 'employee'
  },
  assignedByName: {
    type: String,
    default: ''   // Display name of creator (e.g. 'CEO', 'Project Manager name')
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Under Review', 'Completed', 'Cancelled'],
    default: 'Pending'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium'
  },
  dueDate: {
    type: Date
  },
  category: {
    type: String,
    default: 'General'
  },
  description: {
    type: String,
    default: ''
  },
  hoursLogged: {
    type: Number,
    default: 0
  },
  completionReport: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Task', TaskSchema);
