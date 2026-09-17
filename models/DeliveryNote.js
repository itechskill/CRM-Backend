const mongoose = require('mongoose');

const DeliveryNoteSchema = new mongoose.Schema(
  {
    deliveryNumber: { type: String, trim: true, default: '' },
    deliveryNoteNumber: { type: String, trim: true, default: '' },
    salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    salesOrderNumber: { type: String, trim: true, default: '' },
    sourceDocument: { type: String, trim: true, default: '' },
    clientName: { type: String, trim: true, default: '' },
    deliveryAddress: { type: String, trim: true, default: '' },
    operationType: { type: String, trim: true, default: 'Fortline: Delivery Orders' },
    sourceLocation: { type: String, trim: true, default: 'WH/Stock' },
    scheduledDate: { type: Date, default: Date.now },
    deadline: { type: Date, default: Date.now },
    productAvailability: { type: String, trim: true, default: 'Available' },
    starred: { type: Boolean, default: false },
    recipientName: { type: String, trim: true, default: '' },
    recipientPhone: { type: String, trim: true, default: '' },
    trackingNumber: { type: String, trim: true, default: '' },
    carrier: { type: String, trim: true, default: '' },
    items: [
      {
        product: { type: String, default: '' },
        description: { type: String, default: '' },
        demand: { type: Number, default: 1 },
        quantity: { type: Number, default: 1 },
        unit: { type: String, default: 'Units' },
        availability: { type: String, default: 'Available' },
        totalOrderedQty: { type: Number, default: 0 }
      }
    ],
    status: {
      type: String,
      enum: ['Draft', 'Created', 'Waiting', 'Ready', 'Confirmed', 'Done', 'Cancelled', 'Returned', 'Pending', 'Dispatched', 'In Transit', 'Partially Delivered', 'Fully Delivered', 'Delivered'],
      default: 'Ready'
    },
    deliveryDate: { type: Date, default: null },
    receivedBy: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
    supplierPoNumber: { type: String, trim: true, default: '' },
    blNumber: { type: String, trim: true, default: '' },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null },
    shipmentNumber: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' },
    isPartial: { type: Boolean, default: false },
    isStockDeducted: { type: Boolean, default: false },
    invoiced: { type: Boolean, default: false },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNumber: { type: String, default: '' },
    invoicedAt: { type: Date, default: null },
    salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    salePerson: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

DeliveryNoteSchema.pre('save', async function (next) {
  if (!this.deliveryNumber) {
    const allNotes = await mongoose.model('DeliveryNote').find({
      deliveryNumber: { $regex: /^WH\/OUT\/\d+$/i }
    }).select('deliveryNumber').lean();

    let maxNum = 371;
    allNotes.forEach(d => {
      const match = d.deliveryNumber && d.deliveryNumber.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });

    const num = 'WH/OUT/' + String(maxNum + 1).padStart(5, '0');
    this.deliveryNumber = num;
    this.deliveryNoteNumber = num;
  }
  if (!this.sourceDocument && this.salesOrderNumber) {
    this.sourceDocument = this.salesOrderNumber;
  }
  if (!this.deadline || (this.scheduledDate && this.deadline.getTime() === this.scheduledDate.getTime())) {
    const baseDate = this.scheduledDate || new Date();
    this.deadline = new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000);
  }
  next();
});

module.exports = mongoose.model('DeliveryNote', DeliveryNoteSchema);
