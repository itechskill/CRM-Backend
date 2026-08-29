const mongoose = require('mongoose');

const JobPostingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  department: { type: String, required: true },
  location: { type: String, default: 'Remote' },
  employmentType: { type: String, enum: ['Full-Time', 'Part-Time', 'Contract', 'Internship'], default: 'Full-Time' },
  experience: { type: String, default: '' },
  description: { type: String, default: '' },
  requirements: [{ type: String }],
  skills: [{ type: String }],
  status: { type: String, enum: ['Open', 'Closed', 'Draft'], default: 'Open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('JobPosting', JobPostingSchema);
