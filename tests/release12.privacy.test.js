const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release12-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r12_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 12 tests.');
assert.notEqual(tempDbName, 'test');
assert.notEqual(tempDbName, 'fortline_dev');

const useDatabase = (uri, databaseName) => {
  const queryAt = uri.indexOf('?');
  const query = queryAt >= 0 ? uri.slice(queryAt) : '';
  const withoutQuery = queryAt >= 0 ? uri.slice(0, queryAt) : uri;
  const schemeAt = withoutQuery.indexOf('://');
  assert.notEqual(schemeAt, -1, 'MONGODB_URI is invalid.');
  const pathAt = withoutQuery.indexOf('/', schemeAt + 3);
  const authority = pathAt >= 0 ? withoutQuery.slice(0, pathAt) : withoutQuery;
  return `${authority}/${databaseName}${query}`;
};
process.env.MONGODB_URI = useDatabase(sourceMongoUri, tempDbName);

const connectDB = require('../config/db');
const app = require('../server');
const Client = require('../models/Client');
const Counter = require('../models/Counter');
const CustomerPO = require('../models/CustomerPO');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const PriceRequest = require('../models/PriceRequest');
const ProductFile = require('../models/ProductFile');
const SalesActivity = require('../models/SalesActivity');
const SalesContact = require('../models/SalesContact');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let salesA;
let salesB;
let manager;
let admin;
let ceo;
let finance;
let accountant;
let logistics;
let hr;
let ownRecords;
let otherRecords;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '15m' });
const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
};

const dropTemporaryDatabase = async () => {
  assert.equal(mongoose.connection.name, tempDbName);
  assert.ok(mongoose.connection.name.startsWith(TEMP_DB_PREFIX));
  try {
    await mongoose.connection.dropDatabase();
  } catch (error) {
    if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
  }
};

const createRecordSet = async (owner, label) => {
  const order = await SalesOrder.create({
    orderNumber: `SO-${label}`, orderReference: `SO-${label}`, clientName: `${label} customer`,
    owner: owner._id, salesPerson: owner._id, createdBy: owner._id,
    items: [{ product: `${label} product`, description: `${label} product`, quantity: 1, unitPrice: 10, total: 10 }]
  });
  const customerPO = await CustomerPO.create({ customerName: `${label} customer`, poNumber: `CPO-${label}`, owner: owner._id, createdBy: owner._id });
  const productFile = await ProductFile.create({ customerName: `${label} customer`, fileNumber: `PF-${label}`, owner: owner._id, createdBy: owner._id });
  const invoice = await Invoice.create({
    invoiceNumber: `INV-${label}`, clientName: `${label} customer`, amount: 10,
    dueDate: new Date(Date.now() + 86400000), salesPerson: owner._id, createdBy: owner._id
  });
  const payment = await Payment.create({ customerName: `${label} customer`, amount: 1, salesPerson: owner._id, createdBy: owner._id });
  const deliveryNote = await DeliveryNote.create({
    deliveryNumber: `DN-${label}`, deliveryNoteNumber: `DN-${label}`, salesOrder: order._id,
    salesOrderNumber: order.orderNumber, clientName: `${label} customer`, salesPerson: owner._id,
    createdBy: owner._id, items: [{ product: `${label} product`, quantity: 1, orderItemId: String(order.items[0]._id) }]
  });
  const activity = await SalesActivity.create({ type: 'Other', description: `${label} activity`, performedBy: owner._id });
  return { order, customerPO, productFile, invoice, payment, deliveryNote, activity };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 1 });
  const password = `Release12-${runId}`;
  [salesA, salesB, manager, admin, ceo, finance, accountant, logistics, hr] = await User.create([
    { fullName: 'R12 Sales A', email: `r12.a.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R12 Sales B', email: `r12.b.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R12 Manager', email: `r12.manager.${runId}@example.com`, password, role: 'sales_manager', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R12 Admin', email: `r12.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R12 CEO', email: `r12.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R12 Finance', email: `r12.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R12 Accounts', email: `r12.accounts.${runId}@example.com`, password, role: 'accountant', status: 'active', isApproved: true },
    { fullName: 'R12 Logistics', email: `r12.logistics.${runId}@example.com`, password, role: 'logistics', status: 'active', isApproved: true },
    { fullName: 'R12 HR', email: `r12.hr.${runId}@example.com`, password, role: 'hr_manager', status: 'active', isApproved: true }
  ]);
  ownRecords = await createRecordSet(manager, `M${runId}`);
  otherRecords = await createRecordSet(salesB, `B${runId}`);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await dropTemporaryDatabase();
  await mongoose.disconnect();
});

