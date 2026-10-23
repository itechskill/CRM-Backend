const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release6-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r6_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 6 tests.');
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
const Counter = require('../models/Counter');
const CustomerPO = require('../models/CustomerPO');
const Lead = require('../models/Lead');
const Notification = require('../models/Notification');
const ProductFile = require('../models/ProductFile');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let userA;
let userB;
let userC;
let manager;
let admin;
let ceo;
let finance;

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

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  await Counter.create([{ _id: getCounterKey('file-number'), sequence: 3000 }, { _id: getCounterKey('sales-order-number'), sequence: 1 }]);
  const password = `Release6-${runId}`;
  [userA, userB, userC, manager, admin, ceo, finance] = await User.create([
    { fullName: 'R6 Sales A', email: `r6.a.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R6 Sales B', email: `r6.b.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R6 Sales C', email: `r6.c.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R6 Manager', email: `r6.manager.${runId}@example.com`, password, role: 'sales_manager', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R6 Admin', email: `r6.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R6 CEO', email: `r6.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R6 Finance', email: `r6.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true }
  ]);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await dropTemporaryDatabase();
  await mongoose.disconnect();
});

test('Sales user A cannot search, update, or convert user B records by id', async () => {
  const unique = `private-${runId}`;
  const lead = await Lead.create({ name: unique, owner: userB._id, assignedTo: userB._id, createdBy: userB._id });
  const quotation = await Quotation.create({ clientName: unique, salePerson: userA.fullName, owner: userB._id, originalOwner: userB._id, createdBy: userB._id });
  const po = await CustomerPO.create({ customerName: unique, quotationId: quotation._id, owner: userB._id, createdBy: userB._id });
  const file = await ProductFile.create({ customerName: unique, quotationId: quotation._id, customerPOId: po._id, owner: userB._id, createdBy: userB._id });
  const order = await SalesOrder.create({ clientName: unique, owner: userB._id, salesPerson: userB._id, createdBy: userB._id });

  for (const path of [`/quotations?status=all&search=${unique}`, `/leads?search=${unique}`, `/orders?status=all&search=${unique}`]) {
    const result = await request(userA, `/api/sales-employee${path}`);
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.count, 0);
  }

  const attempts = [
    ['PATCH', `/leads/${lead._id}`, { name: 'stolen' }],
    ['POST', `/leads/${lead._id}/convert-to-deal`, {}],
    ['PATCH', `/quotations/${quotation._id}`, { notes: 'stolen' }],
    ['POST', `/quotations/${quotation._id}/convert-to-po`, {}],
    ['PATCH', `/customer-pos/${po._id}`, { notes: 'stolen' }],
    ['POST', `/customer-pos/${po._id}/convert-to-file`, {}],
    ['PATCH', `/product-files/${file._id}`, { notes: 'stolen' }],
    ['POST', `/product-files/${file._id}/convert-to-order`, {}],
    ['PATCH', `/orders/${order._id}`, { notes: 'stolen' }]
  ];
  for (const [method, path, body] of attempts) {
    const result = await request(userA, `/api/sales-employee${path}`, { method, body: JSON.stringify(body) });
    assert.equal(result.response.status, 403, `${method} ${path}: ${JSON.stringify(result.data)}`);
  }
});

test('non-Sales department roles cannot use Sales write endpoints', async () => {
  const result = await request(finance, '/api/sales-employee/quotations', {
    method: 'POST', body: JSON.stringify({ clientName: 'Finance must not create this', issuingCompanyCode: 'FORTLINE_ENTERPRISES' })
  });
  assert.equal(result.response.status, 403);
});

test('Sales Manager is own-only while Admin and CEO can see all Sales records', async () => {
  const own = await Quotation.create({ clientName: `Manager own ${runId}`, owner: manager._id, originalOwner: manager._id, createdBy: manager._id });
  const other = await Quotation.create({ clientName: `A record ${runId}`, owner: userA._id, originalOwner: userA._id, createdBy: userA._id });
  const ownLead = await Lead.create({ name: `Manager lead ${runId}`, owner: manager._id, createdBy: manager._id });
  const otherLead = await Lead.create({ name: `A lead ${runId}`, owner: userA._id, createdBy: userA._id });

  const managerList = await request(manager, '/api/sales-employee/quotations?status=all');
  assert.equal(managerList.response.status, 200);
  assert.ok(managerList.data.data.some(item => item._id === own._id.toString()));
  assert.ok(!managerList.data.data.some(item => item._id === other._id.toString()));
  const managerLeads = await request(manager, '/api/sales-employee/leads');
  assert.ok(managerLeads.data.data.some(item => item._id === ownLead._id.toString()));
  assert.ok(!managerLeads.data.data.some(item => item._id === otherLead._id.toString()));

  for (const privileged of [admin, ceo]) {
    const list = await request(privileged, '/api/sales-employee/quotations?status=all');
    assert.equal(list.response.status, 200);
    assert.ok(list.data.data.some(item => item._id === own._id.toString()));
    assert.ok(list.data.data.some(item => item._id === other._id.toString()));
    const leadList = await request(privileged, '/api/sales-employee/leads');
    assert.ok(leadList.data.data.some(item => item._id === ownLead._id.toString()));
    assert.ok(leadList.data.data.some(item => item._id === otherLead._id.toString()));
  }
});

