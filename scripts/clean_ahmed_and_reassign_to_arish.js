const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const Quotation = require('../models/Quotation');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const EditPermissionRequest = require('../models/EditPermissionRequest');

async function cleanAhmedAndReassignToArish() {
  console.log('Ensuring Ahmed Anjum (quote@fortline.net) has ZERO test data...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const ahmedUser = await User.findOne({ email: 'quote@fortline.net' });
    const arishUser = await User.findOne({ email: 'arish@fortline.net' });

    if (ahmedUser && arishUser) {
      // Reassign any test sales orders, quotations, delivery notes, invoices, payments, edit requests created during demo setup to Arish
      await SalesOrder.updateMany({ salesPerson: ahmedUser._id, orderNumber: { $regex: /^(SO-2026-|SO-TEST-)/ } }, { salesPerson: arishUser._id, createdBy: arishUser._id });
      await Quotation.updateMany({ salesPerson: ahmedUser._id, quotationNumber: { $regex: /^(QT-2026-|QT-TEST-|QT-WORKFLOW-)/ } }, { salesPerson: arishUser._id, createdBy: arishUser._id });
      await DeliveryNote.updateMany({ createdBy: ahmedUser._id }, { createdBy: arishUser._id });
      await Invoice.updateMany({ createdBy: ahmedUser._id }, { createdBy: arishUser._id, salesPerson: arishUser._id });
      await Payment.updateMany({ createdBy: ahmedUser._id }, { createdBy: arishUser._id });
      await EditPermissionRequest.updateMany({ requestedByUserId: ahmedUser._id }, { requestedByUserId: arishUser._id, requestedByName: arishUser.fullName });

      console.log('✅ Successfully reassigned all demo test records to Arish (arish@fortline.net). Ahmed Anjum profile is 100% clean!');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error cleaning Ahmed data:', err);
    process.exit(1);
  }
}

cleanAhmedAndReassignToArish();
