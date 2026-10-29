const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r26_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 26 tests.');
assert.notEqual(tempDbName, 'test');
assert.notEqual(tempDbName, 'fortline_dev');
const useDatabase = (uri, name) => {
  const queryAt = uri.indexOf('?');
  const query = queryAt >= 0 ? uri.slice(queryAt) : '';
  const base = queryAt >= 0 ? uri.slice(0, queryAt) : uri;
  const pathAt = base.indexOf('/', base.indexOf('://') + 3);
  return `${pathAt >= 0 ? base.slice(0, pathAt) : base}/${name}${query}`;
};
process.env.MONGODB_URI = useDatabase(sourceMongoUri, tempDbName);

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const Invoice = require('../models/Invoice');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { addFinanceCostingToInvoices, analyzeInvoicePerformance } = require('../utils/targetPerformance');
const { serializeMonetaryVisibility } = require('../utils/monetaryVisibility');

let server;
let baseUrl;
let users;
let order;
let po;
let invoice;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '15m' });
const request = async (user, path, method = 'GET', body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const password = `R26-${runId}`;
  const roles = ['finance', 'admin', 'ceo', 'accountant', 'sales_person', 'support', 'logistics', 'purchaser'];
  const records = await User.create(roles.map(role => ({
    fullName: `R26 ${role}`,
    email: `r26.${role}.${runId}@example.com`,
    password,
    role,
    purchaserSubDept: role === 'purchaser' ? 'Local' : undefined,
    status: 'active',
    isApproved: true
  })));
  users = Object.fromEntries(records.map(user => [user.role, user]));
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 26000 });
  order = await SalesOrder.create({
    orderNumber: `SO-R26-${runId}`,
    clientName: 'R26 Customer',
    owner: users.sales_person._id,
    createdBy: users.sales_person._id,
    totalAmount: 1180,
    discount: 0,
    tax: 180,
    netAmount: 1180,
    items: [{ description: 'Server', quantity: 1, unitPrice: 1000, total: 1000 }]
  });
  po = await SupplierPO.create({
    poNumber: `LPO-R26-${runId}`,
    poType: 'Local',
    supplierName: 'R26 Supplier',
    salesOrderId: order._id,
    salesOrderNumber: order.orderNumber,
    currency: 'PKR',
    total: 500,
    totalAmount: 500,
    costingStatus: 'Incomplete',
    expenses: [{ category: 'Freight', calculationType: 'Fixed', amountCents: 10000, amountPKRCents: 10000, currency: 'PKR', exchangeRateToPKR: 1, addedBy: users.finance._id, addedByName: users.finance.fullName }],
    createdBy: users.finance._id,
    createdByName: users.finance.fullName
  });
  order.supplierPoId = po._id;
  await order.save();
  invoice = await Invoice.create({
    invoiceNumber: `INV-R26-${runId}`,
    clientName: order.clientName,
    salesOrderId: order._id,
    salesOrderNumber: order.orderNumber,
    subtotal: 1000,
    discount: 0,
    tax: 180,
    amount: 1180,
    issueDate: new Date(),
    dueDate: new Date(),
    status: 'Finalized',
    isDraft: false,
    createdBy: users.sales_person._id
  });
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) {
    assert.equal(mongoose.connection.name, tempDbName);
    try { await mongoose.connection.dropDatabase(); }
    catch (error) {
      if (error.code !== 8000) throw error;
      for (const { name } of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('landed COGS and GP reuse Target Performance figures and remain provisional until completed', async () => {
  const [row] = await addFinanceCostingToInvoices([invoice]);
  assert.equal(row.financeCosting.invoiceAmountExcludingTaxCents, 100000);
  assert.equal(row.financeCosting.cogsCents, 60000);
  assert.equal(row.financeCosting.grossProfitCents, 40000);
  assert.equal(row.financeCosting.provisional, true);
  const target = analyzeInvoicePerformance({ invoice, order, supplierPO: po, purchaseCostCents: 60000 });
  assert.equal(row.financeCosting.grossProfitCents, target.grossProfitCents);
});

test('missing PO and foreign rate gaps never return a misleading zero profit', async () => {
  const noPoOrder = await SalesOrder.create({ orderNumber: `SO-NOPO-${runId}`, clientName: 'No PO', createdBy: users.sales_person._id, totalAmount: 100, netAmount: 100 });
  const noPoInvoice = await Invoice.create({ invoiceNumber: `INV-NOPO-${runId}`, clientName: 'No PO', salesOrderId: noPoOrder._id, subtotal: 100, amount: 100, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.sales_person._id });
  const globalOrder = await SalesOrder.create({ orderNumber: `SO-RATE-${runId}`, clientName: 'No Rate', createdBy: users.sales_person._id, totalAmount: 1000, netAmount: 1000 });
  await SupplierPO.create({ poNumber: `GPO-RATE-${runId}`, poType: 'Global', supplierName: 'USD Supplier', salesOrderId: globalOrder._id, currency: 'USD', totalAmount: 10, createdBy: users.finance._id });
  const globalInvoice = await Invoice.create({ invoiceNumber: `INV-RATE-${runId}`, clientName: 'No Rate', salesOrderId: globalOrder._id, subtotal: 1000, amount: 1000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.sales_person._id });
  const [noPo, noRate] = await addFinanceCostingToInvoices([noPoInvoice, globalInvoice]);
  assert.equal(noPo.financeCosting.issue, 'Cost not recorded');
  assert.equal(noPo.financeCosting.grossProfitCents, null);
  assert.equal(noRate.financeCosting.issue, 'Rate missing');
  assert.equal(noRate.financeCosting.cogsCents, null);
});

test('foreign saved rate is used and multiple POs/invoices receive a Review flag', async () => {
  const fxOrder = await SalesOrder.create({ orderNumber: `SO-FX-${runId}`, clientName: 'FX', createdBy: users.sales_person._id, totalAmount: 1000, netAmount: 1000 });
  await SupplierPO.create({ poNumber: `GPO-FX-OLD-${runId}`, poType: 'Global', supplierName: 'FX Supplier', salesOrderId: fxOrder._id, currency: 'USD', exchangeRateToPKR: 250, totalAmount: 1, createdBy: users.finance._id, createdAt: new Date(Date.now() - 5000) });
  await SupplierPO.create({ poNumber: `GPO-FX-NEW-${runId}`, poType: 'Global', supplierName: 'FX Supplier', salesOrderId: fxOrder._id, currency: 'USD', exchangeRateToPKR: 300, totalAmount: 2, costingStatus: 'Completed', createdBy: users.finance._id });
  const invoices = await Invoice.create([1, 2].map(index => ({ invoiceNumber: `INV-FX-${index}-${runId}`, clientName: 'FX', salesOrderId: fxOrder._id, subtotal: 1000, amount: 1000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.sales_person._id })));
  const [row] = await addFinanceCostingToInvoices([invoices[0]]);
  assert.equal(row.financeCosting.cogsCents, 60000);
  assert.equal(row.financeCosting.costingStatus, 'Completed');
  assert.equal(row.financeCosting.review, true);
  assert.match(row.financeCosting.reviewReason, /newest Supplier PO/);
  assert.match(row.financeCosting.reviewReason, /full order cost applies to each invoice/);
});

test('only Finance, Admin and CEO receive finance costing fields', async () => {
  const sample = { invoiceNumber: 'INV-SAMPLE', financeCosting: { cogsCents: 1 } };
  assert.ok(serializeMonetaryVisibility(sample, users.finance, 'invoice').financeCosting);
  assert.equal(serializeMonetaryVisibility(sample, users.accountant, 'invoice').financeCosting, undefined);
  for (const role of ['finance', 'admin', 'ceo']) {
    const result = await request(users[role], '/api/sales-employee/invoices');
    assert.equal(result.status, 200, role);
    assert.ok(result.body.data.some(item => item.financeCosting), role);
  }
  for (const role of ['accountant', 'sales_person', 'support', 'logistics', 'purchaser']) {
    const result = await request(users[role], '/api/sales-employee/invoices');
    assert.equal(result.status, 200, role);
    assert.ok(result.body.data.every(item => item.financeCosting === undefined), role);
  }
  const financeOrders = await request(users.finance, '/api/sales-employee/orders');
  assert.equal(financeOrders.status, 200);
  assert.equal(financeOrders.body.data.find(item => item._id === String(order._id)).supplierPOCostingStatus, 'Incomplete');
  const accountsOrders = await request(users.accountant, '/api/sales-employee/orders');
  assert.equal(accountsOrders.status, 200);
  assert.equal(accountsOrders.body.data.find(item => item._id === String(order._id)).supplierPOCostingStatus, undefined);
});

test('costing completion is idempotent and adds only one history entry', async () => {
  const first = await request(users.finance, `/api/purchaser/pos/${po._id}/expenses/costing-status`, 'PATCH', { status: 'Completed' });
  const second = await request(users.finance, `/api/purchaser/pos/${po._id}/expenses/costing-status`, 'PATCH', { status: 'Completed' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const stored = await SupplierPO.findById(po._id);
  assert.equal(stored.costingStatus, 'Completed');
  assert.equal(stored.costingHistory.filter(entry => entry.action === 'Completed').length, 1);
});
