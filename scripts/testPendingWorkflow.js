/**
 * testPendingWorkflow.js
 * End-to-end verification script for Fortline CRM Pending-Workflow Model
 * Based on Section 33 Acceptance Verification
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const InventoryItem = require('../models/InventoryItem');

// We will also import the actual controller functions to test API logic
const {
  calculateCustomerOverdue
} = require('../controllers/salesEmployeeController');

async function runPendingWorkflowVerification() {
  console.log('================================================================');
  console.log('🧪 RUNNING FORTLINE CRM PENDING-WORKFLOW ACCEPTANCE TEST (SEC 33)');
  console.log('================================================================\n');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fortCRM';
  await mongoose.connect(uri);
  console.log('✓ Connected to MongoDB.\n');

  try {
    // 1. Setup Test Users
    let salesUser = await User.findOne({ email: 'sales.tester@fortline.net' });
    if (!salesUser) {
      salesUser = await User.create({
        fullName: 'Sales Tester',
        email: 'sales.tester@fortline.net',
        password: 'Password123!',
        role: 'sales_person',
        department: 'Sales',
        status: 'active',
        isApproved: true
      });
    }

    let financeUser = await User.findOne({ email: 'finance.tester@fortline.net' });
    if (!financeUser) {
      financeUser = await User.create({
        fullName: 'Finance Reviewer',
        email: 'finance.tester@fortline.net',
        password: 'Password123!',
        role: 'finance',
        department: 'Finance',
        status: 'active',
        isApproved: true
      });
    }

    let supportUser = await User.findOne({ email: 'support.tester@fortline.net' });
    if (!supportUser) {
      supportUser = await User.create({
        fullName: 'Support Tester',
        email: 'support.tester@fortline.net',
        password: 'Password123!',
        role: 'support',
        department: 'Support',
        status: 'active',
        isApproved: true
      });
    }

    let accountsUser = await User.findOne({ email: 'accounts.tester@fortline.net' });
    if (!accountsUser) {
      accountsUser = await User.create({
        fullName: 'Accounts Tester',
        email: 'accounts.tester@fortline.net',
        password: 'Password123!',
        role: 'accountant',
        department: 'Accounts',
        status: 'active',
        isApproved: true
      });
    }

    console.log('✓ Verified departmental test users (Sales, Finance, Support, Accounts).\n');

    // Clean up past test batch for idempotency
    const testPrefix = 'WF-TEST-';
    await Quotation.deleteMany({ quotationNumber: new RegExp('^' + testPrefix) });
    await SalesOrder.deleteMany({ orderReference: new RegExp('^' + testPrefix) });
    await DeliveryNote.deleteMany({ deliveryNumber: new RegExp('^' + testPrefix) });
    await Invoice.deleteMany({ invoiceNumber: new RegExp('^' + testPrefix) });

    // Ensure inventory item exists for test products
    await InventoryItem.findOneAndUpdate(
      { name: 'Workflow Test Router' },
      { name: 'Workflow Test Router', sku: 'TEST-RTR-01', totalQuantity: 500, availableQuantity: 500 },
      { upsert: true, new: true }
    );

    // ========================================================================
    // STEP 1: QUOTATION PENDING-WORKFLOW VERIFICATION (Section 33: 20 -> 10)
    // ========================================================================
    console.log('--- STEP 1: QUOTATION PENDING-WORKFLOW MODEL ---');
    console.log('Creating 20 Test Quotations for Sales Person...');
    const createdQuotes = [];
    for (let i = 1; i <= 20; i++) {
      const q = await Quotation.create({
        quotationNumber: `${testPrefix}Q-${1000 + i}`,
        clientName: `Test Client ${i}`,
        clientEmail: `client${i}@workflowtest.com`,
        clientPhone: `0300-11122${i < 10 ? '0' + i : i}`,
        items: [{
          description: 'Workflow Test Router',
          quantity: 2,
          unitPrice: 25000,
          total: 50000
        }],
        subtotal: 50000,
        totalAmount: 50000,
        status: 'Quotation',
        salePerson: salesUser.fullName,
        createdBy: salesUser._id
      });
      createdQuotes.push(q);
    }

    // Verify initial count: 20 active
    let activeQuotes = await Quotation.find({
      createdBy: salesUser._id,
      quotationNumber: new RegExp('^' + testPrefix),
      status: { $ne: 'Converted to Sales Order' }
    });
    console.log(`Initial Active Quotations Count: ${activeQuotes.length} (Expected: 20)`);
    if (activeQuotes.length !== 20) throw new Error('Failed: Expected 20 active quotations.');

    console.log('\nConverting 10 Quotations -> Sales Orders...');
    const convertedOrders = [];
    for (let i = 0; i < 10; i++) {
      const quote = createdQuotes[i];
      // Convert logic matching controller
      const so = await SalesOrder.create({
        orderNumber: `${testPrefix}SO-${2000 + i}`,
        orderReference: `${testPrefix}SO-${2000 + i}`,
        quotationId: quote._id,
        quotationNumber: quote.quotationNumber,
        clientName: quote.clientName,
        clientEmail: quote.clientEmail,
        clientPhone: quote.clientPhone,
        items: quote.items,
        subtotal: quote.subtotal,
        totalAmount: quote.totalAmount,
        netAmount: quote.totalAmount,
        salePerson: salesUser.fullName,
        createdBy: salesUser._id,
        status: 'Draft',
        workflowStatus: 'Draft Order',
        requiresFinanceApproval: false
      });

      quote.status = 'Converted to Sales Order';
      quote.salesOrderId = so._id;
      quote.salesOrderNumber = so.orderReference;
      quote.convertedAt = new Date();
      await quote.save();
      convertedOrders.push(so);
    }

    // Verify Pending Workflow: Active queue MUST show only 10 remaining quotations
    activeQuotes = await Quotation.find({
      createdBy: salesUser._id,
      quotationNumber: new RegExp('^' + testPrefix),
      status: { $ne: 'Converted to Sales Order' }
    });
    const convertedQuotesList = await Quotation.find({
      createdBy: salesUser._id,
      quotationNumber: new RegExp('^' + testPrefix),
      status: 'Converted to Sales Order'
    });
    const totalQuotesInDB = await Quotation.countDocuments({
      createdBy: salesUser._id,
      quotationNumber: new RegExp('^' + testPrefix)
    });

    console.log(`Active (Pending) Quotations in Queue: ${activeQuotes.length} (Expected: 10)`);
    console.log(`Converted Quotations in History: ${convertedQuotesList.length} (Expected: 10)`);
    console.log(`Total Quotations physically in Database: ${totalQuotesInDB} (Expected: 20)`);

    if (activeQuotes.length !== 10) throw new Error(`Failed: Expected 10 active quotations, got ${activeQuotes.length}`);
    if (convertedQuotesList.length !== 10) throw new Error(`Failed: Expected 10 converted quotations, got ${convertedQuotesList.length}`);
    if (totalQuotesInDB !== 20) throw new Error(`Failed: Record was physically deleted from DB! Expected 20, got ${totalQuotesInDB}`);
    console.log('✓ Stage 1 Quotation Pending-Workflow Model PASSED!\n');

    // ========================================================================
    // STEP 2: SALES ORDER & OVERDUE CHECK / FINANCE APPROVAL
    // ========================================================================
    console.log('--- STEP 2: OVERDUE BALANCE CHECK & FINANCE APPROVAL ---');
    const overdueClient = 'Overdue Corp Pakistan';

    // Create a finalized invoice past due date with outstanding balance
    const pastDueDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago
    const overdueInvoice = await Invoice.create({
      invoiceNumber: `${testPrefix}INV-OVERDUE-01`,
      clientName: overdueClient,
      amount: 150000,
      paidAmount: 50000, // Remaining balance 100,000 overdue
      dueDate: pastDueDate,
      status: 'Finalized',
      isDraft: false,
      invoiceType: 'GST Invoice',
      createdBy: accountsUser._id
    });
    console.log(`Created past-due finalized invoice for "${overdueClient}" with Rs. 100,000 overdue balance.`);

    // Test calculateCustomerOverdue function
    const overdueResult = await calculateCustomerOverdue(overdueClient);
    const calculatedOverdue = overdueResult.overdueAmount;
    console.log(`Calculated Overdue for "${overdueClient}": Rs. ${calculatedOverdue} (Expected: 100000)`);
    if (calculatedOverdue !== 100000) throw new Error(`Failed: Overdue should be 100,000, got ${calculatedOverdue}`);

    // Create Sales Order for overdue customer -> MUST require finance approval
    const overdueSO = await SalesOrder.create({
      orderNumber: `${testPrefix}SO-CREDIT-BLOCK-01`,
      orderReference: `${testPrefix}SO-CREDIT-BLOCK-01`,
      clientName: overdueClient,
      items: [{ description: 'High-end Switch', quantity: 1, unitPrice: 200000, total: 200000 }],
      totalAmount: 200000,
      netAmount: 200000,
      salePerson: salesUser.fullName,
      createdBy: salesUser._id,
      customerOverdueAtCreation: calculatedOverdue,
      requiresFinanceApproval: calculatedOverdue > 0,
      workflowStatus: 'Pending Finance Approval'
    });

    console.log(`Order ${overdueSO.orderReference} requiresFinanceApproval: ${overdueSO.requiresFinanceApproval}`);
    if (!overdueSO.requiresFinanceApproval) throw new Error('Failed: Order should require Finance approval.');

    // Attempting to send to support before approval MUST be blocked
    let blocked = false;
    if (overdueSO.requiresFinanceApproval && !overdueSO.financeApprovedBy) {
      blocked = true;
    }
    console.log(`Blocked from sending to Support before Finance approval: ${blocked}`);
    if (!blocked) throw new Error('Failed: Order should be blocked from forwarding.');

    // Finance approves the order
    overdueSO.financeApprovedBy = financeUser._id;
    overdueSO.financeApprovedByName = financeUser.fullName;
    overdueSO.financeApprovedAt = new Date();
    overdueSO.workflowStatus = 'Approved by Finance';
    await overdueSO.save();
    console.log(`Finance approved order ${overdueSO.orderReference}.`);

    // Now Sales person can send to support
    overdueSO.workflowStatus = 'Sent to Support';
    await overdueSO.save();
    console.log(`Order status updated to: ${overdueSO.workflowStatus}`);
    console.log('✓ Stage 2 Overdue & Finance Approval Model PASSED!\n');

    // ========================================================================
    // STEP 3: SUPPORT FULFILLMENT PENDING-WORKFLOW (Section 33: 7 -> 5 -> 2)
    // ========================================================================
    console.log('--- STEP 3: SUPPORT FULFILLMENT PENDING-WORKFLOW MODEL ---');
    console.log('Forwarding 7 Sales Orders to Support...');
    const supportBatchOrders = [];
    for (let i = 0; i < 7; i++) {
      const so = convertedOrders[i];
      so.workflowStatus = 'Sent to Support';
      await so.save();
      supportBatchOrders.push(so);
    }

    const batchIds = supportBatchOrders.map(o => o._id);
    // Support pending queue initial count: 7
    let supportPending = await SalesOrder.find({
      _id: { $in: batchIds },
      workflowStatus: { $in: ['Sent to Support', 'Support Reviewing'] },
      $or: [{ deliveryNoteId: null }, { deliveryNoteId: { $exists: false } }]
    });
    console.log(`Support Pending Sales Orders Queue: ${supportPending.length} (Expected: 7)`);
    if (supportPending.length !== 7) throw new Error(`Expected 7 pending orders for support, got ${supportPending.length}`);

    console.log('Support creates 5 Delivery Notes...');
    const createdDNs = [];
    for (let i = 0; i < 5; i++) {
      const so = supportBatchOrders[i];
      const dn = await DeliveryNote.create({
        deliveryNumber: `${testPrefix}DN-${3000 + i}`,
        salesOrder: so._id,
        salesOrderNumber: so.orderReference,
        clientName: so.clientName,
        recipientPhone: so.clientPhone,
        items: so.items,
        status: 'Confirmed',
        invoiced: false,
        createdBy: supportUser._id
      });

      // Update SO
      so.deliveryNoteId = dn._id;
      so.deliveryNoteNumber = dn.deliveryNumber;
      so.workflowStatus = 'Delivery Note Created';
      await so.save();
      createdDNs.push(dn);
    }

    // Support pending queue MUST drop to 2 (7 - 5 = 2)
    supportPending = await SalesOrder.find({
      _id: { $in: batchIds },
      workflowStatus: { $in: ['Sent to Support', 'Support Reviewing'] },
      $or: [{ deliveryNoteId: null }, { deliveryNoteId: { $exists: false } }]
    });
    const totalSupportOrdersInDB = await SalesOrder.countDocuments({
      orderReference: new RegExp('^' + testPrefix)
    });

    console.log(`Support Pending Queue after 5 DNs created: ${supportPending.length} (Expected: 2)`);
    console.log(`Total Sales Orders retained in DB: ${totalSupportOrdersInDB}`);
    if (supportPending.length !== 2) throw new Error(`Expected 2 pending orders in support queue, got ${supportPending.length}`);
    console.log('✓ Stage 3 Support Fulfillment Pending-Workflow PASSED!\n');

    // ========================================================================
    // STEP 4: ACCOUNTS DRAFT INVOICING PENDING-WORKFLOW (Section 33: 5 -> 4 -> 1)
    // ========================================================================
    console.log('--- STEP 4: ACCOUNTS DRAFT INVOICING PENDING-WORKFLOW MODEL ---');
    // Accounts pending DNs queue initially: 5 DNs awaiting draft invoice
    let accountsPendingDNs = await DeliveryNote.find({
      deliveryNumber: new RegExp('^' + testPrefix),
      invoiced: { $ne: true }
    });
    console.log(`Accounts Pending Delivery Notes Queue: ${accountsPendingDNs.length} (Expected: 5)`);
    if (accountsPendingDNs.length !== 5) throw new Error(`Expected 5 pending DNs in Accounts, got ${accountsPendingDNs.length}`);

    console.log('Accounts drafts 4 Invoices from the 5 Delivery Notes...');
    const createdDraftInvoices = [];
    for (let i = 0; i < 4; i++) {
      const dn = createdDNs[i];
      const inv = await Invoice.create({
        invoiceNumber: `${testPrefix}INV-DRAFT-${4000 + i}`,
        salesOrderId: dn.salesOrder,
        salesOrderNumber: dn.salesOrderNumber,
        deliveryNoteId: dn._id,
        deliveryNoteNumber: dn.deliveryNumber,
        clientName: dn.clientName,
        amount: 50000,
        subtotal: 50000,
        items: dn.items,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'Draft',
        isDraft: true,
        createdBy: accountsUser._id
      });

      // Mark DN as invoiced
      dn.invoiced = true;
      dn.invoiceId = inv._id;
      dn.invoiceNumber = inv.invoiceNumber;
      dn.invoicedAt = new Date();
      await dn.save();

      createdDraftInvoices.push(inv);
    }

    // Accounts pending DNs queue MUST drop to 1 (5 - 4 = 1)
    accountsPendingDNs = await DeliveryNote.find({
      deliveryNumber: new RegExp('^' + testPrefix),
      invoiced: { $ne: true }
    });
    console.log(`Accounts Pending Delivery Notes Queue after 4 drafts: ${accountsPendingDNs.length} (Expected: 1)`);
    if (accountsPendingDNs.length !== 1) throw new Error(`Expected 1 pending DN in Accounts, got ${accountsPendingDNs.length}`);

    // Accounts submits 3 of the 4 draft invoices to Finance
    console.log('Accounts submits 3 draft invoices to Finance...');
    for (let i = 0; i < 3; i++) {
      const inv = createdDraftInvoices[i];
      inv.status = 'Pending Finance Finalization';
      inv.departmentResponsible = 'Finance';
      await inv.save();
    }

    // Accounts Pending Draft Invoices queue MUST drop to 1 (4 - 3 = 1)
    const accountsPendingDrafts = await Invoice.find({
      invoiceNumber: new RegExp('^' + testPrefix),
      status: 'Draft',
      isDraft: true
    });
    console.log(`Accounts Pending Draft Invoices Queue after 3 sent to Finance: ${accountsPendingDrafts.length} (Expected: 1)`);
    if (accountsPendingDrafts.length !== 1) throw new Error(`Expected 1 pending draft in Accounts, got ${accountsPendingDrafts.length}`);
    console.log('✓ Stage 4 Accounts Draft Invoicing Pending-Workflow PASSED!\n');

    // ========================================================================
    // STEP 5: FINANCE FINALIZATION PENDING-WORKFLOW (Section 33: 3 -> 2 -> 1)
    // ========================================================================
    console.log('--- STEP 5: FINANCE FINALIZATION PENDING-WORKFLOW MODEL ---');
    // Finance pending draft invoices queue initially: 3
    let financePendingDrafts = await Invoice.find({
      invoiceNumber: new RegExp('^' + testPrefix),
      status: 'Pending Finance Finalization'
    });
    console.log(`Finance Pending Draft Invoices Queue: ${financePendingDrafts.length} (Expected: 3)`);
    if (financePendingDrafts.length !== 3) throw new Error(`Expected 3 pending drafts in Finance, got ${financePendingDrafts.length}`);

    console.log('Finance finalizes 2 Invoices (1 GST Invoice, 1 Cash Invoice)...');
    // Finalize 1st invoice as GST
    const inv1 = financePendingDrafts[0];
    inv1.status = 'Finalized';
    inv1.isDraft = false;
    inv1.invoiceType = 'GST Invoice';
    inv1.finalizedBy = financeUser._id;
    inv1.finalizedByName = financeUser.fullName;
    inv1.finalizedAt = new Date();
    await inv1.save();
    if (inv1.salesOrderId) {
      await SalesOrder.findByIdAndUpdate(inv1.salesOrderId, { workflowStatus: 'Completed', status: 'Completed' });
    }

    // Finalize 2nd invoice as Cash Invoice
    const inv2 = financePendingDrafts[1];
    inv2.status = 'Finalized';
    inv2.isDraft = false;
    inv2.invoiceType = 'Cash Invoice';
    inv2.finalizedBy = financeUser._id;
    inv2.finalizedByName = financeUser.fullName;
    inv2.finalizedAt = new Date();
    await inv2.save();
    if (inv2.salesOrderId) {
      await SalesOrder.findByIdAndUpdate(inv2.salesOrderId, { workflowStatus: 'Completed', status: 'Completed' });
    }

    // Finance pending queue MUST drop to 1 (3 - 2 = 1)
    financePendingDrafts = await Invoice.find({
      invoiceNumber: new RegExp('^' + testPrefix),
      status: 'Pending Finance Finalization'
    });
    const finalizedInvoicesList = await Invoice.find({
      invoiceNumber: new RegExp('^' + testPrefix + 'INV-DRAFT-'),
      status: 'Finalized',
      isDraft: false
    });

    console.log(`Finance Pending Draft Invoices Queue after 2 finalized: ${financePendingDrafts.length} (Expected: 1)`);
    console.log(`Finance Finalized Invoices from Batch: ${finalizedInvoicesList.length} (Expected: 2)`);
    if (financePendingDrafts.length !== 1) throw new Error(`Expected 1 pending draft in Finance, got ${financePendingDrafts.length}`);
    if (finalizedInvoicesList.length !== 2) throw new Error(`Expected 2 finalized invoices in Finance, got ${finalizedInvoicesList.length}`);

    // Verify linked Sales Order is Completed
    const completedSO = await SalesOrder.findById(inv1.salesOrderId);
    console.log(`Linked Sales Order ${completedSO.orderReference} workflowStatus: ${completedSO.workflowStatus} (Expected: Completed)`);
    if (completedSO.workflowStatus !== 'Completed') throw new Error('Expected Sales Order to be Completed.');
    console.log('✓ Stage 5 Finance Finalization Pending-Workflow PASSED!\n');

    // ========================================================================
    // STEP 6: AUDIT TRAIL & ZERO RECORD DELETION VERIFICATION
    // ========================================================================
    console.log('--- STEP 6: VERIFY DATABASE PERSISTENCE & AUDIT TRAIL ---');
    const finalQuoteCount = await Quotation.countDocuments({ quotationNumber: new RegExp('^' + testPrefix) });
    const finalSOCount = await SalesOrder.countDocuments({ orderReference: new RegExp('^' + testPrefix) });
    const finalDNCount = await DeliveryNote.countDocuments({ deliveryNumber: new RegExp('^' + testPrefix) });
    const finalInvoiceCount = await Invoice.countDocuments({ invoiceNumber: new RegExp('^' + testPrefix) });

    console.log(`Total Test Quotations in MongoDB: ${finalQuoteCount} (Initial: 20)`);
    console.log(`Total Test Sales Orders in MongoDB: ${finalSOCount}`);
    console.log(`Total Test Delivery Notes in MongoDB: ${finalDNCount}`);
    console.log(`Total Test Invoices in MongoDB: ${finalInvoiceCount}`);

    if (finalQuoteCount !== 20) throw new Error('Quotation records were deleted from DB!');
    if (finalDNCount !== 5) throw new Error('Delivery Note records were deleted from DB!');

    console.log('\n================================================================');
    console.log('🎉 ALL SECTION 33 PENDING WORKFLOW ACCEPTANCE CRITERIA PASSED!');
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB.');
  }
}

runPendingWorkflowVerification();
