const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.COUNTER_NAMESPACE = 'dev-local';
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_pricereq_';
const runId = randomBytes(8).toString('hex');
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;

assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Price Request API tests.');
assert.match(tempDbName, /^f_tmp_pricereq_[a-z0-9_]+$/);

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
const User = require('../models/User');
const PriceRequest = require('../models/PriceRequest');
const Counter = require('../models/Counter');
const app = require('../server');

const createdIds = [];
let server;
let baseUrl;
let users;

const tokenFor = (user) => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);

const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenFor(user)}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  return { response, data };
};

const dropTemporaryDatabase = async (databaseName) => {
  assert.ok(databaseName.startsWith(TEMP_DB_PREFIX), `Refusing to drop non-temporary database: ${databaseName}`);
  assert.equal(databaseName, tempDbName, 'Connected database changed during the test run.');
  try {
    await mongoose.connection.dropDatabase();
    console.log(`TEMP_DATABASE_DROPPED=${databaseName}`);
  } catch (error) {
    if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
    const remaining = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.equal(remaining.length, 0, 'Temporary database still has collections after cleanup.');
    console.log(`TEMP_DATABASE_DROPPED_BY_COLLECTIONS=${databaseName}`);
  }
};

const createDemoRequest = async (suffix, requestedFrom = users.purchaser) => {
  const result = await request(users.sales, '/api/price-requests', {
    method: 'POST',
    body: JSON.stringify({
      requestedFrom: requestedFrom._id,
      category: 'Networking',
      brand: 'Cisco',
      leadSource: 'WhatsApp',
      requirement: `DEMO ${suffix} ${runId}`,
      quantity: 2,
      reference: `DEMO-${runId}`
    })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  createdIds.push(result.data.data._id);
  return result.data.data;
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName, 'Refusing to run outside the generated temporary database.');
  assert.ok(mongoose.connection.name.startsWith(TEMP_DB_PREFIX), 'Temporary database prefix is required.');
  assert.notEqual(mongoose.connection.name, 'test', 'The shared test database must never be used.');

  await Counter.create({ _id: `${process.env.COUNTER_NAMESPACE}:file-number`, sequence: 1000 });

  const password = `DEMO-${runId}-password`;
  const [sales, purchaser, salesManager, finance] = await User.create([
    { fullName: 'DEMO Price Request Sales', email: `demo.pr.sales.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true },
    { fullName: 'DEMO Price Request Purchaser', email: `demo.pr.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'DEMO Price Request Sales Manager', email: `demo.pr.manager.${runId}@example.com`, password, role: 'sales_manager', status: 'active', isApproved: true },
    { fullName: 'DEMO Price Request Finance', email: `demo.pr.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true }
  ]);
  users = { sales, purchaser, salesManager, finance };
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) {
    const connectedDbName = mongoose.connection.name;
    try {
      const records = await PriceRequest.find({ _id: { $in: createdIds } })
        .select('_id requestNumber requirement status')
        .sort({ createdAt: 1 })
        .lean();
      console.log('DEMO_PRICE_REQUEST_RECORDS=' + JSON.stringify(records));
    } finally {
      await dropTemporaryDatabase(connectedDbName);
    }
  }
  await mongoose.disconnect();
});

test('create then price requires the assigned user and stores integer cents', async () => {
  const created = await createDemoRequest('API create and price');

  const requesterAttempt = await request(users.sales, `/api/price-requests/${created._id}/price`, {
    method: 'POST',
    body: JSON.stringify({ unitPriceCents: 123456, currency: 'USD' })
  });
  assert.equal(requesterAttempt.response.status, 403);

  const priced = await request(users.purchaser, `/api/price-requests/${created._id}/price`, {
    method: 'POST',
    body: JSON.stringify({ unitPriceCents: 123456, currency: 'USD', leadTime: '2 weeks' })
  });
  assert.equal(priced.response.status, 200, JSON.stringify(priced.data));
  assert.equal(priced.data.data.status, 'Priced');
  assert.equal(priced.data.data.unitPriceCents, 123456);
  assert.equal(priced.data.data.currency, 'USD');
});

test('create validates and stores the lead source', async () => {
  const basePayload = {
    requestedFrom: users.purchaser._id,
    category: 'Networking',
    brand: 'Cisco',
    requirement: `DEMO lead source ${runId}`,
    quantity: 1
  };

  const missing = await request(users.sales, '/api/price-requests', {
    method: 'POST',
    body: JSON.stringify(basePayload)
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.data.message, 'Select a valid lead source.');

  const invalid = await request(users.sales, '/api/price-requests', {
    method: 'POST',
    body: JSON.stringify({ ...basePayload, leadSource: 'Website' })
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.message, 'Select a valid lead source.');

  const created = await request(users.sales, '/api/price-requests', {
    method: 'POST',
    body: JSON.stringify({ ...basePayload, leadSource: 'Other', leadSourceNote: 'Trade show referral' })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.data.leadSource, 'Other');
  assert.equal(created.data.data.leadSourceNote, 'Trade show referral');
  createdIds.push(created.data.data._id);
});

test('new quotations require and snapshot a valid issuing company', async () => {
  const quotePayload = {
    clientName: `DEMO quotation client ${runId}`,
    fileType: 'Green',
    productSummary: 'Temporary test product',
    items: [{ description: 'Temporary test product', quantity: 1, unitPrice: 100, total: 100 }],
    totalAmount: 100,
    netAmount: 100
  };

  const missing = await request(users.sales, '/api/sales-employee/quotations', {
    method: 'POST',
    body: JSON.stringify(quotePayload)
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.data.message, 'Select a valid issuing company.');

  const invalid = await request(users.sales, '/api/sales-employee/quotations', {
    method: 'POST',
    body: JSON.stringify({ ...quotePayload, issuingCompanyCode: 'NOT_A_COMPANY' })
  });
  assert.equal(invalid.response.status, 400);

  const created = await request(users.sales, '/api/sales-employee/quotations', {
    method: 'POST',
    body: JSON.stringify({ ...quotePayload, issuingCompanyCode: 'FORTLINE_ENTERPRISES' })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.data.issuingCompany.code, 'FORTLINE_ENTERPRISES');
  assert.equal(created.data.data.issuingCompany.legalName, 'Fortline Enterprises');
});

test('decline requires a reason', async () => {
  const created = await createDemoRequest('API decline');
  const missingReason = await request(users.purchaser, `/api/price-requests/${created._id}/decline`, {
    method: 'POST', body: JSON.stringify({ reason: '' })
  });
  assert.equal(missingReason.response.status, 400);

  const declined = await request(users.purchaser, `/api/price-requests/${created._id}/decline`, {
    method: 'POST', body: JSON.stringify({ reason: 'DEMO supplier did not quote' })
  });
  assert.equal(declined.response.status, 200, JSON.stringify(declined.data));
  assert.equal(declined.data.data.status, 'Declined');
});

test('requester can reassign and only the new recipient can price', async () => {
  const created = await createDemoRequest('API reassign');
  const reassigned = await request(users.sales, `/api/price-requests/${created._id}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ requestedFrom: users.salesManager._id, pendingNote: 'DEMO reassigned for specialist pricing' })
  });
  assert.equal(reassigned.response.status, 200, JSON.stringify(reassigned.data));
  assert.equal(String(reassigned.data.data.requestedFrom._id), String(users.salesManager._id));

  const oldRecipient = await request(users.purchaser, `/api/price-requests/${created._id}/price`, {
    method: 'POST', body: JSON.stringify({ unitPriceCents: 100, currency: 'PKR' })
  });
  assert.equal(oldRecipient.response.status, 403);

  const newRecipient = await request(users.salesManager, `/api/price-requests/${created._id}/price`, {
    method: 'POST', body: JSON.stringify({ unitPriceCents: 100, currency: 'PKR' })
  });
  assert.equal(newRecipient.response.status, 200, JSON.stringify(newRecipient.data));
});

test('disallowed roles cannot read or create price requests', async () => {
  const list = await request(users.finance, '/api/price-requests');
  assert.equal(list.response.status, 403);
  const create = await request(users.finance, '/api/price-requests', {
    method: 'POST',
    body: JSON.stringify({
      requestedFrom: users.purchaser._id,
      category: 'Other',
      brand: 'Other',
      requirement: `DEMO forbidden create ${runId}`,
      quantity: 1
    })
  });
  assert.equal(create.response.status, 403);
});

test('concurrent completion allows exactly one pending transition', async () => {
  const created = await createDemoRequest('API concurrent completion');
  const [priceResult, declineResult] = await Promise.all([
    request(users.purchaser, `/api/price-requests/${created._id}/price`, {
      method: 'POST', body: JSON.stringify({ unitPriceCents: 9999, currency: 'EUR' })
    }),
    request(users.purchaser, `/api/price-requests/${created._id}/decline`, {
      method: 'POST', body: JSON.stringify({ reason: 'DEMO concurrent decline' })
    })
  ]);
  assert.deepEqual([priceResult.response.status, declineResult.response.status].sort(), [200, 409]);
});
