const mongoose = require('mongoose');

const JobApplicationSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: false },
  jobTitle: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, default: '' },
  resumeUrl: { type: String, default: '' },
  linkedinUrl: { type: String, default: '', trim: true },
  portfolioUrl: { type: String, default: '', trim: true },
  resumeData: { type: String, default: '' },     // Base64 encoded file
  resumeFileName: { type: String, default: '' }, // Original filename
  coverLetter: { type: String, default: '' },
  status: { type: String, enum: ['New', 'Reviewed', 'Shortlisted', 'Interview Scheduled', 'Rejected', 'Hired'], default: 'New' },
  // Interview scheduling
  interviewDate: { type: Date, default: null },
  interviewTime: { type: String, default: '' },
  interviewNotes: { type: String, default: '' },
  interviewType: { type: String, enum: ['In-Person', 'Online', 'Phone', ''], default: '' },
  interviewScheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  interviewEmailSent: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('JobApplication', JobApplicationSchema);

