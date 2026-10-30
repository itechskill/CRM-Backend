const text = value => String(value || '').trim();
const lower = value => text(value).toLowerCase();

const completedStatus = value => ['paid', 'delivered', 'fully delivered', 'completed'].includes(lower(value));

const invoiceBalance = invoice => Math.max(0, Number(invoice?.outstandingAmount ?? (Number(invoice?.amount || 0) - Number(invoice?.paidAmount || 0))) || 0);

const paymentSummary = invoices => {
  const rows = Array.isArray(invoices) ? invoices : [];
  if (!rows.length) return { key: 'not-invoiced', label: 'Not invoiced', amount: 0, paid: 0 };
  const amount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const outstanding = rows.reduce((sum, row) => sum + invoiceBalance(row), 0);
  const paid = Math.max(0, amount - outstanding);
  if (outstanding <= 0 || rows.every(row => lower(row.status) === 'paid')) return { key: 'paid', label: 'Paid', amount, paid: amount };
  if (paid > 0) return { key: 'part-paid', label: 'Part paid', amount, paid };
  return { key: 'unpaid', label: 'Invoiced - unpaid', amount, paid: 0 };
};

const latestShipmentNote = shipment => {
  const history = Array.isArray(shipment?.trackingHistory) ? shipment.trackingHistory : [];
  const latest = history.slice().sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0))[0];
  return text(latest?.notes || shipment?.remarks || shipment?.description);
};

const deriveOrderTrackerStage = ({ order = {}, supplierPOs = [], grns = [], deliveryNotes = [], shipments = [], invoices = [] } = {}) => {
  const status = text(order.workflowStatus || order.status);
  const statusLower = lower(status);
  const payment = paymentSummary(invoices);
  const latestInvoice = invoices[0];
  const latestDn = deliveryNotes[0];
  const latestShipment = shipments[0];
  const latestPo = supplierPOs[0];

  if (payment.key === 'paid') return { department: 'Finance', stage: 'Paid', why: 'Payment received in full', payment };
  if (latestInvoice) {
    const finalized = latestInvoice.isDraft === false || ['finalized', 'approved', 'sent', 'partially paid', 'overdue', 'paid'].includes(lower(latestInvoice.status));
    return {
      department: finalized ? 'Finance' : 'Accounts',
      stage: finalized ? 'Invoiced' : 'Draft Invoice',
      why: finalized ? (payment.key === 'part-paid' ? 'Invoice finalized - payment partly received' : 'Invoice finalized - awaiting payment') : 'Draft invoice awaiting Finance finalization',
      payment
    };
  }
  if (completedStatus(order.deliveryStatus) || completedStatus(order.status) || completedStatus(latestDn?.status)) {
    return { department: 'Accounts', stage: 'Delivered', why: 'Delivery confirmed - awaiting invoice', payment };
  }
  if (latestDn) {
    return { department: text(order.currentDepartment) || 'Support', stage: 'DN Created', why: 'Delivery note created - awaiting delivery confirmation', payment };
  }
  if (grns.length) {
    return { department: 'Support', stage: 'Inventory IN', why: 'Goods verified and added to inventory - awaiting Delivery Note', payment };
  }
  if (statusLower.includes('goods arrived') || latestPo?.goodsReceiptReference) {
    return { department: 'Support', stage: 'Goods Arrived', why: 'Goods arrived - awaiting Support verification', payment };
  }
  if (latestShipment) {
    const note = latestShipmentNote(latestShipment);
    return {
      department: 'Logistics',
      stage: text(latestShipment.status || order.shipmentStatus || 'Shipment'),
      why: note || `Shipment ${text(latestShipment.status || order.shipmentStatus || 'is being tracked by Logistics')}`,
      payment
    };
  }
  if (statusLower.includes('local po issued') || (latestPo && lower(latestPo.poType) === 'local')) {
    return { department: 'Local Purchaser', stage: 'Local PO Issued', why: 'Local PO issued - awaiting supplier goods', payment };
  }
  if (statusLower.includes('international') || statusLower.includes('global') || (latestPo && lower(latestPo.poType) === 'global')) {
    return { department: text(order.currentDepartment) || 'Global Purchaser', stage: status || 'Global Purchase', why: status || 'Global purchase workflow in progress', payment };
  }
  if (!order.financeApprovedAt && !order.financeApprovedBy) {
    return { department: 'Finance', stage: 'Pending Finance Approval', why: 'Awaiting Finance approval', payment };
  }
  return {
    department: text(order.currentDepartment || order.departmentResponsible) || 'Sales',
    stage: status || 'In progress',
    why: text(order.lastAction) || status || 'Workflow in progress',
    payment
  };
};

const FORBIDDEN_TRACKER_KEYS = new Set([
  'salary', 'salarytarget', 'monthlysalessalarycents', 'monthlysalary', 'basesalary', 'netsalary',
  'purchaseexpenses', 'expenses', 'costingstatus', 'costinghistory', 'financecosting', 'cogs', 'cogscents',
  'costbatches', 'batchallocations', 'batchallocationsrestoredat', 'unitcostpkrcents', 'liveunitcostpkrcents', 'costhistory',
  'grossprofit', 'grossprofitcents', 'totalcostpkr', 'exchangerate', 'exchangeratetopkr', 'exchangeratehistory'
]);

const sanitizeTrackerData = value => {
  if (Array.isArray(value)) return value.map(sanitizeTrackerData);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value._bsontype === 'ObjectId' || value.constructor?.name === 'ObjectId') return String(value);
  if (Buffer.isBuffer(value)) return value;
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !FORBIDDEN_TRACKER_KEYS.has(lower(key).replace(/[^a-z0-9]/g, '')))
    .map(([key, item]) => [key, sanitizeTrackerData(item)]));
};

module.exports = {
  deriveOrderTrackerStage,
  invoiceBalance,
  paymentSummary,
  sanitizeTrackerData,
  latestShipmentNote
};
