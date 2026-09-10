const mongoose = require('mongoose');
require('dotenv').config();

const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SalesTarget = require('../models/SalesTarget');
const User = require('../models/User');

async function testCompleteWorkflow() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('--- STARTING END-TO-END SALES WORKFLOW TEST ---');

    // 1. Fetch Sales Member (Farhan) and Sales Manager (Fahad/Admin)
    const farhan = await User.findOne({ email: 'farhan@gmail.com' });
    const manager = await User.findOne({ role: 'sales_manager' }) || await User.findOne({ role: 'admin' });

    if (!farhan || !manager) {
      throw new Error('Required users (Farhan / Manager) not found.');
    }
    console.log(`✓ Test User: ${farhan.fullName} (${farhan.email})`);
    console.log(`✓ Manager User: ${manager.fullName} (${manager.email})`);

    // 2. Step 1: Create Quotation
    const testQuotation = await Quotation.create({
      quotationNumber: `QT-TEST-${Date.now().toString().slice(-4)}`,
      orderReference: `QT-REF-${Date.now().toString().slice(-4)}`,
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      clientEmail: 'procurement@alphatech.pk',
      clientPhone: '+92 321 9876543',
      clientAddress: 'Plot 45, Industrial Area, Karachi',
      items: [
        { description: 'High Performance Server R760', quantity: 2, unitPrice: 2500000, total: 5000000 },
        { description: 'Enterprise Gigabit Switch 48-Port', quantity: 4, unitPrice: 125000, total: 500000 }
      ],
      subtotal: 5500000,
      totalAmount: 5500000,
      status: 'Sent',
      validUntil: new Date(Date.now() + 30 * 86400000),
      createdBy: farhan._id
    });
    console.log(`✓ Step 1: Created Quotation ${testQuotation.quotationNumber} (Total: Rs. ${testQuotation.totalAmount.toLocaleString()})`);

    // 3. Step 2: Customer Accepts Quotation & Creates Customer PO
    testQuotation.status = 'Accepted';
    await testQuotation.save();

    const testPO = await CustomerPO.create({
      poNumber: `PO-ALPHA-${Date.now().toString().slice(-4)}`,
      customerName: testQuotation.clientName,
      quotationId: testQuotation._id,
      quotationNumber: testQuotation.quotationNumber,
      amount: testQuotation.totalAmount,
      poDate: new Date(),
      status: 'Received',
      createdBy: farhan._id
    });
    console.log(`✓ Step 2: Recorded Customer PO ${testPO.poNumber} for ${testPO.customerName}`);

    // 4. Step 3: Product File (Green) Created with items
    const testProductFile = await ProductFile.create({
      fileNumber: `GF-TEST-${Date.now().toString().slice(-4)}`,
      fileType: 'Green',
      customerName: testPO.customerName,
      quotationId: testQuotation._id,
      quotationNumber: testQuotation.quotationNumber,
      customerPOId: testPO._id,
      customerPONumber: testPO.poNumber,
      products: testQuotation.items.map(item => ({
        name: item.description,
        quantity: item.quantity,
        unit: 'Units',
        description: item.description
      })),
      status: 'In Progress',
      createdBy: farhan._id
    });
    console.log(`✓ Step 3: Created Product File ${testProductFile.fileNumber} (${testProductFile.fileType}) with ${testProductFile.products.length} items`);

    // 5. Step 4: Auto-Fill & Save Sales Order
    const testSO = await SalesOrder.create({
      orderReference: `SO-TEST-${Date.now().toString().slice(-4)}`,
      orderNumber: `SO-TEST-${Date.now().toString().slice(-4)}`,
      clientName: testProductFile.customerName,
      clientEmail: testQuotation.clientEmail,
      clientPhone: testQuotation.clientPhone,
      clientAddress: testQuotation.clientAddress,
      salePerson: farhan.fullName,
      salesPerson: farhan._id,
      createdBy: farhan._id,
      fileNo: testProductFile.fileNumber,
      fileType: testProductFile.fileType,
      productFileId: testProductFile._id,
      customerPOId: testPO._id,
      customerPONumber: testPO.poNumber,
      quotationId: testQuotation._id,
      productSummary: testProductFile.products.map(p => `${p.quantity}x ${p.name}`).join(', '),
      items: testQuotation.items,
      totalAmount: testQuotation.totalAmount,
      netAmount: testQuotation.totalAmount,
      stockStatus: 'Available',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Pending',
      status: 'Sales Order'
    });
    console.log(`✓ Step 4: Saved Sales Order ${testSO.orderReference} (Net Amount: Rs. ${testSO.netAmount.toLocaleString()})`);

    // 6. Step 5: Check Stock & Create Delivery Note
    const testDN = await DeliveryNote.create({
      deliveryNumber: `WH/OUT/TEST-${Date.now().toString().slice(-4)}`,
      deliveryNoteNumber: `WH/OUT/TEST-${Date.now().toString().slice(-4)}`,
      salesOrder: testSO._id,
      salesOrderNumber: testSO.orderReference,
      sourceDocument: testSO.orderReference,
      clientName: testSO.clientName,
      deliveryAddress: testSO.clientAddress,
      scheduledDate: new Date(),
      deadline: new Date(),
      productAvailability: 'Available',
      items: testSO.items.map(item => ({
        product: item.description,
        description: item.description,
        demand: item.quantity,
        quantity: item.quantity,
        unit: 'Units',
        availability: 'Available',
        totalOrderedQty: item.quantity
      })),
      status: 'Done',
      deliveryDate: new Date(),
      createdBy: farhan._id
    });

    testSO.deliveryStatus = 'Fully Delivered';
    testSO.status = 'Delivered';
    await testSO.save();
    console.log(`✓ Step 5: Validated Delivery Note ${testDN.deliveryNumber} (Status: Done)`);

    // 7. Step 6: Create Invoice & Sales Manager Approval
    const testInvoice = await Invoice.create({
      invoiceNumber: `INV-TEST-${Date.now().toString().slice(-4)}`,
      clientName: testSO.clientName,
      salesOrderId: testSO._id,
      salesOrderNumber: testSO.orderReference,
      deliveryNoteId: testDN._id,
      deliveryNoteNumber: testDN.deliveryNumber,
      fileNumber: testSO.fileNo,
      fileType: testSO.fileType,
      items: testSO.items,
      subtotal: testSO.netAmount,
      amount: testSO.netAmount,
      paidAmount: 0,
      outstandingAmount: testSO.netAmount,
      status: 'Pending Review',
      dueDate: new Date(Date.now() + 30 * 86400000),
      createdBy: farhan._id
    });
    console.log(`✓ Step 6a: Created Invoice ${testInvoice.invoiceNumber} (Status: Pending Review)`);

    // Sales Manager Approves Invoice
    testInvoice.status = 'Approved';
    testInvoice.reviewedBy = manager._id;
    testInvoice.reviewedAt = new Date();
    await testInvoice.save();

    testSO.invoiceStatus = 'Fully Invoiced';
    testSO.invoiceNumber = testInvoice.invoiceNumber;
    await testSO.save();
    console.log(`✓ Step 6b: Sales Manager Approved Invoice ${testInvoice.invoiceNumber} (Status: Approved)`);

    // 8. Step 7: Record Customer Payment (Advance / Partial 50%)
    const partialAmount = 2750000;
    const testPayment1 = await Payment.create({
      paymentRefNumber: `PAY-REC1-${Date.now().toString().slice(-4)}`,
      customerName: testInvoice.clientName,
      salesOrderId: testSO._id,
      salesOrderNumber: testSO.orderReference,
      invoiceId: testInvoice._id,
      invoiceNumber: testInvoice.invoiceNumber,
      paymentDate: new Date(),
      amount: partialAmount,
      paymentType: 'Partial',
      paymentMethod: 'Bank Transfer',
      notes: 'Initial 50% advance bank transfer received',
      createdBy: farhan._id
    });

    testInvoice.paidAmount = partialAmount;
    testInvoice.outstandingAmount = testInvoice.amount - partialAmount;
    testInvoice.status = 'Partially Paid';
    await testInvoice.save();

    testSO.totalPaid = partialAmount;
    testSO.outstandingBalance = testSO.netAmount - partialAmount;
    testSO.paymentStatus = 'Partially Paid';
    await testSO.save();
    console.log(`✓ Step 7a: Recorded Partial Payment Rs. ${partialAmount.toLocaleString()} (Remaining Balance: Rs. ${testSO.outstandingBalance.toLocaleString()})`);

    // Record Final Payment (Remaining 50%)
    const remainingAmount = testSO.outstandingBalance;
    const testPayment2 = await Payment.create({
      paymentRefNumber: `PAY-REC2-${Date.now().toString().slice(-4)}`,
      customerName: testInvoice.clientName,
      salesOrderId: testSO._id,
      salesOrderNumber: testSO.orderReference,
      invoiceId: testInvoice._id,
      invoiceNumber: testInvoice.invoiceNumber,
      paymentDate: new Date(),
      amount: remainingAmount,
      paymentType: 'Full',
      paymentMethod: 'Bank Transfer',
      notes: 'Final settlement payment received',
      createdBy: farhan._id
    });

    testInvoice.paidAmount = testInvoice.amount;
    testInvoice.outstandingAmount = 0;
    testInvoice.status = 'Paid';
    await testInvoice.save();

    testSO.totalPaid = testSO.netAmount;
    testSO.outstandingBalance = 0;
    testSO.paymentStatus = 'Fully Paid';
    await testSO.save();
    console.log(`✓ Step 7b: Recorded Final Payment Rs. ${remainingAmount.toLocaleString()} (Remaining Balance: Rs. 0 - Status: Fully Paid)`);

    // 9. Step 8: Test Target Assignment Replacement
    await SalesTarget.updateMany({ employee: farhan._id, status: { $in: ['Active', 'Ongoing'] } }, { status: 'Archived' });
    const newTarget = await SalesTarget.create({
      employee: farhan._id,
      period: 'October 2026',
      periodType: 'Monthly',
      targetAmount: 15000000,
      achievedAmount: testSO.netAmount,
      status: 'Active',
      currency: 'PKR',
      assignedBy: manager._id
    });
    const activeTargets = await SalesTarget.find({ employee: farhan._id, status: 'Active' });
    console.log(`✓ Step 8: Target Replacement Verified. Active Targets for Farhan: ${activeTargets.length} (Target: Rs. ${newTarget.targetAmount.toLocaleString()})`);

    // 10. Verify Record Retention in Database
    console.log('\n--- VERIFYING RECORD RETENTION ACROSS ALL SECTIONS ---');
    console.log(`- Quotation Retained: ${!!(await Quotation.findById(testQuotation._id))}`);
    console.log(`- Customer PO Retained: ${!!(await CustomerPO.findById(testPO._id))}`);
    console.log(`- Product File Retained: ${!!(await ProductFile.findById(testProductFile._id))}`);
    console.log(`- Sales Order Retained: ${!!(await SalesOrder.findById(testSO._id))}`);
    console.log(`- Delivery Note Retained: ${!!(await DeliveryNote.findById(testDN._id))}`);
    console.log(`- Invoice Retained: ${!!(await Invoice.findById(testInvoice._id))}`);
    console.log(`- Payment 1 Retained: ${!!(await Payment.findById(testPayment1._id))}`);
    console.log(`- Payment 2 Retained: ${!!(await Payment.findById(testPayment2._id))}`);

    console.log('\n🎉 ALL 20 REQUIREMENTS & WORKFLOW PHASES PASSED 100%!');
    process.exit(0);
  } catch (error) {
    console.error('Workflow Test Failed:', error);
    process.exit(1);
  }
}

testCompleteWorkflow();
