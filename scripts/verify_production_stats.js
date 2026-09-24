const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });

const User = require('../models/User');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const DeliveryNote = require('../models/DeliveryNote');
const Payment = require('../models/Payment');
const { getSalesManagerScope } = require('../utils/salesManagerScope');

async function verifyAllStats() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('--- SYSTEM VERIFICATION REPORT ---');

  // 1. Total counts in database
  const [quoteCount, soCount, dnCount, invCount, payCount] = await Promise.all([
    Quotation.countDocuments(),
    SalesOrder.countDocuments(),
    DeliveryNote.countDocuments(),
    Invoice.countDocuments(),
    Payment.countDocuments()
  ]);

  console.log('Database Document Counts:');
  console.log(`  Quotations: ${quoteCount}`);
  console.log(`  Sales Orders: ${soCount}`);
  console.log(`  Delivery Notes (Support): ${dnCount}`);
  console.log(`  Invoices (Finance / Accounts): ${invCount}`);
  console.log(`  Payments (Finance / Accounts): ${payCount}`);

  // 2. Syed Salman check (Must be 0)
  const salmanQuotes = await Quotation.countDocuments({ salePerson: /Syed Salman/i });
  const salmanOrders = await SalesOrder.countDocuments({ salePerson: /Syed Salman/i });
  console.log(`Syed Salman records check: Quotes=${salmanQuotes}, Orders=${salmanOrders} (Should be 0)`);

  // 3. Finance & Accounts Stats
  const fullyInvoicedCount = await SalesOrder.countDocuments({ invoiceStatus: 'Fully Invoiced' });
  const toInvoiceCount = await SalesOrder.countDocuments({ invoiceStatus: 'To Invoice' });
  console.log(`Sales Orders Workflow routing: Fully Invoiced=${fullyInvoicedCount}, To Invoice=${toInvoiceCount}`);

  // 4. Regional Sales Manager Isolation
  const isbManager = await User.findOne({ email: 'shoaibmehfooz.managerisb@fortline.net' });
  const lhrManager = await User.findOne({ email: 'waseembhatti.managerlhr@fortline.net' });
  const khiManager = await User.findOne({ email: 'umairsiddiqui.managerkhi@fortline.net' });
  const ceo = await User.findOne({ email: 'ceo@fortline.net' });

  // ISB Scope
  const isbScope = await getSalesManagerScope(isbManager);
  const isbQuotes = await Quotation.countDocuments({ $or: [{ createdBy: { $in: isbScope.memberIds } }, { salesPerson: { $in: isbScope.memberIds } }] });
  const isbOrders = await SalesOrder.countDocuments({ $or: [{ createdBy: { $in: isbScope.memberIds } }, { salesPerson: { $in: isbScope.memberIds } }] });

  // LHR Scope
  const lhrScope = await getSalesManagerScope(lhrManager);
  const lhrQuotes = await Quotation.countDocuments({ $or: [{ createdBy: { $in: lhrScope.memberIds } }, { salesPerson: { $in: lhrScope.memberIds } }] });
  const lhrOrders = await SalesOrder.countDocuments({ $or: [{ createdBy: { $in: lhrScope.memberIds } }, { salesPerson: { $in: lhrScope.memberIds } }] });

  // KHI Scope
  const khiScope = await getSalesManagerScope(khiManager);
  const khiQuotes = await Quotation.countDocuments({ $or: [{ createdBy: { $in: khiScope.memberIds } }, { salesPerson: { $in: khiScope.memberIds } }] });
  const khiOrders = await SalesOrder.countDocuments({ $or: [{ createdBy: { $in: khiScope.memberIds } }, { salesPerson: { $in: khiScope.memberIds } }] });

  console.log('\nRegional Sales Manager Breakdown:');
  console.log(`  Islamabad (ISB Team: ${isbScope.memberNames.join(', ')}): Quotes=${isbQuotes}, Orders=${isbOrders}`);
  console.log(`  Lahore (LHR Team: ${lhrScope.memberNames.join(', ')}): Quotes=${lhrQuotes}, Orders=${lhrOrders}`);
  console.log(`  Karachi (KHI Team: ${khiScope.memberNames.join(', ')}): Quotes=${khiQuotes}, Orders=${khiOrders}`);

  // Check that sums equal total
  console.log(`  Regional Sum: Quotes=${isbQuotes + lhrQuotes + khiQuotes}, Total in DB=${quoteCount}`);
  console.log(`  Regional Sum: Orders=${isbOrders + lhrOrders + khiOrders}, Total in DB=${soCount}`);

  // 5. Financial Totals
  const totalSOAmount = (await SalesOrder.aggregate([{ $group: { _id: null, total: { $sum: '$totalAmount' } } }]))[0]?.total || 0;
  const totalInvAmount = (await Invoice.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;
  const totalPayAmount = (await Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0;

  console.log('\nConsolidated Financial Totals (CEO / Admin / Finance view):');
  console.log(`  Total Sales Orders Value: PKR ${totalSOAmount.toLocaleString()}`);
  console.log(`  Total Invoiced Value: PKR ${totalInvAmount.toLocaleString()}`);
  console.log(`  Total Payments Collected: PKR ${totalPayAmount.toLocaleString()}`);

  process.exit(0);
}

verifyAllStats().catch(err => {
  console.error(err);
  process.exit(1);
});