test('sales manager aggregate endpoints return only the manager own records', async () => {
  const endpoints = [
    '/dashboard-stats', '/all-orders', '/all-customer-pos', '/all-product-files',
    '/all-payments', '/all-activities', '/all-delivery-notes', '/invoices'
  ];
  for (const endpoint of endpoints) {
    const result = await request(manager, `/api/sales-manager${endpoint}`);
    assert.equal(result.response.status, 200, `${endpoint}: ${JSON.stringify(result.data)}`);
    const payload = JSON.stringify(result.data);
    assert.ok(!payload.includes(`B${runId}`), `${endpoint} leaked another salesperson record`);
  }
  for (const privileged of [admin, ceo]) {
    const result = await request(privileged, '/api/sales-manager/all-orders');
    assert.equal(result.response.status, 200);
    const ids = result.data.data.map(item => item._id);
    assert.ok(ids.includes(ownRecords.order._id.toString()));
    assert.ok(ids.includes(otherRecords.order._id.toString()));
  }
});

test('manager and salesperson by-id actions reject another owner with 403', async () => {
  const managerAttempts = [
    ['GET', `/api/sales-manager/invoices/${otherRecords.invoice._id}`],
    ['PATCH', `/api/sales-manager/invoices/${otherRecords.invoice._id}`, { status: 'Approved' }],
    ['DELETE', `/api/sales-manager/invoices/${otherRecords.invoice._id}`],
    ['PATCH', `/api/sales-manager/delivery-notes/${otherRecords.deliveryNote._id}`, { notes: 'blocked' }],
    ['DELETE', `/api/sales-manager/delivery-notes/${otherRecords.deliveryNote._id}`],
    ['POST', '/api/sales-manager/delivery-notes', { salesOrderId: otherRecords.order._id, items: [] }],
    ['PATCH', `/api/sales-employee/delivery-notes/${otherRecords.deliveryNote._id}`, { notes: 'blocked' }],
    ['DELETE', `/api/sales-employee/delivery-notes/${otherRecords.deliveryNote._id}`],
    ['POST', '/api/sales-employee/delivery-notes', { salesOrderId: otherRecords.order._id, items: [] }]
  ];
  for (const [method, path, body] of managerAttempts) {
    const result = await request(manager, path, { method, body: body ? JSON.stringify(body) : undefined });
    assert.equal(result.response.status, 403, `${method} ${path}: ${JSON.stringify(result.data)}`);
  }
  const invoicePatch = await request(salesA, `/api/sales-employee/invoices/${otherRecords.invoice._id}`, {
    method: 'PATCH', body: JSON.stringify({ notes: 'blocked' })
  });
  assert.equal(invoicePatch.response.status, 403);
});

