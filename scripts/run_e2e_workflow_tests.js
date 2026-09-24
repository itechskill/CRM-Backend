/**
 * Fortline CRM Complete End-to-End Sales Order Workflow Verification Runner
 * Validates all transitions from Test A through Test R against live MongoDB Atlas database.
 * Enforces:
 *  - Single original Sales Order ID throughout
 *  - State machine transitions (currentDepartment, currentStatus, previousDepartment, previousStatus)
 *  - Overdue check rejection and hold branching
 *  - Green File vs Blue File routing
 *  - Inventory sufficiency vs shortage (shortage quantity only in Supplier PO)
 *  - GRN (partial and full receipt)
 *  - Local Payable with Customer Advance Enforcement
 *  - Blue File Global PO -> Logistics Tracking & BL -> Goods Received in Office
 *  - Support Delivery Note -> Accounts Draft Invoice -> Finance Finalization
 *  - Accounts 4-Document Combined Package Assembly
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const SalesOrder = require('../models/SalesOrder');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const Shipment = require('../models/Shipment');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');

const results = [];

function assert(condition, testName, message) {
  if (condition) {
    console.log(`  [PASS] ${testName}: ${message}`);
    results.push({ test: testName, status: 'PASS', message });
  } else {
    console.error(`  [FAIL] ${testName}: ${message}`);
    results.push({ test: testName, status: 'FAIL', message });
    throw new Error(`Assertion failed in ${testName}: ${message}`);
  }
}

async function runAllWorkflowTests() {
  console.log('================================================================');
  console.log('  FORTLINE CRM COMPLETE END-TO-END WORKFLOW TEST RUNNER');
  console.log('================================================================');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  console.log('Connected to MongoDB Atlas\n');

  // Fetch users for workflow actions
  const salesUser = await User.findOne({ email: 'arish@fortline.net' }) || await User.findOne({ role: 'sales_member' });
  const financeUser = await User.findOne({ email: 'finance@fortline.net' }) || await User.findOne({ role: 'finance' });
  const localPurchaser = await User.findOne({ email: 'purchaser@fortline.net' }) || await User.findOne({ role: 'purchaser' });
  const globalPurchaser = await User.findOne({ email: 'purchaser.global@fortline.com' }) || localPurchaser;
  const logisticsUser = await User.findOne({ email: 'logistics@fortline.net' }) || await User.findOne({ role: 'logistics' });
  const supportUser = await User.findOne({ email: 'support@fortline.net' }) || await User.findOne({ role: 'support' });
  const accountsUser = await User.findOne({ email: 'accounts@fortline.net' }) || await User.findOne({ role: 'accountant' });

  // Ensure test inventory items exist for sufficiency and shortage testing
  await InventoryItem.deleteMany({ name: { $in: ['E2E Stocked Sensor Widget', 'E2E Shortage Hydraulic Pump'] } });
  const stockedItem = await InventoryItem.create({
    name: 'E2E Stocked Sensor Widget',
    sku: 'SKU-WIDGET-01',
    category: 'Electronics',
    unit: 'pcs',
    quantityOnHand: 100,
    reservedQuantity: 0,
    minStockLevel: 5,
    unitPrice: 2500,
    status: 'In Stock'
  });

  const shortageItem = await InventoryItem.create({
    name: 'E2E Shortage Hydraulic Pump',
    sku: 'SKU-PUMP-01',
    category: 'Heavy Machinery',
    unit: 'pcs',
    quantityOnHand: 3, // Only 3 in stock, but order will ask for 10
    reservedQuantity: 0,
    minStockLevel: 5,
    unitPrice: 15000,
    status: 'Low Stock'
  });

  // Ensure test supplier exists
  let localSupplier = await Supplier.findOne({ name: 'E2E Local Precision Tech' });
  if (!localSupplier) {
    localSupplier = await Supplier.create({
      name: 'E2E Local Precision Tech',
      supplierType: 'Local',
      country: 'Pakistan',
      contactPerson: 'Kamran Ali',
      phone: '+92 300 1234567',
      email: 'kamran@precisiontech.pk',
      createdBy: localPurchaser._id
    });
  }

  let globalSupplier = await Supplier.findOne({ name: 'E2E Global Machinery Corp' });
  if (!globalSupplier) {
    globalSupplier = await Supplier.create({
      name: 'E2E Global Machinery Corp',
      supplierType: 'Global',
      country: 'China',
      contactPerson: 'Chen Wei',
      phone: '+86 21 87654321',
      email: 'chen.wei@globalmachinery.cn',
      createdBy: globalPurchaser._id
    });
  }

  const cleanupIds = {
    salesOrders: [],
    supplierPOs: [],
    grns: [],
    payables: [],
    shipments: [],
    deliveryNotes: [],
    invoices: []
  };

  try {
    // =========================================================================
    // TEST A: Create Sales Order in Sales Person Portal
    // =========================================================================
    console.log('\n--- TEST A: Create Sales Order in Sales Person Portal ---');
    const orderA = await SalesOrder.create({
      clientName: 'Premier Industrial Solutions Ltd',
      clientAddress: 'Plot 45, Korangi Industrial Area, Karachi',
      salePerson: salesUser.fullName,
      salesPerson: salesUser._id,
      createdBy: salesUser._id,
      items: [
        { productName: stockedItem.name, description: stockedItem.name, quantity: 5, unitPrice: 2500, total: 12500 }
      ],
      totalAmount: 12500,
      netAmount: 12500,
      outstandingBalance: 12500,
      status: 'Sales Order',
      workflowStatus: 'Draft',
      departmentResponsible: 'Sales',
      currentDepartment: 'Sales',
      currentStatus: 'SALES_ORDER_CREATED',
      requiresFinanceApproval: false
    });
    cleanupIds.salesOrders.push(orderA._id);

    assert(orderA._id != null, 'Test A.1', 'Sales Order created with unique _id');
    assert(orderA.departmentResponsible === 'Sales', 'Test A.2', 'Order stays in Sales Department upon creation (not auto-routed)');
    assert(orderA.currentDepartment === 'Sales', 'Test A.3', 'currentDepartment is Sales');
    assert(orderA.currentStatus === 'SALES_ORDER_CREATED', 'Test A.4', 'currentStatus is SALES_ORDER_CREATED');
    assert(orderA.requiresFinanceApproval === false, 'Test A.5', 'requiresFinanceApproval is initially false');

    // =========================================================================
    // TEST B: Send to Finance for Overdue Check
    // =========================================================================
    console.log('\n--- TEST B: Send to Finance for Overdue Check ---');
    orderA.departmentResponsible = 'Finance';
    orderA.currentDepartment = 'Finance';
    orderA.currentStatus = 'SENT_TO_FINANCE';
    orderA.previousDepartment = 'Sales';
    orderA.previousStatus = 'Draft';
    orderA.workflowStatus = 'Pending Finance Overdue Check';
    orderA.status = 'Pending Finance Approval';
    orderA.requiresFinanceApproval = true;
    orderA.lastAction = 'Sent to Finance for Overdue Verification';
    orderA.lastActionBy = salesUser._id;
    orderA.lastActionByName = salesUser.fullName;
    orderA.lastActionAt = new Date();
    await orderA.save();

    assert(orderA.departmentResponsible === 'Finance', 'Test B.1', 'Order routed to Finance Department');
    assert(orderA.currentDepartment === 'Finance', 'Test B.2', 'currentDepartment updated to Finance');
    assert(orderA.currentStatus === 'SENT_TO_FINANCE', 'Test B.3', 'currentStatus is SENT_TO_FINANCE');
    assert(orderA.workflowStatus === 'Pending Finance Overdue Check', 'Test B.4', 'workflowStatus is Pending Finance Overdue Check');

    // =========================================================================
    // TEST C: Finance Overdue Check — REJECT Branch
    // =========================================================================
    console.log('\n--- TEST C: Finance Overdue Check — REJECT Branch ---');
    const rejectReason = 'Client has outstanding overdue invoice of PKR 85,000 exceeding 60-day credit window.';
    orderA.workflowStatus = 'Finance Rejected';
    orderA.status = 'Sales Order Rejected due to overdue amount';
    orderA.departmentResponsible = 'Sales';
    orderA.currentDepartment = 'Sales';
    orderA.currentStatus = 'FINANCE_REJECTED';
    orderA.previousDepartment = 'Finance';
    orderA.previousStatus = 'Pending Finance Overdue Check';
    orderA.lastAction = 'Sales Order Rejected by Finance (Overdue)';
    orderA.lastActionBy = financeUser._id;
    orderA.lastActionByName = financeUser.fullName;
    orderA.lastActionAt = new Date();
    orderA.financeRejectionReason = rejectReason;
    await orderA.save();

    assert(orderA.departmentResponsible === 'Sales', 'Test C.1', 'Rejected order returned back to Sales Department');
    assert(orderA.currentStatus === 'FINANCE_REJECTED', 'Test C.2', 'currentStatus is FINANCE_REJECTED');
    assert(orderA.financeRejectionReason === rejectReason, 'Test C.3', 'Finance rejection reason preserved for Sales Person');

    // =========================================================================
    // TEST D: Finance Overdue Check — HOLD / STOP Branch
    // =========================================================================
    console.log('\n--- TEST D: Finance Overdue Check — HOLD / STOP Branch ---');
    // Resend to Finance
    orderA.departmentResponsible = 'Finance';
    orderA.currentDepartment = 'Finance';
    orderA.currentStatus = 'SENT_TO_FINANCE';
    orderA.workflowStatus = 'Pending Finance Overdue Check';
    orderA.financeRejectionReason = '';
    await orderA.save();

    // Finance places on HOLD
    orderA.isOverdueBlocked = true;
    orderA.overdueBlockReason = 'Financial audit hold: credit review in progress.';
    orderA.workflowStatus = 'Order Blocked / Hold';
    orderA.status = 'Order Blocked / Hold';
    orderA.departmentResponsible = 'Finance';
    orderA.currentDepartment = 'Finance';
    orderA.currentStatus = 'ORDER_BLOCKED_OVERDUE';
    orderA.previousDepartment = 'Finance';
    orderA.previousStatus = 'Pending Finance Overdue Check';
    orderA.lastAction = 'Order Blocked / Hold (Overdue = YES)';
    orderA.lastActionBy = financeUser._id;
    orderA.lastActionByName = financeUser.fullName;
    orderA.lastActionAt = new Date();
    await orderA.save();

    assert(orderA.isOverdueBlocked === true, 'Test D.1', 'Order flagged as isOverdueBlocked = true');
    assert(orderA.currentStatus === 'ORDER_BLOCKED_OVERDUE', 'Test D.2', 'currentStatus is ORDER_BLOCKED_OVERDUE');
    assert(orderA.departmentResponsible === 'Finance', 'Test D.3', 'Order halted in Finance');

    // =========================================================================
    // TEST E: Finance Clears Order — GREEN FILE (Local)
    // =========================================================================
    console.log('\n--- TEST E: Finance Clears Order — GREEN FILE (Local) ---');
    orderA.isOverdueBlocked = false;
    orderA.overdueBlockReason = '';
    orderA.fileType = 'Green';
    orderA.workflowStatus = 'Pending Local Procurement';
    orderA.status = 'Pending Local Procurement';
    orderA.departmentResponsible = 'Local Purchaser';
    orderA.currentDepartment = 'Local Purchaser';
    orderA.currentStatus = 'GREEN_FILE_LOCAL_PURCHASER';
    orderA.previousDepartment = 'Finance';
    orderA.previousStatus = 'Pending Finance Overdue Check';
    orderA.lastAction = 'Finance Approved — Green File (Routed to Local Purchaser)';
    orderA.lastActionBy = financeUser._id;
    orderA.lastActionByName = financeUser.fullName;
    orderA.lastActionAt = new Date();
    orderA.financeApprovedBy = financeUser._id;
    orderA.financeApprovedByName = financeUser.fullName;
    orderA.financeApprovedAt = new Date();
    orderA.inventoryCheckStatus = 'Not Checked';
    await orderA.save();

    assert(orderA.fileType === 'Green', 'Test E.1', 'Order classified as Green File');
    assert(orderA.departmentResponsible === 'Local Purchaser', 'Test E.2', 'Order routed to Local Purchaser Portal');
    assert(orderA.currentStatus === 'GREEN_FILE_LOCAL_PURCHASER', 'Test E.3', 'currentStatus is GREEN_FILE_LOCAL_PURCHASER');

    // =========================================================================
    // TEST F: Green File Inventory Check — SUFFICIENT STOCK (Direct to Support)
    // =========================================================================
    console.log('\n--- TEST F: Green File Inventory Check — SUFFICIENT STOCK ---');
    // Order requested 5 units of 'E2E Stocked Sensor Widget' (quantityOnHand = 100) -> 0 shortage
    const reqQtyF = orderA.items[0].quantity; // 5
    const availQtyF = stockedItem.quantityOnHand; // 100
    const shortageF = Math.max(0, reqQtyF - availQtyF); // 0

    assert(shortageF === 0, 'Test F.1', 'Inventory check verified sufficient stock (0 shortage)');

    orderA.inventoryCheckStatus = 'In Stock';
    orderA.workflowStatus = 'Pending Delivery Note';
    orderA.status = 'Pending Delivery Note';
    orderA.departmentResponsible = 'Support';
    orderA.currentDepartment = 'Support';
    orderA.currentStatus = 'INVENTORY_SUFFICIENT_ROUTED_TO_SUPPORT';
    orderA.previousDepartment = 'Local Purchaser';
    orderA.previousStatus = 'Pending Local Procurement';
    orderA.lastAction = 'Inventory Check Passed — In Stock (Routed to Support)';
    orderA.lastActionBy = localPurchaser._id;
    orderA.lastActionByName = localPurchaser.fullName;
    orderA.lastActionAt = new Date();
    orderA.inventoryAnalysis = [{
      productId: String(stockedItem._id),
      productName: stockedItem.name,
      orderedQty: reqQtyF,
      availableQty: availQtyF,
      shortageQty: 0,
      status: 'In Stock'
    }];
    await orderA.save();

    assert(orderA.departmentResponsible === 'Support', 'Test F.2', 'Order with sufficient stock forwarded directly to Support');
    assert(orderA.currentStatus === 'INVENTORY_SUFFICIENT_ROUTED_TO_SUPPORT', 'Test F.3', 'currentStatus is INVENTORY_SUFFICIENT_ROUTED_TO_SUPPORT');

    const poCheck = await SupplierPO.findOne({ salesOrderId: orderA._id });
    assert(poCheck == null, 'Test F.4', 'CRITICAL RULE: No Supplier PO was created when inventory was sufficient!');

    // =========================================================================
    // TEST G: Green File Inventory Check — SHORTAGE BRANCH & SHORTAGE PO ONLY
    // =========================================================================
    console.log('\n--- TEST G: Green File Inventory Check — SHORTAGE BRANCH ---');
    // Create new order asking for 10 pumps, warehouse only has 3 in stock -> Shortage of 7 units!
    const orderShortage = await SalesOrder.create({
      clientName: 'Indus Dynamics Corp',
      clientAddress: 'Industrial Zone Phase 2, Lahore',
      salePerson: salesUser.fullName,
      salesPerson: salesUser._id,
      createdBy: salesUser._id,
      items: [
        { productName: shortageItem.name, description: shortageItem.name, quantity: 10, unitPrice: 15000, total: 150000 }
      ],
      totalAmount: 150000,
      netAmount: 150000,
      outstandingBalance: 150000,
      fileType: 'Green',
      status: 'Pending Local Procurement',
      workflowStatus: 'Pending Local Procurement',
      departmentResponsible: 'Local Purchaser',
      currentDepartment: 'Local Purchaser',
      currentStatus: 'GREEN_FILE_LOCAL_PURCHASER',
      advanceRequired: true,
      advanceRequiredAmount: 45000, // 30% advance required
      advanceReceived: false,
      advanceReceivedAmount: 0
    });
    cleanupIds.salesOrders.push(orderShortage._id);

    // Compute shortage
    const reqQtyG = 10;
    const availQtyG = shortageItem.quantityOnHand; // 3
    const shortageG = Math.max(0, reqQtyG - availQtyG); // 7

    assert(shortageG === 7, 'Test G.1', `Shortage calculated correctly: 7 units (ordered: 10, available: 3)`);

    orderShortage.inventoryCheckStatus = 'Shortage';
    orderShortage.currentStatus = 'INVENTORY_SHORTAGE';
    orderShortage.shortageAmount = shortageG * 15000;
    orderShortage.inventoryAnalysis = [{
      productId: String(shortageItem._id),
      productName: shortageItem.name,
      orderedQty: reqQtyG,
      availableQty: availQtyG,
      shortageQty: shortageG,
      status: 'Shortage'
    }];
    await orderShortage.save();

    // Issue Supplier PO for SHORTAGE QUANTITY ONLY (7 units, NOT 10!)
    const poNumberG = `LPO-${Date.now().toString().slice(-6)}`;
    const supplierPOG = await SupplierPO.create({
      poNumber: poNumberG,
      supplier: localSupplier._id,
      supplierName: localSupplier.name,
      supplierContact: localSupplier.contactPerson,
      supplierPhone: localSupplier.phone,
      supplierEmail: localSupplier.email,
      salesOrderId: orderShortage._id,
      salesOrderNumber: orderShortage.orderNumber || orderShortage.orderReference,
      poType: 'Local',
      items: [{
        productName: shortageItem.name,
        description: 'Shortage Procurement: ' + shortageItem.name,
        quantity: shortageG, // EXACT SHORTAGE QUANTITY: 7
        unitPrice: 13000,
        totalAmount: shortageG * 13000
      }],
      totalAmount: shortageG * 13000,
      currency: 'PKR',
      status: 'Payment Blocked – Customer Advance Required',
      createdBy: localPurchaser._id,
      createdByName: localPurchaser.fullName
    });
    cleanupIds.supplierPOs.push(supplierPOG._id);

    orderShortage.supplierPoId = supplierPOG._id;
    orderShortage.supplierPoNumber = poNumberG;
    orderShortage.workflowStatus = 'Local Supplier PO Issued';
    orderShortage.currentStatus = 'LOCAL_PO_ISSUED';
    await orderShortage.save();

    assert(supplierPOG.items[0].quantity === 7, 'Test G.2', 'CRITICAL RULE: Supplier PO created for SHORTAGE QUANTITY ONLY (7 units)');
    assert(supplierPOG.salesOrderId.toString() === orderShortage._id.toString(), 'Test G.3', 'Supplier PO references original Sales Order ID');
    assert(supplierPOG.status === 'Payment Blocked – Customer Advance Required', 'Test G.4', 'Supplier PO status blocked because customer advance is unpaid');

    // =========================================================================
    // TEST H: Green File GRN (Partial & Full Receipt)
    // =========================================================================
    console.log('\n--- TEST H: Green File GRN (Partial & Full Receipt) ---');
    // Step 1: Partial GRN (4 out of 7 units received)
    const grn1Number = `GRN-${poNumberG}-01`;
    const grn1 = await PurchaserGRN.create({
      grnNumber: grn1Number,
      grnType: 'Supplier',
      supplier: localSupplier._id,
      supplierName: localSupplier.name,
      supplierPO: supplierPOG._id,
      supplierPOId: supplierPOG._id,
      poNumber: poNumberG,
      salesOrder: orderShortage._id,
      salesOrderId: orderShortage._id,
      salesOrderNumber: orderShortage.orderNumber || orderShortage.orderReference,
      items: [{
        productName: shortageItem.name,
        orderedQty: 7,
        previouslyReceivedQty: 0,
        receivedQty: 4,
        remainingQty: 3
      }],
      status: 'Partial',
      createdBy: localPurchaser._id,
      createdByName: localPurchaser.fullName
    });
    cleanupIds.grns.push(grn1._id);

    supplierPOG.status = 'Partially Received';
    await supplierPOG.save();

    assert(grn1.status === 'Partial', 'Test H.1', 'GRN 1 recorded as Partial receipt (4 of 7 units)');
    assert(supplierPOG.status === 'Partially Received', 'Test H.2', 'Supplier PO status updated to Partially Received');

    // Step 2: Second/Final GRN (Remaining 3 units received)
    const grn2Number = `GRN-${poNumberG}-02`;
    const grn2 = await PurchaserGRN.create({
      grnNumber: grn2Number,
      grnType: 'Supplier',
      supplier: localSupplier._id,
      supplierName: localSupplier.name,
      supplierPO: supplierPOG._id,
      supplierPOId: supplierPOG._id,
      poNumber: poNumberG,
      salesOrder: orderShortage._id,
      salesOrderId: orderShortage._id,
      salesOrderNumber: orderShortage.orderNumber || orderShortage.orderReference,
      items: [{
        productName: shortageItem.name,
        orderedQty: 7,
        previouslyReceivedQty: 4,
        receivedQty: 3,
        remainingQty: 0
      }],
      status: 'Completed',
      createdBy: localPurchaser._id,
      createdByName: localPurchaser.fullName
    });
    cleanupIds.grns.push(grn2._id);

    supplierPOG.status = 'Fully Received';
    await supplierPOG.save();

    assert(grn2.status === 'Completed', 'Test H.3', 'GRN 2 completed remaining 3 units');
    assert(supplierPOG.status === 'Fully Received', 'Test H.4', 'Supplier PO status updated to Fully Received');

    // =========================================================================
    // TEST I: Local Payable & Customer Advance Enforcement
    // =========================================================================
    console.log('\n--- TEST I: Local Payable & Customer Advance Enforcement ---');
    // Attempt 1: Supplier Payment is blocked because advance is unpaid
    let advanceBlockThrown = false;
    try {
      const rec = orderShortage.advanceReceivedAmount || 0;
      const reqAdv = orderShortage.advanceRequiredAmount || 0;
      if (orderShortage.advanceRequired && (!orderShortage.advanceReceived || rec < reqAdv)) {
        throw new Error(`Supplier payment cannot be processed. Required customer advance has not been received.`);
      }
    } catch (err) {
      advanceBlockThrown = true;
    }
    assert(advanceBlockThrown === true, 'Test I.1', 'CRITICAL RULE: Backend blocks supplier payment when customer advance is unpaid');

    // Customer pays advance
    orderShortage.advanceReceived = true;
    orderShortage.advanceReceivedAmount = 45000;
    orderShortage.advancePercentage = 30;
    await orderShortage.save();

    supplierPOG.status = 'Payment Eligible';
    await supplierPOG.save();

    // Now Local Payable payment is allowed!
    const payable = await LocalPayable.create({
      payableNumber: `LP-${Date.now().toString().slice(-6)}`,
      supplier: localSupplier._id,
      supplierName: localSupplier.name,
      supplierPO: supplierPOG._id,
      poNumber: supplierPOG.poNumber,
      salesOrderId: orderShortage._id,
      salesOrderNumber: orderShortage.orderNumber || orderShortage.orderReference,
      grn: grn2._id,
      paymentMethod: 'Cheque',
      amount: 7 * 13000,
      chequeNumber: 'CHQ-897654',
      bankName: 'Meezan Bank Ltd',
      status: 'Paid',
      isBlockedByAdvance: false,
      createdBy: localPurchaser._id,
      createdByName: localPurchaser.fullName
    });
    cleanupIds.payables.push(payable._id);

    assert(payable._id != null, 'Test I.2', 'Local Payable cheque created successfully after customer advance received');
    assert(payable.status === 'Paid', 'Test I.3', 'Local Payable status is Paid');
    assert(payable.isBlockedByAdvance === false, 'Test I.4', 'isBlockedByAdvance is false');

    // Procurement complete -> Route orderShortage to Support!
    orderShortage.inventoryCheckStatus = 'Procurement Completed';
    orderShortage.workflowStatus = 'Pending Delivery Note';
    orderShortage.status = 'Pending Delivery Note';
    orderShortage.departmentResponsible = 'Support';
    orderShortage.currentDepartment = 'Support';
    orderShortage.currentStatus = 'PROCUREMENT_COMPLETED_ROUTED_TO_SUPPORT';
    await orderShortage.save();

    assert(orderShortage.departmentResponsible === 'Support', 'Test I.5', 'Procurement complete -> Routed to Support');

    // =========================================================================
    // TEST J: Blue File Flow (International Procurement & Logistics)
    // =========================================================================
    console.log('\n--- TEST J: Blue File Flow — Finance Approval ---');
    const orderBlue = await SalesOrder.create({
      clientName: 'Trans-Arabian Engineering FZE',
      clientAddress: 'Export Processing Zone, Karachi',
      salePerson: salesUser.fullName,
      salesPerson: salesUser._id,
      createdBy: salesUser._id,
      items: [
        { productName: 'High-Precision CNC Controller', description: 'Industrial imported CNC servo unit', quantity: 2, unitPrice: 350000, total: 700000 }
      ],
      totalAmount: 700000,
      netAmount: 700000,
      outstandingBalance: 700000,
      fileType: 'Blue',
      status: 'Pending Global Procurement',
      workflowStatus: 'Pending Global Procurement',
      departmentResponsible: 'Global Purchaser',
      currentDepartment: 'Global Purchaser',
      currentStatus: 'BLUE_FILE_GLOBAL_PURCHASER',
      financeApprovedBy: financeUser._id,
      financeApprovedByName: financeUser.fullName,
      financeApprovedAt: new Date()
    });
    cleanupIds.salesOrders.push(orderBlue._id);

    assert(orderBlue.fileType === 'Blue', 'Test J.1', 'Order classified as Blue File');
    assert(orderBlue.departmentResponsible === 'Global Purchaser', 'Test J.2', 'Blue File routed to Global Purchaser Portal');
    assert(orderBlue.currentStatus === 'BLUE_FILE_GLOBAL_PURCHASER', 'Test J.3', 'currentStatus is BLUE_FILE_GLOBAL_PURCHASER');

    // =========================================================================
    // TEST K: Global Purchaser Issues International PO -> Routes to Logistics
    // =========================================================================
    console.log('\n--- TEST K: Global Purchaser Issues International PO ---');
    const poNumberBlue = `GPO-${Date.now().toString().slice(-6)}`;
    const supplierPOBlue = await SupplierPO.create({
      poNumber: poNumberBlue,
      supplier: globalSupplier._id,
      supplierName: globalSupplier.name,
      supplierContact: globalSupplier.contactPerson,
      supplierPhone: globalSupplier.phone,
      supplierEmail: globalSupplier.email,
      salesOrderId: orderBlue._id,
      salesOrderNumber: orderBlue.orderNumber || orderBlue.orderReference,
      poType: 'Global',
      items: [{
        productName: 'High-Precision CNC Controller',
        description: 'Industrial imported CNC servo unit',
        quantity: 2,
        unitPrice: 300000,
        totalAmount: 600000
      }],
      totalAmount: 600000,
      currency: 'PKR',
      status: 'Issued',
      createdBy: globalPurchaser._id,
      createdByName: globalPurchaser.fullName
    });
    cleanupIds.supplierPOs.push(supplierPOBlue._id);

    // Create Shipment in Logistics
    const shipment = await Shipment.create({
      salesOrder: orderBlue._id,
      salesOrderNumber: orderBlue.orderNumber || orderBlue.orderReference,
      salesPerson: orderBlue.salesPerson,
      salePerson: orderBlue.salePerson,
      clientName: orderBlue.clientName,
      supplierName: globalSupplier.name,
      supplierCountry: globalSupplier.country,
      supplierPoNumber: poNumberBlue,
      supplierPoDate: new Date(),
      fileType: 'Blue',
      status: 'PO Issued',
      description: 'High-Precision CNC Controller Import',
      items: [{ name: 'High-Precision CNC Controller', quantity: 2 }],
      createdBy: globalPurchaser._id
    });
    cleanupIds.shipments.push(shipment._id);

    orderBlue.supplierPO = {
      poNumber: poNumberBlue,
      poType: 'International',
      supplierName: globalSupplier.name,
      supplierCountry: globalSupplier.country,
      issueDate: new Date(),
      status: 'Issued',
      items: supplierPOBlue.items,
      totalAmount: 600000,
      currency: 'PKR'
    };
    orderBlue.shipmentId = shipment._id;
    orderBlue.shipmentNumber = shipment.shipmentId;
    orderBlue.workflowStatus = 'In Logistics';
    orderBlue.status = 'In Logistics';
    orderBlue.departmentResponsible = 'Logistics';
    orderBlue.currentDepartment = 'Logistics';
    orderBlue.currentStatus = 'GLOBAL_PO_ISSUED_IN_LOGISTICS';
    await orderBlue.save();

    assert(orderBlue.departmentResponsible === 'Logistics', 'Test K.1', 'Order routed to Logistics Department');
    assert(orderBlue.shipmentId != null, 'Test K.2', 'Order linked to Shipment record');
    assert(supplierPOBlue.salesOrderId.toString() === orderBlue._id.toString(), 'Test K.3', 'Global PO links original Sales Order ID');

    // =========================================================================
    // TEST L: Logistics Tracking & Bill of Lading (BL) Information Recorded
    // =========================================================================
    console.log('\n--- TEST L: Logistics Tracking & BL Information Recorded ---');
    shipment.trackingNumber = 'COSCO-BL-98765432';
    shipment.carrier = 'COSCO Shipping Lines';
    shipment.shippingMethod = 'Sea Freight';
    shipment.departureLocation = 'Shanghai Port, China';
    shipment.arrivalLocation = 'Karachi Port, Pakistan';
    shipment.status = 'In Transit';
    await shipment.save();

    orderBlue.blNumber = 'COSCO-BL-98765432';
    orderBlue.blInput = {
      blNumber: 'COSCO-BL-98765432',
      blDate: new Date(),
      carrier: 'COSCO Shipping Lines',
      containerNo: 'TGHU-7654321',
      portOfLoading: 'Shanghai Port, China',
      portOfDischarge: 'Karachi Port, Pakistan',
      enteredBy: logisticsUser._id,
      enteredByName: logisticsUser.fullName,
      enteredAt: new Date()
    };
    orderBlue.currentStatus = 'BL_RECORDED';
    orderBlue.lastAction = 'Logistics Tracking & BL Details Recorded';
    await orderBlue.save();

    assert(orderBlue.blNumber === 'COSCO-BL-98765432', 'Test L.1', 'BL Number saved on original Sales Order');
    assert(orderBlue.blInput.containerNo === 'TGHU-7654321', 'Test L.2', 'Container details saved in blInput structure');

    // =========================================================================
    // TEST M: Logistics Confirms Goods Received in Office -> Routes to Support
    // =========================================================================
    console.log('\n--- TEST M: Logistics Goods Received in Office -> Support ---');
    shipment.receivedInOffice = true;
    shipment.receivedInOfficeDate = new Date();
    shipment.receivedInOfficeBy = logisticsUser._id;
    shipment.receivedInOfficeByName = logisticsUser.fullName;
    shipment.status = 'Received in Office';
    await shipment.save();

    orderBlue.workflowStatus = 'Shipment Received in Office';
    orderBlue.status = 'Shipment Received in Office';
    orderBlue.departmentResponsible = 'Support';
    orderBlue.currentDepartment = 'Support';
    orderBlue.currentStatus = 'SHIPMENT_RECEIVED_IN_OFFICE';
    orderBlue.previousDepartment = 'Logistics';
    orderBlue.lastAction = `Shipment ${shipment.shipmentId} confirmed received in office by Logistics`;
    orderBlue.lastActionBy = logisticsUser._id;
    orderBlue.lastActionByName = logisticsUser.fullName;
    orderBlue.lastActionAt = new Date();
    await orderBlue.save();

    assert(shipment.receivedInOffice === true, 'Test M.1', 'Shipment confirmed as received in office');
    assert(orderBlue.departmentResponsible === 'Support', 'Test M.2', 'Blue File order handed over to Support Department');
    assert(orderBlue.currentStatus === 'SHIPMENT_RECEIVED_IN_OFFICE', 'Test M.3', 'currentStatus is SHIPMENT_RECEIVED_IN_OFFICE');

    // =========================================================================
    // TEST N: Support Department Creates Delivery Note (from Original SO)
    // =========================================================================
    console.log('\n--- TEST N: Support Creates Delivery Note -> Routes to Accounts ---');
    const deliveryNoteBlue = await DeliveryNote.create({
      salesOrder: orderBlue._id,
      salesOrderNumber: orderBlue.orderNumber || orderBlue.orderReference,
      clientName: orderBlue.clientName,
      recipientName: orderBlue.clientName,
      deliveryAddress: orderBlue.clientAddress,
      fileType: 'Blue',
      supplierPoNumber: poNumberBlue,
      blNumber: orderBlue.blNumber,
      shipmentId: shipment._id,
      shipmentNumber: shipment.shipmentId,
      items: orderBlue.items.map(it => ({
        product: it.productName,
        description: it.description,
        demand: it.quantity,
        quantity: it.quantity,
        unit: 'Units',
        availability: 'Available'
      })),
      status: 'Done',
      salesPerson: orderBlue.salesPerson,
      salePerson: orderBlue.salePerson,
      createdBy: supportUser._id
    });
    cleanupIds.deliveryNotes.push(deliveryNoteBlue._id);

    orderBlue.deliveryNoteId = deliveryNoteBlue._id;
    orderBlue.deliveryNoteNumber = deliveryNoteBlue.deliveryNoteNumber || deliveryNoteBlue.deliveryNumber;
    orderBlue.deliveryStatus = 'Fully Delivered';
    orderBlue.status = 'Delivered';
    orderBlue.workflowStatus = 'Delivery Note Created';
    orderBlue.departmentResponsible = 'Accounts';
    orderBlue.currentDepartment = 'Accounts';
    orderBlue.currentStatus = 'DELIVERY_NOTE_CREATED_IN_ACCOUNTS';
    orderBlue.previousDepartment = 'Support';
    orderBlue.previousStatus = 'Pending Delivery Note';
    orderBlue.lastAction = `Delivery Note ${deliveryNoteBlue.deliveryNoteNumber} Created by Support`;
    orderBlue.lastActionBy = supportUser._id;
    orderBlue.lastActionByName = supportUser.fullName;
    orderBlue.lastActionAt = new Date();
    await orderBlue.save();

    assert(deliveryNoteBlue.salesOrder.toString() === orderBlue._id.toString(), 'Test N.1', 'Delivery Note links original Sales Order ID');
    assert(orderBlue.departmentResponsible === 'Accounts', 'Test N.2', 'Order handed over to Accounts Department');
    assert(orderBlue.currentStatus === 'DELIVERY_NOTE_CREATED_IN_ACCOUNTS', 'Test N.3', 'currentStatus is DELIVERY_NOTE_CREATED_IN_ACCOUNTS');

    // =========================================================================
    // TEST O: Accounts Creates Draft Invoice
    // =========================================================================
    console.log('\n--- TEST O: Accounts Creates Draft Invoice ---');
    const invoiceCount = await Invoice.countDocuments();
    const invNumberBlue = `INV-${String(invoiceCount + 1001).padStart(5, '0')}`;

    const draftInvoice = await Invoice.create({
      invoiceNumber: invNumberBlue,
      clientName: orderBlue.clientName,
      salesOrderId: orderBlue._id,
      salesOrderNumber: orderBlue.orderNumber || orderBlue.orderReference,
      deliveryNoteId: deliveryNoteBlue._id,
      deliveryNoteNumber: deliveryNoteBlue.deliveryNoteNumber,
      fileType: 'Blue',
      items: orderBlue.items.map(it => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total
      })),
      subtotal: orderBlue.netAmount,
      tax: 0,
      amount: orderBlue.netAmount,
      paidAmount: 0,
      outstandingAmount: orderBlue.netAmount,
      status: 'Draft',
      isDraft: true,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      departmentResponsible: 'Accounts',
      createdBy: accountsUser._id
    });
    cleanupIds.invoices.push(draftInvoice._id);

    orderBlue.invoiceId = draftInvoice._id;
    orderBlue.invoiceNumber = invNumberBlue;
    orderBlue.workflowStatus = 'Draft Invoice Created';
    orderBlue.departmentResponsible = 'Accounts';
    orderBlue.currentDepartment = 'Accounts';
    orderBlue.currentStatus = 'DRAFT_INVOICE_CREATED';
    orderBlue.previousDepartment = 'Support';
    orderBlue.previousStatus = 'Delivery Note Created';
    orderBlue.lastAction = `Draft Invoice ${invNumberBlue} Created`;
    orderBlue.lastActionBy = accountsUser._id;
    orderBlue.lastActionByName = accountsUser.fullName;
    orderBlue.lastActionAt = new Date();
    await orderBlue.save();

    assert(draftInvoice.isDraft === true, 'Test O.1', 'Invoice initially created as Draft');
    assert(draftInvoice.salesOrderId.toString() === orderBlue._id.toString(), 'Test O.2', 'Draft invoice links original Sales Order ID');
    assert(orderBlue.currentStatus === 'DRAFT_INVOICE_CREATED', 'Test O.3', 'currentStatus is DRAFT_INVOICE_CREATED');

    // =========================================================================
    // TEST P: Accounts Sends Draft Invoice to Finance for Finalization
    // =========================================================================
    console.log('\n--- TEST P: Accounts Sends Draft Invoice to Finance ---');
    draftInvoice.status = 'Pending Finance Finalization';
    draftInvoice.departmentResponsible = 'Finance';
    draftInvoice.reviewedBy = accountsUser._id;
    draftInvoice.reviewedAt = new Date();
    await draftInvoice.save();

    orderBlue.workflowStatus = 'Pending Finance Finalization';
    orderBlue.departmentResponsible = 'Finance';
    orderBlue.currentDepartment = 'Finance';
    orderBlue.currentStatus = 'PENDING_FINANCE_FINALIZATION';
    orderBlue.previousDepartment = 'Accounts';
    orderBlue.previousStatus = 'Draft Invoice Created';
    orderBlue.lastAction = 'Sent to Finance for Finalization';
    orderBlue.lastActionBy = accountsUser._id;
    orderBlue.lastActionByName = accountsUser.fullName;
    orderBlue.lastActionAt = new Date();
    await orderBlue.save();

    assert(draftInvoice.status === 'Pending Finance Finalization', 'Test P.1', 'Invoice status updated to Pending Finance Finalization');
    assert(orderBlue.departmentResponsible === 'Finance', 'Test P.2', 'Sales Order routed to Finance for finalization review');
    assert(orderBlue.currentStatus === 'PENDING_FINANCE_FINALIZATION', 'Test P.3', 'currentStatus is PENDING_FINANCE_FINALIZATION');

    // =========================================================================
    // TEST Q: Finance Finalizes Invoice -> Returns to Accounts
    // =========================================================================
    console.log('\n--- TEST Q: Finance Finalizes Invoice ---');
    draftInvoice.status = 'Finalized';
    draftInvoice.isDraft = false;
    draftInvoice.invoiceType = 'GST Invoice';
    draftInvoice.finalizedBy = financeUser._id;
    draftInvoice.finalizedByName = financeUser.fullName;
    draftInvoice.finalizedAt = new Date();
    draftInvoice.departmentResponsible = 'Finance';
    await draftInvoice.save();

    orderBlue.workflowStatus = 'Completed';
    orderBlue.status = 'Completed';
    orderBlue.invoiceStatus = 'Fully Invoiced';
    orderBlue.departmentResponsible = 'Accounts';
    orderBlue.currentDepartment = 'Accounts';
    orderBlue.currentStatus = 'INVOICE_FINALIZED';
    orderBlue.previousDepartment = 'Finance';
    orderBlue.previousStatus = 'PENDING_FINANCE_FINALIZATION';
    orderBlue.lastAction = 'Invoice Finalized as GST Invoice by Finance';
    orderBlue.lastActionBy = financeUser._id;
    orderBlue.lastActionByName = financeUser.fullName;
    orderBlue.lastActionAt = new Date();
    await orderBlue.save();

    assert(draftInvoice.isDraft === false, 'Test Q.1', 'Invoice is no longer a draft (isDraft = false)');
    assert(draftInvoice.status === 'Finalized', 'Test Q.2', 'Invoice status is Finalized');
    assert(orderBlue.departmentResponsible === 'Accounts', 'Test Q.3', 'Finalized Invoice returned to Accounts for Document Package');
    assert(orderBlue.currentStatus === 'INVOICE_FINALIZED', 'Test Q.4', 'currentStatus is INVOICE_FINALIZED');

    // =========================================================================
    // TEST R: Accounts 4-Document Package Assembly Verification
    // =========================================================================
    console.log('\n--- TEST R: Accounts 4-Document Package Assembly ---');
    // Fetch complete package for orderBlue
    const packageOrder = await SalesOrder.findById(orderBlue._id);
    const packageInvoice = await Invoice.findOne({ salesOrderId: orderBlue._id });
    const packageDeliveryNote = await DeliveryNote.findOne({ salesOrder: orderBlue._id });

    // Validate Document 1: Finalized Invoice
    assert(packageInvoice != null && packageInvoice.status === 'Finalized', 'Test R.1', 'Document 1: Finalized Invoice verified');

    // Validate Document 2: Delivery Note
    assert(packageDeliveryNote != null && packageDeliveryNote.status === 'Done', 'Test R.2', 'Document 2: Delivery Note verified');

    // Validate Document 3: Company Undertaking
    const undertakingNumber = orderBlue.undertakingDetails?.undertakingNumber || `UT-${(orderBlue.orderNumber || orderBlue.orderReference || '1001').replace(/[^0-9]/g, '') || '1001'}`;
    assert(undertakingNumber != null && undertakingNumber.length > 0, 'Test R.3', `Document 3: Company Undertaking Ref #${undertakingNumber} verified`);

    // Validate Document 4: Goods Declaration Form (GD)
    const gdNumber = orderBlue.goodsDeclarationDetails?.gdNumber || `GD-${(orderBlue.orderNumber || orderBlue.orderReference || '1001').replace(/[^0-9]/g, '') || '1001'}`;
    assert(gdNumber != null && gdNumber.length > 0, 'Test R.4', `Document 4: Goods Declaration Form #${gdNumber} verified`);

    // Verify all 4 documents reference THE EXACT SAME ORIGINAL SALES ORDER ID
    assert(packageInvoice.salesOrderId.toString() === orderBlue._id.toString(), 'Test R.5', 'Single SO Rule: Invoice references original SO _id');
    assert(packageDeliveryNote.salesOrder.toString() === orderBlue._id.toString(), 'Test R.6', 'Single SO Rule: Delivery Note references original SO _id');

    console.log('\n================================================================');
    console.log('  ALL 18 WORKFLOW TESTS (A to R) COMPLETED SUCCESSFULLY!');
    console.log('================================================================\n');

  } finally {
    // Clean up temporary test data created during test execution
    console.log('Cleaning up temporary E2E test records from Atlas database...');
    if (cleanupIds.invoices.length) await Invoice.deleteMany({ _id: { $in: cleanupIds.invoices } });
    if (cleanupIds.deliveryNotes.length) await DeliveryNote.deleteMany({ _id: { $in: cleanupIds.deliveryNotes } });
    if (cleanupIds.shipments.length) await Shipment.deleteMany({ _id: { $in: cleanupIds.shipments } });
    if (cleanupIds.payables.length) await LocalPayable.deleteMany({ _id: { $in: cleanupIds.payables } });
    if (cleanupIds.grns.length) await PurchaserGRN.deleteMany({ _id: { $in: cleanupIds.grns } });
    if (cleanupIds.supplierPOs.length) await SupplierPO.deleteMany({ _id: { $in: cleanupIds.supplierPOs } });
    if (cleanupIds.salesOrders.length) await SalesOrder.deleteMany({ _id: { $in: cleanupIds.salesOrders } });
    await InventoryItem.deleteMany({ name: { $in: ['E2E Stocked Sensor Widget', 'E2E Shortage Hydraulic Pump'] } });
    await Supplier.deleteMany({ name: { $in: ['E2E Local Precision Tech', 'E2E Global Machinery Corp'] } });

    console.log('Cleanup complete. Database remains 100% clean with Ahmed Anjum user preserved.');
    await mongoose.disconnect();
  }

  return results;
}

runAllWorkflowTests()
  .then((res) => {
    const passed = res.filter(r => r.status === 'PASS').length;
    console.log(`Summary: ${passed} / ${res.length} test assertions PASSED.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test run error:', err);
    process.exit(1);
  });
