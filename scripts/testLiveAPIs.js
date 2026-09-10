const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
dotenv.config();

const User = require('../models/User');

async function testAPIs() {
  await mongoose.connect(process.env.MONGODB_URI);
  let salesEmp = await User.findOne({ department: { $regex: /^sales$/i } });
  if (!salesEmp) {
    salesEmp = await User.create({
      fullName: 'John Sales Rep',
      email: 'john.sales@nexus.com',
      password: 'Password123!',
      role: 'employee',
      department: 'Sales',
      position: 'Senior Sales Representative',
      salaryTarget: 6000,
      status: 'active',
      isApproved: true
    });
  }
  let manager = await User.findOne({ role: 'sales_manager' });
  if (!manager) {
    manager = await User.findOne({ role: 'admin' });
  }
  if (!manager) {
    manager = await User.create({
      fullName: 'Sarah Sales Manager',
      email: 'manager.sales@nexus.com',
      password: 'Password123!',
      role: 'sales_manager',
      department: 'Sales',
      position: 'Head of Sales',
      status: 'active',
      isApproved: true
    });
  }

  const empToken = jwt.sign({ id: salesEmp._id, role: salesEmp.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const mgrToken = jwt.sign({ id: manager._id, role: manager.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

  console.log('Generated JWT tokens for Sales Employee and Sales Manager.');

  // Test /api/sales-employee/stats
  const res1 = await fetch('http://localhost:5000/api/sales-employee/stats', {
    headers: { Authorization: `Bearer ${empToken}` }
  });
  const data1 = await res1.json();
  console.log('/api/sales-employee/stats response status:', res1.status, 'success:', data1.success);
  console.log('Sales Performance:', data1.data?.salesPerformance);
  console.log('Financial Performance:', data1.data?.financialPerformance);

  // Test /api/sales-manager/dashboard-stats
  const res2 = await fetch('http://localhost:5000/api/sales-manager/dashboard-stats', {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const data2 = await res2.json();
  console.log('--- DASHBOARD STATS METRICS ---');
  console.log('Total Orders:', data2.data?.totalOrders);
  console.log('Total Monthly Revenue:', data2.data?.totalMonthlyRevenue);
  console.log('Total Receivables:', data2.data?.totalReceivables);
  console.log('Overdue Invoice Amount:', data2.data?.overdueInvoiceAmount);
  console.log('Team Target Attainment (%):', data2.data?.teamTargetAchievementPct);

  // Test /api/sales-manager/team-members
  const res3 = await fetch('http://localhost:5000/api/sales-manager/team-members', {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const data3 = await res3.json();
  console.log('/api/sales-manager/team-members response status:', res3.status, 'count:', data3.count);

  await mongoose.disconnect();
}

testAPIs().catch(e => {
  console.error('API test failed:', e);
  process.exit(1);
});
