const mongoose = require('mongoose');
const { allocateDeliveryNoteNumber } = require('../utils/deliveryNoteNumber');

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
    expiryDate: { type: Date, default: null },
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
        partNumber: { type: String, trim: true, default: '' },
        demand: { type: Number, default: 1 },
        quantity: { type: Number, default: 1 },
        unit: { type: String, default: 'Units' },
        availability: { type: String, default: 'Available' },
        totalOrderedQty: { type: Number, default: 0 },
        orderItemId: { type: String, default: '' },
        orderItemIndex: { type: Number, default: 0 },
        inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
        unitPrice: { type: Number, default: 0 },
        lineTotal: { type: Number, default: 0 }
      }
    ],
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
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
    signedDeliveryNoteDocument: { type: String, default: '' },
    signedDeliveryNoteDocumentName: { type: String, default: '' },
    signedDeliveryNoteUploadedAt: { type: Date, default: null },
    signedDeliveryNoteUploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    signedDeliveryNoteUploadedByName: { type: String, default: '' },
    isPartial: { type: Boolean, default: false },
    isStockDeducted: { type: Boolean, default: false },
    stockDeductionClaimedAt: { type: Date, default: null },
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

DeliveryNoteSchema.pre('save', async function () {
  if (!this.deliveryNumber) {
    const num = await allocateDeliveryNoteNumber(this.$session());
    this.deliveryNumber = num;
    this.deliveryNoteNumber = num;
  }
  if (this.salesOrder && (this.isNew || this.isModified('items'))) {
    // Prices are commercial Sales Order data. Never trust Delivery Note callers
    // to create or update their own unit prices or totals.
    const SalesOrder = require('./SalesOrder');
    const order = await SalesOrder.findById(this.salesOrder).session(this.$session() || null);
    if (order) {
      this.items.forEach((deliveryItem, deliveryIndex) => {
        const sourceItem = order.items.find(item =>
          deliveryItem.orderItemId && String(item._id) === String(deliveryItem.orderItemId)
        ) || order.items[Number(deliveryItem.orderItemIndex)] || order.items[deliveryIndex];
        const unitPrice = Number(sourceItem?.unitPrice) || 0;
        deliveryItem.partNumber = String(sourceItem?.partNumber || '').trim();
        deliveryItem.unitPrice = unitPrice;
        deliveryItem.lineTotal = (Number(deliveryItem.quantity) || Number(deliveryItem.demand) || 0) * unitPrice;
      });

      const subtotal = this.items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
      const orderSubtotal = (order.items || []).reduce(
        (sum, item) => sum + (Number(item.total) || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0))),
        0
      );
      const priceRatio = orderSubtotal > 0 ? Math.min(1, subtotal / orderSubtotal) : 1;
      this.subtotal = subtotal;
      this.discount = Math.round((Number(order.discount) || 0) * priceRatio * 100) / 100;
      this.tax = Math.round((Number(order.tax) || 0) * priceRatio * 100) / 100;
      this.grandTotal = Math.round((subtotal - this.discount + this.tax) * 100) / 100;
    }
  }
  if (!this.sourceDocument && this.salesOrderNumber) {
    this.sourceDocument = this.salesOrderNumber;
  }
  if (!this.deadline || (this.scheduledDate && this.deadline.getTime() === this.scheduledDate.getTime())) {
    const baseDate = this.scheduledDate || new Date();
    this.deadline = new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000);
  }
});

module.exports = mongoose.model('DeliveryNote', DeliveryNoteSchema);
