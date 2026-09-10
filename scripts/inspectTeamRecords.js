const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Deal = require('../models/Deal');

async function checkRecords() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await User.find({ email: { $in: ['farhan@gmail.com', 'kaleem@gmail.com'] } });
    
    for (const u of users) {
      const leads = await Lead.find({ $or: [{ assignedTo: u._id }, { createdBy: u._id }] });
      const quotations = await Quotation.find({ createdBy: u._id });
      const orders = await SalesOrder.find({ salesPerson: u._id });
      const deals = await Deal.find({ $or: [{ assignedTo: u._id }, { createdBy: u._id }] });

      console.log(`\n=== User: ${u.fullName} (${u.email}) ===`);
      console.log(`Leads: ${leads.length}`);
      console.log(`Quotations: ${quotations.length}`);
      console.log(`Orders: ${orders.length}`);
      console.log(`Deals: ${deals.length}`);
      
      console.log('Orders breakdown:', orders.map(o => ({ orderNo: o.orderNo, clientName: o.clientName, netAmount: o.netAmount, status: o.status })));
    }

    const allOrders = await SalesOrder.find();
    console.log(`\nTotal Sales Orders in DB: ${allOrders.length}`);
    console.log('All Orders:', allOrders.map(o => ({ orderNo: o.orderNo, client: o.clientName, salesPerson: o.salesPerson, amount: o.netAmount })));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkRecords();
