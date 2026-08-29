const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['Present', 'Absent', 'Late', 'Half Day', 'On Leave'],
    default: 'Present'
  },
  checkIn: {
    type: String,
    default: '09:00 AM'
  },
  checkOut: {
    type: String,
    default: '05:00 PM'
  },
  workHours: {
    type: Number,
    default: 8
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Attendance', AttendanceSchema);
