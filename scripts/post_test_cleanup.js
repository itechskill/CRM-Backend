const mongoose = require('mongoose');
require('dotenv').config();

const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const FinancialCharge = require('../models/FinancialCharge');
const EditPermissionRequest = require('../models/EditPermissionRequest');
const EditAuditLog = require('../models/EditAuditLog');
const InventoryItem = require('../models/InventoryItem');

async function cleanTestRecords() {
  console.log('Cleaning up master test suite records...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    await SalesOrder.deleteMany({ orderNumber: { $regex: /^SO-TEST-/ } });
    await DeliveryNote.deleteMany({ deliveryNoteNumber: { $regex: /^DN-TEST-/ } });
    await Invoice.deleteMany({ invoiceNumber: { $regex: /^INV-OVD-/ } });
    await SupplierPO.deleteMany({ poNumber: { $regex: /^PO-/ } });
    await PurchaserGRN.deleteMany({ grnNumber: { $regex: /^GRN-BLUE-/ } });
    await LocalPayable.deleteMany({ payableNumber: { $regex: /^PAYABLE-SHORT-/ } });
    await FinancialCharge.deleteMany({ chargeNumber: { $regex: /^FC-OVD-/ } });
    await EditPermissionRequest.deleteMany({ requestId: { $regex: /^REQ-TEST-/ } });
    await InventoryItem.deleteMany({ name: 'Industrial Valve FX-100' });

    console.log('✅ Post-test cleanup complete. Database is clean and ready for production use.');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup error:', err);
    process.exit(1);
  }
}

cleanTestRecords();
