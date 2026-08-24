const mongoose = require('mongoose');

const WorkUpdateSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    default: ''
  },
  project: {
    type: String,
    default: ''
  },
  task: {
    type: String,
    default: ''
  },
  hoursSpent: {
    type: Number,
    required: true,
    min: 0.5,
    max: 24
  },
  summary: {
    type: String,
    required: [true, 'Work summary is required'],
    trim: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['Submitted', 'Reviewed', 'Approved'],
    default: 'Submitted'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('WorkUpdate', WorkUpdateSchema);
