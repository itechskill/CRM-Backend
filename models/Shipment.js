const mongoose = require('mongoose');

const ShipmentSchema = new mongoose.Schema(
  {
    shipmentId: {
      type: String,
      unique: true,
      trim: true
    },
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalesOrder',
      required: true
    },
    salesOrderNumber: {
      type: String,
      trim: true,
      default: ''
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    salePerson: {
      type: String,
      trim: true,
      default: ''
    },
    clientName: {
      type: String,
      trim: true,
      default: ''
    },
    clientEmail: {
      type: String,
      trim: true,
      default: ''
    },
    clientPhone: {
      type: String,
      trim: true,
      default: ''
    },
    supplierName: {
      type: String,
      trim: true,
      default: ''
    },
    supplierCountry: {
      type: String,
      trim: true,
      default: ''
    },
    supplierPoNumber: {
      type: String,
      trim: true,
      default: ''
    },
    supplierPoDate: {
      type: Date,
      default: null
    },
    fileType: {
      type: String,
      default: 'Blue'
    },
    status: {
      type: String,
      enum: [
        'PO Issued',
        'Shipment Pending',
        'Booked',
        'Dispatched',
        'In Transit',
        'Arrived',
        'Received in Office',
        'Delayed',
        'Cancelled'
      ],
      default: 'PO Issued'
    },
    etd: {
      type: Date,
      default: null
    },
    eta: {
      type: Date,
      default: null
    },
    actualDepartureDate: {
      type: Date,
      default: null
    },
    actualArrivalDate: {
      type: Date,
      default: null
    },
    flightNumber: {
      type: String,
      trim: true,
      default: ''
    },
    carrier: {
      type: String,
      trim: true,
      default: ''
    },
    shippingMethod: {
      type: String,
      enum: ['Air Freight', 'Sea Freight', 'Courier', 'Land', 'Other'],
      default: 'Air Freight'
    },
    trackingNumber: {
      type: String,
      trim: true,
      default: ''
    },
    departureLocation: {
      type: String,
      trim: true,
      default: ''
    },
    arrivalLocation: {
      type: String,
      trim: true,
      default: ''
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    referenceDocs: {
      type: String,
      trim: true,
      default: ''
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
    },
    items: [
      {
        description: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    receivedInOffice: {
      type: Boolean,
      default: false
    },
    receivedInOfficeDate: {
      type: Date,
      default: null
    },
    receivedInOfficeBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    receivedInOfficeByName: {
      type: String,
      trim: true,
      default: ''
    },
    deliveryNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryNote',
      default: null
    },
    deliveryNoteNumber: {
      type: String,
      default: ''
    },
    trackingHistory: [
      {
        status: { type: String, default: '' },
        location: { type: String, default: '' },
        notes: { type: String, default: '' },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        updatedByName: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now }
      }
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { timestamps: true }
);

// Auto-generate shipmentId (SHP-0001)
ShipmentSchema.pre('save', async function (next) {
  if (!this.shipmentId) {
    const lastShipment = await mongoose
      .model('Shipment')
      .findOne({ shipmentId: { $regex: /^SHP-\d+$/i } })
      .sort({ createdAt: -1 })
      .select('shipmentId')
      .lean();

    let nextNum = 1001;
    if (lastShipment && lastShipment.shipmentId) {
      const match = lastShipment.shipmentId.match(/\d+$/);
      if (match) {
        nextNum = parseInt(match[0], 10) + 1;
      }
    }
    this.shipmentId = `SHP-${nextNum}`;
  }
  next();
});

module.exports = mongoose.model('Shipment', ShipmentSchema);
