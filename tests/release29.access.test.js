const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
mongoose.set('autoIndex', false);
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r29_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 29 tests.');
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

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const Notification = require('../models/Notification');
const EditPermissionRequest = require('../models/EditPermissionRequest');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { deriveOrderTrackerStage } = require('../utils/orderTracker');

let server;
let baseUrl;
let users;
let draft;
let finalized;
const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (user, path, method = 'GET', body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { text }; }
  return { status: response.status, body: parsed };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const password = `Release29-${runId}`;
  const created = await User.create([
    { fullName: 'R29 Accounts', email: `r29.accounts.${runId}@example.com`, password, role: 'accountant', department: 'Accounts', status: 'active', isApproved: true },
    { fullName: 'R29 Finance', email: `r29.finance.${runId}@example.com`, password, role: 'finance', department: 'Finance', status: 'active', isApproved: true },
    { fullName: 'R29 CEO', email: `r29.ceo.${runId}@example.com`, password, role: 'ceo', department: 'Executive', status: 'active', isApproved: true },
    { fullName: 'R29 Admin', email: `r29.admin.${runId}@example.com`, password, role: 'admin', department: 'Administration', status: 'active', isApproved: true },
    { fullName: 'R29 Sales', email: `r29.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R29 Support', email: `r29.support.${runId}@example.com`, password, role: 'support', department: 'Support', status: 'active', isApproved: true },
    { fullName: 'R29 Tracker', email: `r29.tracker.${runId}@example.com`, password, role: 'order_tracker', department: 'Operations', status: 'active', isApproved: true, salaryTarget: 900000, monthlySalesSalaryCents: 10000000 }
  ]);
  users = Object.fromEntries(['accounts', 'finance', 'ceo', 'admin', 'sales', 'support', 'tracker'].map((key, index) => [key, created[index]]));
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 2900 });
  const order = await SalesOrder.create({
    orderNumber: `SO-R29-${runId}`, orderReference: `SO-R29-${runId}`, clientName: 'R29 Customer',
    owner: users.sales._id, salesPerson: users.sales._id, createdBy: users.sales._id,
    totalAmount: 1000, netAmount: 1180, tax: 180, currentDepartment: 'Finance',
    items: [{ partNumber: '120G-001', sku: 'FG-120G', description: 'Fortigate 120G', quantity: 1, unitPrice: 1000, total: 1000 }],
    workflowHistory: [{ userName: users.sales.fullName, department: 'Finance', action: 'Order sent to Finance', newStatus: 'Submitted to Finance', notes: 'Awaiting approval' }]
  });
  draft = await Invoice.create({
    invoiceNumber: `INV-R29-D-${runId}`, clientName: 'R29 Customer', salesOrderId: order._id,
    items: [{ partNumber: '', description: 'Fortigate 120G', quantity: 1, unitPrice: 1000, total: 1000 }],
    amount: 1180, subtotal: 1000, tax: 180, taxRate: 18, dueDate: new Date(Date.now() + 86400000),
    status: 'Pending Finance Finalization', isDraft: true, createdBy: users.accounts._id, salesPerson: users.sales._id
  });
  finalized = await Invoice.create({
    invoiceNumber: `INV-R29-F-${runId}`, clientName: 'R29 Customer', salesOrderId: order._id,
    items: [{ partNumber: '120G-001', description: 'Fortigate 120G', quantity: 1, unitPrice: 1000, total: 1000 }],
    amount: 1180, subtotal: 1000, tax: 180, taxRate: 18, dueDate: new Date(Date.now() + 86400000),
    status: 'Finalized', isDraft: false, createdBy: users.accounts._id, salesPerson: users.sales._id
  });
  await SupplierPO.create({
    poNumber: `LPO-R29-${runId}`, poType: 'Local', supplierName: 'R29 Supplier', salesOrderId: order._id,
    items: [{ productName: 'Fortigate 120G', description: 'Fortigate 120G', quantity: 1, unitPrice: 500, totalAmount: 500 }], subtotal: 500, totalAmount: 500,
    exchangeRateToPKR: 1, costingStatus: 'Completed', expenses: [{ category: 'Freight', amountCents: 10000, amountPKRCents: 10000, addedBy: users.finance._id }],
    createdBy: users.finance._id
  });
  server = http.createServer(app);
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolveServer => server.close(resolveServer));
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

test('Finance edits a draft directly while Accounts requires one-time Finance approval', async () => {
  const financeEdit = await request(users.finance, `/api/finance/invoices/${draft._id}`, 'PATCH', { notes: 'Finance direct draft edit' });
  assert.equal(financeEdit.status, 200, JSON.stringify(financeEdit.body));

  const denied = await request(users.accounts, `/api/sales-employee/invoices/${draft._id}`, 'PATCH', { notes: 'Accounts attempt' });
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /Finance edit approval required/);

  const createRequest = await request(users.accounts, '/api/edit-permissions/request', 'POST', {
    documentType: 'Draft Invoice', documentId: draft._id, reason: 'Correct part number', requestType: 'General'
  });
  assert.equal(createRequest.status, 201, JSON.stringify(createRequest.body));
  assert.equal(createRequest.body.data.approverRole, 'finance');
  assert.ok(await Notification.exists({ recipient: users.finance._id, title: /Finance Edit Permission Requested/ }));
  const ceoBlocked = await request(users.ceo, `/api/edit-permissions/requests/${createRequest.body.data._id}/respond`, 'PATCH', { status: 'Approved' });
  assert.equal(ceoBlocked.status, 403);
  const approved = await request(users.finance, `/api/edit-permissions/requests/${createRequest.body.data._id}/respond`, 'PATCH', { status: 'Approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const saved = await request(users.accounts, `/api/sales-employee/invoices/${draft._id}`, 'PATCH', {
    notes: 'Accounts approved edit', items: [{ partNumber: '120G-001', description: 'Fortigate 120G', quantity: 1, unitPrice: 1000 }]
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await Invoice.findById(draft._id)).items[0].partNumber, '120G-001');
  const usedAgain = await request(users.accounts, `/api/sales-employee/invoices/${draft._id}`, 'PATCH', { notes: 'Second edit' });
  assert.equal(usedAgain.status, 403);
});

test('Finance may reject an Accounts draft request', async () => {
  const created = await request(users.accounts, '/api/edit-permissions/request', 'POST', {
    documentType: 'Draft Invoice', documentId: draft._id, reason: 'Rejected correction', requestType: 'General'
  });
  assert.equal(created.status, 201);
  const rejected = await request(users.finance, `/api/edit-permissions/requests/${created.body.data._id}/respond`, 'PATCH', { status: 'Rejected', responseNote: 'Not required' });
  assert.equal(rejected.status, 200);
  assert.equal((await EditPermissionRequest.findById(created.body.data._id)).status, 'Rejected');
});

test('Finance finalized-invoice edits retain CEO approval and Sales/Support cannot edit', async () => {
  const denied = await request(users.finance, `/api/finance/invoices/${finalized._id}`, 'PATCH', { notes: 'Final correction' });
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /CEO edit approval required/);
  const created = await request(users.finance, '/api/edit-permissions/request', 'POST', {
    documentType: 'Final Invoice', documentId: finalized._id, reason: 'Final correction', requestType: 'General'
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.approverRole, 'ceo');
  const financeBlocked = await request(users.finance, `/api/edit-permissions/requests/${created.body.data._id}/respond`, 'PATCH', { status: 'Approved' });
  assert.equal(financeBlocked.status, 403);
  const approved = await request(users.ceo, `/api/edit-permissions/requests/${created.body.data._id}/respond`, 'PATCH', { status: 'Approved' });
  assert.equal(approved.status, 200);
  const saved = await request(users.finance, `/api/finance/invoices/${finalized._id}`, 'PATCH', { notes: 'CEO approved final correction' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  for (const user of [users.sales, users.support]) {
    const attempt = await request(user, `/api/finance/invoices/${draft._id}`, 'PATCH', { notes: 'blocked' });
    assert.equal(attempt.status, 403);
  }
});

test('old draft invoice GET resolves source part number and a save persists it without using SKU', async () => {
  const result = await request(users.accounts, '/api/sales-employee/invoices');
  assert.equal(result.status, 200);
  const row = result.body.data.find(item => String(item._id) === String(draft._id));
  assert.equal(row.items[0].partNumber, '120G-001');
  assert.notEqual(row.items[0].partNumber, 'FG-120G');
});

test('Order Tracker reads every owner, sees money, but never receives expense/costing/GP/salary/rate fields', async () => {
  const orders = await request(users.tracker, '/api/order-tracker/orders');
  assert.equal(orders.status, 200, JSON.stringify(orders.body));
  assert.ok(orders.body.data.some(row => row.salesperson === users.sales.fullName && row.amount === 1180));
  const pos = await request(users.tracker, '/api/order-tracker/records/supplier-pos');
  assert.equal(pos.status, 200);
  const serialized = JSON.stringify(pos.body);
  assert.match(serialized, /totalAmount/);
  assert.doesNotMatch(serialized, /purchaseExpenses|"expenses"|costingStatus|grossProfit|cogs|salary|exchangeRate/i);
  for (const profilePath of ['/api/auth/me', '/api/users/me']) {
    const profile = await request(users.tracker, profilePath);
    assert.equal(profile.status, 200);
    assert.doesNotMatch(JSON.stringify(profile.body), /salaryTarget|monthlySalesSalaryCents/i);
  }
  const before = (await SalesOrder.findById(orders.body.data[0]._id)).updatedAt.getTime();
  const detail = await request(users.tracker, `/api/order-tracker/orders/${orders.body.data[0]._id}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.data.timeline.some(event => event.stage === 'Order sent to Finance' && event.person === users.sales.fullName));
  const afterRead = (await SalesOrder.findById(orders.body.data[0]._id)).updatedAt.getTime();
  assert.equal(afterRead, before, 'Order Tracker GET changed data');
});

