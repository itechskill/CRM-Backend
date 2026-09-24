const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Quotation = require('../models/Quotation');

async function seedThreeUserQuotations() {
  console.log('Adding 3 dummy test quotations for Ahmed Anjum (quote@fortline.net)...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Find Ahmed Anjum user
    let salesUser = await User.findOne({ email: 'quote@fortline.net' });
    if (!salesUser) {
      salesUser = await User.findOne({ role: { $in: ['sales_person', 'sales_member', 'employee'] } });
    }

    if (!salesUser) {
      console.error('Sales person user not found!');
      process.exit(1);
    }

    console.log(`Assigned to Sales Person: ${salesUser.fullName} (${salesUser.email}) [ID: ${salesUser._id}]`);

    // Create Quotation 1 (PKR 10)
    const q1 = await Quotation.create({
      quotationNumber: `QT-WORKFLOW-10`,
      orderReference: `QT-WORKFLOW-10`,
      clientName: 'Workflow Test Client A',
      clientEmail: 'testa@workflow.com',
      clientPhone: '+923001111111',
      items: [
        { description: 'Workflow Test Item 10', quantity: 1, unitPrice: 10, total: 10 }
      ],
      totalAmount: 10,
      netAmount: 10,
      status: 'Quotation',
      notes: 'Test quotation for workflow testing (PKR 10)',
      createdBy: salesUser._id,
      salesPerson: salesUser._id,
      salePerson: salesUser.fullName
    });

    // Create Quotation 2 (PKR 20)
    const q2 = await Quotation.create({
      quotationNumber: `QT-WORKFLOW-20`,
      orderReference: `QT-WORKFLOW-20`,
      clientName: 'Workflow Test Client B',
      clientEmail: 'testb@workflow.com',
      clientPhone: '+923002222222',
      items: [
        { description: 'Workflow Test Item 20', quantity: 1, unitPrice: 20, total: 20 }
      ],
      totalAmount: 20,
      netAmount: 20,
      status: 'Quotation',
      notes: 'Test quotation for workflow testing (PKR 20)',
      createdBy: salesUser._id,
      salesPerson: salesUser._id,
      salePerson: salesUser.fullName
    });

    // Create Quotation 3 (PKR 30)
    const q3 = await Quotation.create({
      quotationNumber: `QT-WORKFLOW-30`,
      orderReference: `QT-WORKFLOW-30`,
      clientName: 'Workflow Test Client C',
      clientEmail: 'testc@workflow.com',
      clientPhone: '+923003333333',
      items: [
        { description: 'Workflow Test Item 30', quantity: 1, unitPrice: 30, total: 30 }
      ],
      totalAmount: 30,
      netAmount: 30,
      status: 'Quotation',
      notes: 'Test quotation for workflow testing (PKR 30)',
      createdBy: salesUser._id,
      salesPerson: salesUser._id,
      salePerson: salesUser.fullName
    });

    console.log('✅ Successfully created 3 quotations:');
    console.log(`1. ${q1.quotationNumber} - ${q1.clientName} - PKR ${q1.totalAmount}`);
    console.log(`2. ${q2.quotationNumber} - ${q2.clientName} - PKR ${q2.totalAmount}`);
    console.log(`3. ${q3.quotationNumber} - ${q3.clientName} - PKR ${q3.totalAmount}`);

    process.exit(0);
  } catch (err) {
    console.error('Error creating dummy quotations:', err);
    process.exit(1);
  }
}

seedThreeUserQuotations();
