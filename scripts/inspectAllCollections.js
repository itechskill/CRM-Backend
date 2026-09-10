const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const Deal = require('../models/Deal');

async function inspectAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const quotations = await Quotation.find();
    console.log(`\n=== Quotations (${quotations.length}) ===`);
    quotations.forEach(q => console.log(`- ${q.quotationNo || q.orderReference}: ${q.clientName} | Amount: ${q.totalAmount} | By: ${q.salePerson}`));

    const orders = await SalesOrder.find();
    console.log(`\n=== Sales Orders (${orders.length}) ===`);
    orders.forEach(o => console.log(`- ${o.orderNo || o.orderReference}: ${o.clientName} | Amount: ${o.netAmount} | Status: ${o.status}`));

    const invoices = await Invoice.find();
    console.log(`\n=== Invoices (${invoices.length}) ===`);
    invoices.forEach(i => console.log(`- ${i.invoiceNo}: ${i.clientName} | Amount: ${i.amount} | Status: ${i.status}`));

    const leads = await Lead.find();
    console.log(`\n=== Leads (${leads.length}) ===`);
    leads.forEach(l => console.log(`- ${l.name} (${l.company}) | Status: ${l.status} | Value: ${l.value}`));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

inspectAll();