test('tracker derives department, stage and why across the requested workflow stages', () => {
  const pending = deriveOrderTrackerStage({ order: { status: 'Submitted to Finance' } });
  assert.deepEqual([pending.department, pending.stage, pending.why], ['Finance', 'Pending Finance Approval', 'Awaiting Finance approval']);
  assert.match(deriveOrderTrackerStage({ order: { financeApprovedAt: new Date(), workflowStatus: 'Local PO Issued / Awaiting Supplier Goods' }, supplierPOs: [{ poType: 'Local' }] }).why, /awaiting supplier goods/i);
  assert.match(deriveOrderTrackerStage({ order: { financeApprovedAt: new Date(), workflowStatus: 'Goods Arrived / Awaiting Support Verification' }, supplierPOs: [{ goodsReceiptReference: 'SUP-1' }] }).why, /Support verification/i);
  assert.equal(deriveOrderTrackerStage({ order: { financeApprovedAt: new Date() }, deliveryNotes: [{ status: 'Created' }] }).stage, 'DN Created');
  assert.equal(deriveOrderTrackerStage({ order: { deliveryStatus: 'Delivered' } }).stage, 'Delivered');
  assert.equal(deriveOrderTrackerStage({ order: {}, invoices: [{ status: 'Finalized', isDraft: false, amount: 100, paidAmount: 0 }] }).stage, 'Invoiced');
  assert.equal(deriveOrderTrackerStage({ order: {}, invoices: [{ status: 'Paid', amount: 100, paidAmount: 100, outstandingAmount: 0 }] }).stage, 'Paid');
});

