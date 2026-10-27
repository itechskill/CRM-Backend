const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
mongoose.set('autoIndex', false);
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r17_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 17 tests.');
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
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const PurchaserGRN = require('../models/PurchaserGRN');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');

let server;
let baseUrl;
let users;
let orderIds;
const selectedMonth = new Date().toISOString().slice(0, 7);
const selectedDate = new Date(`${selectedMonth}-10T12:00:00.000Z`);
const previousDate = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 10, 12));
const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;
const utcDaysAgo = days => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days, 12));
};

const tokenFor = user => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);
const request = async (user, path) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${tokenFor(user)}` } });
  return { response, data: await response.json() };
};

const insertFinanceOrder = async ({ owner, amount, date, completed = false, suffix }) => {
  const _id = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id,
    orderNumber: `SO-R17-${suffix}-${runId}`,
    orderReference: `SO-R17-${suffix}-${runId}`,
    clientName: `Release 17 ${suffix}`,
    owner: owner._id,
    createdBy: owner._id,
    items: [],
    totalAmount: amount,
    netAmount: amount,
    currentDepartment: completed ? 'Accounts' : 'Finance',
    departmentResponsible: completed ? 'Accounts' : 'Finance',
    previousDepartment: completed ? 'Finance' : 'Sales',
    requiresFinanceApproval: !completed,
    workflowStatus: completed ? 'Completed' : 'Pending Finance Overdue Check',
    status: completed ? 'Completed' : 'Pending Finance Approval',
    deliveryStatus: completed ? 'Fully Delivered' : 'Not Delivered',
    workflowHistory: [{
      department: 'Sales',
      action: 'Sent to Finance for Overdue Verification',
      newStatus: 'Pending Finance Overdue Check',
      timestamp: date
    }],
    createdAt: date,
    updatedAt: date
  });
  return _id;
};

const createPO = async ({ orderId, type, total, currency = 'PKR', rate, date, suffix }) => {
  const po = await SupplierPO.create({
    poNumber: `${type === 'Global' ? 'GPO' : 'LPO'}-R17-${suffix}-${runId}`,
    supplierName: `Release 17 ${type} Supplier`,
    poType: type,
    poDate: date,
    totalAmount: total,
    total,
    currency,
    exchangeRateToPKR: rate,
    status: 'Issued',
    salesOrderId: orderId,
    createdBy: users.finance._id
  });
  await SupplierPO.collection.updateOne({ _id: po._id }, { $set: { createdAt: date, updatedAt: date, exchangeRateToPKR: rate ?? null } });
  return po;
};

const createInvoice = ({ owner, orderId, suffix, daysOld, amount, paidAmount = 0, status = 'Finalized', isDraft = false }) => {
  const date = utcDaysAgo(daysOld);
  return Invoice.create({
    invoiceNumber: `INV-R17-${suffix}-${runId}`,
    clientName: `Release 17 ${suffix}`,
    salesOrderId: orderId,
    salesOrderNumber: `SO-R17-${suffix}`,
    amount,
    paidAmount,
    outstandingAmount: Math.max(0, amount - paidAmount),
    issueDate: date,
    dueDate: date,
    finalizedAt: isDraft || status === 'Cancelled' ? null : date,
    status,
    isDraft,
    salesPerson: owner._id,
    createdBy: owner._id
  });
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const password = `Release17-${runId}`;
  const created = await User.create([
    { fullName: 'R17 Sales A', email: `r17.a.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R17 Sales B', email: `r17.b.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R17 Finance', email: `r17.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R17 Accountant', email: `r17.accountant.${runId}@example.com`, password, role: 'accountant', status: 'active', isApproved: true },
    { fullName: 'R17 Admin', email: `r17.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R17 CEO', email: `r17.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R17 Logistics', email: `r17.logistics.${runId}@example.com`, password, role: 'logistics', status: 'active', isApproved: true }
  ]);
  users = { salesA: created[0], salesB: created[1], finance: created[2], accountant: created[3], admin: created[4], ceo: created[5], logistics: created[6] };

  orderIds = {
    current: await insertFinanceOrder({ owner: users.salesA, amount: 100, date: selectedDate, suffix: 'CURRENT' }),
    priorOpen: await insertFinanceOrder({ owner: users.salesB, amount: 200, date: previousDate, suffix: 'PRIOR-OPEN' }),
    priorDone: await insertFinanceOrder({ owner: users.salesA, amount: 300, date: previousDate, completed: true, suffix: 'PRIOR-DONE' })
  };
  await SalesOrder.collection.insertOne({
    _id: new mongoose.Types.ObjectId(), clientName: 'Never reached Finance', owner: users.salesA._id,
    createdBy: users.salesA._id, totalAmount: 999, netAmount: 999, currentDepartment: 'Sales',
    departmentResponsible: 'Sales', status: 'Sales Order', workflowStatus: 'Sales Order Created',
    items: [], createdAt: selectedDate, updatedAt: selectedDate
  });

  const localCurrent = await createPO({ orderId: orderIds.current, type: 'Local', total: 10, date: selectedDate, suffix: 'LOCAL-CURRENT' });
  await createPO({ orderId: orderIds.priorOpen, type: 'Local', total: 20, date: previousDate, suffix: 'LOCAL-OPEN' });
  const globalRated = await createPO({ orderId: orderIds.current, type: 'Global', total: 2, currency: 'USD', rate: 280, date: selectedDate, suffix: 'GLOBAL-RATED' });
  const globalMissing = await createPO({ orderId: orderIds.current, type: 'Global', total: 3, currency: 'USD', rate: null, date: selectedDate, suffix: 'GLOBAL-MISSING' });
  await createPO({ orderId: orderIds.priorDone, type: 'Global', total: 4, date: previousDate, suffix: 'GLOBAL-DONE' });

  const grnRows = [
    { number: 'LOCAL', po: localCurrent, orderId: orderIds.current, type: 'Supplier' },
    { number: 'GLOBAL-RATED', po: globalRated, orderId: orderIds.current, type: 'Logistics' },
    { number: 'GLOBAL-MISSING', po: globalMissing, orderId: orderIds.current, type: 'Support Inventory IN' }
  ];
  for (const row of grnRows) {
    const grn = await PurchaserGRN.create({
      grnNumber: `GRN-R17-${row.number}-${runId}`,
      grnType: row.type,
      supplierPO: row.po._id,
      salesOrder: row.orderId,
      grnDate: selectedDate,
      createdBy: users.finance._id
    });
    await PurchaserGRN.collection.updateOne({ _id: grn._id }, { $set: { createdAt: selectedDate, updatedAt: selectedDate } });
  }

  await DeliveryNote.collection.insertMany([
    { deliveryNumber: `DN-R17-1-${runId}`, deliveryNoteNumber: `DN-R17-1-${runId}`, salesOrder: orderIds.current, status: 'Created', createdBy: users.finance._id, createdAt: selectedDate, updatedAt: selectedDate },
    { deliveryNumber: `DN-R17-2-${runId}`, deliveryNoteNumber: `DN-R17-2-${runId}`, salesOrder: orderIds.current, status: 'Cancelled', createdBy: users.finance._id, createdAt: selectedDate, updatedAt: selectedDate }
  ]);

  await Promise.all([
    createInvoice({ owner: users.salesA, orderId: orderIds.current, suffix: 'DAY-0', daysOld: 0, amount: 100, paidAmount: 20 }),
    createInvoice({ owner: users.salesA, orderId: orderIds.current, suffix: 'DAY-30', daysOld: 30, amount: 200 }),
    createInvoice({ owner: users.salesB, orderId: orderIds.priorOpen, suffix: 'DAY-31', daysOld: 31, amount: 300, paidAmount: 100 }),
    createInvoice({ owner: users.salesB, orderId: orderIds.priorOpen, suffix: 'DAY-45', daysOld: 45, amount: 400 }),
    createInvoice({ owner: users.salesA, orderId: orderIds.current, suffix: 'DAY-46', daysOld: 46, amount: 500, paidAmount: 200 }),
    createInvoice({ owner: users.salesA, orderId: orderIds.current, suffix: 'DRAFT', daysOld: 0, amount: 600, status: 'Draft', isDraft: true }),
    createInvoice({ owner: users.salesB, orderId: orderIds.priorOpen, suffix: 'CANCELLED', daysOld: 0, amount: 700, status: 'Cancelled' }),
    createInvoice({ owner: users.salesB, orderId: orderIds.priorOpen, suffix: 'PAID', daysOld: 0, amount: 800, paidAmount: 800, status: 'Paid' })
  ]);

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

