const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

process.env.NODE_ENV = 'test';
mongoose.set('autoIndex', false);
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r15_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 15 tests.');
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
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const DeliveryNote = require('../models/DeliveryNote');
const SalesOrder = require('../models/SalesOrder');
const SupportTicket = require('../models/SupportTicket');

let server;
let baseUrl;
let users;
let deliveryNote;
const selectedMonth = new Date().toISOString().slice(0, 7);
const selectedDate = new Date(`${selectedMonth}-10T12:00:00.000Z`);
const previousDate = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 10, 12));
const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;
const utcDaysFromToday = days => {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
};

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
const setDates = (Model, id, date = selectedDate) => Model.collection.updateOne(
  { _id: id },
  { $set: { createdAt: date, updatedAt: date } }
);
const insertOrder = async fields => {
  const _id = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id,
    orderNumber: `SO-R15-${String(_id).slice(-6)}`,
    orderReference: `SO-R15-${String(_id).slice(-6)}`,
    clientName: 'Release 15 Customer',
    items: [],
    totalAmount: 0,
    netAmount: 0,
    createdAt: selectedDate,
    updatedAt: selectedDate,
    ...fields
  });
  return _id;
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');

  const password = `Release15-${runId}`;
  const created = await User.create([
    { fullName: 'Release 15 Support', email: `r15.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true },
    { fullName: 'Release 15 Admin', email: `r15.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'Release 15 CEO', email: `r15.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'Release 15 Local', email: `r15.local.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'Release 15 Global', email: `r15.global.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true },
    { fullName: 'Release 15 Sales', email: `r15.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true }
  ]);
  users = { support: created[0], admin: created[1], ceo: created[2], local: created[3], global: created[4], sales: created[5] };

  const localQueue = await insertOrder({
    fileType: 'Green', currentDepartment: 'Local Purchaser', departmentResponsible: 'Local Purchaser',
    workflowStatus: 'Pending Local Procurement', financeApprovedBy: users.admin._id, totalAmount: 100.25, netAmount: 100.25
  });
  await insertOrder({
    fileType: 'Green', currentDepartment: 'Support', departmentResponsible: 'Support',
    workflowStatus: 'Goods Received in Office', inventoryFulfilledFromExistingStock: true,
    totalAmount: 200, netAmount: 200
  });
  await insertOrder({
    fileType: 'Green', currentDepartment: 'Support', departmentResponsible: 'Support',
    workflowStatus: 'Local Supplier PO Issued', totalAmount: 400, netAmount: 400
  });
  const globalQueue = await insertOrder({
    fileType: 'Blue', currentDepartment: 'Global Purchaser', departmentResponsible: 'Global Purchaser',
    workflowStatus: 'Pending Global Procurement', financeApprovedBy: users.admin._id, totalAmount: 500, netAmount: 500
  });
  await insertOrder({
    fileType: 'Blue', currentDepartment: 'Logistics', departmentResponsible: 'Logistics',
    workflowStatus: 'In Logistics', lastActionAt: selectedDate, totalAmount: 600, netAmount: 600,
    workflowHistory: [{ department: 'Global Purchaser', newStatus: 'In Logistics', timestamp: selectedDate }]
  });

  const [localPo, globalPoWithRate, globalPoMissingRate] = await SupplierPO.create([
    { poNumber: `LPO-R15-${runId}`, supplierName: 'Local Supplier', poType: 'Local', totalAmount: 300, currency: 'PKR', salesOrderId: localQueue, createdBy: users.local._id },
    { poNumber: `GPO-R15-A-${runId}`, supplierName: 'Global Supplier A', poType: 'Global', totalAmount: 10, total: 10, currency: 'USD', exchangeRateToPKR: 280, salesOrderId: globalQueue, createdBy: users.global._id },
    { poNumber: `GPO-R15-B-${runId}`, supplierName: 'Global Supplier B', poType: 'Global', totalAmount: 20, total: 20, currency: 'EUR', exchangeRateToPKR: null, salesOrderId: globalQueue, createdBy: users.global._id }
  ]);
  await Promise.all([localPo, globalPoWithRate, globalPoMissingRate].map(po => setDates(SupplierPO, po._id)));

  await PurchaserGRN.create([
    { grnNumber: `GRN-R15-L-${runId}`, grnType: 'Supplier', supplierPO: localPo._id, salesOrder: localQueue, createdBy: users.support._id },
    { grnNumber: `GRN-R15-G-${runId}`, grnType: 'Support Inventory IN', supplierPO: globalPoWithRate._id, salesOrder: globalQueue, createdBy: users.support._id },
    { grnNumber: `GRN-R15-X-${runId}`, grnType: 'Supplier', supplierPO: localPo._id, salesOrder: localQueue, createdBy: users.local._id }
  ]);

  const dnId = new mongoose.Types.ObjectId();
  await DeliveryNote.collection.insertOne({
    _id: dnId,
    deliveryNumber: `DN-R15-${runId}`,
    deliveryNoteNumber: `DN-R15-${runId}`,
    salesOrder: localQueue,
    status: 'Created',
    createdBy: users.support._id,
    createdAt: selectedDate,
    updatedAt: selectedDate
  });
  deliveryNote = await DeliveryNote.findById(dnId);

  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
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

