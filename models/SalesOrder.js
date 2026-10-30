const mongoose = require('mongoose');
const companySnapshotDefinition = require('./schemas/companySnapshot');

const SalesOrderSchema = new mongoose.Schema(
  {
    orderReference: { type: String, trim: true, default: '' },
    creationDate: { type: Date, default: null },
    salePerson: { type: String, trim: true, default: '' },
    fileNo: { type: String, trim: true, default: '' },
    fileType: { type: String, enum: ['Blue', 'Green', 'Yellow', ''], default: '' },
    suggestedFileType: { type: String, enum: ['Blue', 'Green', ''], default: '' },
    productSummary: { type: String, trim: true, default: '' },
    orderNumber: { type: String, trim: true, default: '' },
    clientName: { type: String, required: [true, 'Client name is required'], trim: true },
    clientEmail: { type: String, trim: true, lowercase: true, default: '' },
    clientPhone: { type: String, trim: true, default: '' },
    clientAddress: { type: String, trim: true, default: '' },
    items: [
      {
        description: { type: String, default: '' },
        sku: { type: String, default: '' },
        productCode: { type: String, default: '' },
        partNumber: { type: String, trim: true, default: '' },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      }
    ],
    totalAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    status: { type: String, default: 'Sales Order' },
    orderDate: { type: Date, default: Date.now },
    deliveryDate: { type: Date, default: null },
    notes: { type: String, default: '' },
    issuingCompany: companySnapshotDefinition(),
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
      status: { type: String, default: '' },
      items: [
        {
          description: { type: String, default: '' },
          partNumber: { type: String, trim: true, default: '' },
          quantity: { type: Number, default: 1 },
          unitPrice: { type: Number, default: 0 },
          total: { type: Number, default: 0 }
        }
      ],
      totalAmount: { type: Number, default: 0 },
      subtotal: { type: Number, default: 0 },
      gstRate: { type: Number, default: 0 },
      gstAmount: { type: Number, default: 0 },
      vatRate: { type: Number, default: 0 },
      vatAmount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      currency: { type: String, default: 'PKR' },
      exchangeRateToPKR: { type: Number, default: null },
      notes: { type: String, default: '' },
      issuingCompany: companySnapshotDefinition(),
      issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      issuedByName: { type: String, default: '' },
      issuedAt: { type: Date, default: null }
    },
    supplierPoId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupplierPO', default: null },
    supplierPoNumber: { type: String, default: '' },
    goodsReceivedInOffice: {
      received: { type: Boolean, default: false },
      receivedAt: { type: Date, default: null },
      receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      receivedByName: { type: String, default: '' },
      receivedQuantity: { type: Number, default: 0 },
      orderedQuantity: { type: Number, default: 0 },
      remarks: { type: String, default: '' }
    },
    inventoryReceived: { type: Boolean, default: false },
    inventoryFulfilledFromExistingStock: { type: Boolean, default: false },
    inventoryGrnNumbers: [{ type: String, trim: true }],
    inventoryReceipts: [
      {
        receiptId: { type: String, default: '' },
        grnNumber: { type: String, default: '' },
        receivedAt: { type: Date, default: Date.now },
        receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        receivedByName: { type: String, default: '' },
        referenceType: { type: String, default: '' },
        referenceNumber: { type: String, default: '' },
        referenceDate: { type: Date, default: null },
        supplierName: { type: String, default: '' },
        carrier: { type: String, default: '' },
        containerNo: { type: String, default: '' },
        portOfLoading: { type: String, default: '' },
        portOfDischarge: { type: String, default: '' },
        remarks: { type: String, default: '' },
        items: [
          {
            orderItemId: { type: String, default: '' },
            productName: { type: String, default: '' },
            partNumber: { type: String, trim: true, default: '' },
            sku: { type: String, default: '' },
            orderedQty: { type: Number, default: 0 },
            receivedQty: { type: Number, default: 0 },
            inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
            inventoryName: { type: String, default: '' },
            inventorySku: { type: String, default: '' },
            inventoryCategory: { type: String, default: '' },
            inventoryLocation: { type: String, default: '' },
            createdNew: { type: Boolean, default: false }
          }
        ]
      }
    ],
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
    inventoryCheckStatus: {
      type: String,
      enum: ['Not Checked', 'In Stock', 'Shortage', 'Procurement Completed'],
      default: 'Not Checked'
    },
    undertakingDetails: {
      undertakingNumber: { type: String, default: '' },
      issuedDate: { type: Date, default: null },
      termsAccepted: { type: Boolean, default: true },
      remarks: { type: String, default: 'Official Company Undertaking for Sales Order' }
    },
    goodsDeclarationDetails: {
      gdNumber: { type: String, default: '' },
      gdDate: { type: Date, default: null },
      portName: { type: String, default: 'Karachi Customs Port' },
      declarationType: { type: String, default: 'Commercial Import' },
      remarks: { type: String, default: 'Verified Goods Declaration Form' }
    },
    workflowStatus: {
      type: String,
      default: 'Sales Order Created'
    },
    departmentResponsible: {
      type: String,
      default: 'Sales'
    },
    currentDepartment: {
      type: String,
      enum: ['Sales', 'Finance', 'Local Purchaser', 'Global Purchaser', 'Logistics', 'Support', 'Accounts', 'Completed'],
      default: 'Sales'
    },
    currentStatus: {
      type: String,
      default: 'SALES_ORDER_CREATED'
    },
    previousDepartment: {
      type: String,
      default: ''
    },
    previousStatus: {
      type: String,
      default: ''
    },
    lastAction: {
      type: String,
      default: 'Sales Order Created'
    },
    lastActionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    lastActionByName: {
      type: String,
      default: ''
    },
    lastActionAt: {
      type: Date,
      default: Date.now
    },
    inventoryAnalysis: [
      {
        productId: { type: String, default: '' },
        productName: { type: String, default: '' },
        orderedQty: { type: Number, default: 0 },
        availableQty: { type: Number, default: 0 },
        shortageQty: { type: Number, default: 0 },
        status: { type: String, default: 'Pending' }
      }
    ],
    inventoryReservations: [
      {
        orderItemId: { type: String, default: '' },
        itemIndex: { type: Number, default: 0 },
        inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
        deliveryNote: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryNote', default: null },
        inventoryName: { type: String, default: '' },
        quantity: { type: Number, default: 0, min: 0 },
        remainingQuantity: { type: Number, default: 0, min: 0 },
        deliveredQuantity: { type: Number, default: 0, min: 0 },
        releasedQuantity: { type: Number, default: 0, min: 0 },
        status: {
          type: String,
          enum: ['Reserved', 'Partially Fulfilled', 'Fulfilled', 'Released'],
          default: 'Reserved'
        },
        reservedAt: { type: Date, default: Date.now },
        reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reservedByName: { type: String, default: '' },
        releasedAt: { type: Date, default: null },
        releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        releasedByName: { type: String, default: '' },
        releaseReason: { type: String, default: '' }
      }
    ],
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
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Financial Control: Inventory Shortage & Customer Advance Tracking
    shortageAmount: { type: Number, default: 0 },
    advanceRequired: { type: Boolean, default: false },
    advanceReceived: { type: Boolean, default: false },
    advancePercentage: { type: Number, default: 0 },
    advanceRequiredAmount: { type: Number, default: 0 },
    advanceReceivedAmount: { type: Number, default: 0 },
    isSupplierPaymentBlocked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

SalesOrderSchema.index({ owner: 1, createdAt: -1 });
SalesOrderSchema.index({ createdBy: 1, createdAt: -1 });
SalesOrderSchema.index({ currentDepartment: 1, workflowStatus: 1, updatedAt: -1 });

SalesOrderSchema.pre('save', async function (next) {
  if (this.isNew) {
    const { allocateSalesOrderNumber } = require('../utils/salesOrderNumber');
    const allocatedNumber = await allocateSalesOrderNumber(this.$session());
    this.orderNumber = allocatedNumber;
    this.orderReference = allocatedNumber;
  } else if (this.isModified('orderNumber') || this.isModified('orderReference')) {
    const candidate = String(this.orderNumber || this.orderReference || '').trim();
    const duplicate = candidate && await mongoose.model('SalesOrder').exists({
      _id: { $ne: this._id },
      $or: [{ orderNumber: candidate }, { orderReference: candidate }]
    });
    if (duplicate) {
      const error = new Error(`Sales Order number ${candidate} already exists.`);
      error.statusCode = 409;
      throw error;
    }
    this.orderNumber = candidate;
    this.orderReference = candidate;
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
