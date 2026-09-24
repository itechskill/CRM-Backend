const mongoose = require('mongoose');
require('dotenv').config();

const AHMED_EMAIL = 'quote@fortline.net';
const PRESERVED_EMAILS = [
  'quote@fortline.net',
  'admin@yourcompany.com',
  'ceo@fortline.net',
  'manager@fortline.net',
  'arish@fortline.net',
  'support@fortline.net',
  'accounts@fortline.net',
  'finance@fortline.net',
  'logistics@fortline.net',
  'purchaser@fortline.net',
  'purchaser.global@fortline.com'
];

async function cleanDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    const db = mongoose.connection.db;

    // Find Ahmed Anjum user
    const ahmedUser = await db.collection('users').findOne({ email: AHMED_EMAIL });
    const ahmedId = ahmedUser ? ahmedUser._id : null;
    console.log(`Ahmed Anjum User Found: ${ahmedUser ? ahmedUser.fullName : 'NOT FOUND'} (${ahmedId})`);

    // Remove unneeded users, preserving key portal users
    const deleteUsersResult = await db.collection('users').deleteMany({
      email: { $nin: PRESERVED_EMAILS }
    });
    console.log(`Cleaned Users: Deleted ${deleteUsersResult.deletedCount} test user accounts.`);

    // Clear transactional collections, keeping Ahmed Anjum's legitimate records if any
    const transactionalCollections = [
      'leads', 'deals', 'quotations', 'salesorders', 'customerpos', 'productfiles',
      'supplierpos', 'purchasergrns', 'localpayables', 'deliverynotes', 'invoices',
      'payments', 'proformainvoices', 'expenses', 'maintenancecharges', 'financialcharges',
      'shipments', 'editpermissionrequests', 'editauditlogs', 'notifications', 'salesactivities'
    ];

    for (const colName of transactionalCollections) {
      try {
        const query = ahmedId ? {
          $and: [
            { createdBy: { $ne: ahmedId } },
            { salesPerson: { $ne: ahmedId } },
            { requestedByUserId: { $ne: ahmedId } }
          ]
        } : {};

        const res = await db.collection(colName).deleteMany(query);
        console.log(`Cleaned ${colName}: Deleted ${res.deletedCount} records.`);
      } catch (colErr) {
        console.log(`Skipped ${colName}: ${colErr.message}`);
      }
    }

    console.log('\n--- DATABASE CLEANUP COMPLETE ---');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup Error:', err);
    process.exit(1);
  }
}

cleanDatabase();
