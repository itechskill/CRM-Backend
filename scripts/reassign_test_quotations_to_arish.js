const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Quotation = require('../models/Quotation');

async function reassignTestQuotationsToArish() {
  console.log('Reassigning test quotations to Arish (arish@fortline.net)...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // 1. Remove any test quotations from Ahmed Anjum (quote@fortline.net)
    const ahmedUser = await User.findOne({ email: 'quote@fortline.net' });
    if (ahmedUser) {
      await Quotation.deleteMany({ quotationNumber: { $regex: /^QT-WORKFLOW-/ } });
      console.log('Cleaned test quotations from quote@fortline.net.');
    }

    // 2. Find or create Arish user (arish@fortline.net)
    let arishUser = await User.findOne({ email: 'arish@fortline.net' });
    if (!arishUser) {
      console.log('User arish@fortline.net not found. Creating sales person account...');
      arishUser = await User.create({
        fullName: 'Arish Khan',
        email: 'arish@fortline.net',
        password: 'password123',
        role: 'sales_person',
        department: 'Sales',
        status: 'active'
      });
    }

    console.log(`Target Sales Person: ${arishUser.fullName} (${arishUser.email}) [ID: ${arishUser._id}]`);

    // 3. Create Quotation 1 (PKR 10) for Arish
    const q1 = await Quotation.create({
      quotationNumber: 'QT-WORKFLOW-10',
      orderReference: 'QT-WORKFLOW-10',
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
      createdBy: arishUser._id,
      salesPerson: arishUser._id,
      salePerson: arishUser.fullName
    });

    // 4. Create Quotation 2 (PKR 20) for Arish
    const q2 = await Quotation.create({
      quotationNumber: 'QT-WORKFLOW-20',
      orderReference: 'QT-WORKFLOW-20',
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
      createdBy: arishUser._id,
      salesPerson: arishUser._id,
      salePerson: arishUser.fullName
    });

    // 5. Create Quotation 3 (PKR 30) for Arish
    const q3 = await Quotation.create({
      quotationNumber: 'QT-WORKFLOW-30',
      orderReference: 'QT-WORKFLOW-30',
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
      createdBy: arishUser._id,
      salesPerson: arishUser._id,
      salePerson: arishUser.fullName
    });

    console.log('\n✅ Successfully assigned 3 test quotations to Arish (arish@fortline.net):');
    console.log(`1. ${q1.quotationNumber} - ${q1.clientName} - PKR ${q1.totalAmount}`);
    console.log(`2. ${q2.quotationNumber} - ${q2.clientName} - PKR ${q2.totalAmount}`);
    console.log(`3. ${q3.quotationNumber} - ${q3.clientName} - PKR ${q3.totalAmount}`);

    process.exit(0);
  } catch (err) {
    console.error('Error reassigning test quotations:', err);
    process.exit(1);
  }
}

reassignTestQuotationsToArish();
