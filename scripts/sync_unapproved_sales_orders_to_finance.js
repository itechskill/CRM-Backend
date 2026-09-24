const mongoose = require('mongoose');
require('dotenv').config();

const SalesOrder = require('../models/SalesOrder');

async function syncUnapprovedOrdersToFinance() {
  console.log('Syncing all unapproved Sales Orders to Finance Approval queue...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const result = await SalesOrder.updateMany(
      {
        financeApprovedBy: null,
        status: { $nin: ['Finance Approved', 'Rejected', 'Sales Order Rejected due to overdue amount', 'Delivered', 'Completed', 'Done', 'Paid'] }
      },
      {
        $set: {
          status: 'Pending Finance Approval',
          workflowStatus: 'Pending Finance Overdue Check',
          departmentResponsible: 'Finance',
          requiresFinanceApproval: true
        }
      }
    );

    console.log(`✅ Successfully synced ${result.modifiedCount} sales orders to Finance approval list.`);
    process.exit(0);
  } catch (err) {
    console.error('Sync error:', err);
    process.exit(1);
  }
}

syncUnapprovedOrdersToFinance();
