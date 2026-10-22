const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release31-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r31_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;

assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 3.1 tests.');
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
const InventoryItem = require('../models/InventoryItem');
const LocalPayable = require('../models/LocalPayable');
const PurchaserGRN = require('../models/PurchaserGRN');
const SalesOrder = require('../models/SalesOrder');
const Supplier = require('../models/Supplier');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');
const { allocateGrnNumber, withGrnDuplicateRecovery } = require('../utils/grnNumber');

let server;
let baseUrl;
let purchaser;
let support;
let supplier;

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
  return { response, data: await response.json() };
};

const createOrder = (overrides = {}) => SalesOrder.create({
  orderNumber: 'CALLER-SUPPLIED',
  orderReference: 'CALLER-SUPPLIED',
  clientName: `Release 3.1 ${runId}`,
  fileType: 'Green',
  items: [{ description: 'Release 3.1 Widget', quantity: 2, unitPrice: 100, total: 200 }],
  totalAmount: 200,
  netAmount: 200,
  workflowStatus: 'Pending Local Procurement',
  status: 'Pending Local Procurement',
  currentDepartment: 'Local Purchaser',
  departmentResponsible: 'Local Purchaser',
  createdBy: purchaser._id,
  salesPerson: purchaser._id,
  ...overrides
});

const dropTemporaryDatabase = async () => {
  assert.equal(mongoose.connection.name, tempDbName, 'Connected database changed during the test run.');
  assert.ok(mongoose.connection.name.startsWith(TEMP_DB_PREFIX));
  try {
    await mongoose.connection.dropDatabase();
    console.log(`TEMP_DATABASE_DROPPED=${tempDbName}`);
  } catch (error) {
    if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
    const remaining = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.equal(remaining.length, 0, 'Temporary database still has collections after cleanup.');
    console.log(`TEMP_DATABASE_DROPPED_BY_COLLECTIONS=${tempDbName}`);
  }
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');

  await PurchaserGRN.collection.createIndex({ grnNumber: 1 }, { unique: true });
  await Counter.create([
    { _id: getCounterKey('sales-order-number'), sequence: 1 },
    { _id: getCounterKey('grn-number'), sequence: 0 }
  ]);

  const password = `Release31-${runId}`;
  [purchaser, support] = await User.create([
    { fullName: 'Release 3.1 Local Purchaser', email: `release31.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'Release 3.1 Support', email: `release31.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true }
  ]);
  supplier = await Supplier.create({ name: `Release 3.1 Supplier ${runId}`, supplierType: 'Local', createdBy: purchaser._id });

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await dropTemporaryDatabase();
  await mongoose.disconnect();
});

test('concurrent Sales Order creation atomically allocates unique SO numbers and ignores caller references', async () => {
  const orders = await Promise.all(Array.from({ length: 20 }, (_, index) => createOrder({
    clientName: `Concurrent customer ${index}`
  })));
  const numbers = orders.map(order => order.orderNumber);
  assert.equal(new Set(numbers).size, orders.length);
  assert.ok(numbers.every(number => /^SO-\d{4,}$/.test(number)));
  assert.ok(orders.every(order => order.orderReference === order.orderNumber));
  assert.ok(numbers.every(number => number !== 'CALLER-SUPPLIED'));

  await Counter.updateOne({ _id: getCounterKey('sales-order-number') }, { $set: { sequence: 1 } });
  await assert.rejects(
    createOrder({ clientName: 'Duplicate counter candidate' }),
    error => error.statusCode === 409 && /already exists/i.test(error.message)
  );
  await Counter.updateOne({ _id: getCounterKey('sales-order-number') }, { $set: { sequence: 21 } });
});

test('Issue Local PO routes the order to Support awaiting goods and retains the second-PO guard', async () => {
  const order = await createOrder();
  const payload = {
    poType: 'Local',
    salesOrderId: order._id,
    supplierId: supplier._id,
    issuingCompanyCode: 'FORTLINE_ENTERPRISES',
    items: [{ productName: 'Release 3.1 Widget', quantity: 2, unitPrice: 100 }]
  };
  const issued = await request(purchaser, '/api/purchaser/pos', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(issued.response.status, 201, JSON.stringify(issued.data));

  const saved = await SalesOrder.findById(order._id).lean();
  assert.equal(saved.currentDepartment, 'Support');
  assert.equal(saved.departmentResponsible, 'Support');
  assert.equal(saved.workflowStatus, 'Local Supplier PO Issued');
  assert.equal(saved.status, 'Local Supplier PO Issued');
  assert.equal(saved.goodsReceivedInOffice.received, false);
  assert.equal(saved.inventoryReceived, false);
  assert.ok(await LocalPayable.exists({ salesOrderId: order._id }));

  const duplicate = await request(purchaser, '/api/purchaser/pos', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.data.message, /already has active Local Supplier PO/i);
});

test('Procure via Local PO rejects orders fulfilled from stock and orders already with Support', async () => {
  const fulfilled = await createOrder({ inventoryFulfilledFromExistingStock: true });
  const fulfilledResult = await request(purchaser, `/api/purchaser/orders/${fulfilled._id}/complete-procurement`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(fulfilledResult.response.status, 409);
  assert.match(fulfilledResult.data.message, /already fulfilled from existing stock/i);

  const inSupport = await createOrder({ currentDepartment: 'Support', departmentResponsible: 'Support' });
  const supportResult = await request(purchaser, `/api/purchaser/orders/${inSupport._id}/complete-procurement`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(supportResult.response.status, 409);
  assert.match(supportResult.data.message, /already with Support/i);
});

test('In Stock to Support returns a conflict when the order has a shortage', async () => {
  await InventoryItem.create({ name: 'Release 3.1 Widget', quantityOnHand: 1, reservedQuantity: 0, minStockLevel: 0 });
  const order = await createOrder();
  const result = await request(purchaser, `/api/purchaser/orders/${order._id}/inventory-check`, {
    method: 'POST',
    body: JSON.stringify({ isFullyInStock: true })
  });
  assert.equal(result.response.status, 409, JSON.stringify(result.data));
  assert.match(result.data.message, /stock shortage was detected/i);
  const saved = await SalesOrder.findById(order._id).lean();
  assert.notEqual(saved.currentDepartment, 'Support');
});

test('GRN duplicate recovery reconciles a lagging counter and retries the transaction', async () => {
  await PurchaserGRN.create({
    grnNumber: 'GRN-000005',
    items: [{ productName: 'Existing GRN item', receivedQty: 1 }],
    createdBy: support._id,
    createdByName: support.fullName
  });
  await Counter.updateOne({ _id: getCounterKey('grn-number') }, { $set: { sequence: 4 } });

  const session = await mongoose.startSession();
  let allocated;
  try {
    await withGrnDuplicateRecovery(session, async () => {
      allocated = await allocateGrnNumber(session);
      await PurchaserGRN.create([{
        grnNumber: allocated,
        items: [{ productName: 'Recovered GRN item', receivedQty: 1 }],
        createdBy: support._id,
        createdByName: support.fullName
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  assert.equal(allocated, 'GRN-000006');
  assert.ok(await PurchaserGRN.exists({ grnNumber: 'GRN-000006' }));
  const counter = await Counter.findById(getCounterKey('grn-number')).lean();
  assert.equal(counter.sequence, 6);
});

