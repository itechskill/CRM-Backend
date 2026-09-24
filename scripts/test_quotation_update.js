const mongoose = require('mongoose');
require('dotenv').config();
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { logCategoryAEdit } = require('../utils/editPermissionHelper');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  const q = await Quotation.findOne({});
  const u = await User.findOne({ role: { $in: ['employee', 'sales_member', 'sales_manager'] } });
  console.log('Testing logCategoryAEdit with Quotation:', q?.orderReference || q?.quotationNumber, 'and User:', u?.fullName);
  await logCategoryAEdit({
    documentType: 'Quotation',
    documentId: q._id,
    documentNumber: q.orderReference || q.quotationNumber || 'Quotation',
    changedBy: u,
    changes: [{ field: 'notes', oldValue: 'test1', newValue: 'test2' }],
    reason: 'Direct Quotation edit by Sales Person'
  });
  console.log('logCategoryAEdit succeeded without error!');
  process.exit(0);
}

test().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
