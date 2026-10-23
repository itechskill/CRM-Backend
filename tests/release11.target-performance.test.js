const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r11_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 11 tests.');
assert.notEqual(tempDbName, 'test');
assert.notEqual(tempDbName, 'fortline_dev');

const useDatabase = (uri, databaseName) => {
  const queryAt = uri.indexOf('?');
  const query = queryAt >= 0 ? uri.slice(queryAt) : '';
  const withoutQuery = queryAt >= 0 ? uri.slice(0, queryAt) : uri;
  const schemeAt = withoutQuery.indexOf('://');
  const pathAt = withoutQuery.indexOf('/', schemeAt + 3);
  return `${pathAt >= 0 ? withoutQuery.slice(0, pathAt) : withoutQuery}/${databaseName}${query}`;
};
process.env.MONGODB_URI = useDatabase(sourceMongoUri, tempDbName);

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { totalCostPKR } = require('../utils/purchaseExpenses');
const {
  analyzeInvoicePerformance,
  calendarDaysBetween,
  creditPercentForDays,
  performancePercent
} = require('../utils/targetPerformance');

let server;
let baseUrl;
let admin;
let ceo;
let finance;
let salesA;
let salesB;
let manager;
let workedInvoice;
let forwardedInvoice;
let lateInvoice;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '15m' });
const request = async (user, path, method = 'GET', body = undefined) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

