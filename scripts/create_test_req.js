const mongoose = require('mongoose');
require('dotenv').config();
const EditPermissionRequest = require('../models/EditPermissionRequest');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');

async function createTestReq() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const salesUser = await User.findOne({ role: { $in: ['employee', 'sales_member', 'sales_manager'] } });
  const so8 = await SalesOrder.findOne({ $or: [{ orderReference: /0008/i }, { orderNumber: /0008/i }] });

  if (!salesUser) {
    console.log('Sales user not found!');
    process.exit(1);
  }
  if (!so8) {
    console.log('SO-0008 not found!');
    process.exit(1);
  }

  console.log('Found sales user:', salesUser.fullName || salesUser.name, 'ID:', salesUser._id);
  console.log('Found SO:', so8.orderReference || so8.orderNumber, 'ID:', so8._id);

  // Remove any old pending test requests for clean slate
  await EditPermissionRequest.deleteMany({ documentId: String(so8._id) });

  const newReq = await EditPermissionRequest.create({
    requestId: 'REQ-' + Date.now().toString().slice(-6),
    documentType: 'Sales Order',
    documentId: String(so8._id),
    documentNumber: so8.orderReference || so8.orderNumber || 'SO-0008',
    requestedByUserId: salesUser._id,
    requestedByName: salesUser.fullName || salesUser.name || 'Ahmed Anjum',
    requestedByRole: salesUser.role || 'employee',
    requestedByDepartment: salesUser.department || 'Sales',
    requestType: 'SpecificField',
    requestedFields: [
      {
        fieldName: 'totalAmount',
        label: 'Total Amount / Net Amount',
        currentValue: String(so8.totalAmount || so8.netAmount || '0'),
        requestedValue: String((Number(so8.totalAmount || so8.netAmount || 0) + 500))
      }
    ],
    reason: 'Client requested price adjustment and quantity update for Sales Order SO-0008.',
    currentDocumentStatus: so8.status || 'Sales Order',
    status: 'Pending'
  });

  console.log('Created test request successfully:');
  console.log(JSON.stringify(newReq, null, 2));

  process.exit(0);
}

createTestReq().catch(e => {
  console.error(e);
  process.exit(1);
});
