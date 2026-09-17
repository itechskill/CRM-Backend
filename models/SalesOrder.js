const mongoose = require('mongoose');

const SalesOrderSchema = new mongoose.Schema(
  {
    orderReference: { type: String, trim: true, default: '' },
    creationDate: { type: Date, default: null },
    salePerson: { type: String, trim: true, default: '' },
    fileNo: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
    productSummary: { type: String, trim: true, default: '' },
    orderNumber: { type: String, trim: true, default: '' },
    clientName: { type: String, required: [true, 'Client name is required'], trim: true },
    clientEmail: { type: String, trim: true, lowercase: true, default: '' },
    clientPhone: { type: String, trim: true, default: '' },
    clientAddress: { type: String, trim: true, default: '' },
    items: [
      {
        description: { type: String, default: '' },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    totalAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    status: { type: String, default: 'Sales Order' },
    orderDate: { type: Date, default: Date.now },
    deliveryDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    // Stock workflow
    stockStatus: {
      type: String,
      enum: ['Available', 'Purchase Required', 'In Procurement', 'Received', 'In Stock', 'Out of Stock', 'Partial Stock', 'Pending Check'],
      default: 'Available'
    },
    // Auto-updated statuses based on related records
    deliveryStatus: {
      type: String,
      enum: ['Not Delivered', 'Partially Delivered', 'Fully Delivered', 'Delivered', 'Done'],
      default: 'Not Delivered'
    },
    invoiceStatus: {
      type: String,
      enum: ['Not Invoiced', 'Partially Invoiced', 'Fully Invoiced', 'Invoiced', 'To Invoice'],
      default: 'To Invoice'
    },
    invoiceNumber: { type: String, default: '' },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Advance Received', 'Partially Paid', 'Fully Paid', 'Paid', 'Unpaid'],
      default: 'Pending'
    },
    totalPaid: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    // Linked records
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    customerPOId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerPO', default: null },
    customerPONumber: { type: String, default: '' },
    productFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductFile', default: null },
    proformaInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProformaInvoice', default: null },
    proformaInvoiceNumber: { type: String, default: '' },
    proformaStatus: {
      type: String,
      enum: ['None', 'Draft', 'Issued', 'Sent', 'Approved', 'Cancelled'],
      default: 'None'
    },
    customerOverdueAtCreation: { type: Number, default: 0 },
    requiresFinanceApproval: { type: Boolean, default: false },
    financeApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    financeApprovedByName: { type: String, default: '' },
    financeApprovedAt: { type: Date, default: null },
    financeRejectionReason: { type: String, default: '' },
    isOverdueBlocked: { type: Boolean, default: false },
    overdueBlockReason: { type: String, default: '' },
    overdueBlockedAt: { type: Date, default: null },
    overdueBlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    overdueBlockedByName: { type: String, default: '' },
    supplierPO: {
      poNumber: { type: String, default: '' },
      poType: { type: String, enum: ['Local', 'International', ''], default: '' },
      supplierName: { type: String, default: '' },
      supplierCountry: { type: String, default: '' },
      supplierEmail: { type: String, default: '' },
      supplierPhone: { type: String, default: '' },
      issueDate: { type: Date, default: null },
      status: { type: String, default: 'Issued' },
      items: [
        {
          description: { type: String, default: '' },
          quantity: { type: Number, default: 1 },
          unitPrice: { type: Number, default: 0 },
          total: { type: Number, default: 0 }
        }
      ],
      totalAmount: { type: Number, default: 0 },
      currency: { type: String, default: 'PKR' },
      notes: { type: String, default: '' },
      issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      issuedByName: { type: String, default: '' },
      issuedAt: { type: Date, default: null }
    },
    goodsReceivedInOffice: {
      received: { type: Boolean, default: false },
      receivedAt: { type: Date, default: null },
      receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      receivedByName: { type: String, default: '' },
      receivedQuantity: { type: Number, default: 0 },
      orderedQuantity: { type: Number, default: 0 },
      remarks: { type: String, default: '' }
    },
    blNumber: { type: String, default: '' },
    blInput: {
      blNumber: { type: String, default: '' },
      blDate: { type: Date, default: null },
      carrier: { type: String, default: '' },
      containerNo: { type: String, default: '' },
      portOfLoading: { type: String, default: '' },
      portOfDischarge: { type: String, default: '' },
      enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      enteredByName: { type: String, default: '' },
      enteredAt: { type: Date, default: null }
    },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null },
    shipmentNumber: { type: String, default: '' },
    deliveryNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote', default: null },
    deliveryNoteNumber: { type: String, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    // Department Handoff & Audit Trail
    workflowStatus: {
      type: String,
      default: 'Sales Order Created'
    },
    departmentResponsible: {
      type: String,
      default: 'Sales'
    },
    workflowHistory: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        userName: { type: String, default: '' },
        department: { type: String, default: '' },
        action: { type: String, default: '' },
        previousStatus: { type: String, default: '' },
        newStatus: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
      }
    ],
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    salesPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

SalesOrderSchema.pre('save', async function (next) {
  if (!this.orderNumber && !this.orderReference) {
    const allOrders = await mongoose.model('SalesOrder').find({
      orderReference: { $regex: /^S\d+$/i }
    }).select('orderReference').lean();
    
    let maxNum = 1724;
    allOrders.forEach(o => {
      const match = o.orderReference && o.orderReference.match(/\d+$/);
      if (match) {
        const n = parseInt(match[0], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    
    const nextRef = 'S0' + String(maxNum + 1);
    this.orderReference = nextRef;
    this.orderNumber = nextRef;
  } else if (!this.orderNumber && this.orderReference) {
    this.orderNumber = this.orderReference;
  } else if (!this.orderReference && this.orderNumber) {
    this.orderReference = this.orderNumber;
  }
  
  if (!this.creationDate) {
    this.creationDate = this.createdAt || new Date();
  }
  // Auto-set outstanding balance
  if (this.outstandingBalance === 0 && this.netAmount > 0 && this.totalPaid === 0) {
    this.outstandingBalance = this.netAmount || this.totalAmount || 0;
  }
  next();
});

module.exports = mongoose.model('SalesOrder', SalesOrderSchema);
