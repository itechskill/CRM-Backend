const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release23-${runId}`;
const TEMP_DB_PREFIX = 'f_tmp_r23_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 23 tests.');
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
const ExchangeRate = require('../models/ExchangeRate');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let admin;
let finance;
let ceo;
let purchaser;
let sales;
let firstPO;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '15m' });
const request = async (user, path, method = 'GET', body = undefined) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};
const poInput = currency => ({
  poType: 'Global', issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED', supplierName: `R23 supplier ${runId}`,
  supplierCountry: 'United States', currency, exchangeRateToPKR: 999,
  items: [{ productName: 'Server', quantity: 2, unitPricePKR: 100, totalPricePKR: 200 }]
});

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const password = `R23-${runId}`;
  [admin, finance, ceo, purchaser, sales] = await User.create([
    { fullName: 'R23 Admin', email: `r23.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R23 Finance', email: `r23.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R23 CEO', email: `r23.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R23 Global Purchaser', email: `r23.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true },
    { fullName: 'R23 Sales', email: `r23.sales.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true }
  ]);
  await Counter.create({ _id: getCounterKey('global-po-number'), sequence: 1 });
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

test('rate list exposes code defaults and only Admin can edit with history', async () => {
  for (const user of [admin, finance, ceo, purchaser]) {
    const listed = await request(user, '/api/exchange-rates');
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.data.find(row => row.currency === 'USD').rateToPKR, 295);
    assert.equal(listed.body.data.find(row => row.currency === 'AED').rateToPKR, 80);
    assert.equal(listed.body.data.find(row => row.currency === 'EUR').rateToPKR, null);
  }
  assert.equal((await request(sales, '/api/exchange-rates')).status, 403);
  assert.equal((await request(finance, '/api/exchange-rates/USD', 'PATCH', { rateToPKR: 300 })).status, 403);
  const updated = await request(admin, '/api/exchange-rates/USD', 'PATCH', { rateToPKR: 300, note: 'R23 test rate' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.history.length, 1);
  assert.equal(updated.body.data.history[0].oldRate, 295);
  assert.equal(updated.body.data.history[0].newRate, 300);
  assert.equal(updated.body.data.lastChangedByName, admin.fullName);
});

test('new Supplier PO copies the current rate, ignores caller rate, and keeps it after master changes', async () => {
  const created = await request(purchaser, '/api/purchaser/pos', 'POST', poInput('USD'));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  firstPO = created.body.data;
  assert.equal(firstPO.currency, 'USD');
  assert.equal(firstPO.exchangeRateToPKR, 300);
  await request(admin, '/api/exchange-rates/USD', 'PATCH', { rateToPKR: 305, note: 'Later change' });
  assert.equal((await SupplierPO.findById(firstPO._id).lean()).exchangeRateToPKR, 300);
  const second = await request(purchaser, '/api/purchaser/pos', 'POST', poInput('USD'));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.exchangeRateToPKR, 305);
});

test('PO issue is refused when Admin has not set the selected currency rate', async () => {
  const result = await request(purchaser, '/api/purchaser/pos', 'POST', poInput('EUR'));
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(result.body.message, 'Exchange rate for EUR is not set by Admin.');
});

test('foreign expense copies the current rate, Finance cannot replace it, and Admin correction is in history', async () => {
  const added = await request(finance, `/api/purchaser/pos/${firstPO._id}/expenses`, 'POST', {
    category: 'Freight', amount: 10, currency: 'USD', exchangeRateToPKR: 999
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  let expense = added.body.data.expenses.find(item => !item.isDeleted);
  assert.equal(expense.exchangeRateToPKR, 305);
  const financeEdit = await request(finance, `/api/purchaser/pos/${firstPO._id}/expenses/${expense._id}`, 'PATCH', { exchangeRateToPKR: 777, amount: 11 });
  assert.equal(financeEdit.status, 200, JSON.stringify(financeEdit.body));
  expense = financeEdit.body.data.expenses.find(item => item._id === String(expense._id));
  assert.equal(expense.exchangeRateToPKR, 305);
  const adminEdit = await request(admin, `/api/purchaser/pos/${firstPO._id}/expenses/${expense._id}`, 'PATCH', { exchangeRateToPKR: 310 });
  assert.equal(adminEdit.status, 200, JSON.stringify(adminEdit.body));
  expense = adminEdit.body.data.expenses.find(item => item._id === String(expense._id));
  assert.equal(expense.exchangeRateToPKR, 310);
  assert.equal(expense.editHistory.at(-1).oldValues.exchangeRateToPKR, 305);
  assert.equal(expense.editHistory.at(-1).newValues.exchangeRateToPKR, 310);
});

test('Admin can correct one PO rate without changing the master rate and the PO records history', async () => {
  const blocked = await request(purchaser, `/api/purchaser/pos/${firstPO._id}/exchange-rate`, 'PATCH', { exchangeRateToPKR: 315 });
  assert.equal(blocked.status, 403);
  const corrected = await request(admin, `/api/purchaser/pos/${firstPO._id}/exchange-rate`, 'PATCH', { exchangeRateToPKR: 315, note: 'Contract rate' });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.data.exchangeRateToPKR, 315);
  assert.equal(corrected.body.data.exchangeRateHistory.at(-1).oldRate, 300);
  assert.equal(corrected.body.data.exchangeRateHistory.at(-1).newRate, 315);
  assert.equal((await ExchangeRate.findOne({ currency: 'USD' }).lean()).rateToPKR, 305);
});
