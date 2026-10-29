const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r25_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 25 tests.');
assert.notEqual(tempDbName, 'test');
assert.notEqual(tempDbName, 'fortline_dev');
const useDatabase = (uri, name) => {
  const queryAt = uri.indexOf('?');
  const query = queryAt >= 0 ? uri.slice(queryAt) : '';
  const base = queryAt >= 0 ? uri.slice(0, queryAt) : uri;
  const schemeAt = base.indexOf('://');
  const pathAt = base.indexOf('/', schemeAt + 3);
  return `${pathAt >= 0 ? base.slice(0, pathAt) : base}/${name}${query}`;
};
process.env.MONGODB_URI = useDatabase(sourceMongoUri, tempDbName);
process.env.COUNTER_NAMESPACE = `release25-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let admin;
let finance;
let accountant;
let sales;
let manager;
let invoice;
const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
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
  const password = `R25-${runId}`;
  [admin, finance, accountant, sales, manager] = await User.create([
    { fullName: 'R25 Admin', email: `r25.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R25 Finance', email: `r25.finance.${runId}@example.com`, password, role: 'finance', department: 'Finance', status: 'active', isApproved: true },
    { fullName: 'R25 Accounts', email: `r25.accounts.${runId}@example.com`, password, role: 'accountant', department: 'Accounts', status: 'active', isApproved: true },
    { fullName: 'R25 Sales', email: `r25.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R25 Manager', email: `r25.manager.${runId}@example.com`, password, role: 'sales_manager', department: 'Sales', status: 'active', isApproved: true }
  ]);
  await Payment.syncIndexes();
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 250001 });
  const order = await SalesOrder.create({
    orderNumber: `SO-R25-${runId}`, clientName: 'R25 Customer', owner: sales._id, createdBy: sales._id,
    salesPerson: sales._id, totalAmount: 1000, netAmount: 1000,
    issuingCompany: { code: 'FORTLINE_PRIVATE_LIMITED', legalName: 'Fortline Private Limited' },
    items: [{ description: 'R25 item', quantity: 1, unitPrice: 1000, total: 1000 }]
  });
  invoice = await Invoice.create({
    invoiceNumber: `INV-R25-${runId}`, clientName: order.clientName, salesOrderId: order._id,
    salesOrderNumber: order.orderNumber, items: [{ description: 'R25 item', quantity: 1, unitPrice: 1000, total: 1000 }],
    amount: 1000, dueDate: new Date(Date.now() + 30 * 86400000), status: 'Finalized',
    isDraft: false, salesPerson: sales._id, createdBy: accountant._id
  });
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, tempDbName);
    try { await mongoose.connection.dropDatabase(); }
    catch (error) {
      if (error.code !== 8000) throw error;
      for (const { name } of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('Admin salary API feeds salesperson and manager when ON and stays private when OFF', async () => {
  for (const user of [sales, manager]) {
    const saved = await request(admin, `/api/target-performance/users/${user._id}/salary`, 'PATCH', { monthlySalaryCents: 10000000 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.monthlySalesSalaryCents, 10000000);
  }
  await request(admin, '/api/target-performance/settings', 'PATCH', { showToSalespeople: true });
  for (const user of [sales, manager]) {
    const visible = await request(user, '/api/target-performance/me?month=2026-10');
    assert.equal(visible.body.data.visible, true);
    assert.equal(visible.body.data.salaryCents, 10000000);
    assert.equal(visible.body.data.targetCents, 50000000);
  }
  await request(admin, '/api/target-performance/settings', 'PATCH', { showToSalespeople: false });
  for (const user of [sales, manager]) {
    const hidden = await request(user, '/api/target-performance/me?month=2026-10');
    assert.deepEqual(Object.keys(hidden.body.data).sort(), ['month', 'visible']);
    assert.equal(hidden.body.data.visible, false);
  }
});

test('Receive Payment creates one idempotent RV and updates the invoice balance once', async () => {
  const payload = {
    receiptRequestId: `same-${runId}`, customerName: invoice.clientName, invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber, amount: 250, paymentMethod: 'Bank Transfer',
    paymentDate: '2026-10-29', reference: 'BANK-R25-001'
  };
  const [first, second] = await Promise.all([
    request(finance, '/api/sales-employee/payments', 'POST', payload),
    request(finance, '/api/sales-employee/payments', 'POST', payload)
  ]);
  assert.ok([200, 201].includes(first.status));
  assert.ok([200, 201].includes(second.status));
  const matches = await Payment.find({ receiptRequestId: payload.receiptRequestId }).lean();
  assert.equal(matches.length, 1);
  assert.match(matches[0].receiptVoucherNumber, /^RV-\d{6}$/);
  assert.equal(matches[0].reference, payload.reference);
  assert.equal(matches[0].issuingCompany.code, 'FORTLINE_PRIVATE_LIMITED');
  const reloaded = await Invoice.findById(invoice._id).lean();
  assert.equal(reloaded.paidAmount, 250);
  assert.equal(reloaded.outstandingAmount, 750);
});

test('concurrent payments receive different global RV numbers', async () => {
  const createInvoice = suffix => Invoice.create({
    invoiceNumber: `INV-R25-${suffix}-${runId}`, clientName: `Customer ${suffix}`,
    items: [{ description: suffix, quantity: 1, unitPrice: 100, total: 100 }], amount: 100,
    dueDate: new Date(Date.now() + 86400000), status: 'Finalized', isDraft: false, createdBy: accountant._id
  });
  const [invoiceA, invoiceB] = await Promise.all([createInvoice('A'), createInvoice('B')]);
  const [paymentA, paymentB] = await Promise.all([
    request(finance, '/api/sales-employee/payments', 'POST', { receiptRequestId: `a-${runId}`, customerName: invoiceA.clientName, invoiceId: invoiceA._id, amount: 10 }),
    request(finance, '/api/sales-employee/payments', 'POST', { receiptRequestId: `b-${runId}`, customerName: invoiceB.clientName, invoiceId: invoiceB._id, amount: 10 })
  ]);
  assert.equal(paymentA.status, 201);
  assert.equal(paymentB.status, 201);
  assert.notEqual(paymentA.body.data.receiptVoucherNumber, paymentB.body.data.receiptVoucherNumber);
});

test('RV access is restricted and legacy payments load without an RV', async () => {
  const payment = await Payment.findOne({ receiptRequestId: `same-${runId}` });
  assert.equal((await request(finance, `/api/sales-employee/payments/${payment._id}/receipt-voucher`)).status, 200);
  assert.equal((await request(accountant, `/api/sales-employee/payments/${payment._id}/receipt-voucher`)).status, 200);
  assert.equal((await request(admin, `/api/sales-employee/payments/${payment._id}/receipt-voucher`)).status, 200);
  assert.equal((await request(sales, `/api/sales-employee/payments/${payment._id}/receipt-voucher`)).status, 403);
  const salesRetry = await request(sales, '/api/sales-employee/payments', 'POST', { receiptRequestId: `same-${runId}` });
  assert.equal(salesRetry.status, 200);
  assert.equal(salesRetry.body.data.receiptVoucherNumber, undefined);
  const salesList = await request(sales, '/api/sales-employee/payments');
  assert.ok(salesList.body.data.every(row => row.receiptVoucherNumber === undefined));
  await Payment.collection.insertOne({ customerName: 'Legacy', amount: 5, paymentDate: new Date(), createdBy: finance._id, createdAt: new Date(), updatedAt: new Date() });
  const financeList = await request(finance, '/api/sales-employee/payments');
  assert.ok(financeList.body.data.some(row => row.customerName === 'Legacy' && !row.receiptVoucherNumber));
});
