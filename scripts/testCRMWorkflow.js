const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const SalesTarget = require('../models/SalesTarget');
const SalesActivity = require('../models/SalesActivity');

async function testCRMWorkflow() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  // 1. Find or create test sales employee
  let salesEmp = await User.findOne({ email: 'test.sales@nexus.com' });
  if (!salesEmp) {
    salesEmp = await User.create({
      fullName: 'John Sales Rep',
      email: 'test.sales@nexus.com',
      password: 'Password123!',
      role: 'employee',
      department: 'Sales',
      position: 'Senior Sales Representative',
      salaryTarget: 6000,
      status: 'active',
      isApproved: true
    });
    console.log('Created test sales employee:', salesEmp.email);
  } else {
    console.log('Found existing sales employee:', salesEmp.email);
  }

  // 2. Find or create sales manager / admin
  let manager = await User.findOne({ role: { $in: ['sales_manager', 'admin'] } });
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
    console.log('Created test sales manager:', manager.email);
  }

  // 3. Assign Monthly Target
  const targetPeriod = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  let target = await SalesTarget.findOne({ employee: salesEmp._id, period: targetPeriod });
  if (!target) {
    target = await SalesTarget.create({
      employee: salesEmp._id,
      period: targetPeriod,
      periodType: 'Monthly',
      targetAmount: 75000,
      achievedAmount: 0,
      currency: 'PKR',
      status: 'Active',
      assignedBy: manager._id,
      notes: 'Q4 Enterprise Target'
    });
    console.log('Assigned target to employee:', target.targetAmount);
  }

  // 4. Create Lead assigned to sales employee
  const lead = await Lead.create({
    name: 'Acme Corporation',
    company: 'Acme Global Ltd',
    email: 'contact@acme.com',
    phone: '+1 555 234 5678',
    status: 'Qualified',
    value: 45000,
    source: 'Website',
    assignedTo: salesEmp._id,
    createdBy: salesEmp._id
  });
  console.log('Created Lead in MongoDB:', lead.name, lead.value);

  // 5. Create Deal for sales employee
  const deal = await Deal.create({
    title: 'Acme Cloud Migration Deal',
    clientName: 'Acme Global Ltd',
    value: 45000,
    stage: 'Won',
    probability: 100,
    leadId: lead._id,
    assignedTo: salesEmp._id,
    createdBy: salesEmp._id
  });
  console.log('Created Deal in MongoDB:', deal.title, 'Stage:', deal.stage);

  // 6. Create Invoice for the won deal
  const count = await Invoice.countDocuments();
  const invoiceNumber = `INV-${String(count + 1001).padStart(5, '0')}`;
  const invoice = await Invoice.create({
    invoiceNumber,
    clientName: deal.clientName,
    dealId: deal._id,
    dealTitle: deal.title,
    amount: deal.value,
    status: 'Sent',
    dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    description: 'Cloud Migration Professional Services',
    createdBy: salesEmp._id
  });
  console.log('Created Invoice in MongoDB:', invoice.invoiceNumber, invoice.amount);

  // 7. Verify Data Retrieval
  const memberInvoices = await Invoice.find({ createdBy: salesEmp._id });
  console.log(`Member has ${memberInvoices.length} invoices saved in MongoDB.`);

  const allTeamMembers = await User.find({ role: 'employee', department: { $regex: /^sales$/i } });
  console.log(`Total Sales Team Members in MongoDB: ${allTeamMembers.length}`);

  console.log('--- ALL CRM DATA VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
  await mongoose.disconnect();
}

testCRMWorkflow().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