test('sales manager team-management and target mutations are all forbidden', async () => {
  const attempts = [
    ['GET', '/api/sales-manager/team-members'],
    ['GET', `/api/sales-manager/team-members/${salesB._id}/profile`],
    ['PATCH', `/api/sales-manager/team-members/${salesB._id}/details`, {}],
    ['DELETE', `/api/sales-manager/team-members/${salesB._id}`],
    ['POST', '/api/sales-manager/invite-member', {}],
    ['POST', '/api/sales-manager/assign-lead', {}],
    ['POST', '/api/sales-manager/assign-followup', {}],
    ['POST', '/api/sales-manager/targets', {}],
    ['PATCH', `/api/sales-manager/targets/${salesB._id}`, {}],
    ['DELETE', `/api/sales-manager/targets/${salesB._id}`]
  ];
  for (const [method, path, body] of attempts) {
    const result = await request(manager, path, { method, body: body ? JSON.stringify(body) : undefined });
    assert.equal(result.response.status, 403, `${method} ${path}: ${JSON.stringify(result.data)}`);
  }
});

test('clients, contacts, sidebar counts and user directory are privacy-safe for Sales roles', async () => {
  const ownClient = await Client.create({ name: `A client ${runId}`, createdBy: salesA._id });
  const otherClient = await Client.create({ name: `B client ${runId}`, createdBy: salesB._id });
  const ownContact = await SalesContact.create({ name: `A contact ${runId}`, createdBy: salesA._id });
  const otherContact = await SalesContact.create({ name: `B contact ${runId}`, createdBy: salesB._id });

  for (const [path, ownId, otherId] of [
    ['/api/crm/clients', ownClient._id, otherClient._id],
    ['/api/crm/contacts', ownContact._id, otherContact._id]
  ]) {
    const list = await request(salesA, path);
    const ids = list.data.data.map(item => item._id);
    assert.ok(ids.includes(ownId.toString()));
    assert.ok(!ids.includes(otherId.toString()));
    const denied = await request(salesA, `${path}/${otherId}`, { method: 'DELETE' });
    assert.equal(denied.response.status, 403);
    const global = await request(admin, path);
    assert.ok(global.data.data.some(item => item._id === otherId.toString()));
  }

  const users = await request(salesA, '/api/users');
  assert.equal(users.response.status, 200);
  assert.ok(users.data.data.length >= 2);
  for (const user of users.data.data) assert.deepEqual(Object.keys(user).sort(), ['_id', 'name', 'role']);

  const counts = await request(salesA, '/api/users/sidebar-counts');
  assert.equal(counts.response.status, 200);
  assert.equal(counts.data.data.clients, 1);
});

test('Price Requests remain global and Sales notifications go only to the effective owner', async () => {
  const priceRequest = await PriceRequest.create({
    requestNumber: `PR-R12-${runId}`, requestedBy: salesB._id, requestedFrom: finance._id,
    brand: 'Dell', category: 'Servers', leadSource: 'Email', requirement: 'Global visibility check', quantity: 1
  });
  for (const user of [salesA, manager]) {
    const result = await request(user, '/api/price-requests');
    assert.equal(result.response.status, 200);
    assert.ok(result.data.data.some(item => item._id === priceRequest._id.toString()));
  }

  await Notification.deleteMany({ title: 'New Lead Created' });
  const created = await request(salesA, '/api/sales-employee/leads', {
    method: 'POST', body: JSON.stringify({ name: `Owner-only lead ${runId}` })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const notifications = await Notification.find({ title: 'New Lead Created' }).lean();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient.toString(), salesA._id.toString());
});

test('department router guards deny Sales roles and preserve legitimate department access', async () => {
  const guarded = ['/api/finance/summary', '/api/logistics/stats', '/api/hr/stats'];
  for (const user of [salesA, manager]) {
    for (const path of guarded) {
      const result = await request(user, path);
      assert.equal(result.response.status, 403, `${user.role} ${path}: ${JSON.stringify(result.data)}`);
    }
  }

  for (const [user, path] of [
    [finance, '/api/finance/summary'], [accountant, '/api/finance/summary'],
    [logistics, '/api/logistics/stats'], [hr, '/api/hr/stats'],
    [admin, '/api/finance/summary'], [ceo, '/api/logistics/stats']
  ]) {
    const result = await request(user, path);
    assert.equal(result.response.status, 200, `${user.role} ${path}: ${JSON.stringify(result.data)}`);
  }
});
