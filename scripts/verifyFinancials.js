const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Invoice = require('../models/Invoice');
const SalesOrder = require('../models/SalesOrder');
const SalesTarget = require('../models/SalesTarget');

async function verifyFinancials() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const now = new Date();
    const users = await User.find({ email: { $in: ['farhan@gmail.com', 'kaleem@gmail.com'] } });

    for (const u of users) {
      const empId = u._id;
      const [invoices, orders, targets] = await Promise.all([
        Invoice.find({ createdBy: empId }),
        SalesOrder.find({ salesPerson: empId }),
        SalesTarget.find({ employee: empId })
      ]);

      const unpaidInvoices = invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled');
      const invoiceReceivables = unpaidInvoices.reduce((sum, i) => {
        const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
        return sum + Math.max(0, outstanding);
      }, 0);

      const overdueInvoices = invoices.filter(i => (i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now)) && i.status !== 'Paid' && i.status !== 'Cancelled');
      const overdueInvoiceAmount = overdueInvoices.reduce((sum, i) => {
        const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
        return sum + Math.max(0, outstanding);
      }, 0);

      const salesAchieved = 8700000; // Farhan / calculated
      const activeTarget = targets[0];
      const monthlyTarget = activeTarget?.targetAmount || 1500000;
      const achievementPct = Math.round((activeTarget.achievedAmount / monthlyTarget) * 100);

      console.log(`\n=== Financial Check for ${u.fullName} ===`);
      console.log(`Receivables: Rs. ${invoiceReceivables.toLocaleString()}`);
      console.log(`Overdue Amount: Rs. ${overdueInvoiceAmount.toLocaleString()}`);
      console.log(`Target: Rs. ${monthlyTarget.toLocaleString()} | Achieved: Rs. ${activeTarget.achievedAmount.toLocaleString()} | Percentage: ${achievementPct}%`);
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

verifyFinancials();
