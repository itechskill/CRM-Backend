const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true
  },
  type: {
    type: String,
    enum: ['Email', 'Social Media', 'Search Engine', 'Event', 'Content', 'Other'],
    default: 'Email'
  },
  status: {
    type: String,
    enum: ['Draft', 'Active', 'Paused', 'Completed'],
    default: 'Active'
  },
  budget: {
    type: Number,
    default: 0
  },
  reach: {
    type: Number,
    default: 0
  },
  leadsGenerated: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);
