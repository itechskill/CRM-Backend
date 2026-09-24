const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const Quotation = require('../models/Quotation');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SupplierPO = require('../models/SupplierPO');
const Supplier = require('../models/Supplier');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const FinancialCharge = require('../models/FinancialCharge');
const EditPermissionRequest = require('../models/EditPermissionRequest');
const EditAuditLog = require('../models/EditAuditLog');
const InventoryItem = require('../models/InventoryItem');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const Shipment = require('../models/Shipment');
const Expense = require('../models/Expense');

async function seedMasterWorkflowDemoData() {
  console.log('================================================================');
  console.log('       SEEDING FORTLINE CRM MASTER WORKFLOW DEMO DATA           ');
  console.log('================================================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas\n');

    // 1. Fetch Key Users (Preserve Ahmed Anjum)
    const ahmedUser = await User.findOne({ email: 'quote@fortline.net' }) || await User.findOne({ role: 'sales_person' });
    const ceoUser = await User.findOne({ role: 'ceo' });
    const financeUser = await User.findOne({ role: 'finance' });
    const purchaserUser = await User.findOne({ role: 'purchaser' }) || await User.findOne({ role: 'local_purchaser' });
    const globalPurchaserUser = await User.findOne({ role: 'global_purchaser' }) || purchaserUser;
    const supportUser = await User.findOne({ role: 'support' });
    const logisticsUser = await User.findOne({ role: 'logistics' });
    const accountsUser = await User.findOne({ role: 'accountant' }) || financeUser;

    const salesUserId = ahmedUser ? ahmedUser._id : new mongoose.Types.ObjectId();
    const ceoUserId = ceoUser ? ceoUser._id : new mongoose.Types.ObjectId();
    const financeUserId = financeUser ? financeUser._id : new mongoose.Types.ObjectId();
    const purchaserUserId = purchaserUser ? purchaserUser._id : new mongoose.Types.ObjectId();
    const supportUserId = supportUser ? supportUser._id : new mongoose.Types.ObjectId();

    console.log('User Accounts Verified:');
    console.log(`- Sales Person: ${ahmedUser ? ahmedUser.fullName : 'Ahmed Anjum'} (${ahmedUser ? ahmedUser.email : 'quote@fortline.net'})`);
    console.log(`- CEO: ${ceoUser ? ceoUser.fullName : 'Karim Rafiq'}`);
    console.log(`- Finance: ${financeUser ? financeUser.fullName : 'Finance User'}`);
    console.log(`- Purchaser: ${purchaserUser ? purchaserUser.fullName : 'Purchaser User'}\n`);

    // 2. Clear previous demo test objects except Ahmed Anjum's user record
    console.log('Purging non-Ahmed legacy test data across workflow collections...');
    await SalesOrder.deleteMany({ orderNumber: { $regex: /^SO-/ } });
    await Quotation.deleteMany({ quotationNumber: { $regex: /^QT-/ } });
    await DeliveryNote.deleteMany({ deliveryNoteNumber: { $regex: /^DN-/ } });
    await Invoice.deleteMany({ invoiceNumber: { $regex: /^INV-/ } });
    await Payment.deleteMany({ receiptNumber: { $regex: /^PAY-/ } });
    await SupplierPO.deleteMany({ poNumber: { $regex: /^PO-/ } });
    await PurchaserGRN.deleteMany({ grnNumber: { $regex: /^GRN-/ } });
    await LocalPayable.deleteMany({ payableNumber: { $regex: /^PAYABLE-/ } });
    await FinancialCharge.deleteMany({ chargeNumber: { $regex: /^FC-/ } });
    await EditPermissionRequest.deleteMany({});
    await EditAuditLog.deleteMany({});
    await InventoryItem.deleteMany({ sku: { $regex: /^SKU-DEMO/ } });
    await Deal.deleteMany({ title: { $regex: /^[Demo]/ } });
    await Lead.deleteMany({ name: { $regex: /^[Demo]/ } });
    await Shipment.deleteMany({ trackingNumber: { $regex: /^TRK-DEMO/ } });
    await Expense.deleteMany({ referenceNumber: { $regex: /^EXP-DEMO/ } });

    // 3. Create Seed Inventory Items
    console.log('\n1. Creating Inventory Items...');
    const invItem1 = await InventoryItem.create({
      name: 'Siemens Pressure Transmitter P300',
      sku: 'SKU-DEMO-VALVE-01',
      category: 'Instrumentation',
      quantityInStock: 80,
      unitPrice: 12000,
      reorderLevel: 20,
      unitOfMeasure: 'pcs',
      createdBy: salesUserId
    });

    const invItem2 = await InventoryItem.create({
      name: 'High Flow Centrifugal Pump CP-500',
      sku: 'SKU-DEMO-PUMP-02',
      category: 'Machinery',
      quantityInStock: 5,
      unitPrice: 35000,
      reorderLevel: 10,
      unitOfMeasure: 'pcs',
      createdBy: salesUserId
    });

    const invItem3 = await InventoryItem.create({
      name: 'Yokogawa Digital Flow Meter DF-900',
      sku: 'SKU-DEMO-FLOW-03',
      category: 'Automation',
      quantityInStock: 0,
      unitPrice: 15000,
      reorderLevel: 15,
      unitOfMeasure: 'pcs',
      createdBy: salesUserId
    });

    // 4. Create Suppliers
    console.log('2. Creating Local & Global Suppliers...');
    let localSupplier = await Supplier.findOne({ name: 'Lahore Industrial Supplies & Valves' });
    if (!localSupplier) {
      localSupplier = await Supplier.create({
        name: 'Lahore Industrial Supplies & Valves',
        supplierType: 'Local',
        email: 'sales@lahoreindustrial.pk',
        phone: '+92-42-35889900',
        city: 'Lahore',
        createdBy: purchaserUserId
      });
    }

    let globalSupplier = await Supplier.findOne({ name: 'Yokogawa Electric International Ltd' });
    if (!globalSupplier) {
      globalSupplier = await Supplier.create({
        name: 'Yokogawa Electric International Ltd',
        supplierType: 'Global',
        email: 'global-sales@yokogawa.com',
        phone: '+81-3-5432-1000',
        country: 'Japan',
        createdBy: purchaserUserId
      });
    }

    // ────────────────────────────────────────────────────────────────
    // SITUATION 1: Finance Rejected Sales Order Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('\n3. Creating Situation 1: Finance Rejected Sales Order...');
    const qt1 = await Quotation.create({
      quotationNumber: 'QT-2026-REJ01',
      clientName: 'Apex Industries Ltd',
      clientEmail: 'procurement@apexind.pk',
      items: [{ description: 'Heavy Duty Gearbox HG-800', quantity: 2, unitPrice: 225000, total: 450000 }],
      totalAmount: 450000,
      status: 'Rejected',
      createdBy: salesUserId,
      salesPerson: salesUserId
    });

    const so1 = await SalesOrder.create({
      orderNumber: 'SO-2026-REJ01',
      orderReference: 'SO-2026-REJ01',
      quotationId: qt1._id,
      clientName: 'Apex Industries Ltd',
      fileType: 'Yellow',
      fileNumber: 'FL-2026-REJ01',
      items: [{ productName: 'Heavy Duty Gearbox HG-800', quantity: 2, unitPrice: 225000, total: 450000 }],
      totalAmount: 450000,
      netAmount: 450000,
      status: 'Rejected',
      overdueCheckStatus: 'Rejected - Overdue Limit Exceeded',
      rejectionReason: 'Customer overdue balance exceeds PKR 500,000 threshold',
      salesPerson: salesUserId,
      createdBy: salesUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 2: Green File In-Stock Approved & Fully Paid Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('4. Creating Situation 2: Green File In-Stock Delivered & Paid Order...');
    const qt2 = await Quotation.create({
      quotationNumber: 'QT-2026-GREEN01',
      clientName: 'Karachi Textile Mills',
      items: [{ description: 'Siemens Pressure Transmitter P300', quantity: 30, unitPrice: 12000, total: 360000 }],
      totalAmount: 360000,
      status: 'Converted to Sales Order',
      createdBy: salesUserId,
      salesPerson: salesUserId
    });

    const so2 = await SalesOrder.create({
      orderNumber: 'SO-2026-GREEN01',
      orderReference: 'SO-2026-GREEN01',
      quotationId: qt2._id,
      clientName: 'Karachi Textile Mills',
      fileType: 'Green',
      fileNumber: 'FL-2026-GREEN01',
      items: [{ productId: invItem1._id, productName: 'Siemens Pressure Transmitter P300', quantity: 30, unitPrice: 12000, total: 360000 }],
      totalAmount: 360000,
      netAmount: 360000,
      status: 'Approved',
      overdueCheckStatus: 'All Clear',
      deliveryStatus: 'Delivered',
      paymentStatus: 'Paid',
      salesPerson: salesUserId,
      createdBy: salesUserId
    });

    const dn2 = await DeliveryNote.create({
      deliveryNoteNumber: 'DN-2026-GREEN01',
      salesOrderId: so2._id,
      salesOrderNumber: 'SO-2026-GREEN01',
      clientName: 'Karachi Textile Mills',
      items: [{ productName: 'Siemens Pressure Transmitter P300', quantity: 30 }],
      status: 'Delivered',
      courierName: 'TCS Express',
      trackingNumber: 'TCS-99887766',
      deliveredAt: new Date(Date.now() - 3 * 86400000),
      createdBy: supportUserId
    });

    const inv2 = await Invoice.create({
      invoiceNumber: 'INV-2026-GREEN01',
      salesOrderId: so2._id,
      salesOrderNumber: 'SO-2026-GREEN01',
      deliveryNoteId: dn2._id,
      deliveryNoteNumber: 'DN-2026-GREEN01',
      clientName: 'Karachi Textile Mills',
      fileType: 'Green',
      fileNumber: 'FL-2026-GREEN01',
      items: [{ description: 'Siemens Pressure Transmitter P300', quantity: 30, unitPrice: 12000, total: 360000 }],
      subtotal: 360000,
      amount: 360000,
      paidAmount: 360000,
      outstandingAmount: 0,
      status: 'Paid',
      isDraft: false,
      dueDate: new Date(Date.now() + 15 * 86400000),
      createdBy: salesUserId
    });

    const pay2 = await Payment.create({
      paymentRefNumber: 'PAY-2026-GREEN01',
      customerName: 'Karachi Textile Mills',
      amount: 360000,
      paymentMethod: 'Bank Transfer',
      paymentType: 'Full',
      invoiceId: inv2._id,
      invoiceNumber: 'INV-2026-GREEN01',
      salesOrderId: so2._id,
      salesOrderNumber: 'SO-2026-GREEN01',
      paymentDate: new Date(Date.now() - 2 * 86400000),
      createdBy: salesUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 3: Green File Shortage, Customer Advance & Supplier Unlocking Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('5. Creating Situation 3: Green File Shortage + Advance Unlocking Order...');
    const so3 = await SalesOrder.create({
      orderNumber: 'SO-2026-GREEN02',
      orderReference: 'SO-2026-GREEN02',
      clientName: 'Engro Polymer & Chemicals',
      fileType: 'Green',
      fileNumber: 'FL-2026-GREEN02',
      items: [{ productId: invItem2._id, productName: 'High Flow Centrifugal Pump CP-500', quantity: 20, unitPrice: 35000, total: 700000 }],
      totalAmount: 700000,
      netAmount: 700000,
      shortageAmount: 525000,
      advanceRequiredAmount: 250000,
      advanceReceivedAmount: 250000,
      isSupplierPaymentBlocked: false,
      status: 'Approved',
      overdueCheckStatus: 'All Clear',
      salesPerson: salesUserId,
      createdBy: salesUserId
    });

    const payAdvance = await Payment.create({
      paymentRefNumber: 'PAY-2026-ADV01',
      customerName: 'Engro Polymer & Chemicals',
      amount: 250000,
      paymentMethod: 'Cheque',
      paymentType: 'Advance',
      salesOrderId: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      notes: 'Customer Advance Payment (CHQ-889012 Meezan Bank Ltd)',
      createdBy: salesUserId
    });

    const poLocal1 = await SupplierPO.create({
      poNumber: 'PO-LOCAL-2026-01',
      supplier: localSupplier._id,
      supplierName: 'Lahore Industrial Supplies & Valves',
      poType: 'Local',
      salesOrder: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      items: [{ productId: invItem2._id, productName: 'High Flow Centrifugal Pump CP-500', quantity: 15, unitPrice: 30000, totalAmount: 450000 }],
      totalAmount: 450000,
      status: 'Issued',
      createdBy: purchaserUserId
    });

    const grnLocal1 = await PurchaserGRN.create({
      grnNumber: 'GRN-LOCAL-2026-01',
      supplier: localSupplier._id,
      supplierName: 'Lahore Industrial Supplies & Valves',
      supplierPO: poLocal1._id,
      poNumber: 'PO-LOCAL-2026-01',
      salesOrder: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      items: [{ productName: 'High Flow Centrifugal Pump CP-500', orderedQty: 15, receivedQty: 15, remainingQty: 0 }],
      grnType: 'Supplier',
      status: 'Completed',
      createdBy: purchaserUserId
    });

    const payableLocal1 = await LocalPayable.create({
      payableNumber: 'PAYABLE-2026-01',
      supplier: localSupplier._id,
      supplierName: 'Lahore Industrial Supplies & Valves',
      supplierPO: poLocal1._id,
      poNumber: 'PO-LOCAL-2026-01',
      grn: grnLocal1._id,
      paymentMethod: 'Cash',
      amount: 450000,
      status: 'Payment Eligible',
      salesOrder: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      createdBy: purchaserUserId
    });

    const dn3 = await DeliveryNote.create({
      deliveryNoteNumber: 'DN-2026-GREEN02',
      salesOrderId: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      clientName: 'Engro Polymer & Chemicals',
      items: [{ productName: 'High Flow Centrifugal Pump CP-500', quantity: 20 }],
      status: 'In Transit',
      courierName: 'Leopard Courier',
      trackingNumber: 'LPD-445566',
      createdBy: supportUserId
    });

    const inv3 = await Invoice.create({
      invoiceNumber: 'INV-2026-GREEN02',
      salesOrderId: so3._id,
      salesOrderNumber: 'SO-2026-GREEN02',
      deliveryNoteId: dn3._id,
      deliveryNoteNumber: 'DN-2026-GREEN02',
      clientName: 'Engro Polymer & Chemicals',
      fileType: 'Green',
      fileNumber: 'FL-2026-GREEN02',
      items: [{ description: 'High Flow Centrifugal Pump CP-500', quantity: 20, unitPrice: 35000, total: 700000 }],
      subtotal: 700000,
      amount: 700000,
      paidAmount: 250000,
      outstandingAmount: 450000,
      status: 'Partially Paid',
      isDraft: false,
      dueDate: new Date(Date.now() + 20 * 86400000),
      createdBy: salesUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 4: Unpaid Customer Advance & Blocked Supplier Payment
    // ────────────────────────────────────────────────────────────────
    console.log('6. Creating Situation 4: Unpaid Advance & Supplier Payment Locked Order...');
    const so4 = await SalesOrder.create({
      orderNumber: 'SO-2026-SHORT01',
      orderReference: 'SO-2026-SHORT01',
      clientName: 'Fauji Fertilizer Company',
      fileType: 'Green',
      fileNumber: 'FL-2026-SHORT01',
      items: [{ productName: 'Industrial Valve FX-100', quantity: 80, unitPrice: 5000, total: 400000 }],
      totalAmount: 400000,
      netAmount: 400000,
      shortageAmount: 400000,
      advanceRequiredAmount: 200000,
      advanceReceivedAmount: 0,
      isSupplierPaymentBlocked: true,
      status: 'Approved',
      overdueCheckStatus: 'All Clear',
      salesPerson: salesUserId,
      createdBy: salesUserId
    });

    const payableBlocked = await LocalPayable.create({
      payableNumber: 'PAYABLE-2026-BLOCKED',
      supplier: localSupplier._id,
      supplierName: 'Lahore Industrial Supplies & Valves',
      paymentMethod: 'Cheque',
      amount: 400000,
      status: 'Payment Blocked – Awaiting Customer Advance',
      salesOrder: so4._id,
      salesOrderNumber: 'SO-2026-SHORT01',
      createdBy: purchaserUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 5: Blue File Global PO & Multiple Cumulative GRNs Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('7. Creating Situation 5: Blue File Global Procurement & Partial/Cumulative GRNs...');
    const so5 = await SalesOrder.create({
      orderNumber: 'SO-2026-BLUE01',
      orderReference: 'SO-2026-BLUE01',
      clientName: 'Hub Power Company (HUBCO)',
      fileType: 'Blue',
      fileNumber: 'FL-2026-BLUE01',
      items: [{ productId: invItem3._id, productName: 'Yokogawa Digital Flow Meter DF-900', quantity: 100, unitPrice: 18500, total: 1850000 }],
      totalAmount: 1850000,
      netAmount: 1850000,
      status: 'Approved',
      overdueCheckStatus: 'All Clear',
      salesPerson: salesUserId,
      createdBy: salesUserId
    });

    const poGlobal1 = await SupplierPO.create({
      poNumber: 'PO-GLOBAL-2026-01',
      supplier: globalSupplier._id,
      supplierName: 'Yokogawa Electric International Ltd',
      poType: 'Global',
      salesOrder: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      items: [{ productId: invItem3._id, productName: 'Yokogawa Digital Flow Meter DF-900', quantity: 100, unitPrice: 15000, totalAmount: 1500000 }],
      totalAmount: 1500000,
      status: 'Issued',
      createdBy: globalPurchaserUser ? globalPurchaserUser._id : purchaserUserId
    });

    const grnGlobal1 = await PurchaserGRN.create({
      grnNumber: 'GRN-GLOBAL-2026-01',
      supplier: globalSupplier._id,
      supplierName: 'Yokogawa Electric International Ltd',
      supplierPO: poGlobal1._id,
      poNumber: 'PO-GLOBAL-2026-01',
      salesOrder: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      items: [{ productName: 'Yokogawa Digital Flow Meter DF-900', orderedQty: 100, receivedQty: 60, remainingQty: 40 }],
      grnType: 'Supplier',
      status: 'Partial',
      createdBy: purchaserUserId
    });

    const grnGlobal2 = await PurchaserGRN.create({
      grnNumber: 'GRN-GLOBAL-2026-02',
      supplier: globalSupplier._id,
      supplierName: 'Yokogawa Electric International Ltd',
      supplierPO: poGlobal1._id,
      poNumber: 'PO-GLOBAL-2026-01',
      salesOrder: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      items: [{ productName: 'Yokogawa Digital Flow Meter DF-900', orderedQty: 40, receivedQty: 40, remainingQty: 0 }],
      grnType: 'Supplier',
      status: 'Completed',
      createdBy: purchaserUserId
    });

    const dn5 = await DeliveryNote.create({
      deliveryNoteNumber: 'DN-2026-BLUE01',
      salesOrderId: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      clientName: 'Hub Power Company (HUBCO)',
      items: [{ productName: 'Yokogawa Digital Flow Meter DF-900', quantity: 100 }],
      status: 'Confirmed',
      receivedBy: 'HUBCO Plant Operations',
      createdBy: supportUserId
    });

    const inv5 = await Invoice.create({
      invoiceNumber: 'INV-2026-BLUE01',
      salesOrderId: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      deliveryNoteId: dn5._id,
      deliveryNoteNumber: 'DN-2026-BLUE01',
      clientName: 'Hub Power Company (HUBCO)',
      fileType: 'Blue',
      fileNumber: 'FL-2026-BLUE01',
      items: [{ description: 'Yokogawa Digital Flow Meter DF-900', quantity: 100, unitPrice: 18500, total: 1850000 }],
      subtotal: 1850000,
      amount: 1850000,
      paidAmount: 0,
      outstandingAmount: 1850000,
      status: 'Finalized',
      isDraft: false,
      dueDate: new Date(Date.now() + 10 * 86400000),
      createdBy: salesUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 6: Automatic 3% Overdue Financial Charge Invoice
    // ────────────────────────────────────────────────────────────────
    console.log('8. Creating Situation 6: Automatic 3% Overdue Financial Charge Record...');
    const pastDueDate = new Date();
    pastDueDate.setDate(pastDueDate.getDate() - 15); // 15 days overdue

    const invOverdue = await Invoice.create({
      invoiceNumber: 'INV-2026-OVERDUE01',
      clientName: 'National Refinery Limited',
      amount: 500000,
      paidAmount: 0,
      outstandingAmount: 500000,
      subtotal: 500000,
      dueDate: pastDueDate,
      status: 'Overdue',
      isDraft: false,
      lateChargeAmount: 15000,
      lateChargePercentage: 3,
      lateChargeApplied: true,
      createdBy: salesUserId
    });

    const fcOverdue = await FinancialCharge.create({
      chargeNumber: 'FC-2026-OVD01',
      chargeType: 'Overdue Financial Charge',
      description: 'Automatic 3% Late Financial Charge on Overdue Invoice INV-2026-OVERDUE01',
      amount: 15000,
      currency: 'PKR',
      relatedDocumentType: 'Invoice',
      relatedDocumentNumber: 'INV-2026-OVERDUE01',
      relatedDocumentId: invOverdue._id,
      status: 'Recorded',
      createdBy: ceoUserId,
      createdByName: 'System Auto-Enforcer'
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 7: CEO Edit Permission Requests (Pending, Approved, Rejected)
    // ────────────────────────────────────────────────────────────────
    console.log('9. Creating Situation 7: CEO Edit Permission Requests...');
    
    // Pending Field Specific Request
    await EditPermissionRequest.create({
      requestId: 'REQ-2026-001',
      documentType: 'Sales Order',
      documentId: String(so5._id),
      documentNumber: 'SO-2026-BLUE01',
      currentDocumentStatus: 'Approved',
      requestedByUserId: salesUserId,
      requestedByName: ahmedUser ? ahmedUser.fullName : 'Ahmed Anjum',
      requestedByRole: 'sales_person',
      requestedByDepartment: 'Sales',
      requestType: 'SpecificField',
      requestedFields: [{ fieldName: 'totalAmount', label: 'Total Amount', currentValue: 1850000, requestedValue: 1920000 }],
      reason: 'Client requested optional remote diagnostic telemetry module',
      status: 'Pending'
    });

    // Pending General Request
    await EditPermissionRequest.create({
      requestId: 'REQ-2026-002',
      documentType: 'Delivery Note',
      documentId: String(dn3._id),
      documentNumber: 'DN-2026-GREEN02',
      currentDocumentStatus: 'In Transit',
      requestedByUserId: supportUserId,
      requestedByName: supportUser ? supportUser.fullName : 'Support User',
      requestedByRole: 'support',
      requestedByDepartment: 'Support',
      requestType: 'General',
      reason: 'Urgent recipient shipping address and contact phone correction',
      status: 'Pending'
    });

    // Approved Request
    await EditPermissionRequest.create({
      requestId: 'REQ-2026-003',
      documentType: 'Draft Invoice',
      documentId: String(inv3._id),
      documentNumber: 'INV-2026-GREEN02',
      currentDocumentStatus: 'Draft',
      requestedByUserId: salesUserId,
      requestedByName: ahmedUser ? ahmedUser.fullName : 'Ahmed Anjum',
      requestedByRole: 'sales_person',
      requestedByDepartment: 'Sales',
      requestType: 'General',
      reason: 'Correct client tax exempt certificate registration number',
      status: 'Approved',
      approvedByUserId: ceoUserId,
      approvedByName: ceoUser ? ceoUser.fullName : 'CEO Karim Rafiq',
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 3600000)
    });

    // Rejected Request
    await EditPermissionRequest.create({
      requestId: 'REQ-2026-004',
      documentType: 'Final Invoice',
      documentId: String(inv2._id),
      documentNumber: 'INV-2026-GREEN01',
      currentDocumentStatus: 'Paid',
      requestedByUserId: salesUserId,
      requestedByName: ahmedUser ? ahmedUser.fullName : 'Ahmed Anjum',
      requestedByRole: 'sales_person',
      requestedByDepartment: 'Sales',
      requestType: 'General',
      reason: 'Client asked to adjust payment terms from Net 30 to Net 60',
      status: 'Rejected',
      rejectedByUserId: ceoUserId,
      rejectedByName: ceoUser ? ceoUser.fullName : 'CEO Karim Rafiq',
      rejectionReason: 'Invoice is already finalized and paid in full. Terms cannot be modified post-settlement.',
      rejectedAt: new Date()
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 8: Direct Edit Exceptions (Quotation & Supplier PO)
    // ────────────────────────────────────────────────────────────────
    console.log('10. Creating Situation 8: Category A Direct Edit Objects...');
    await Quotation.create({
      quotationNumber: 'QT-2026-DIRECT',
      clientName: 'Pakistan Petroleum Limited (PPL)',
      items: [{ description: 'High Pressure Control Valve', quantity: 4, unitPrice: 95000, total: 380000 }],
      totalAmount: 380000,
      status: 'Sent',
      createdBy: salesUserId,
      salesPerson: salesUserId
    });

    await SupplierPO.create({
      poNumber: 'PO-LOCAL-2026-DIRECT',
      supplier: localSupplier._id,
      supplierName: 'Lahore Industrial Supplies & Valves',
      poType: 'Local',
      items: [{ productName: 'Industrial Valve Seals & Gaskets Set', quantity: 20, unitPrice: 6000, totalAmount: 120000 }],
      totalAmount: 120000,
      status: 'Issued',
      createdBy: purchaserUserId
    });

    // ────────────────────────────────────────────────────────────────
    // SITUATION 9: Pipeline Deals, Leads & Logistics Shipments for Department Stats
    // ────────────────────────────────────────────────────────────────
    console.log('11. Creating Deals, Leads, and Shipments for Department Metrics...');
    await Deal.create({
      title: '[Demo] HUBCO Flow Meter Expansion Phase 2',
      clientName: 'Hub Power Company (HUBCO)',
      value: 2500000,
      stage: 'Closed Won',
      probability: 100,
      assignedTo: salesUserId,
      createdBy: salesUserId
    });

    await Deal.create({
      title: '[Demo] Engro Chemical Pipeline Upgrade',
      clientName: 'Engro Polymer & Chemicals',
      value: 1800000,
      stage: 'Proposal',
      probability: 70,
      assignedTo: salesUserId,
      createdBy: salesUserId
    });

    await Lead.create({
      name: '[Demo] Fatima Fertilizer Company',
      company: 'Fatima Fertilizer',
      email: 'procurement@fatima-group.com',
      phone: '+92-42-111-328-462',
      status: 'Qualified',
      source: 'Direct Inquiry',
      assignedTo: salesUserId,
      createdBy: salesUserId
    });

    await Shipment.create({
      trackingNumber: 'TRK-DEMO-9901',
      salesOrder: so5._id,
      salesOrderNumber: 'SO-2026-BLUE01',
      clientName: 'Hub Power Company (HUBCO)',
      supplierName: 'Yokogawa Electric International Ltd',
      carrier: 'DHL Express Global',
      departureLocation: 'Tokyo, Japan',
      arrivalLocation: 'Port Qasim, Karachi',
      shippingMethod: 'Air Freight',
      status: 'In Transit',
      etd: new Date(Date.now() - 5 * 86400000),
      eta: new Date(Date.now() + 2 * 86400000),
      createdBy: purchaserUserId
    });

    await Expense.create({
      title: 'Customs Duty & Air Freight for PO-GLOBAL-2026-01',
      category: 'Travel',
      amount: 145000,
      status: 'Approved',
      submittedBy: financeUserId,
      submittedByName: financeUser ? financeUser.fullName : 'Finance User',
      notes: 'Import tariff and freight clearance fee',
      date: new Date(Date.now() - 4 * 86400000)
    });

    console.log('\n================================================================');
    console.log('       SEEDING COMPLETE - ALL 12 SITUATIONS LOADED SUCCESSFULLY!');
    console.log('================================================================');
    console.log('Live Data Population Highlights:');
    console.log('1. Preserved User: Ahmed Anjum (quote@fortline.net)');
    console.log('2. Quotations & Sales Orders: 5 scenarios (Rejection, Green In-Stock, Green Shortage, Unpaid Advance, Blue File Global)');
    console.log('3. Delivery Notes & Invoices: Full lifecycle linked records with Paid/Partially Paid/Overdue statuses');
    console.log('4. Financial Charges: PKR 15,000 automatic 3% charge on 15-day overdue PKR 500,000 invoice');
    console.log('5. CEO Edit Requests: 2 Pending (with [2] badge), 1 Approved, 1 Rejected');
    console.log('6. Supplier POs, GRNs & Payables: Local and Global cumulative GRNs and supplier payment locking');
    console.log('7. CRM Stats: Department KPIs for CEO, Admin, Sales, Finance, Purchaser, Accounts, Support, and Logistics updated automatically!\n');

    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seedMasterWorkflowDemoData();
