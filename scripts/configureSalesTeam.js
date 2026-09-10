const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function configureSalesTeam() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    // 1. Set Farhan and Kaleem as the two Sales employees
    await User.updateOne(
      { email: 'farhan@gmail.com' },
      { $set: { fullName: 'Farhan', role: 'employee', department: 'Sales', position: 'Senior Sales Executive', status: 'active', isApproved: true } }
    );
    await User.updateOne(
      { email: 'kaleem@gmail.com' },
      { $set: { fullName: 'Kaleem', role: 'employee', department: 'Sales', position: 'Sales Representative', status: 'active', isApproved: true } }
    );

    // 2. Set non-sales employees to other departments
    await User.updateMany(
      { email: { $nin: ['farhan@gmail.com', 'kaleem@gmail.com'] }, role: 'employee' },
      { $set: { department: 'Operations' } }
    );

    // 3. Confirm active sales employees
    const salesEmployees = await User.find({ role: 'employee', department: /^sales$/i }).select('fullName email department role position status');
    console.log('Active Sales Team Members:', JSON.stringify(salesEmployees, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error configuring sales team:', err);
    process.exit(1);
  }
}

configureSalesTeam();
