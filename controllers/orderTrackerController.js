const Quotation = require('../models/Quotation');
const PriceRequest = require('../models/PriceRequest');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const DeliveryNote = require('../models/DeliveryNote');
const Shipment = require('../models/Shipment');
const SupportTicket = require('../models/SupportTicket');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const InventoryItem = require('../models/InventoryItem');
const SalesActivity = require('../models/SalesActivity');
const { deriveOrderTrackerStage, sanitizeTrackerData } = require('../utils/orderTracker');
const { resolveDocumentsPartNumbers } = require('../utils/documentPartNumbers');

const id = value => String(value?._id || value || '');
const dateValue = value => value ? new Date(value).getTime() : 0;
const escaped = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const relatedToOrders = (rows, fields, orderIds) => rows.filter(row => fields.some(field => orderIds.has(id(row[field]))));

const loadOrderRelations = async orders => {
  const orderIds = new Set(orders.map(order => id(order)));
  const [supplierPOs, grns, deliveryNotes, shipments, invoices, payments, quotations, customerPOs, productFiles, activities] = await Promise.all([
    SupplierPO.find({ salesOrderId: { $in: [...orderIds] } }).populate('supplier', 'name').populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    PurchaserGRN.find({ salesOrder: { $in: [...orderIds] } }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    DeliveryNote.find({ $or: [{ salesOrder: { $in: [...orderIds] } }, { salesOrderId: { $in: [...orderIds] } }] }).populate('createdBy', 'fullName').sort({ createdAt: -1 }).lean(),
    Shipment.find({ salesOrder: { $in: [...orderIds] } }).populate('createdBy receivedInOfficeBy', 'fullName').sort({ updatedAt: -1 }).lean(),
    Invoice.find({ salesOrderId: { $in: [...orderIds] } }).populate('createdBy reviewedBy finalizedBy', 'fullName').sort({ createdAt: -1 }).lean(),
    Payment.find({ $or: [{ salesOrderId: { $in: [...orderIds] } }, { 'allocations.salesOrderId': { $in: [...orderIds] } }] }).populate('createdBy', 'fullName').sort({ paymentDate: -1 }).lean(),
    Quotation.find({ _id: { $in: orders.map(order => order.quotationId).filter(Boolean) } }).populate('createdBy owner', 'fullName').lean(),
    CustomerPO.find({ _id: { $in: orders.map(order => order.customerPOId).filter(Boolean) } }).populate('createdBy owner', 'fullName').lean(),
    ProductFile.find({ _id: { $in: orders.map(order => order.productFileId).filter(Boolean) } }).populate('createdBy owner', 'fullName').lean(),
    SalesActivity.find({ relatedId: { $in: [...orderIds] } }).populate('performedBy', 'fullName').sort({ createdAt: -1 }).lean()
  ]);
  return { supplierPOs, grns, deliveryNotes, shipments, invoices, payments, quotations, customerPOs, productFiles, activities };
};

const rowsFor = (rows, order, fields) => rows.filter(row => fields.some(field => id(row[field]) === id(order)));

const timelineEvent = (stage, record, date, person, department, detail, documentType = '') => ({
  stage, date, person: person?.fullName || person || '', department, detail, documentType,
  documentId: record?._id || null, record: documentType ? record : undefined
});

const buildTimeline = (order, relations) => {
  const quotation = relations.quotations.find(row => id(row) === id(order.quotationId));
  const customerPO = relations.customerPOs.find(row => id(row) === id(order.customerPOId));
  const productFile = relations.productFiles.find(row => id(row) === id(order.productFileId));
  const pos = rowsFor(relations.supplierPOs, order, ['salesOrderId']);
  const grns = rowsFor(relations.grns, order, ['salesOrder', 'salesOrderId']);
  const dns = rowsFor(relations.deliveryNotes, order, ['salesOrder', 'salesOrderId']);
  const shipments = rowsFor(relations.shipments, order, ['salesOrder']);
  const invoices = rowsFor(relations.invoices, order, ['salesOrderId']);
  const payments = [...new Map(
    rowsFor(relations.payments, order, ['salesOrderId'])
      .concat(relations.payments.filter(payment => (payment.allocations || []).some(row => id(row.salesOrderId) === id(order))))
      .map(payment => [id(payment), payment])
  ).values()];
  const events = [];
  if (quotation) events.push(timelineEvent('Quotation', quotation, quotation.creationDate || quotation.createdAt, quotation.createdBy, 'Sales', quotation.quotationNumber || quotation.orderReference, 'quotation'));
  if (customerPO) events.push(timelineEvent('Customer PO', customerPO, customerPO.createdAt, customerPO.createdBy, 'Sales', customerPO.poNumber, 'customer-po'));
  if (productFile) events.push(timelineEvent('Product File', productFile, productFile.createdAt, productFile.createdBy, 'Sales', productFile.fileNumber, 'product-file'));
  events.push(timelineEvent('Sales Order', order, order.orderDate || order.creationDate || order.createdAt, order.salesPerson || order.createdBy, 'Sales', order.orderNumber || order.orderReference, 'sales-order'));
  if (order.financeApprovedAt) events.push(timelineEvent('Finance Approval', order, order.financeApprovedAt, order.financeApprovedByName, 'Finance', order.financeApprovalNotes || 'Approved'));
  for (const po of pos) {
    events.push(timelineEvent(`${po.poType || 'Supplier'} PO`, po, po.poDate || po.createdAt, po.createdByName || po.createdBy, po.poType === 'Global' ? 'Global Purchaser' : 'Local Purchaser', po.poNumber, 'supplier-po'));
    if (po.goodsReceiptRecordedAt || po.goodsReceiptDate) events.push(timelineEvent('Supplier Goods Received', po, po.goodsReceiptRecordedAt || po.goodsReceiptDate, po.goodsReceiptRecordedBy, 'Local Purchaser', po.goodsReceiptReference || 'Receipt recorded'));
  }
  for (const shipment of shipments) {
    events.push(timelineEvent('Shipment', shipment, shipment.updatedAt || shipment.createdAt, shipment.receivedInOfficeByName || shipment.createdBy, 'Logistics', `${shipment.status || 'Shipment'}${shipment.remarks ? ` - ${shipment.remarks}` : ''}`, 'shipment'));
  }
  for (const grn of grns) events.push(timelineEvent('GRN / Inventory IN', grn, grn.dateReceived || grn.createdAt, grn.createdByName || grn.createdBy, 'Support', grn.grnNumber, 'grn'));
  for (const dn of dns) {
    events.push(timelineEvent('Delivery Note', dn, dn.createdAt, dn.createdBy, 'Support', `${dn.deliveryNumber || dn.deliveryNoteNumber} - ${dn.status || 'Created'}`, 'delivery-note'));
    if (dn.deliveryDate && ['Confirmed', 'Delivered', 'Fully Delivered'].includes(dn.status)) events.push(timelineEvent('Delivery Confirmed', dn, dn.deliveryDate, dn.receivedBy, 'Support', dn.status));
  }
  for (const invoice of invoices) events.push(timelineEvent(invoice.isDraft === false ? 'Final Invoice' : 'Draft Invoice', invoice, invoice.finalizedAt || invoice.createdAt, invoice.finalizedBy || invoice.createdBy, invoice.isDraft === false ? 'Finance' : 'Accounts', `${invoice.invoiceNumber} - ${invoice.status}`, 'invoice'));
  for (const payment of payments) events.push(timelineEvent('Payment', payment, payment.paymentDate || payment.createdAt, payment.createdBy, 'Finance', `${payment.receiptVoucherNumber || payment.paymentRefNumber || 'Payment'} - ${payment.amount}`, 'payment'));
  for (const history of order.workflowHistory || []) {
    events.push(timelineEvent(
      history.action || history.newStatus || 'Workflow update',
      history,
      history.timestamp,
      history.userName,
      history.department || order.currentDepartment,
      history.notes || [history.previousStatus, history.newStatus].filter(Boolean).join(' → ')
    ));
  }
  for (const activity of relations.activities.filter(row => id(row.relatedId) === id(order))) events.push(timelineEvent(activity.type, activity, activity.createdAt, activity.performedBy, 'Sales', activity.description));
  return events.filter(event => event.date).sort((a, b) => dateValue(a.date) - dateValue(b.date));
};

const buildOrderRow = (order, relations) => {
  const supplierPOs = rowsFor(relations.supplierPOs, order, ['salesOrderId']);
  const grns = rowsFor(relations.grns, order, ['salesOrder', 'salesOrderId']);
  const deliveryNotes = rowsFor(relations.deliveryNotes, order, ['salesOrder', 'salesOrderId']);
  const shipments = rowsFor(relations.shipments, order, ['salesOrder']);
  const invoices = rowsFor(relations.invoices, order, ['salesOrderId']);
  const stage = deriveOrderTrackerStage({ order, supplierPOs, grns, deliveryNotes, shipments, invoices });
  const timeline = buildTimeline(order, relations);
  const latest = timeline[timeline.length - 1];
  const quotation = relations.quotations.find(row => id(row) === id(order.quotationId));
  const customerPO = relations.customerPOs.find(row => id(row) === id(order.customerPOId));
  const productFile = relations.productFiles.find(row => id(row) === id(order.productFileId));
  return {
    _id: order._id,
    orderNumber: order.orderNumber || order.orderReference,
    fileNumber: order.fileNo || order.fileNumber || productFile?.fileNumber || '',
    quotationNumber: quotation?.quotationNumber || order.quotationNumber || '',
    customerPONumber: customerPO?.poNumber || order.customerPONumber || '',
    customer: order.clientName || order.customerName || '',
    salesperson: order.salesPerson?.fullName || order.owner?.fullName || order.salePerson || '',
    currentDepartment: stage.department,
    currentStage: stage.stage,
    why: stage.why,
    lastUpdate: latest ? { what: latest.stage, when: latest.date, by: latest.person } : { what: order.lastAction || order.status, when: order.updatedAt, by: '' },
    payment: stage.payment,
    amount: order.netAmount || order.totalAmount || 0,
    status: order.status,
    workflowStatus: order.workflowStatus
  };
};

const listOrders = async (req, res) => {
  try {
    const orders = await SalesOrder.find({})
      .populate('salesPerson owner createdBy financeApprovedBy', 'fullName role department')
      .sort({ updatedAt: -1 }).lean();
    const relations = await loadOrderRelations(orders);
    let data = orders.map(order => buildOrderRow(order, relations));
    const search = String(req.query.search || '').trim();
    if (search) {
      const matcher = new RegExp(escaped(search), 'i');
      data = data.filter(row => [row.orderNumber, row.fileNumber, row.customer, row.quotationNumber, row.customerPONumber].some(value => matcher.test(String(value || ''))));
    }
    return res.status(200).json({ success: true, count: data.length, data: sanitizeTrackerData(data) });
  } catch (error) {
    console.error('[Order Tracker List Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading the order tracker.' });
  }
};

