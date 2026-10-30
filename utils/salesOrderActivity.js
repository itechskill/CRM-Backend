const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const DeliveryNote = require('../models/DeliveryNote');
const Shipment = require('../models/Shipment');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SalesActivity = require('../models/SalesActivity');
const { deriveOrderTrackerStage } = require('./orderTracker');

const id = value => String(value?._id || value || '');
const asDate = value => value ? new Date(value) : null;
const byOrder = (rows, orderId, fields) => rows.filter(row => fields.some(field => id(row[field]) === orderId));
const personName = value => value?.fullName || value?.name || value || '';

const event = ({ date, person, department, action, detail = '' }) => ({
  date: asDate(date), person: personName(person), department: department || '', action: action || '', detail: detail || ''
});

const buildRecentActivity = ({ order, supplierPOs, grns, deliveryNotes, shipments, invoices, payments, activities }) => {
  const rows = [];
  rows.push(event({
    date: order.orderDate || order.creationDate || order.createdAt,
    person: order.salesPerson || order.createdBy || order.salePerson,
    department: 'Sales', action: 'Sales Order created', detail: order.orderNumber || order.orderReference
  }));
  if (order.financeApprovedAt) rows.push(event({
    date: order.financeApprovedAt, person: order.financeApprovedByName || order.financeApprovedBy,
    department: 'Finance', action: 'Finance approved', detail: order.financeApprovalNotes || ''
  }));
  for (const history of order.workflowHistory || []) rows.push(event({
    date: history.timestamp, person: history.userName, department: history.department || order.currentDepartment,
    action: history.action || history.newStatus || 'Workflow updated',
    detail: history.notes || history.newStatus || history.previousStatus || ''
  }));
  for (const po of supplierPOs) {
    rows.push(event({ date: po.poDate || po.createdAt, person: po.createdByName || po.createdBy, department: po.poType === 'Global' ? 'Global Purchaser' : 'Local Purchaser', action: `${po.poType || 'Supplier'} PO issued`, detail: po.poNumber }));
    if (po.goodsReceiptRecordedAt || po.goodsReceiptDate) rows.push(event({ date: po.goodsReceiptRecordedAt || po.goodsReceiptDate, person: po.goodsReceiptRecordedBy, department: 'Local Purchaser', action: 'Supplier goods received', detail: po.goodsReceiptReference || '' }));
  }
  for (const shipment of shipments) rows.push(event({ date: shipment.updatedAt || shipment.createdAt, person: shipment.receivedInOfficeByName || shipment.createdBy, department: 'Logistics', action: shipment.status || 'Shipment updated', detail: shipment.remarks || shipment.description || '' }));
  for (const grn of grns) rows.push(event({ date: grn.dateReceived || grn.createdAt, person: grn.createdByName || grn.createdBy, department: 'Support', action: 'GRN / Inventory IN', detail: grn.grnNumber || '' }));
  for (const note of deliveryNotes) {
    rows.push(event({ date: note.createdAt, person: note.createdBy, department: 'Support', action: 'Delivery Note created', detail: `${note.deliveryNumber || note.deliveryNoteNumber || ''} ${note.status || ''}`.trim() }));
    if (note.deliveryDate) rows.push(event({ date: note.deliveryDate, person: note.receivedBy, department: 'Support', action: 'Delivery confirmed', detail: note.status || '' }));
  }
  for (const invoice of invoices) rows.push(event({ date: invoice.finalizedAt || invoice.createdAt, person: invoice.finalizedBy || invoice.createdBy, department: invoice.isDraft === false ? 'Finance' : 'Accounts', action: invoice.isDraft === false ? 'Invoice finalized' : 'Draft invoice created', detail: invoice.invoiceNumber || '' }));
  for (const payment of payments) rows.push(event({ date: payment.paymentDate || payment.createdAt, person: payment.createdBy, department: 'Finance', action: 'Payment received', detail: payment.receiptVoucherNumber || payment.paymentRefNumber || '' }));
  for (const activity of activities) rows.push(event({ date: activity.createdAt, person: activity.performedBy, department: 'Sales', action: activity.type || 'Sales activity', detail: activity.description || '' }));
  return rows.filter(row => row.date && !Number.isNaN(row.date.getTime()))
    .sort((a, b) => b.date - a.date)
    .slice(0, 10);
};

const loadSalesOrderWorkflow = async orders => {
  const plainOrders = (orders || []).map(order => typeof order?.toObject === 'function' ? order.toObject() : order);
  const orderIds = plainOrders.map(order => order._id).filter(Boolean);
  if (!orderIds.length) return new Map();
  const [supplierPOs, grns, deliveryNotes, shipments, invoices, payments, activities] = await Promise.all([
    SupplierPO.find({ salesOrderId: { $in: orderIds } }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    PurchaserGRN.find({ $or: [{ salesOrder: { $in: orderIds } }, { salesOrderId: { $in: orderIds } }] }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    DeliveryNote.find({ $or: [{ salesOrder: { $in: orderIds } }, { salesOrderId: { $in: orderIds } }] }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    Shipment.find({ salesOrder: { $in: orderIds } }).populate('createdBy receivedInOfficeBy', 'fullName').sort({ updatedAt: -1 }).lean(),
    Invoice.find({ salesOrderId: { $in: orderIds } }).populate('createdBy finalizedBy', 'fullName').sort({ createdAt: -1 }).lean(),
    Payment.find({ $or: [{ salesOrderId: { $in: orderIds } }, { 'allocations.salesOrderId': { $in: orderIds } }] }).populate('createdBy', 'fullName').sort({ paymentDate: -1 }).lean(),
    SalesActivity.find({ relatedId: { $in: orderIds } }).populate('performedBy', 'fullName').sort({ createdAt: -1 }).lean()
  ]);
  const result = new Map();
  for (const order of plainOrders) {
    const orderId = id(order);
    const pos = byOrder(supplierPOs, orderId, ['salesOrderId']);
    const orderGrns = byOrder(grns, orderId, ['salesOrder', 'salesOrderId']);
    const dns = byOrder(deliveryNotes, orderId, ['salesOrder', 'salesOrderId']);
    const orderShipments = byOrder(shipments, orderId, ['salesOrder']);
    const orderInvoices = byOrder(invoices, orderId, ['salesOrderId']);
    const orderPayments = payments.filter(payment => id(payment.salesOrderId) === orderId || (payment.allocations || []).some(allocation => id(allocation.salesOrderId) === orderId));
    const orderActivities = activities.filter(activity => id(activity.relatedId) === orderId);
    const stage = deriveOrderTrackerStage({ order, supplierPOs: pos, grns: orderGrns, deliveryNotes: dns, shipments: orderShipments, invoices: orderInvoices });
    const recentActivity = buildRecentActivity({ order, supplierPOs: pos, grns: orderGrns, deliveryNotes: dns, shipments: orderShipments, invoices: orderInvoices, payments: orderPayments, activities: orderActivities });
    const latest = recentActivity[0];
    result.set(orderId, {
      currentStatus: stage.stage,
      department: stage.department,
      stage: stage.stage,
      reason: stage.why,
      lastAction: latest?.action || order.lastAction || stage.why,
      lastActionBy: latest?.person || order.lastActionByName || '',
      lastActionAt: latest?.date || order.lastActionAt || order.updatedAt,
      recentActivity
    });
  }
  return result;
};

module.exports = { buildRecentActivity, loadSalesOrderWorkflow };
