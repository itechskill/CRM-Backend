const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release14-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r14_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 14 tests.');
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
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const PriceRequest = require('../models/PriceRequest');
const TargetPerformanceSetting = require('../models/TargetPerformanceSetting');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let users;

const tokenFor = user => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);
const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
};

const selectedMonth = new Date().toISOString().slice(0, 7);
const selectedDate = new Date(`${selectedMonth}-10T12:00:00.000Z`);
const previousDate = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 10, 12));

const setCreatedAt = (Model, id, date) => Model.collection.updateOne({ _id: id }, { $set: { createdAt: date, updatedAt: date } });

const createDashboardSet = async (owner, suffix, baseAmount) => {
  const quotation = await Quotation.collection.insertOne({
    orderReference: `LEGACY-${suffix}`,
    quotationNumber: `LEGACY-${suffix}`,
    clientName: `${suffix} customer`,
    status: 'Sent',
    totalAmount: baseAmount,
    netAmount: baseAmount,
    owner: owner._id,
    createdBy: owner._id,
    createdAt: selectedDate,
    updatedAt: selectedDate
  });
  const order = await SalesOrder.create({
    clientName: `${suffix} customer`,
    status: 'Sales Order',
    owner: owner._id,
    createdBy: owner._id,
    quotationId: quotation.insertedId,
    items: [{ description: `${suffix} item`, quantity: 1, unitPrice: baseAmount, total: baseAmount }],
    totalAmount: baseAmount,
    netAmount: baseAmount
  });
  await setCreatedAt(SalesOrder, order._id, selectedDate);

  const requested = await PriceRequest.create({
    requestNumber: `PR-${suffix}-PENDING`, requestedBy: owner._id, requestedFrom: owner._id,
    brand: 'Dell', category: 'Servers', leadSource: 'Email', requirement: `${suffix} pending`, quantity: 1
  });
  const priced = await PriceRequest.create({
    requestNumber: `PR-${suffix}-PRICED`, requestedBy: owner._id, requestedFrom: owner._id,
    brand: 'Dell', category: 'Servers', leadSource: 'Email', requirement: `${suffix} priced`, quantity: 1, status: 'Priced'
  });
  const oldRequest = await PriceRequest.create({
    requestNumber: `PR-${suffix}-OLD`, requestedBy: owner._id, requestedFrom: owner._id,
    brand: 'Dell', category: 'Servers', leadSource: 'Email', requirement: `${suffix} old`, quantity: 1, status: 'Priced'
  });
  await Promise.all([
    setCreatedAt(PriceRequest, requested._id, selectedDate),
    setCreatedAt(PriceRequest, priced._id, selectedDate),
    setCreatedAt(PriceRequest, oldRequest._id, previousDate)
  ]);

  const invoice = await Invoice.create({
    invoiceNumber: `INV-${suffix}`,
    clientName: `${suffix} customer`,
    salesOrderId: order._id,
    salesOrderNumber: order.orderNumber,
    amount: baseAmount,
    paidAmount: baseAmount / 4,
    outstandingAmount: baseAmount * 0.75,
    dueDate: new Date(Date.now() - 86400000),
    issueDate: selectedDate,
    finalizedAt: selectedDate,
    status: 'Finalized',
    isDraft: false,
    salesPerson: owner._id,
    createdBy: owner._id
  });
  const draftInvoice = await Invoice.create({
    invoiceNumber: `INV-${suffix}-DRAFT`, clientName: `${suffix} customer`, salesOrderId: order._id,
    amount: baseAmount * 10, paidAmount: 0, dueDate: new Date(Date.now() - 86400000), issueDate: selectedDate,
    status: 'Draft', isDraft: true, salesPerson: owner._id, createdBy: owner._id
  });
  const oldPaidInvoice = await Invoice.create({
    invoiceNumber: `INV-${suffix}-OLD`, clientName: `${suffix} customer`, salesOrderId: order._id,
    amount: baseAmount / 2, paidAmount: baseAmount / 2, outstandingAmount: 0, dueDate: previousDate,
    issueDate: previousDate, finalizedAt: previousDate, status: 'Paid', isDraft: false,
    salesPerson: owner._id, createdBy: owner._id
  });
  return { quotationId: quotation.insertedId, order, invoice, draftInvoice, oldPaidInvoice };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 1 });
  const password = `Release14-${runId}`;
  const created = await User.create([
    { fullName: 'Alpha Labelled', email: `r14.alpha.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true, priceRequestLabel: 'DELL Configurator', monthlySalesSalaryCents: 10000000 },
    { fullName: 'Beta Unlabelled', email: `r14.beta.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'Gamma Manager', email: `r14.manager.${runId}@example.com`, password, role: 'sales_manager', department: 'Sales', status: 'active', isApproved: true, priceRequestLabel: 'Enterprise Pricing' },
    { fullName: 'Delta Inactive', email: `r14.inactive.${runId}@example.com`, password, role: 'purchaser', status: 'inactive', isApproved: true, priceRequestLabel: 'Hidden' },
    { fullName: 'Release 14 Admin', email: `r14.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'Release 14 CEO', email: `r14.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true, priceRequestLabel: 'Executive Pricing' }
  ]);
  users = { salesA: created[0], salesB: created[1], manager: created[2], inactive: created[3], admin: created[4], ceo: created[5] };
  await Promise.all([
    createDashboardSet(users.salesA, 'A', 400),
    createDashboardSet(users.salesB, 'B', 800),
    createDashboardSet(users.manager, 'M', 1200)
  ]);
  const legacyRequest = await PriceRequest.create({
    requestNumber: 'PR-OLD-UNLABELLED',
    requestedBy: users.salesA._id,
    requestedFrom: users.salesB._id,
    brand: 'Dell',
    category: 'Servers',
    leadSource: 'Email',
    requirement: 'Old request remains readable',
    quantity: 1
  });
  await setCreatedAt(PriceRequest, legacyRequest._id, previousDate);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, tempDbName);
    try {
      await mongoose.connection.dropDatabase();
    } catch (error) {
      if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('labelled user endpoint is alphabetical, hides unlabelled/inactive users, and exposes only allowed fields', async () => {
  const result = await request(users.salesA, '/api/price-requests/labelled-users');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.data.map(item => item.name), ['Alpha Labelled', 'Gamma Manager', 'Release 14 CEO']);
  result.data.data.forEach(item => assert.deepEqual(Object.keys(item).sort(), ['_id', 'label', 'name']));
  assert.equal(result.data.data[0].label, 'DELL Configurator');
});

