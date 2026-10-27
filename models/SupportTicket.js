const mongoose = require('mongoose');

const SupportTicketSchema = new mongoose.Schema(
  {
    deliveryNote: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote', required: true, index: true },
    deliveryNoteNumber: { type: String, required: true, trim: true },
    complaint: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['Received', 'Solved'],
      default: 'Received'
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, trim: true, default: '' },
    solvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
