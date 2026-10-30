const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const DeliveryNote = require('../models/DeliveryNote');
const SupplierPO = require('../models/SupplierPO');
const { moneyToCents } = require('./purchaseExpenses');

const VIRTUAL_OPENING_BATCH_ID = 'opening-stock';

const idString = value => String(value?._id || value || '');
const centsToMoney = cents => Math.round((Number(cents) || 0)) / 100;
const activeExpenseTotalCents = po => (po?.expenses || []).reduce((sum, expense) => (
  expense?.isDeleted ? sum : sum + (Number(expense?.amountPKRCents) || 0)
), 0);

const planFifoAllocation = (batches, requestedQuantity) => {
  let remaining = Number(requestedQuantity) || 0;
  if (remaining <= 0) return [];
  const ordered = [...(batches || [])].sort((a, b) => {
    const dateDiff = new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0);
    return dateDiff || idString(a._id).localeCompare(idString(b._id));
  });
  const allocations = [];
  for (const batch of ordered) {
    const available = Math.max(0, Number(batch.quantityRemaining) || 0);
    const quantity = Math.min(available, remaining);
    if (quantity > 0) allocations.push({ batchId: batch._id, quantity });
    remaining -= quantity;
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    const error = new Error(`Cost batches are short by ${remaining} unit(s).`);
    error.statusCode = 409;
    throw error;
  }
  return allocations;
};

const activeAllocatedQuantity = async (inventoryItemId, session) => {
  const rows = await DeliveryNote.aggregate([
    { $match: { status: { $nin: ['Cancelled', 'Returned'] }, isStockDeducted: { $ne: true }, batchAllocationsRestoredAt: null } },
    { $unwind: '$items' },
    { $match: { 'items.inventoryItem': new mongoose.Types.ObjectId(inventoryItemId) } },
    { $unwind: '$items.batchAllocations' },
    { $group: { _id: null, quantity: { $sum: '$items.batchAllocations.quantity' } } }
  ]).session(session || null);
  return Number(rows[0]?.quantity) || 0;
};

const unbatchedQuantity = async (item, session) => {
  const batchRemaining = (item.costBatches || []).reduce((sum, batch) => sum + (Number(batch.quantityRemaining) || 0), 0);
  const allocated = await activeAllocatedQuantity(item._id, session);
  return Math.max(0, (Number(item.quantityOnHand) || 0) - batchRemaining - allocated);
};

const materializeOpeningBatch = async (item, quantity, user, session) => {
  if (!(quantity > 0)) return item;
  item.costBatches.push({
    source: 'Opening stock',
    receivedAt: item.createdAt || new Date(0),
    quantityReceived: quantity,
    quantityRemaining: quantity,
    unitCostPKRCents: null,
    costStatus: 'not recorded',
    enteredBy: user?._id || null,
    enteredByName: user?.fullName || '',
    note: 'Virtual opening stock materialized for FIFO allocation.'
  });
  await item.save({ session });
  return item;
};

const allocateInventoryBatches = async ({ inventoryItemId, quantity, user, session }) => {
  let item = await InventoryItem.findById(inventoryItemId).session(session || null);
  if (!item) throw Object.assign(new Error('Inventory item not found for FIFO allocation.'), { statusCode: 404 });
  const openingQuantity = await unbatchedQuantity(item, session);
  if (openingQuantity > 0) item = await materializeOpeningBatch(item, openingQuantity, user, session);
  const allocations = planFifoAllocation(item.costBatches, quantity);
  for (const allocation of allocations) {
    const updated = await InventoryItem.updateOne(
      { _id: item._id, costBatches: { $elemMatch: { _id: allocation.batchId, quantityRemaining: { $gte: allocation.quantity } } } },
      { $inc: { 'costBatches.$.quantityRemaining': -allocation.quantity } },
      { session }
    );
    if (updated.modifiedCount !== 1) {
      throw Object.assign(new Error('Inventory cost batches changed while allocating. Please retry.'), { statusCode: 409 });
    }
  }
  return allocations.map(allocation => ({ batchId: allocation.batchId, quantity: allocation.quantity }));
};

const restoreDeliveryNoteBatches = async ({ deliveryNote, session }) => {
  if (!deliveryNote || deliveryNote.batchAllocationsRestoredAt) return false;
  for (const line of deliveryNote.items || []) {
    for (const allocation of line.batchAllocations || []) {
      await InventoryItem.updateOne(
        { _id: line.inventoryItem, 'costBatches._id': allocation.batchId },
        { $inc: { 'costBatches.$.quantityRemaining': Number(allocation.quantity) || 0 } },
        { session }
      );
    }
  }
  deliveryNote.batchAllocationsRestoredAt = new Date();
  await deliveryNote.save({ session });
  return true;
};

const basePOLineUnitCostCents = (po, line) => {
  if (!po || !line) return null;
  const currency = String(po.currency || 'PKR').toUpperCase();
  const rate = currency === 'PKR' ? 1 : Number(po.exchangeRateToPKR);
  if (!(rate > 0)) return null;
  return Math.round(moneyToCents(line.unitPrice) * rate);
};