test('Local and Global dashboard tiles use queue records, cents, stock/PO split and stored FX rates', async () => {
  const local = await request(users.local, `/api/purchaser/stats?type=Local&month=${selectedMonth}`);
  assert.equal(local.response.status, 200, JSON.stringify(local.data));
  assert.deepEqual(local.data.data.tiles.saleOrderReceived, { count: 3, amountCents: 70025 });
  assert.deepEqual(local.data.data.tiles.soStock, { count: 1, amountCents: 20000 });
  assert.deepEqual(local.data.data.tiles.poIssued, { count: 1, amountCents: 30000, missingExchangeRateCount: 0 });

  const global = await request(users.global, `/api/purchaser/stats?type=Global&month=${selectedMonth}`);
  assert.equal(global.response.status, 200, JSON.stringify(global.data));
  assert.deepEqual(global.data.data.tiles.saleOrderReceived, { count: 2, amountCents: 110000 });
  assert.deepEqual(global.data.data.tiles.poIssued, { count: 2, amountCents: 280000, missingExchangeRateCount: 1 });
  assert.deepEqual(global.data.data.tiles.sentToLogistic, { count: 1, amountCents: 60000 });
});

test('Support dashboard shows total/Local/Global GRNs and includes expiry day 45 but not day 46', async () => {
  const updated = await request(users.support, `/api/sales-employee/delivery-notes/${deliveryNote._id}/expiry`, {
    method: 'PATCH', body: JSON.stringify({ expiryDate: utcDaysFromToday(45).toISOString().slice(0, 10) })
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
  await DeliveryNote.collection.insertMany([
    {
      _id: new mongoose.Types.ObjectId(), deliveryNumber: `DN-R15-PAST-${runId}`, deliveryNoteNumber: `DN-R15-PAST-${runId}`,
      status: 'Created', expiryDate: utcDaysFromToday(-1), createdBy: users.support._id, createdAt: previousDate, updatedAt: previousDate
    },
    {
      _id: new mongoose.Types.ObjectId(), deliveryNumber: `DN-R15-46-${runId}`, deliveryNoteNumber: `DN-R15-46-${runId}`,
      status: 'Created', expiryDate: utcDaysFromToday(46), createdBy: users.support._id, createdAt: previousDate, updatedAt: previousDate
    }
  ]);
  const result = await request(users.support, `/api/sales-employee/support/stats?month=${selectedMonth}`);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.data.tiles.dnCreated.count, 1);
  assert.deepEqual(result.data.data.tiles.grnInput, { total: 2, local: 1, global: 1 });
  assert.equal(result.data.data.tiles.expiryDateNotification.count, 2);
  assert.equal(result.data.data.expirySupported, true);
  assert.equal(result.data.data.expiryWindowDays, 45);
  assert.equal(result.data.data.tiles.saleOrderReceived.count, 2);
});

test('Support tickets require a valid DN; Support writes while Admin/CEO are read-only', async () => {
  const missing = await request(users.support, '/api/support-tickets', { method: 'POST', body: JSON.stringify({ complaint: 'Missing DN' }) });
  assert.equal(missing.response.status, 400);
  const invalid = await request(users.support, '/api/support-tickets', { method: 'POST', body: JSON.stringify({ deliveryNoteNumber: 'DN-NOT-FOUND', complaint: 'Invalid DN' }) });
  assert.equal(invalid.response.status, 400);
  const pending = await request(users.support, '/api/support-tickets', {
    method: 'POST', body: JSON.stringify({ deliveryNoteNumber: deliveryNote.deliveryNoteNumber, complaint: 'Pending is invalid', status: 'Pending' })
  });
  assert.equal(pending.response.status, 400);

  const created = await request(users.support, '/api/support-tickets', {
    method: 'POST', body: JSON.stringify({ deliveryNoteNumber: deliveryNote.deliveryNoteNumber, complaint: 'Damaged carton' })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.data.status, 'Received');

  const solved = await request(users.support, `/api/support-tickets/${created.data.data._id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Solved' })
  });
  assert.equal(solved.response.status, 200);
  assert.ok(solved.data.data.solvedAt);

  const [oldUnsolved, oldSolved] = await SupportTicket.create([
    { deliveryNote: deliveryNote._id, deliveryNoteNumber: deliveryNote.deliveryNoteNumber, complaint: 'Old unsolved', status: 'Received', createdBy: users.support._id },
    { deliveryNote: deliveryNote._id, deliveryNoteNumber: deliveryNote.deliveryNoteNumber, complaint: 'Old solved', status: 'Solved', solvedAt: previousDate, createdBy: users.support._id }
  ]);
  await Promise.all([setDates(SupportTicket, oldUnsolved._id, previousDate), setDates(SupportTicket, oldSolved._id, previousDate)]);

  for (const reader of [users.support, users.admin, users.ceo]) {
    const list = await request(reader, '/api/support-tickets');
    assert.equal(list.response.status, 200);
    assert.equal(list.data.count, 3);
  }
  const adminWrite = await request(users.admin, '/api/support-tickets', {
    method: 'POST', body: JSON.stringify({ deliveryNoteNumber: deliveryNote.deliveryNoteNumber, complaint: 'Admin write' })
  });
  assert.equal(adminWrite.response.status, 403);
  const salesRead = await request(users.sales, '/api/support-tickets');
  assert.equal(salesRead.response.status, 403);

  const stats = await request(users.support, `/api/sales-employee/support/stats?month=${selectedMonth}`);
  assert.equal(stats.data.data.tiles.ticketReceived.count, 2);
  assert.equal(stats.data.data.tiles.ticketResolved.count, 1);
  const previousStats = await request(users.support, `/api/sales-employee/support/stats?month=${previousMonth}`);
  assert.equal(previousStats.data.data.tiles.ticketReceived.count, 2);
  assert.equal(previousStats.data.data.tiles.ticketResolved.count, 1);
});

test('current purchaser dashboards carry incomplete prior-month records but exclude completed ones', async () => {
  const oldLocalOpen = await insertOrder({
    fileType: 'Green', currentDepartment: 'Support', workflowStatus: 'Goods Received in Office',
    financeApprovedAt: previousDate, inventoryFulfilledFromExistingStock: true,
    totalAmount: 50, netAmount: 50, createdAt: previousDate, updatedAt: previousDate
  });
  const oldLocalDone = await insertOrder({
    fileType: 'Green', currentDepartment: 'Accounts', workflowStatus: 'Delivery Note Confirmed', deliveryStatus: 'Fully Delivered',
    financeApprovedAt: previousDate, inventoryFulfilledFromExistingStock: true,
    totalAmount: 60, netAmount: 60, createdAt: previousDate, updatedAt: previousDate
  });
  const oldGlobalOpen = await insertOrder({
    fileType: 'Blue', currentDepartment: 'Logistics', workflowStatus: 'In Logistics', financeApprovedAt: previousDate,
    totalAmount: 55, netAmount: 55, createdAt: previousDate, updatedAt: previousDate, lastActionAt: previousDate,
    workflowHistory: [{ department: 'Global Purchaser', newStatus: 'In Logistics', timestamp: previousDate }]
  });
  const oldGlobalDone = await insertOrder({
    fileType: 'Blue', currentDepartment: 'Accounts', workflowStatus: 'Delivery Note Confirmed', deliveryStatus: 'Fully Delivered',
    financeApprovedAt: previousDate, totalAmount: 65, netAmount: 65, createdAt: previousDate, updatedAt: previousDate,
    workflowHistory: [{ department: 'Global Purchaser', newStatus: 'In Logistics', timestamp: previousDate }]
  });
  const oldPOs = await SupplierPO.create([
    { poNumber: `LPO-R15-OLD-OPEN-${runId}`, supplierName: 'Local Old Open', poType: 'Local', poDate: previousDate, totalAmount: 90, currency: 'PKR', salesOrderId: oldLocalOpen, createdBy: users.local._id },
    { poNumber: `LPO-R15-OLD-DONE-${runId}`, supplierName: 'Local Old Done', poType: 'Local', poDate: previousDate, totalAmount: 100, currency: 'PKR', salesOrderId: oldLocalDone, createdBy: users.local._id },
    { poNumber: `GPO-R15-OLD-OPEN-${runId}`, supplierName: 'Global Old Open', poType: 'Global', poDate: previousDate, totalAmount: 110, currency: 'PKR', salesOrderId: oldGlobalOpen, createdBy: users.global._id },
    { poNumber: `GPO-R15-OLD-DONE-${runId}`, supplierName: 'Global Old Done', poType: 'Global', poDate: previousDate, totalAmount: 120, currency: 'PKR', salesOrderId: oldGlobalDone, createdBy: users.global._id }
  ]);
  await Promise.all(oldPOs.map(po => setDates(SupplierPO, po._id, previousDate)));

  const currentLocal = (await request(users.local, `/api/purchaser/stats?type=Local&month=${selectedMonth}`)).data.data.tiles;
  assert.deepEqual(currentLocal.saleOrderReceived, { count: 4, amountCents: 75025 });
  assert.deepEqual(currentLocal.soStock, { count: 2, amountCents: 25000 });
  assert.deepEqual(currentLocal.poIssued, { count: 2, amountCents: 39000, missingExchangeRateCount: 0 });
  const currentGlobal = (await request(users.global, `/api/purchaser/stats?type=Global&month=${selectedMonth}`)).data.data.tiles;
  assert.deepEqual(currentGlobal.saleOrderReceived, { count: 3, amountCents: 115500 });
  assert.deepEqual(currentGlobal.poIssued, { count: 3, amountCents: 291000, missingExchangeRateCount: 1 });
  assert.deepEqual(currentGlobal.sentToLogistic, { count: 2, amountCents: 65500 });

  const pastLocal = (await request(users.local, `/api/purchaser/stats?type=Local&month=${previousMonth}`)).data.data.tiles;
  assert.deepEqual(pastLocal.saleOrderReceived, { count: 2, amountCents: 11000 });
  assert.deepEqual(pastLocal.soStock, { count: 2, amountCents: 11000 });
  assert.deepEqual(pastLocal.poIssued, { count: 2, amountCents: 19000, missingExchangeRateCount: 0 });
  const pastGlobal = (await request(users.global, `/api/purchaser/stats?type=Global&month=${previousMonth}`)).data.data.tiles;
  assert.deepEqual(pastGlobal.saleOrderReceived, { count: 2, amountCents: 12000 });
  assert.deepEqual(pastGlobal.poIssued, { count: 2, amountCents: 23000, missingExchangeRateCount: 0 });
  assert.deepEqual(pastGlobal.sentToLogistic, { count: 2, amountCents: 12000 });
});

test('dashboard routes allow intended departments and block unrelated roles', async () => {
  for (const user of [users.support, users.admin, users.ceo]) {
    const result = await request(user, `/api/sales-employee/support/stats?month=${selectedMonth}`);
    assert.equal(result.response.status, 200);
  }
  assert.equal((await request(users.sales, `/api/sales-employee/support/stats?month=${selectedMonth}`)).response.status, 403);
  assert.equal((await request(users.support, `/api/purchaser/stats?type=Local&month=${selectedMonth}`)).response.status, 403);
  assert.equal((await request(users.local, `/api/purchaser/stats?type=Global&month=${selectedMonth}`)).response.status, 403);
  assert.equal((await request(users.global, `/api/purchaser/stats?type=Local&month=${selectedMonth}`)).response.status, 403);
});
