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
const tempDbName = `f_tmp_r22_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 22 tests.');
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
process.env.COUNTER_NAMESPACE = `release22-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const Invoice = require('../models/Invoice');
const User = require('../models/User');

let server;
let baseUrl;
let admin;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenFor(admin)}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return { response, data: await response.json() };
};

const invoiceBody = overrides => ({
  clientName: 'Release 22 Client',
  amount: 1000,
  dueDate: new Date(Date.now() + 86400000).toISOString(),
  items: [{ description: 'Server', quantity: 1, unitPrice: 1000, total: 1000 }],
  ...overrides
});

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  admin = await User.create({
    fullName: 'Release 22 Admin',
    email: `r22.admin.${runId}@example.com`,
    password: `Release22-${runId}`,
    role: 'admin',
    status: 'active',
    isApproved: true
  });
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
      if (error.code !== 8000) throw error;
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('PO Reference is trimmed on create, editable and clearable', async () => {
  const created = await request('/api/sales-employee/invoices', {
    method: 'POST',
    body: JSON.stringify(invoiceBody({ poReference: '  CPO-7788  ' }))
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.data.poReference, 'CPO-7788');

  const updated = await request(`/api/sales-employee/invoices/${created.data.data._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ poReference: '  CPO-9900  ' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.data.poReference, 'CPO-9900');

  const cleared = await request(`/api/sales-employee/invoices/${created.data.data._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ poReference: '   ' })
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.data.data.poReference, '');
});

test('PO Reference is optional for old invoices and limited to 60 trimmed characters', async () => {
  const legacy = await Invoice.create(invoiceBody({
    invoiceNumber: `INV-R22-LEGACY-${runId}`,
    createdBy: admin._id
  }));
  assert.equal(legacy.poReference, '');

  const tooLongCreate = await request('/api/sales-employee/invoices', {
    method: 'POST',
    body: JSON.stringify(invoiceBody({ poReference: ` ${'x'.repeat(61)} ` }))
  });
  assert.equal(tooLongCreate.response.status, 400);
  assert.match(tooLongCreate.data.message, /60 characters/);

  const tooLongUpdate = await request(`/api/sales-employee/invoices/${legacy._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ poReference: 'y'.repeat(61) })
  });
  assert.equal(tooLongUpdate.response.status, 400);
  assert.match(tooLongUpdate.data.message, /60 characters/);
});

test('Finance invoice create and update endpoints enforce the same PO Reference rules', async () => {
  const created = await request('/api/finance/invoices', {
    method: 'POST',
    body: JSON.stringify(invoiceBody({ poReference: '  CPO-FIN-22  ' }))
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.data.poReference, 'CPO-FIN-22');

  const updated = await request(`/api/finance/invoices/${created.data.data._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ poReference: '  CPO-FIN-23  ' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.data.poReference, 'CPO-FIN-23');

  const tooLong = await request(`/api/finance/invoices/${created.data.data._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ poReference: 'z'.repeat(61) })
  });
  assert.equal(tooLong.response.status, 400);
  assert.match(tooLong.data.message, /60 characters/);
});