test('Finance dashboard returns all ten tiles with Local/Global splits, PKR cents and missing-rate count', async () => {
  const result = await request(users.finance, `/api/finance/dashboard-stats?month=${selectedMonth}`);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const tiles = result.data.data.tiles;
  assert.deepEqual(tiles.so, { count: 2, amountCents: 30000 });
  assert.deepEqual(tiles.localPoIssued, { count: 2, amountCents: 3000, missingExchangeRateCount: 0 });
  assert.deepEqual(tiles.globalPoIssued, { count: 2, amountCents: 56000, missingExchangeRateCount: 1 });
  assert.deepEqual(tiles.localGrnInput, { count: 1 });
  assert.deepEqual(tiles.globalGrnInput, { count: 2 });
  assert.deepEqual(tiles.deliveryNote, { count: 2 });
  assert.equal(Object.hasOwn(tiles.localGrnInput, 'amountCents'), false);
  assert.equal(Object.hasOwn(tiles.globalGrnInput, 'amountCents'), false);
  assert.equal(Object.hasOwn(tiles.deliveryNote, 'amountCents'), false);
});

test('Finance aging reuses Sales boundaries and excludes draft, cancelled and fully paid receivables', async () => {
  const result = await request(users.finance, `/api/finance/dashboard-stats?month=${selectedMonth}`);
  const tiles = result.data.data.tiles;
  assert.deepEqual(tiles.receivable1To30, { count: 2, amountCents: 28000 });
  assert.deepEqual(tiles.overdueGrace31To45, { count: 2, amountCents: 60000 });
  assert.deepEqual(tiles.overdue45Plus, { count: 1, amountCents: 30000 });
});

