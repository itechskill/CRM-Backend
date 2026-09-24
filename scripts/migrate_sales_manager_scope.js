const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function migrate() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB Atlas');

  const lhrManager = await User.findOne({ email: 'waseembhatti.managerlhr@fortline.net' });
  if (lhrManager) {
    lhrManager.branch = 'Lahore';
    lhrManager.city = 'Lahore';
    await lhrManager.save();
    console.log(`Updated LHR Manager: ${lhrManager.fullName} (Branch: ${lhrManager.branch})`);

    const lhrSalesPerson = await User.findOne({ email: 'sulemanbhatti.saleslhr@fortline.net' });
    if (lhrSalesPerson) {
      lhrSalesPerson.branch = 'Lahore';
      lhrSalesPerson.city = 'Lahore';
      lhrSalesPerson.manager = lhrManager._id;
      lhrSalesPerson.createdBy = lhrManager._id;
      await lhrSalesPerson.save();
      console.log(`Updated LHR Sales Person: ${lhrSalesPerson.fullName} -> Linked to manager ${lhrManager.fullName}`);
    }
  }

  // Also check any other sales managers or sales persons by email pattern
  const allUsers = await User.find({ role: { $in: ['sales_manager', 'sales_person', 'sales_rep', 'sales_member'] } });
  for (const u of allUsers) {
    const email = u.email.toLowerCase();
    let detectedBranch = '';
    if (email.includes('isb') || email.includes('islamabad')) detectedBranch = 'Islamabad';
    else if (email.includes('khi') || email.includes('karachi')) detectedBranch = 'Karachi';
    else if (email.includes('lhr') || email.includes('lahore')) detectedBranch = 'Lahore';

    if (detectedBranch && !u.branch) {
      u.branch = detectedBranch;
      u.city = detectedBranch;
      await u.save();
      console.log(`Inferred branch for ${u.fullName} (${u.email}) -> ${detectedBranch}`);
    }
  }

  console.log('Migration completed successfully.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
