const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const TEMP_DB_PREFIX = 'fortline_tmp_co_';
const runId = randomBytes(8).toString('hex');
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
process.env.COUNTER_NAMESPACE = `companies-${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;

assert.ok(sourceMongoUri, 'MONGODB_URI is required to run company tests.');
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

const {
  DOCUMENT_TYPES,
  getCompanySnapshot,
  inheritCompanySnapshot,
  resolvePOCompany
} = require('../config/companies');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');

before(async () => {
  await mongoose.connect(useDatabase(sourceMongoUri, tempDbName), { serverSelectionTimeoutMS: 10000 });
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 1 });
});

after(async () => {
  assert.equal(mongoose.connection.name, tempDbName, 'Connected database changed during the test run.');
  try {
    await mongoose.connection.dropDatabase();
  } catch (error) {
    if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
  }
  await mongoose.disconnect();
});

test('shared company validation enforces allowed document types', () => {
  assert.equal(
    getCompanySnapshot('FORTLINE_ENTERPRISES', DOCUMENT_TYPES.QUOTATION).legalName,
    'Fortline Enterprises'
  );
  assert.equal(
    resolvePOCompany({ poType: 'Local', requestedCompanyCode: 'FORTLINE_ENTERPRISES' }).code,
    'FORTLINE_ENTERPRISES'
  );
  assert.equal(
    resolvePOCompany({ poType: 'Global', requestedCompanyCode: 'WWTS' }).code,
    'WWTS'
  );
  assert.throws(
    () => resolvePOCompany({ poType: 'Global', requestedCompanyCode: 'FORTLINE_ENTERPRISES' }),
    /not allowed/
  );
  assert.throws(
    () => resolvePOCompany({ poType: 'Local', requestedCompanyCode: 'HIGH_CLOUD_TRADING_LLC' }),
    /not allowed/
  );
  assert.throws(
    () => resolvePOCompany({ poType: 'Local' }),
    /required/
  );
});

test('quotation snapshot is inherited by its sales order and valid PO type', async () => {
  const quotationCompany = getCompanySnapshot('FORTLINE_PRIVATE_LIMITED', DOCUMENT_TYPES.QUOTATION);
  const quotation = await Quotation.create({
    clientName: 'Temporary company test client',
    orderReference: `TMP-Q-${Date.now()}`,
    issuingCompany: quotationCompany
  });

  const order = await SalesOrder.create({
    clientName: quotation.clientName,
    orderReference: `TMP-SO-${Date.now()}`,
    quotationId: quotation._id,
    issuingCompany: inheritCompanySnapshot(quotation)
  });

  assert.equal(order.issuingCompany.code, quotation.issuingCompany.code);
  assert.equal(order.issuingCompany.legalName, quotation.issuingCompany.legalName);
  assert.deepEqual(
    resolvePOCompany({ poType: 'Local', order }).allowedDocumentTypes.sort(),
    quotationCompany.allowedDocumentTypes.sort()
  );
  assert.deepEqual(
    resolvePOCompany({ poType: 'Global', order }).allowedDocumentTypes.sort(),
    quotationCompany.allowedDocumentTypes.sort()
  );
});

test('an inherited company that is invalid for a PO type requires an explicit replacement', () => {
  const localOnlyOrder = {
    issuingCompany: getCompanySnapshot('FORTLINE_ENTERPRISES', DOCUMENT_TYPES.QUOTATION)
  };

  assert.throws(
    () => resolvePOCompany({ poType: 'Global', order: localOnlyOrder }),
    /Select an allowed issuing company/
  );
  assert.equal(
    resolvePOCompany({
      poType: 'Global',
      order: localOnlyOrder,
      requestedCompanyCode: 'HIGH_CLOUD_TRADING_LLC'
    }).code,
    'HIGH_CLOUD_TRADING_LLC'
  );
});
