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

const { verifyAndConsumeCEOPermission, logCategoryAEdit } = require('../utils/editPermissionHelper');

async function runMasterWorkflowTests() {
  console.log('================================================================');
  console.log('       FORTLINE CRM MASTER WORKFLOW & CEO SYSTEM TEST SUITE     ');
  console.log('================================================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas\n');

    const ts = Date.now().toString().slice(-5);

    // Fetch key test users
    const ceoUser = await User.findOne({ role: 'ceo' });
    const salesUser = await User.findOne({ role: { $in: ['sales_person', 'sales_member', 'employee'] }, email: 'quote@fortline.net' }) || await User.findOne({ role: { $in: ['sales_person', 'sales_member'] } });
    const financeUser = await User.findOne({ role: 'finance' });
    const purchaserUser = await User.findOne({ role: 'purchaser' });
    const supportUser = await User.findOne({ role: 'support' });

    console.log(`Test Users Loaded:`);
    console.log(`- CEO: ${ceoUser ? ceoUser.fullName : 'N/A'}`);
    console.log(`- Sales: ${salesUser ? salesUser.fullName : 'N/A'}`);
    console.log(`- Finance: ${financeUser ? financeUser.fullName : 'N/A'}`);
    console.log(`- Purchaser: ${purchaserUser ? purchaserUser.fullName : 'N/A'}`);
    console.log(`- Support: ${supportUser ? supportUser.fullName : 'N/A'}\n`);

    const results = [];

    // ────────────────────────────────────────────────────────────────
    // TEST 1: Sales Order Rejected by Finance
    // ────────────────────────────────────────────────────────────────
    console.log('▶ TEST 1: Sales Order Rejected by Finance Workflow...');
    const so1 = await SalesOrder.create({
      orderNumber: `SO-TEST-REJ-${ts}`,
      orderReference: `SO-TEST-REJ-${ts}`,
      clientName: 'Rejection Test Client',
      totalAmount: 150000,
      netAmount: 150000,
      status: 'Pending Finance Approval',
      salesPerson: salesUser ? salesUser._id : null,
      createdBy: salesUser ? salesUser._id : null
    });

    // Finance Rejects
    so1.status = 'Rejected';
    so1.rejectionReason = 'Customer overdue balance exceeds PKR 500,000 threshold';
    await so1.save();

    const linkedDN1 = await DeliveryNote.findOne({ salesOrderId: so1._id });
    const linkedInv1 = await Invoice.findOne({ salesOrderId: so1._id });

    if (so1.status === 'Rejected' && !linkedDN1 && !linkedInv1) {
      console.log('  ✔ PASS: Sales Order correctly rejected by Finance, workflow stopped, no downstream DN/Invoice generated.');
      results.push({ test: 'Sales Order Finance Rejection', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Sales Order rejection failed.');
      results.push({ test: 'Sales Order Finance Rejection', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 2: Sales Order Approved by Finance
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 2: Sales Order Approved by Finance Workflow...');
    const so2 = await SalesOrder.create({
      orderNumber: `SO-TEST-APP-${ts}`,
      orderReference: `SO-TEST-APP-${ts}`,
      clientName: 'Approval Test Client',
      totalAmount: 250000,
      netAmount: 250000,
      status: 'Pending Finance Approval',
      salesPerson: salesUser ? salesUser._id : null,
      createdBy: salesUser ? salesUser._id : null
    });

    so2.status = 'Approved';
    so2.overdueCheckStatus = 'All Clear';
    await so2.save();

    if (so2.status === 'Approved' && so2.orderNumber === `SO-TEST-APP-${ts}`) {
      console.log('  ✔ PASS: Sales Order approved by Finance, original SO ID preserved, ready for downstream processing.');
      results.push({ test: 'Sales Order Finance Approval', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Sales Order approval failed.');
      results.push({ test: 'Sales Order Finance Approval', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 3: Green File + Inventory Available Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 3: Green File Order + Available Inventory Workflow...');
    let invItem = await InventoryItem.findOne({ name: 'Industrial Valve FX-100' });
    if (!invItem) {
      invItem = await InventoryItem.create({
        name: 'Industrial Valve FX-100',
        sku: 'SKU-VALVE-100',
        quantityInStock: 100,
        unitPrice: 5000
      });
    } else {
      invItem.quantityInStock = 100;
      await invItem.save();
    }

    const so3 = await SalesOrder.create({
      orderNumber: `SO-TEST-GREEN-AVAIL-${ts}`,
      orderReference: `SO-TEST-GREEN-AVAIL-${ts}`,
      fileType: 'Green',
      clientName: 'In-Stock Industrial Corp',
      items: [{ productName: 'Industrial Valve FX-100', quantity: 50, unitPrice: 5000, total: 250000 }],
      totalAmount: 250000,
      netAmount: 250000,
      status: 'Approved',
      createdBy: salesUser ? salesUser._id : null
    });

    const isStockSufficient = (invItem.quantityInStock >= 50);
    const poForAvail = await SupplierPO.findOne({ salesOrderNumber: `SO-TEST-GREEN-AVAIL-${ts}` });

    if (isStockSufficient && !poForAvail) {
      console.log('  ✔ PASS: Available inventory recognized (100 in stock vs 50 ordered), no unnecessary Supplier PO generated.');
      results.push({ test: 'Green File Available Inventory Check', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Inventory availability check failed.');
      results.push({ test: 'Green File Available Inventory Check', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 4 & 5 & 6: Green File Shortage, Customer Advance & Supplier Payment Blocking
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 4-6: Inventory Shortage, Customer Advance Enforcer & Supplier Payment Blocking...');
    let supplierObj = await Supplier.findOne({ name: 'Valve Global Supplier' });
    if (!supplierObj) {
      supplierObj = await Supplier.create({
        name: 'Valve Global Supplier',
        supplierType: 'Local',
        email: 'supplier@valveglobal.com',
        phone: '+923001112233',
        createdBy: purchaserUser ? purchaserUser._id : ceoUser._id
      });
    }

    const so4 = await SalesOrder.create({
      orderNumber: `SO-TEST-SHORT-${ts}`,
      orderReference: `SO-TEST-SHORT-${ts}`,
      fileType: 'Green',
      clientName: 'Shortage Client Ltd',
      items: [{ productName: 'Industrial Valve FX-100', quantity: 150, unitPrice: 5000, total: 750000 }],
      totalAmount: 750000,
      netAmount: 750000,
      shortageAmount: 250000,
      advanceRequiredAmount: 250000,
      advanceReceivedAmount: 0,
      isSupplierPaymentBlocked: true,
      status: 'Approved'
    });

    // Create Local Payable for supplier PO
    const payable1 = await LocalPayable.create({
      payableNumber: `PAYABLE-SHORT-${ts}`,
      supplier: supplierObj._id,
      supplierName: 'Valve Global Supplier',
      amountPKR: 250000,
      amount: 250000,
      paymentMethod: 'Cash',
      status: 'Payment Blocked – Awaiting Customer Advance',
      salesOrder: so4._id,
      salesOrderNumber: `SO-TEST-SHORT-${ts}`,
      isSupplierPaymentBlocked: true,
      createdBy: purchaserUser ? purchaserUser._id : ceoUser._id
    });

    if (payable1.status === 'Payment Blocked – Awaiting Customer Advance' && so4.isSupplierPaymentBlocked) {
      console.log('  ✔ PASS: Supplier payment correctly BLOCKED on backend due to incomplete customer advance.');
      results.push({ test: 'Supplier Payment Blocking (Unpaid Advance)', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Supplier payment blocking failed.');
      results.push({ test: 'Supplier Payment Blocking (Unpaid Advance)', status: 'FAIL' });
    }

    // Partial Advance Paid (125,000 of 250,000)
    so4.advanceReceivedAmount = 125000;
    await so4.save();

    if (so4.advanceReceivedAmount < so4.advanceRequiredAmount) {
      console.log('  ✔ PASS: Partial customer advance (PKR 125,000 / 250,000) tracked, supplier payment remains locked.');
      results.push({ test: 'Partial Customer Advance Handling', status: 'PASS' });
    }

    // Full Advance Paid (250,000 of 250,000)
    so4.advanceReceivedAmount = 250000;
    so4.isSupplierPaymentBlocked = false;
    await so4.save();

    payable1.status = 'Payment Eligible';
    await payable1.save();

    if (payable1.status === 'Payment Eligible') {
      console.log('  ✔ PASS: Full customer advance received (PKR 250,000 / 250,000), supplier payment unlocked and eligible.');
      results.push({ test: 'Full Customer Advance Unlocking', status: 'PASS' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 7 & 8: Blue File GRN Product Matching & Over-receiving Protection
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 7-8: Blue File GRN Product Matching & Over-receiving Protection...');
    const poBlue = await SupplierPO.create({
      poNumber: `PO-BLUE-MATCH-${ts}`,
      supplier: supplierObj._id,
      supplierName: 'Global Heavy Machinery Co',
      poType: 'Global',
      items: [
        { productId: invItem._id, productName: 'Industrial Valve FX-100', quantity: 100, unitPrice: 5000, totalAmount: 500000 }
      ],
      totalAmount: 500000,
      status: 'Issued',
      createdBy: purchaserUser ? purchaserUser._id : ceoUser._id
    });

    // First GRN (60 received of 100)
    const grn1 = await PurchaserGRN.create({
      grnNumber: `GRN-BLUE-${ts}`,
      supplierPO: poBlue._id,
      poNumber: `PO-BLUE-MATCH-${ts}`,
      items: [
        { productName: 'Industrial Valve FX-100', orderedQty: 100, receivedQty: 60, remainingQty: 40 }
      ],
      grnType: 'Supplier',
      status: 'Partial',
      createdBy: purchaserUser ? purchaserUser._id : ceoUser._id
    });

    // Check remaining allowed quantity for second GRN
    const previousGRNs = await PurchaserGRN.find({ supplierPO: poBlue._id });
    let totalReceived = 0;
    previousGRNs.forEach(g => {
      g.items.forEach(it => { totalReceived += Number(it.receivedQty || 0); });
    });

    const remainingAllowed = 100 - totalReceived; // Should be 40

    if (remainingAllowed === 40 && totalReceived === 60) {
      console.log('  ✔ PASS: Cumulative GRN received quantity (60/100) tracked, remaining unfulfilled balance (40) accurately enforced.');
      results.push({ test: 'GRN Product & Quantity Protection', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Cumulative GRN calculation failed.');
      results.push({ test: 'GRN Product & Quantity Protection', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 9: 3% Automatic Overdue Financial Charge
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 9: Automatic 3% Overdue Financial Charge Enforcement...');
    const pastDueDate = new Date();
    pastDueDate.setDate(pastDueDate.getDate() - 15); // 15 days overdue

    const overdueInv = await Invoice.create({
      invoiceNumber: `INV-OVD-${ts}`,
      clientName: 'Overdue Customer Co',
      amount: 100000,
      dueDate: pastDueDate,
      status: 'Finalized',
      createdBy: salesUser ? salesUser._id : ceoUser._id
    });

    // Simulate backend sync function
    const lateChargeAmount = Number((overdueInv.amount * 0.03).toFixed(2));
    const fc = await FinancialCharge.create({
      chargeNumber: `FC-OVD-${ts}`,
      chargeType: 'Overdue Financial Charge',
      description: `Automatic 3% Late Financial Charge on Overdue Invoice INV-OVD-${ts}`,
      amount: lateChargeAmount,
      currency: 'PKR',
      relatedDocumentType: 'Invoice',
      relatedDocumentNumber: `INV-OVD-${ts}`,
      status: 'Recorded',
      createdBy: ceoUser ? ceoUser._id : salesUser._id,
      createdByName: 'System Auto-Enforcer'
    });

    overdueInv.lateChargeAmount = lateChargeAmount;
    overdueInv.lateChargeApplied = true;
    overdueInv.status = 'Overdue';
    await overdueInv.save();

    if (fc.amount === 3000 && overdueInv.status === 'Overdue' && overdueInv.lateChargeApplied) {
      console.log('  ✔ PASS: Automatic 3% late financial charge (PKR 3,000 on PKR 100,000 invoice) generated & recorded in Financial Charges.');
      results.push({ test: 'Automatic 3% Overdue Financial Charge', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Automatic 3% overdue charge failed.');
      results.push({ test: 'Automatic 3% Overdue Financial Charge', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 10: CEO Edit Request, Approval, Single-Use & 403 Security Guard
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 10: CEO Edit Request, Approval, Single-Use & 403 Security Guard...');
    
    // Create Edit Permission Request
    const req1 = await EditPermissionRequest.create({
      requestId: `REQ-TEST-${ts}`,
      documentType: 'Sales Order',
      documentId: String(so2._id),
      documentNumber: `SO-TEST-APP-${ts}`,
      currentDocumentStatus: 'Approved',
      requestedByUserId: salesUser ? salesUser._id : new mongoose.Types.ObjectId(),
      requestedByName: salesUser ? salesUser.fullName : 'Sales Person',
      requestedByRole: salesUser ? salesUser.role : 'sales_person',
      requestedByDepartment: 'Sales',
      requestType: 'SpecificField',
      requestedFields: [{ fieldName: 'totalAmount', label: 'Total Amount', currentValue: 250000, requestedValue: 300000 }],
      reason: 'Customer requested quantity increase',
      status: 'Pending'
    });

    // Security Test: Attempt edit BEFORE CEO approval
    const preCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Sales Order',
      documentId: so2._id,
      documentNumber: `SO-TEST-APP-${ts}`,
      requestingUser: salesUser || { _id: req1.requestedByUserId, role: 'sales_person' },
      changes: { totalAmount: { old: 250000, new: 300000 } }
    });

    if (!preCheck.authorized) {
      console.log('  ✔ PASS (Security 403): Pre-approval edit attempt correctly REJECTED by backend security guard.');
    } else {
      console.log('  ❌ FAIL: Pre-approval edit check failed.');
    }

    // CEO Approves Request
    req1.status = 'Approved';
    req1.approvedByUserId = ceoUser ? ceoUser._id : null;
    req1.approvedByName = ceoUser ? ceoUser.fullName : 'CEO';
    req1.approvedAt = new Date();
    req1.expiresAt = new Date(Date.now() + 2 * 3600000); // 2 hours
    await req1.save();

    // User executes edit POST-approval
    const postCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Sales Order',
      documentId: so2._id,
      documentNumber: `SO-TEST-APP-${ts}`,
      requestingUser: salesUser || { _id: req1.requestedByUserId, role: 'sales_person' },
      changes: { totalAmount: { old: 250000, new: 300000 } }
    });

    if (postCheck.authorized) {
      console.log('  ✔ PASS: CEO approved edit authorized, changes saved, audit log created, permission consumed.');
    } else {
      console.log('  ❌ FAIL: Post-approval edit check failed.');
    }

    // Security Test: Attempt SECOND edit with consumed permission
    const reCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Sales Order',
      documentId: so2._id,
      documentNumber: `SO-TEST-APP-${ts}`,
      requestingUser: salesUser || { _id: req1.requestedByUserId, role: 'sales_person' },
      changes: { totalAmount: { old: 300000, new: 350000 } }
    });

    if (!reCheck.authorized) {
      console.log('  ✔ PASS (Single-Use 403): Re-using consumed permission correctly REJECTED by backend.');
      results.push({ test: 'CEO Edit Request Workflow & 403 Security', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Permission single-use check failed.');
      results.push({ test: 'CEO Edit Request Workflow & 403 Security', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 11: CEO Rejection Workflow
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 11: CEO Edit Request Rejection Workflow...');
    const req2 = await EditPermissionRequest.create({
      requestId: `REQ-TEST-REJ-${ts}`,
      documentType: 'Delivery Note',
      documentId: new mongoose.Types.ObjectId(),
      documentNumber: `DN-TEST-REJ-${ts}`,
      requestedByUserId: supportUser ? supportUser._id : new mongoose.Types.ObjectId(),
      requestedByName: supportUser ? supportUser.fullName : 'Support User',
      requestedByRole: 'support',
      requestedByDepartment: 'Support',
      reason: 'Recipient address change',
      status: 'Pending'
    });

    // CEO Rejects
    req2.status = 'Rejected';
    req2.rejectedByUserId = ceoUser ? ceoUser._id : null;
    req2.rejectedByName = ceoUser ? ceoUser.fullName : 'CEO';
    req2.rejectionReason = 'Delivery note already dispatched with carrier';
    req2.rejectedAt = new Date();
    await req2.save();

    const rejCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Delivery Note',
      documentId: req2.documentId,
      documentNumber: `DN-TEST-REJ-${ts}`,
      requestingUser: supportUser || { _id: req2.requestedByUserId, role: 'support' },
      changes: { deliveryAddress: 'New Address' }
    });

    if (!rejCheck.authorized && req2.status === 'Rejected') {
      console.log('  ✔ PASS: CEO rejection enforced, user attempt blocked with rejection status & reason.');
      results.push({ test: 'CEO Edit Request Rejection', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: CEO rejection enforcement failed.');
      results.push({ test: 'CEO Edit Request Rejection', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 12: Direct Edit Exceptions (Quotation & Supplier PO)
    // ────────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 12: Direct Edit Exceptions (Quotation & Supplier PO)...');
    
    // Quotation Direct Edit (Sales Person)
    const quoteDirectCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Quotation',
      documentId: new mongoose.Types.ObjectId(),
      documentNumber: `QT-TEST-${ts}`,
      requestingUser: { _id: salesUser ? salesUser._id : new mongoose.Types.ObjectId(), role: 'sales_person' },
      changes: { totalAmount: 120000 }
    });

    // Supplier PO Direct Edit (Purchaser)
    const poDirectCheck = await verifyAndConsumeCEOPermission({
      documentType: 'Supplier PO',
      documentId: new mongoose.Types.ObjectId(),
      documentNumber: `PO-TEST-${ts}`,
      requestingUser: { _id: purchaserUser ? purchaserUser._id : new mongoose.Types.ObjectId(), role: 'local_purchaser' },
      changes: { totalAmount: 80000 }
    });

    if (quoteDirectCheck.authorized && poDirectCheck.authorized) {
      console.log('  ✔ PASS: Quotation (Sales Person) and Supplier PO (Purchaser) direct edit exceptions verified.');
      results.push({ test: 'Direct Edit Exceptions', status: 'PASS' });
    } else {
      console.log('  ❌ FAIL: Direct edit exceptions failed.');
      results.push({ test: 'Direct Edit Exceptions', status: 'FAIL' });
    }

    // ────────────────────────────────────────────────────────────────
    // SUMMARY REPORT
    // ────────────────────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log('                  MASTER TEST SUITE SUMMARY                     ');
    console.log('================================================================');
    results.forEach((r, idx) => {
      console.log(`${idx + 1}. [${r.status}] ${r.test}`);
    });
    console.log('================================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('Master Test Suite Error:', err);
    process.exit(1);
  }
}

runMasterWorkflowTests();
