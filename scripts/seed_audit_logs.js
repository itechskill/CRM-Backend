const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const EditAuditLog = require('../models/EditAuditLog');

async function seedAuditLogs() {
  console.log('Seeding initial audit logs for CEO Edit History...');
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const ceoUser = await User.findOne({ role: 'ceo' });
    const arishUser = await User.findOne({ email: 'arish@fortline.net' });

    const ceoId = ceoUser ? ceoUser._id : new mongoose.Types.ObjectId();
    const arishId = arishUser ? arishUser._id : new mongoose.Types.ObjectId();

    await EditAuditLog.deleteMany({ documentNumber: { $regex: /^SO-AUDIT-/ } });

    await EditAuditLog.create({
      documentType: 'Sales Order',
      documentId: new mongoose.Types.ObjectId().toString(),
      documentNumber: 'SO-AUDIT-2026-01',
      editedByUserId: arishId,
      editedByName: arishUser ? arishUser.fullName : 'Arish Khan',
      editedByRole: 'sales_person',
      editedByDepartment: 'Sales',
      permissionType: 'CEO_APPROVED',
      changes: [
        { field: 'totalAmount', oldValue: 1850000, newValue: 1920000 },
        { field: 'deliveryStatus', oldValue: 'Pending', newValue: 'In Transit' }
      ],
      reason: 'CEO approved price adjustment for telemetry module',
      timestamp: new Date(Date.now() - 3600000)
    });

    await EditAuditLog.create({
      documentType: 'Quotation',
      documentId: new mongoose.Types.ObjectId().toString(),
      documentNumber: 'QT-AUDIT-2026-01',
      editedByUserId: arishId,
      editedByName: arishUser ? arishUser.fullName : 'Arish Khan',
      editedByRole: 'sales_person',
      editedByDepartment: 'Sales',
      permissionType: 'DIRECT_EDIT',
      changes: [
        { field: 'totalAmount', oldValue: 10, newValue: 15 }
      ],
      reason: 'Direct edit exception permitted for quotation',
      timestamp: new Date(Date.now() - 7200000)
    });

    console.log('✅ Audit log records created successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Audit log seed error:', err);
    process.exit(1);
  }
}

seedAuditLogs();