const getOrderDetail = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id)
      .populate('salesPerson owner createdBy financeApprovedBy', 'fullName role department').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    const relations = await loadOrderRelations([order]);
    const resolvedOrder = (await resolveDocumentsPartNumbers([order], 'sales-order'))[0];
    const timeline = buildTimeline(resolvedOrder, relations);
    return res.status(200).json({
      success: true,
      data: sanitizeTrackerData({ summary: buildOrderRow(resolvedOrder, relations), order: resolvedOrder, timeline })
    });
  } catch (error) {
    console.error('[Order Tracker Detail Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading order workflow detail.' });
  }
};

const RECORD_TYPES = {
  quotations: { model: Quotation, sort: { createdAt: -1 }, partType: 'quotation' },
  'price-requests': { model: PriceRequest, sort: { createdAt: -1 } },
  'customer-pos': { model: CustomerPO, sort: { createdAt: -1 }, partType: 'customer-po' },
  'product-files': { model: ProductFile, sort: { createdAt: -1 }, partType: 'product-file' },
  'sales-orders': { model: SalesOrder, sort: { updatedAt: -1 }, partType: 'sales-order' },
  'supplier-pos': { model: SupplierPO, sort: { createdAt: -1 }, partType: 'supplier-po' },
  grns: { model: PurchaserGRN, sort: { createdAt: -1 }, partType: 'grn' },
  'delivery-notes': { model: DeliveryNote, sort: { createdAt: -1 }, partType: 'delivery-note' },
  shipments: { model: Shipment, sort: { updatedAt: -1 } },
  'support-tickets': { model: SupportTicket, sort: { updatedAt: -1 } },
  invoices: { model: Invoice, sort: { createdAt: -1 }, partType: 'invoice' },
  payments: { model: Payment, sort: { paymentDate: -1 } },
  inventory: { model: InventoryItem, sort: { name: 1 } }
};

const listRecords = async (req, res) => {
  try {
    const config = RECORD_TYPES[req.params.type];
    if (!config) return res.status(404).json({ success: false, message: 'Order Tracker record type not found.' });
    let rows = await config.model.find({}).sort(config.sort).limit(500).lean();
    if (config.partType) rows = await resolveDocumentsPartNumbers(rows, config.partType);
    return res.status(200).json({ success: true, count: rows.length, data: sanitizeTrackerData(rows) });
  } catch (error) {
    console.error('[Order Tracker Records Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading tracker records.' });
  }
};

module.exports = { listOrders, getOrderDetail, listRecords, RECORD_TYPES };