const createPerformanceInvoice = async ({ owner, creator, suffix, issueDate, paymentDate, paymentAmounts = [100000] }) => {
  const order = await SalesOrder.create({
    orderNumber: `SO-R11-${suffix}-${runId}`,
    clientName: `R11 Customer ${suffix}`,
    owner: owner._id,
    createdBy: creator._id,
    salesPerson: owner._id,
    totalAmount: 100000,
    netAmount: 100000,
    items: [{ description: 'R11 item', quantity: 1, unitPrice: 100000, total: 100000 }]
  });
  const po = await SupplierPO.create({
    poNumber: `LPO-R11-${suffix}-${runId}`,
    supplierName: 'R11 Supplier',
    poType: 'Local',
    items: [{ productName: 'R11 item', quantity: 1, unitPrice: 50000, totalAmount: 50000 }],
    subtotal: 50000,
    total: 50000,
    totalAmount: 50000,
    currency: 'PKR',
    salesOrderId: order._id,
    salesOrderNumber: order.orderNumber,
    createdBy: admin._id,
    createdByName: admin.fullName,
    expenses: [{
      category: 'Freight',
      calculationType: 'Fixed',
      amountCents: 2000000,
      currency: 'PKR',
      exchangeRateToPKR: 1,
      amountPKRCents: 2000000,
      addedBy: admin._id,
      addedByName: admin.fullName,
      addedAt: new Date(issueDate),
      editHistory: []
    }]
  });
  order.supplierPoId = po._id;
  await order.save();
  const invoice = await Invoice.create({
    invoiceNumber: `INV-R11-${suffix}-${runId}`,
    clientName: order.clientName,
    salesOrderId: order._id,
    salesOrderNumber: order.orderNumber,
    subtotal: 100000,
    tax: 0,
    amount: 100000,
    issueDate,
    dueDate: new Date(new Date(issueDate).getTime() + 30 * 86400000),
    status: 'Finalized',
    isDraft: false,
    salesPerson: owner._id,
    createdBy: admin._id
  });
  for (let index = 0; index < paymentAmounts.length; index += 1) {
    await Payment.create({
      customerName: order.clientName,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      salesOrderId: order._id,
      salesOrderNumber: order.orderNumber,
      paymentDate: Array.isArray(paymentDate) ? paymentDate[index] : paymentDate,
      amount: paymentAmounts[index],
      paymentType: paymentAmounts.length > 1 ? 'Partial' : 'Full',
      salesPerson: owner._id,
      createdBy: finance._id
    });
  }
  return { order, po, invoice };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  const password = `R11-${runId}`;
  [admin, ceo, finance, salesA, salesB, manager] = await User.create([
    { fullName: 'R11 Admin', email: `r11.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R11 CEO', email: `r11.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R11 Finance', email: `r11.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R11 Sales A', email: `r11.a.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true },
    { fullName: 'R11 Sales B', email: `r11.b.${runId}@example.com`, password, role: 'sales_rep', status: 'active', isApproved: true },
    { fullName: 'R11 Manager', email: `r11.manager.${runId}@example.com`, password, role: 'sales_manager', status: 'active', isApproved: true }
  ]);
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 11000 });
  workedInvoice = await createPerformanceInvoice({
    owner: salesA,
    creator: salesA,
    suffix: 'WORKED',
    issueDate: new Date(Date.UTC(2026, 0, 10)),
    paymentDate: [new Date(Date.UTC(2026, 1, 9)), new Date(Date.UTC(2026, 1, 10))],
    paymentAmounts: [50000, 50000]
  });
  forwardedInvoice = await createPerformanceInvoice({
    owner: salesB,
    creator: salesA,
    suffix: 'FORWARDED',
    issueDate: new Date(Date.UTC(2026, 0, 20)),
    paymentDate: new Date(Date.UTC(2026, 1, 1))
  });
  lateInvoice = await createPerformanceInvoice({
    owner: salesB,
    creator: salesB,
    suffix: 'LATE',
    issueDate: new Date(Date.UTC(2026, 0, 1)),
    paymentDate: new Date(Date.UTC(2026, 1, 11))
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

test('salary targets and performance percentages use integer cents and the salary x 5 rule', () => {
  const salaryCents = 10000000;
  const targetCents = salaryCents * 5;
  assert.equal(targetCents, 50000000);
  assert.equal(performancePercent(50000000, targetCents), 100);
  assert.equal(performancePercent(60000000, targetCents), 120);
  assert.equal(performancePercent(25000000, targetCents), 50);
});

test('calendar-day boundaries are 100% through day 30, 20% on days 31-40, and zero on day 41', () => {
  const invoiceDate = new Date(Date.UTC(2026, 0, 10));
  assert.equal(calendarDaysBetween(invoiceDate, new Date(Date.UTC(2026, 1, 9))), 30);
  assert.equal(creditPercentForDays(30), 100);
  assert.equal(creditPercentForDays(31), 20);
  assert.equal(creditPercentForDays(40), 20);
  assert.equal(creditPercentForDays(41), 0);
});

test('worked GP and partial payments credit proportional shares using each cleared date', async () => {
  const payments = await Payment.find({ invoiceId: workedInvoice.invoice._id }).lean();
  const row = analyzeInvoicePerformance({
    invoice: workedInvoice.invoice.toObject(),
    order: workedInvoice.order.toObject(),
    supplierPO: workedInvoice.po.toObject(),
    payments,
    purchaseCostCents: 7000000,
    asOf: new Date(Date.UTC(2026, 1, 10))
  });
  assert.equal(row.revenueExcludingTaxCents, 10000000);
  assert.equal(row.purchaseCostCents, 7000000);
  assert.equal(row.grossProfitCents, 3000000);
  assert.deepEqual(row.payments.map(payment => payment.creditPercent), [100, 20]);
  assert.deepEqual(row.payments.map(payment => payment.creditedGrossProfitCents), [1500000, 300000]);
  assert.equal(row.costChangedAfterCredit, true);
});

test('Global PO cost uses a saved exchange rate and refuses to assume one when it is missing', async () => {
  const base = {
    poType: 'Global',
    currency: 'USD',
    totalAmount: 500,
    expenses: [{ amountPKRCents: 2000000, isDeleted: false }]
  };
  assert.equal(await totalCostPKR({ ...base, exchangeRateToPKR: 280 }), 160000);
  assert.equal(await totalCostPKR(base), null);
});

test('visibility defaults OFF and leaks no salary or deal data to Sales', async () => {
  const result = await request(salesA, '/api/target-performance/me?month=2026-02');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.visible, false);
  assert.equal(result.body.data.salaryCents, undefined);
  assert.equal(result.body.data.invoices, undefined);
});

test('Admin sets salaries and visibility; salesperson and manager remain scoped to themselves', async () => {
  assert.equal((await request(admin, `/api/target-performance/users/${salesA._id}/salary`, 'PATCH', { monthlySalaryCents: 10000000 })).status, 200);
  assert.equal((await request(admin, `/api/target-performance/users/${salesB._id}/salary`, 'PATCH', { monthlySalaryCents: 10000000 })).status, 200);
  assert.equal((await request(admin, `/api/target-performance/users/${manager._id}/salary`, 'PATCH', { monthlySalaryCents: 10000000 })).status, 200);
  assert.equal((await request(admin, '/api/target-performance/settings', 'PATCH', { showToSalespeople: true })).status, 200);

  const own = await request(salesA, `/api/target-performance/me?month=2026-02&userId=${salesB._id}`);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.data.userId, String(salesA._id));
  assert.equal(own.body.data.salaryCents, 10000000);
  assert.equal(own.body.data.targetCents, 50000000);
  assert.equal(own.body.data.achievedGrossProfitCents, 1800000);
  assert.ok(own.body.data.invoices.every(invoice => invoice.salesOrderId !== String(forwardedInvoice.order._id)));

  const managerOwn = await request(manager, `/api/target-performance/me?month=2026-02&userId=${salesA._id}`);
  assert.equal(managerOwn.status, 200);
  assert.equal(managerOwn.body.data.userId, String(manager._id));
  assert.equal(managerOwn.body.data.invoices.length, 0);
  assert.equal((await request(salesA, '/api/target-performance/admin?month=2026-02')).status, 403);
});

test('forwarded work credits the receiver and day-41 payments are sent to Finance with zero credit', async () => {
  const adminView = await request(admin, '/api/target-performance/admin?month=2026-02');
  assert.equal(adminView.status, 200, JSON.stringify(adminView.body));
  const receiver = adminView.body.data.salespeople.find(row => row.userId === String(salesB._id));
  const sender = adminView.body.data.salespeople.find(row => row.userId === String(salesA._id));
  assert.ok(receiver.invoices.some(invoice => invoice.invoiceId === String(forwardedInvoice.invoice._id)));
  assert.ok(!sender.invoices.some(invoice => invoice.invoiceId === String(forwardedInvoice.invoice._id)));
  assert.equal(receiver.achievedGrossProfitCents, 3000000);
  const late = receiver.invoices.find(invoice => invoice.invoiceId === String(lateInvoice.invoice._id));
  assert.equal(late.payments[0].creditPercent, 0);
  assert.equal(late.needsFinance, true);

  const financeView = await request(finance, '/api/target-performance/finance-overdue?month=2026-02');
  assert.equal(financeView.status, 200);
  assert.ok(financeView.body.data.invoices.some(invoice => invoice.invoiceId === String(lateInvoice.invoice._id)));
  assert.equal(financeView.body.data.invoices[0].salaryCents, undefined);
});

test('CEO can review performance but cannot see salary-derived values or change settings', async () => {
  const result = await request(ceo, '/api/target-performance/admin?month=2026-02');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.salaryVisible, false);
  assert.ok(result.body.data.salespeople.every(row => row.salaryCents === null && row.targetCents === null && row.performancePercent === null));
  assert.equal((await request(ceo, '/api/target-performance/settings', 'PATCH', { showToSalespeople: false })).status, 403);
});