test('Finance invoice and aging totals equal the sum of both salespeople dashboards', async () => {
  const [finance, salesA, salesB] = await Promise.all([
    request(users.finance, `/api/finance/dashboard-stats?month=${selectedMonth}`),
    request(users.salesA, `/api/sales-employee/stats?month=${selectedMonth}`),
    request(users.salesB, `/api/sales-employee/stats?month=${selectedMonth}`)
  ]);
  const financeTiles = finance.data.data.tiles;
  const salesTiles = [salesA.data.data.dashboardTiles, salesB.data.data.dashboardTiles];
  for (const [financeKey, salesKey] of [
    ['invoiced', 'invoiced'],
    ['receivable1To30', 'safeReceivable'],
    ['overdueGrace31To45', 'dueReceivable'],
    ['overdue45Plus', 'above45Days']
  ]) {
    const count = salesTiles.reduce((sum, tiles) => sum + tiles[salesKey].count, 0);
    const amountCents = salesTiles.reduce((sum, tiles) => sum + Math.round(tiles[salesKey].amount * 100), 0);
    assert.deepEqual(financeTiles[financeKey], { count, amountCents });
  }
});

test('current month carries open SOs and POs; a past month uses only that month events', async () => {
  const current = await request(users.finance, `/api/finance/dashboard-stats?month=${selectedMonth}`);
  assert.equal(current.data.data.tiles.so.count, 2);
  assert.equal(current.data.data.tiles.localPoIssued.count, 2);
  assert.equal(current.data.data.tiles.globalPoIssued.count, 2);

  const past = await request(users.finance, `/api/finance/dashboard-stats?month=${previousMonth}`);
  assert.deepEqual(past.data.data.tiles.so, { count: 2, amountCents: 50000 });
  assert.equal(past.data.data.tiles.localPoIssued.count, 1);
  assert.equal(past.data.data.tiles.globalPoIssued.count, 1);
});

test('Finance dashboard allows Finance, Accountant, Admin and CEO and blocks other departments', async () => {
  for (const user of [users.finance, users.accountant, users.admin, users.ceo]) {
    const result = await request(user, `/api/finance/dashboard-stats?month=${selectedMonth}`);
    assert.equal(result.response.status, 200, `${user.role}: ${JSON.stringify(result.data)}`);
  }
  for (const user of [users.salesA, users.logistics]) {
    const result = await request(user, `/api/finance/dashboard-stats?month=${selectedMonth}`);
    assert.equal(result.response.status, 403, `${user.role}: ${JSON.stringify(result.data)}`);
  }
});
