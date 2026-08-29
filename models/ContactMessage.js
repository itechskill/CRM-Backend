const mongoose = require('mongoose');

const ContactMessageSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  company: { type: String, default: '' },
  phone: { type: String, default: '' },
  subject: { type: String, default: '' },
  message: { type: String, required: true },
  status: { type: String, enum: ['New', 'Read', 'Replied'], default: 'New' }
}, { timestamps: true });

module.exports = mongoose.model('ContactMessage', ContactMessageSchema);
