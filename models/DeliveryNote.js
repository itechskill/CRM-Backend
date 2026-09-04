const mongoose = require('mongoose');

const DeliveryNoteSchema = new mongoose.Schema(
  {
    deliveryNumber: {
      type: String,
      trim: true,
      default: ''
    },
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesOrder',
      default: null
    },
    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true
    },
    deliveryAddress: {
      type: String,
      trim: true,
      default: ''
    },
    items: [
      {
        description: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unit: { type: String, default: 'pcs' }
      }
    ],
    status: {
      type: String,
      enum: ['Pending', 'In Transit', 'Delivered', 'Returned'],
      default: 'Pending'
    },
    deliveryDate: {
      type: Date,
      default: null
    },
    receivedBy: {
      type: String,
      trim: true,
      default: ''
    },
    notes: {
      type: String,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

// Auto-generate delivery note number before save
DeliveryNoteSchema.pre('save', async function (next) {
  if (!this.deliveryNumber) {
    const count = await mongoose.model('DeliveryNote').countDocuments();
    this.deliveryNumber = `DN-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('DeliveryNote', DeliveryNoteSchema);
