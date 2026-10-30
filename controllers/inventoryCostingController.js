const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const User = require('../models/User');
const Notification = require('../models/Notification');
const {
  VIRTUAL_OPENING_BATCH_ID,
  virtualOpeningBatch,
  materializeOpeningBatch,
  resolveBatchUnitCostCents
} = require('../utils/inventoryCosting');

const inventoryCostReaders = ['finance', 'admin', 'ceo', 'accountant'];
const inventoryCostEditors = ['finance', 'admin'];

const getInventoryCosting = async (req, res) => {
  try {
    const items = await InventoryItem.find({}).sort({ name: 1 });
    const poCache = new Map();
    const data = [];
    for (const item of items) {
      const virtual = await virtualOpeningBatch(item);
      const batches = [...(item.costBatches || []).map(batch => batch.toObject()), ...(virtual ? [virtual] : [])];
      const resolvedBatches = [];
      for (const batch of batches) {
        const liveUnitCostPKRCents = await resolveBatchUnitCostCents(batch, poCache);
        resolvedBatches.push({
          ...batch,
          liveUnitCostPKRCents,
          costStatus: liveUnitCostPKRCents === null ? 'not recorded' : 'recorded'
        });
      }
      data.push({
        _id: item._id,
        name: item.name,
        sku: item.sku || '',
        partNumber: item.partNumber || '',
        quantityOnHand: item.quantityOnHand || 0,
        reservedQuantity: item.reservedQuantity || 0,
        batches: resolvedBatches
      });
    }
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('[Inventory Costing List Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading inventory costing.' });
  }
};

const notifyAdmins = async ({ item, batch, user, oldCost, newCost, reason }) => {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
  if (!admins.length) return;
  await Notification.insertMany(admins.map(admin => ({
    recipient: admin._id,
    sender: user._id,
    title: oldCost === null ? 'Inventory batch cost recorded' : 'Inventory batch cost changed',
    message: `${item.name}${item.partNumber ? ` / ${item.partNumber}` : ''}: PKR ${oldCost === null ? 'not recorded' : (oldCost / 100).toLocaleString()} -> PKR ${(newCost / 100).toLocaleString()} by ${user.fullName || user.role}.`,
    type: 'system',
    link: '/admin/inventory-costing',
    data: { inventoryItemId: item._id, batchId: batch._id, oldUnitCostPKRCents: oldCost, newUnitCostPKRCents: newCost, reason },
    isRead: false
  })));
};

const setInventoryBatchCost = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (!inventoryCostEditors.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only Finance or Admin can set an inventory batch cost.' });
    const money = Number(req.body.unitCostPKR);
    if (!Number.isFinite(money) || money < 0) return res.status(400).json({ success: false, message: 'Unit cost must be a valid PKR amount.' });
    const newCost = Math.round(money * 100);
    const reason = String(req.body.reason || req.body.note || '').trim();
    let output;
    await session.withTransaction(async () => {
      let item = await InventoryItem.findById(req.params.itemId).session(session);
      if (!item) throw Object.assign(new Error('Inventory item not found.'), { statusCode: 404 });
      if (req.params.batchId === VIRTUAL_OPENING_BATCH_ID) {
        const virtual = await virtualOpeningBatch(item, session);
        if (!virtual) throw Object.assign(new Error('Opening stock batch no longer exists. Refresh and try again.'), { statusCode: 409 });
        item = await materializeOpeningBatch(item, virtual.quantityRemaining, req.user, session);
        req.params.batchId = String(item.costBatches[item.costBatches.length - 1]._id);
      }
      const batch = item.costBatches.id(req.params.batchId);
      if (!batch) throw Object.assign(new Error('Inventory cost batch not found.'), { statusCode: 404 });
      const oldCost = Number.isSafeInteger(batch.unitCostPKRCents) ? batch.unitCostPKRCents : null;
      if (oldCost !== null && req.user.role !== 'admin') {
        throw Object.assign(new Error('Only Admin can change a recorded inventory cost.'), { statusCode: 403 });
      }
      if (oldCost !== null && !reason) {
        throw Object.assign(new Error('A reason is required when changing a recorded inventory cost.'), { statusCode: 400 });
      }
      batch.unitCostPKRCents = newCost;
      batch.costStatus = 'recorded';
      batch.note = String(req.body.note || batch.note || '').trim();
      batch.costHistory.push({
        changedBy: req.user._id,
        changedByName: req.user.fullName || '',
        changedAt: new Date(),
        oldUnitCostPKRCents: oldCost,
        newUnitCostPKRCents: newCost,
        reason
      });
      await item.save({ session });
      output = { item, batch: batch.toObject(), oldCost, newCost, reason };
    });
    await notifyAdmins({ ...output, user: req.user });
    return res.json({ success: true, message: output.oldCost === null ? 'Inventory batch cost recorded.' : 'Inventory batch cost changed.', data: output.batch });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error updating inventory batch cost.' });
  } finally {
    await session.endSession();
  }
};

module.exports = { inventoryCostReaders, getInventoryCosting, setInventoryBatchCost };