const registeredMutationRoutes = () => {
  const root = resolve(__dirname, '..');
  const serverSource = readFileSync(resolve(root, 'server.js'), 'utf8');
  const imports = new Map([...serverSource.matchAll(/const\s+(\w+)\s*=\s*require\('\.\/routes\/([^']+)'\)/g)].map(match => [match[1], match[2]]));
  const mounts = [...serverSource.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)];
  const found = [];
  for (const [, mount, variable] of mounts) {
    const file = imports.get(variable);
    if (!file) continue;
    const source = readFileSync(resolve(root, 'routes', `${file}.js`), 'utf8');
    for (const match of source.matchAll(/router\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi)) found.push([match[1].toUpperCase(), `${mount}${match[2]}`]);
    for (const match of source.matchAll(/router\.route\(\s*['"]([^'"]+)['"]\s*\)([\s\S]*?);/gi)) {
      for (const verb of match[2].matchAll(/\.(post|put|patch|delete)\s*\(/gi)) found.push([verb[1].toUpperCase(), `${mount}${match[1]}`]);
    }
  }
  return [...new Map(found.map(route => [`${route[0]} ${route[1]}`, route])).values()];
};

test('every registered mutation route is centrally denied to Order Tracker except explicit self-service exceptions', async () => {
  const exceptions = [
    ['PUT', '/api/auth/update-password'], ['POST', '/api/auth/logout'],
    ['PATCH', '/api/notifications/read-all'], ['PATCH', '/api/notifications/507f1f77bcf86cd799439011/read']
  ];
  const exceptionKeys = new Set(exceptions.map(([method, path]) => `${method} ${path.replace(/507f1f77bcf86cd799439011/, ':id')}`));
  const routes = registeredMutationRoutes();
  assert.ok(routes.length > 70, `Only ${routes.length} mutation routes were enumerated`);
  console.log(`R29_MUTATION_ROUTE_COUNT=${routes.length}`);
  for (const [method, template] of routes) {
    const normalizedTemplate = template.replace(/:[A-Za-z0-9_]+/g, ':id');
    if (exceptionKeys.has(`${method} ${normalizedTemplate}`)) continue;
    const path = template.replace(/:([A-Za-z0-9_]+)/g, (_, name) => name.toLowerCase().includes('token') ? 'token' : '507f1f77bcf86cd799439011');
    const result = await request(users.tracker, path, method, {});
    assert.equal(result.status, 403, `${method} ${template} was not denied: ${JSON.stringify(result.body)}`);
  }
  const markAll = await request(users.tracker, '/api/notifications/read-all', 'PATCH', {});
  assert.equal(markAll.status, 200);
  const markOne = await request(users.tracker, '/api/notifications/507f1f77bcf86cd799439011/read', 'PATCH', {});
  assert.notEqual(markOne.status, 403);
  const password = await request(users.tracker, '/api/auth/update-password', 'PUT', { currentPassword: 'wrong', newPassword: 'NewPass123' });
  assert.notEqual(password.status, 403);
  const logout = await request(users.tracker, '/api/auth/logout', 'POST', {});
  assert.equal(logout.status, 200);
});
