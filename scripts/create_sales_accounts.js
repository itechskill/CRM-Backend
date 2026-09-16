const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const SalesTarget = require('../models/SalesTarget');

async function createAccounts() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI found');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // 1. Create or Update Sales Representative (Full Access)
  let rep = await User.findOne({ email: 'tariq.rep@fortline.net' });
  if (rep) {
    rep.fullName = 'Tariq Mahmood';
    rep.role = 'sales_rep';
    rep.position = 'Sales Representative';
    rep.department = 'Sales';
    rep.status = 'active';
    rep.isApproved = true;
    rep.password = 'Password123!';
    await rep.save();
    console.log('Updated existing Sales Representative:', rep.email);
  } else {
    rep = await User.create({
      fullName: 'Tariq Mahmood',
      email: 'tariq.rep@fortline.net',
      password: 'Password123!',
      role: 'sales_rep',
      position: 'Sales Representative',
      department: 'Sales',
      phone: '+92 301 9876543',
      salaryTarget: 750000,
      status: 'active',
      isApproved: true
    });
    console.log('Created new Sales Representative:', rep.email);
  }

  // Create active target for Sales Rep
  await SalesTarget.findOneAndUpdate(
    { employee: rep._id, status: 'Active' },
    {
      employee: rep._id,
      targetAmount: 750000,
      period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      periodType: 'Monthly',
      currency: 'PKR',
      status: 'Active',
      startDate: new Date(),
      endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    },
    { upsert: true, new: true }
  );

  // 2. Create or Update Sales Person (Access till Sales Orders)
  let person = await User.findOne({ email: 'zain.sales@fortline.net' });
  if (person) {
    person.fullName = 'Zain Malik';
    person.role = 'sales_person';
    person.position = 'Sales Person';
    person.department = 'Sales';
    person.status = 'active';
    person.isApproved = true;
    person.password = 'Password123!';
    await person.save();
    console.log('Updated existing Sales Person:', person.email);
  } else {
    person = await User.create({
      fullName: 'Zain Malik',
      email: 'zain.sales@fortline.net',
      password: 'Password123!',
      role: 'sales_person',
      position: 'Sales Person',
      department: 'Sales',
      phone: '+92 302 1234567',
      salaryTarget: 450000,
      status: 'active',
      isApproved: true
    });
    console.log('Created new Sales Person:', person.email);
  }

  // Create active target for Sales Person
  await SalesTarget.findOneAndUpdate(
    { employee: person._id, status: 'Active' },
    {
      employee: person._id,
      targetAmount: 450000,
      period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      periodType: 'Monthly',
      currency: 'PKR',
      status: 'Active',
      startDate: new Date(),
      endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
    },
    { upsert: true, new: true }
  );

  console.log('\n--- ACCOUNTS CREATED & VERIFIED ---');
  console.log('1. Sales Representative (Full Access): tariq.rep@fortline.net / Password123!');
  console.log('2. Sales Person (Till Sales Orders): zain.sales@fortline.net / Password123!');
  
  await mongoose.disconnect();
}

createAccounts().catch(console.error);