test('legacy records without owner fall back to createdBy without being modified', async () => {
  const legacy = await Quotation.create({ clientName: `Legacy owner fallback ${runId}`, createdBy: userB._id });
  assert.equal(legacy.owner, null);
  const aList = await request(userA, `/api/sales-employee/quotations?status=all&search=${encodeURIComponent('Legacy owner fallback')}`);
  const bList = await request(userB, `/api/sales-employee/quotations?status=all&search=${encodeURIComponent('Legacy owner fallback')}`);
  assert.equal(aList.data.count, 0);
  assert.ok(bList.data.data.some(item => item._id === legacy._id.toString()));
  const unchanged = await Quotation.findById(legacy._id).lean();
  assert.equal(unchanged.owner, null);
});

test('quotation forwarding enforces permission and target rules', async () => {
  const quotation = await Quotation.create({ clientName: 'Permission client', owner: userA._id, originalOwner: userA._id, createdBy: userA._id });
  const denied = await request(userA, `/api/sales-employee/quotations/${quotation._id}/forward`, {
    method: 'POST', body: JSON.stringify({ targetUserId: userB._id })
  });
  assert.equal(denied.response.status, 403);

  const enabled = await request(admin, `/api/admin/users/${userA._id}/sales-permissions`, {
    method: 'PATCH', body: JSON.stringify({ canForwardQuotations: true })
  });
  assert.equal(enabled.response.status, 200, JSON.stringify(enabled.data));
  const invalidTarget = await request(userA, `/api/sales-employee/quotations/${quotation._id}/forward`, {
    method: 'POST', body: JSON.stringify({ targetUserId: finance._id })
  });
  assert.equal(invalidTarget.response.status, 400);
  const selfTarget = await request(userA, `/api/sales-employee/quotations/${quotation._id}/forward`, {
    method: 'POST', body: JSON.stringify({ targetUserId: userA._id })
  });
  assert.equal(selfTarget.response.status, 400);
});

test('quotation forwarding is atomic under an ownership race and notifies only the winner', async () => {
  const quotation = await Quotation.create({
    clientName: 'Race Customer Ltd', productSummary: 'Managed Switch',
    items: [{ description: 'Managed Switch', quantity: 4, unitPrice: 10, total: 40 }],
    owner: userA._id, originalOwner: userA._id, createdBy: userA._id,
    issuingCompany: { code: 'FORTLINE_ENTERPRISES', legalName: 'Fortline Enterprises', name: 'Fortline Enterprises' }
  });
  const po = await CustomerPO.create({ customerName: quotation.clientName, quotationId: quotation._id, owner: userA._id, createdBy: userA._id });
  const file = await ProductFile.create({ customerName: quotation.clientName, quotationId: quotation._id, customerPOId: po._id, owner: userA._id, createdBy: userA._id });

  const [toB, toC] = await Promise.all([
    request(userA, `/api/sales-employee/quotations/${quotation._id}/forward`, { method: 'POST', body: JSON.stringify({ targetUserId: userB._id, note: 'B handoff' }) }),
    request(userA, `/api/sales-employee/quotations/${quotation._id}/forward`, { method: 'POST', body: JSON.stringify({ targetUserId: userC._id, note: 'C handoff' }) })
  ]);
  assert.deepEqual([toB.response.status, toC.response.status].sort(), [200, 409]);

  const [updated, updatedPo, updatedFile, notifications] = await Promise.all([
    Quotation.findById(quotation._id).lean(), CustomerPO.findById(po._id).lean(),
    ProductFile.findById(file._id).lean(), Notification.find({ 'data.quotationId': quotation._id }).lean()
  ]);
  assert.equal(updated.createdBy.toString(), userA._id.toString());
  assert.equal(updated.originalOwner.toString(), userA._id.toString());
  assert.equal(updated.forwardHistory.length, 1);
  assert.equal(updatedPo.owner.toString(), updated.owner.toString());
  assert.equal(updatedFile.owner.toString(), updated.owner.toString());
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].recipient.toString(), updated.owner.toString());
  assert.equal(notifications[0].data.customerCompany, 'Race Customer Ltd');
  assert.equal(notifications[0].data.product, 'Managed Switch');
  assert.equal(notifications[0].data.quantity, 4);

  const originalList = await request(userA, '/api/sales-employee/quotations?status=all');
  const retained = originalList.data.data.find(item => item._id === quotation._id.toString());
  assert.equal(retained.isForwardedReadOnly, true);
  const receiver = updated.owner.toString() === userB._id.toString() ? userB : userC;
  const receiverList = await request(receiver, '/api/sales-employee/quotations?status=all');
  assert.ok(receiverList.data.data.some(item => item._id === quotation._id.toString() && !item.isForwardedReadOnly));
});