test('only Admin can set, clear and validate a Price Request label', async () => {
  const forbidden = await request(users.ceo, `/api/admin/users/${users.salesB._id}/price-request-label`, {
    method: 'PATCH', body: JSON.stringify({ priceRequestLabel: 'CEO attempt' })
  });
  assert.equal(forbidden.response.status, 403);

  const tooLong = await request(users.admin, `/api/admin/users/${users.salesB._id}/price-request-label`, {
    method: 'PATCH', body: JSON.stringify({ priceRequestLabel: 'x'.repeat(81) })
  });
  assert.equal(tooLong.response.status, 400);

  const updated = await request(users.admin, `/api/admin/users/${users.salesB._id}/price-request-label`, {
    method: 'PATCH', body: JSON.stringify({ priceRequestLabel: '  HP Specialist  ' })
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.data.priceRequestLabel, 'HP Specialist');

  const cleared = await request(users.admin, `/api/admin/users/${users.salesB._id}/price-request-label`, {
    method: 'PATCH', body: JSON.stringify({ priceRequestLabel: '   ' })
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.data.data.priceRequestLabel, '');
});

test('an existing request assigned to an unlabelled user remains readable', async () => {
  const result = await request(users.salesA, '/api/price-requests');
  assert.equal(result.response.status, 200);
  const oldRequest = result.data.data.find(item => item.requestNumber === 'PR-OLD-UNLABELLED');
  assert.ok(oldRequest);
  assert.equal(String(oldRequest.requestedFrom._id), String(users.salesB._id));
});

test('nine dashboard tiles use the selected month and remain owner-scoped for two salespeople and a manager', async () => {
  const salesResult = await request(users.salesA, `/api/sales-employee/stats?month=${selectedMonth}`);
  assert.equal(salesResult.response.status, 200, JSON.stringify(salesResult.data));
  const salesTiles = salesResult.data.data.dashboardTiles;
  assert.equal(salesResult.data.data.dashboardMonth, selectedMonth);
  assert.deepEqual(salesTiles.priceRequested, { count: 2 });
  assert.deepEqual(salesTiles.priceReceived, { count: 1 });
  assert.deepEqual(salesTiles.quotationSent, { count: 1, amount: 400 });
  assert.deepEqual(salesTiles.saleOrder, { count: 1, amount: 400 });
  assert.deepEqual(salesTiles.invoiced, { count: 1, amount: 400 });
  assert.equal(salesTiles.receivable.count, 1);
  assert.equal(salesTiles.receivable.amount, 300);
  assert.equal(salesTiles.overdue.count, 1);
  assert.equal(salesTiles.overdue.amount, 300);
  assert.equal(salesTiles.overdue.records[0].invoiceNumber, 'INV-A');

  const salesBResult = await request(users.salesB, `/api/sales-employee/stats?month=${selectedMonth}`);
  assert.equal(salesBResult.response.status, 200, JSON.stringify(salesBResult.data));
  assert.equal(salesBResult.data.data.dashboardTiles.quotationSent.amount, 800);
  assert.equal(salesBResult.data.data.dashboardTiles.overdue.amount, 600);
  assert.equal(salesBResult.data.data.dashboardTiles.overdue.records[0].invoiceNumber, 'INV-B');

  const managerResult = await request(users.manager, `/api/sales-manager/dashboard-stats?month=${selectedMonth}`);
  assert.equal(managerResult.response.status, 200, JSON.stringify(managerResult.data));
  const managerTiles = managerResult.data.data.dashboardTiles;
  assert.equal(managerTiles.priceRequested.count, 2);
  assert.equal(managerTiles.quotationSent.amount, 1200);
  assert.equal(managerTiles.overdue.amount, 900);
  assert.equal(managerTiles.overdue.records[0].invoiceNumber, 'INV-M');
});

test('month filter changes monthly tiles while receivable and overdue stay as-of-today', async () => {
  const previousMonth = previousDate.toISOString().slice(0, 7);
  const result = await request(users.salesA, `/api/sales-employee/stats?month=${previousMonth}`);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const tiles = result.data.data.dashboardTiles;
  assert.equal(result.data.data.dashboardMonth, previousMonth);
  assert.equal(tiles.priceRequested.count, 2);
  assert.equal(tiles.priceReceived.count, 1);
  assert.equal(tiles.quotationSent.count, 0);
  assert.equal(tiles.saleOrder.count, 0);
  assert.equal(tiles.invoiced.count, 1);
  assert.equal(tiles.invoiced.amount, 200);
  assert.equal(tiles.receivable.count, 1);
  assert.equal(tiles.overdue.count, 1);
});

test('draft invoices are excluded from invoiced, receivable and overdue tiles', async () => {
  const result = await request(users.salesA, `/api/sales-employee/stats?month=${selectedMonth}`);
  const tiles = result.data.data.dashboardTiles;
  assert.equal(tiles.invoiced.count, 1);
  assert.equal(tiles.receivable.count, 1);
  assert.equal(tiles.overdue.count, 1);
  assert.ok(tiles.receivable.records.every(invoice => !invoice.invoiceNumber.includes('DRAFT')));
});

test('Target Performance source covers feature OFF, salary set, and salary not set', async () => {
  const hidden = await request(users.salesA, `/api/target-performance/me?month=${selectedMonth}`);
  assert.equal(hidden.response.status, 200);
  assert.equal(hidden.data.data.visible, false);

  await TargetPerformanceSetting.create({ key: 'global', showToSalespeople: true, updatedBy: users.admin._id });
  const withSalary = await request(users.salesA, `/api/target-performance/me?month=${selectedMonth}`);
  assert.equal(withSalary.response.status, 200, JSON.stringify(withSalary.data));
  assert.equal(withSalary.data.data.visible, true);
  assert.equal(withSalary.data.data.salaryCents, 10000000);
  assert.equal(withSalary.data.data.targetCents, 50000000);

  const withoutSalary = await request(users.salesB, `/api/target-performance/me?month=${selectedMonth}`);
  assert.equal(withoutSalary.response.status, 200, JSON.stringify(withoutSalary.data));
  assert.equal(withoutSalary.data.data.visible, true);
  assert.equal(withoutSalary.data.data.salaryCents, 0);
  assert.equal(withoutSalary.data.data.targetCents, 0);

  await TargetPerformanceSetting.updateOne({ key: 'global' }, { $set: { showToSalespeople: false } });
  const hiddenAgain = await request(users.manager, `/api/target-performance/me?month=${selectedMonth}`);
  assert.equal(hiddenAgain.response.status, 200);
  assert.equal(hiddenAgain.data.data.visible, false);
});
