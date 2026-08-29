const mongoose = require('mongoose');

const JobApplicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: false },
  jobTitle: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, default: '' },
  resumeUrl: { type: String, required: true },
  coverLetter: { type: String, default: '' },
  status: { type: String, enum: ['New', 'Reviewed', 'Shortlisted', 'Rejected'], default: 'New' }
}, { timestamps: true });

module.exports = mongoose.model('JobApplication', JobApplicationSchema);