const expensePerUnitCents = po => {
  if (!po || po.costingStatus !== 'Completed') return 0;
  const quantity = (po.items || []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  return quantity > 0 ? Math.round(activeExpenseTotalCents(po) / quantity) : 0;
};

const resolveBatchUnitCostCents = async (batch, poCache = new Map()) => {
  if (!batch) return null;
  if (!batch.supplierPO) return batch.costStatus === 'recorded' && Number.isSafeInteger(batch.unitCostPKRCents)
    ? batch.unitCostPKRCents
    : null;
  const key = idString(batch.supplierPO);
  let po = poCache.get(key);
  if (!po) {
    po = await SupplierPO.findById(batch.supplierPO).lean();
    poCache.set(key, po);
  }
  if (!po) return Number.isSafeInteger(batch.unitCostPKRCents) ? batch.unitCostPKRCents : null;
  const line = (po.items || []).find(candidate => idString(candidate._id) === idString(batch.supplierPOLineId));
  const base = basePOLineUnitCostCents(po, line);
  return base === null ? null : base + expensePerUnitCents(po);
};

const resolveStockInvoiceCost = async ({ invoice, order }) => {
  const results = await resolveStockInvoiceCosts({ invoices: [invoice], orders: order ? [order] : [] });
  return results.get(idString(invoice?._id)) || { cogsCents: null, issue: 'Cost not recorded', source: 'stock' };
};

const resolveStockInvoiceCosts = async ({ invoices = [], orders = [] }) => {
  const DeliveryNoteModel = require('../models/DeliveryNote');
  const orderMap = new Map((orders || []).map(order => [idString(order._id), order]));
  const explicitIds = invoices.map(invoice => invoice.deliveryNoteId).filter(Boolean);
  const invoiceIds = invoices.map(invoice => invoice._id).filter(Boolean);
  const orderIds = [...new Set(invoices.map(invoice => idString(invoice.salesOrderId)).filter(Boolean))];
  const or = [];
  if (explicitIds.length) or.push({ _id: { $in: explicitIds } });
  if (invoiceIds.length) or.push({ invoiceId: { $in: invoiceIds } });
  if (orderIds.length) or.push({ salesOrder: { $in: orderIds }, invoiced: true });
  const notes = or.length ? await DeliveryNoteModel.find({ $or: or }).lean() : [];
  if (!notes.length) {
    return new Map(invoices.map(invoice => [idString(invoice._id), {
      cogsCents: null,
      issue: 'Cost not recorded',
      source: 'stock'
    }]));
  }
  const itemIds = [...new Set(notes.flatMap(note => (note.items || []).map(line => idString(line.inventoryItem))).filter(Boolean))];
  const inventoryItems = await InventoryItem.find({ _id: { $in: itemIds } }).lean();
  const itemMap = new Map(inventoryItems.map(item => [idString(item._id), item]));
  const batchPOIds = [...new Set(inventoryItems.flatMap(item => (item.costBatches || []).map(batch => idString(batch.supplierPO))).filter(Boolean))];
  const batchPOs = batchPOIds.length ? await SupplierPO.find({ _id: { $in: batchPOIds } }).lean() : [];
  const poCache = new Map(batchPOs.map(po => [idString(po._id), po]));
  const results = new Map();
  for (const invoice of invoices) {
    const order = orderMap.get(idString(invoice.salesOrderId));
    let invoiceNotes = invoice.deliveryNoteId ? notes.filter(note => idString(note._id) === idString(invoice.deliveryNoteId)) : [];
    if (!invoiceNotes.length) invoiceNotes = notes.filter(note => idString(note.invoiceId) === idString(invoice._id));
    if (!invoiceNotes.length) invoiceNotes = notes.filter(note => idString(note.salesOrder) === idString(order?._id || invoice.salesOrderId) && note.invoiced === true);
    let cogsCents = 0;
    let hasAllocation = false;
    let missing = false;
    for (const note of invoiceNotes) {
      for (const line of note.items || []) {
        const item = itemMap.get(idString(line.inventoryItem));
        for (const allocation of line.batchAllocations || []) {
          hasAllocation = true;
          const batch = (item?.costBatches || []).find(candidate => idString(candidate._id) === idString(allocation.batchId));
          let unitCost = null;
          if (batch?.supplierPO) {
            const po = poCache.get(idString(batch.supplierPO));
            const poLine = (po?.items || []).find(candidate => idString(candidate._id) === idString(batch.supplierPOLineId));
            const base = basePOLineUnitCostCents(po, poLine);
            unitCost = base === null ? null : base + expensePerUnitCents(po);
          } else if (batch?.costStatus === 'recorded' && Number.isSafeInteger(batch.unitCostPKRCents)) {
            unitCost = batch.unitCostPKRCents;
          }
          if (unitCost === null) missing = true;
          else cogsCents += Math.round((Number(allocation.quantity) || 0) * unitCost);
        }
      }
    }
    results.set(idString(invoice._id), !hasAllocation || missing
      ? { cogsCents: null, issue: 'Cost not recorded', source: 'stock' }
      : { cogsCents, issue: '', source: 'stock' });
  }
  return results;
};

const virtualOpeningBatch = async (item, session) => {
  const quantity = await unbatchedQuantity(item, session);
  return quantity > 0 ? {
    _id: VIRTUAL_OPENING_BATCH_ID,
    source: 'Opening stock', receivedAt: item.createdAt, quantityReceived: quantity, quantityRemaining: quantity,
    unitCostPKRCents: null, costStatus: 'not recorded', note: 'Opening stock - cost not recorded', costHistory: []
  } : null;
};

module.exports = {
  VIRTUAL_OPENING_BATCH_ID,
  centsToMoney,
  planFifoAllocation,
  unbatchedQuantity,
  virtualOpeningBatch,
  materializeOpeningBatch,
  allocateInventoryBatches,
  restoreDeliveryNoteBatches,
  basePOLineUnitCostCents,
  expensePerUnitCents,
  resolveBatchUnitCostCents,
  resolveStockInvoiceCost,
  resolveStockInvoiceCosts
};
