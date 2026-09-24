const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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

async function cleanAllTestData() {
  console.log('Connecting to MongoDB Atlas...');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('Successfully connected to MongoDB Atlas');

    const db = mongoose.connection.db;

    // 1. Verify Ahmed Anjum user
    const ahmedUser = await db.collection('users').findOne({ email: AHMED_EMAIL });
    if (!ahmedUser) {
      console.warn('WARNING: Ahmed Anjum user not found with email:', AHMED_EMAIL);
    } else {
      console.log(`Ahmed Anjum user preserved: ${ahmedUser.fullName} (${ahmedUser.email}, ID: ${ahmedUser._id})`);
    }

    // 2. Remove unneeded test users, preserving system portal users
    const userCleanResult = await db.collection('users').deleteMany({
      email: { $nin: PRESERVED_EMAILS }
    });
    console.log(`Cleaned unneeded test user accounts: ${userCleanResult.deletedCount}`);

    // 3. Collections to completely clear of test data
    const collectionsToClear = [
      'quotations',
      'salesorders',
      'customerpos',
      'productfiles',
      'leads',
      'deals',
      'supplierpos',
      'purchasergrns',
      'localpayables',
      'deliverynotes',
      'invoices',
      'payments',
      'proformainvoices',
      'financialcharges',
      'maintenancecharges',
      'expenses',
      'shipments',
      'editpermissionrequests',
      'editauditlogs',
      'notifications',
      'salesactivities',
      'auditlogs',
      'followups',
      'inventoryitems',
      'salestargets'
    ];

    console.log('\n--- CLEARING TEST TRANSACTIONAL DATA ---');
    for (const colName of collectionsToClear) {
      try {
        const countBefore = await db.collection(colName).countDocuments();
        if (countBefore > 0) {
          const res = await db.collection(colName).deleteMany({});
          console.log(`Cleared ${colName}: Removed ${res.deletedCount} test records.`);
        } else {
          console.log(`${colName}: Already 0 records.`);
        }
      } catch (err) {
        console.log(`Note for ${colName}: ${err.message}`);
      }
    }

    // 4. Verify Ahmed Anjum user still intact
    const verifyAhmed = await db.collection('users').findOne({ email: AHMED_EMAIL });
    console.log(`\nFinal Verification of Ahmed Anjum Profile:`);
    console.log(`User: ${verifyAhmed.fullName} (${verifyAhmed.email})`);
    console.log(`Role: ${verifyAhmed.role}`);
    console.log(`Department: ${verifyAhmed.department}`);

    console.log('\n=============================================');
    console.log('ALL TEST DATA REMOVED. ALL STATS RESET TO ZERO.');
    console.log('AHMED ANJUM PROFILE PRESERVED 100% UNTOUCHED.');
    console.log('=============================================');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  }
}

cleanAllTestData();
