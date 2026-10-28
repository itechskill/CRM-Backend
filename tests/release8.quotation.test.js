const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release8-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r8_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;

assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 8 tests.');
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
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let salespersonA;
let salespersonB;

const tokenFor = user => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);

const createQuotation = async (user, overrides = {}) => {
  const response = await fetch(`${baseUrl}/api/sales-employee/quotations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenFor(user)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED',
      quotationCode: 'KR',
      orderReference: 'CALLER-SUPPLIED-MUST-BE-IGNORED',
      clientName: `Release 8 client ${runId}`,
      items: [{ sku: 'R8-SKU', description: 'Release 8 item', quantity: 2, unitPrice: 100 }],
      taxPercentage: 18,
      ...overrides
    })
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  return data.data;
};

const dropTemporaryDatabase = async () => {
  assert.equal(mongoose.connection.name, tempDbName, 'Connected database changed during the test run.');
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

  await Counter.create({ _id: getCounterKey('file-number'), sequence: 4000 });
  const password = `Release8-${runId}`;
  [salespersonA, salespersonB] = await User.create([
    { fullName: 'Karim Rafiq', email: `r8.a.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'Kiran Raza', email: `r8.b.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true }
  ]);

  await Quotation.createIndexes();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await dropTemporaryDatabase();
  await mongoose.disconnect();
});

test('quotation sequence is global across salespeople, uses six digits, and ignores caller references and codes', async () => {
  const firstA = await createQuotation(salespersonA, { quotationCode: 'k.r!' });
  const firstB = await createQuotation(salespersonB, { quotationCode: 'k.r!' });

  assert.equal(firstA.orderReference, 'QO-000001');
  assert.equal(firstB.orderReference, 'QO-000002');
  assert.equal(firstA.quotationSerial, 1);
  assert.equal(firstB.quotationSerial, 2);
  assert.equal(firstA.quotationSerialCreator, undefined);
  assert.equal(firstB.quotationSerialCreator, undefined);
  assert.equal(firstA.quotationCode, '');
  assert.equal(firstA.quotationNumberFormat, 'global-v1');
  assert.equal(firstA.fileNo, '4001');
  assert.equal(firstA.taxPercentage, 18);
  assert.equal(firstA.tax, 36);
  assert.equal(firstA.netAmount, 236);
});

test('concurrent quotation creation across salespeople allocates globally unique serials', async () => {
  const created = await Promise.all(Array.from({ length: 16 }, (_, index) => (
    createQuotation(index % 2 ? salespersonA : salespersonB, { quotationCode: `A-${index}` })
  )));
  const serials = created.map(quotation => quotation.quotationSerial);
  const references = created.map(quotation => quotation.orderReference);
  assert.equal(new Set(serials).size, serials.length);
  assert.equal(new Set(references).size, references.length);
  assert.deepEqual([...serials].sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index + 3));
  references.forEach(reference => assert.match(reference, /^QO-\d{6,}$/));
});

test('global partial unique index applies only to the new number format', async () => {
  const indexes = Quotation.schema.indexes();
  const serialIndex = indexes.find(([, options]) => options.name === 'unique_global_quotation_serial_v1');
  assert.ok(serialIndex);
  assert.equal(serialIndex[1].unique, true);
  assert.deepEqual(serialIndex[1].partialFilterExpression, { quotationNumberFormat: 'global-v1' });

  await Quotation.collection.insertMany([
    { orderReference: 'S01724', quotationNumber: 'S01724', clientName: 'Legacy one', owner: salespersonA._id, createdBy: salespersonA._id },
    { orderReference: '1022', quotationNumber: '1022', clientName: 'Legacy two', owner: salespersonA._id, createdBy: salespersonA._id }
  ]);

  await Quotation.collection.insertOne({
    orderReference: 'QO-999999', quotationNumber: 'QO-999999', clientName: 'Indexed one',
    quotationSerial: 999999, quotationNumberFormat: 'global-v1'
  });
  await assert.rejects(
    Quotation.collection.insertOne({
      orderReference: 'QO-999999', quotationNumber: 'QO-999999', clientName: 'Indexed duplicate',
      quotationSerial: 999999, quotationNumberFormat: 'global-v1'
    }),
    error => error?.code === 11000
  );
});

test('saving a legacy quotation leaves its old reference and serial fields unchanged', async () => {
  const legacy = await Quotation.findOne({ orderReference: 'S01724' });
  assert.ok(legacy);
  assert.equal(legacy.quotationSerial, undefined);
  assert.equal(legacy.quotationSerialCreator, undefined);
  legacy.status = 'Sent';
  await legacy.save();

  const saved = await Quotation.findById(legacy._id).lean();
  assert.equal(saved.orderReference, 'S01724');
  assert.equal(saved.quotationNumber, 'S01724');
  assert.equal(saved.quotationSerial, undefined);
  assert.equal(saved.quotationSerialCreator, undefined);
  assert.equal(saved.quotationNumberFormat, undefined);

  const response = await fetch(`${baseUrl}/api/sales-employee/quotations?status=all&search=S01724`, {
    headers: { Authorization: `Bearer ${tokenFor(salespersonA)}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].quotationNumber, 'S01724');
});
