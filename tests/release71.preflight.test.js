const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release71-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r71_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 7.1 tests.');
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
const Counter = require('../models/Counter');
const DeliveryNote = require('../models/DeliveryNote');
const InventoryItem = require('../models/InventoryItem');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');
const { checkOrderStock } = require('../controllers/salesEmployeeController');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let support;
let admin;
let finance;
let salesperson;
let order;
let inventory;
let deliveryNote;

const tokenFor = user => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);

const endpointStockCheck = async user => {
  const response = await fetch(`${baseUrl}/api/sales-employee/orders/${order._id}/stock-check`, {
    headers: { Authorization: `Bearer ${tokenFor(user)}` }
  });
  return { status: response.status, body: await response.json() };
};

const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenFor(user)}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return { status: response.status, body: await response.json() };
};

const deliveryNoteStockCheck = (user, deliveryNoteId) => request(
  user,
  `/api/sales-employee/delivery-notes/${deliveryNoteId}/stock-check`
);

const createSupportOrder = async ({ name, quantity, inventoryItem, reservations = [], overrides = {} }) => {
  const created = await SalesOrder.create({
    clientName: `R71 ${name}`,
    items: [{ description: name, sku: '', quantity, unitPrice: 100, total: quantity * 100 }],
    totalAmount: quantity * 100,
    netAmount: quantity * 100,
    status: 'Goods Received in Office',
    workflowStatus: 'Goods Received in Office',
    currentDepartment: 'Support',
    departmentResponsible: 'Support',
    goodsReceivedInOffice: { received: true, receivedQuantity: quantity, orderedQuantity: quantity },
    inventoryAnalysis: inventoryItem ? [{ productId: String(inventoryItem._id), productName: name, orderedQty: quantity }] : [],
    inventoryReservations: reservations,
    createdBy: salesperson._id,
    salesPerson: salesperson._id,
    owner: salesperson._id,
    ...overrides
  });
  return created;
};

const directStockCheck = async user => {
  let status = 200;
  let body;
  const response = {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; }
  };
  await checkOrderStock({ params: { id: String(order._id) }, user }, response);
  return { status, body };
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

  await Counter.create([
    { _id: getCounterKey('delivery-note-number'), sequence: 1 },
    { _id: getCounterKey('sales-order-number'), sequence: 1299 }
  ]);
  const password = `Release71-${runId}`;
  [support, admin, finance, salesperson] = await User.create([
    { fullName: 'R71 Support', email: `r71.support.${runId}@example.com`, password, role: 'support', department: 'Support', status: 'active', isApproved: true },
    { fullName: 'R71 Admin', email: `r71.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R71 Finance', email: `r71.finance.${runId}@example.com`, password, role: 'finance', department: 'Finance', status: 'active', isApproved: true },
    { fullName: 'R71 Sales', email: `r71.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true }
  ]);

  inventory = await InventoryItem.create({
    name: '512 GB SSD',
    sku: 'SKU-795521-1',
    quantityOnHand: 7,
    reservedQuantity: 1,
    minStockLevel: 0
  });
  order = await SalesOrder.create({
    orderNumber: 'SO-1299',
    orderReference: 'SO-1299',
    clientName: 'DEMO 7',
    items: [{ description: '512 GB SSD', sku: '', quantity: 1, unitPrice: 100, total: 100 }],
    totalAmount: 100,
    netAmount: 100,
    stockStatus: 'Available',
    status: 'DN Created',
    workflowStatus: 'Delivery Note Created',
    currentDepartment: 'Accounts',
    departmentResponsible: 'Accounts',
    goodsReceivedInOffice: { received: true, receivedQuantity: 1, orderedQuantity: 1 },
    createdBy: salesperson._id,
    salesPerson: salesperson._id,
    owner: salesperson._id
  });
  const orderItemId = String(order.items[0]._id);
  order.inventoryAnalysis = [{ productId: String(inventory._id), productName: '512 GB SSD', orderedQty: 1, availableQty: 1, shortageQty: 0, status: 'Available' }];
  order.inventoryReservations = [{
    orderItemId,
    itemIndex: 0,
    inventoryItem: inventory._id,
    inventoryName: inventory.name,
    quantity: 1,
    remainingQuantity: 1,
    deliveredQuantity: 0,
    releasedQuantity: 0,
    status: 'Reserved',
    reservedBy: support._id,
    reservedByName: support.fullName
  }];
  await order.save();

  deliveryNote = await DeliveryNote.create({
    salesOrder: order._id,
    salesOrderNumber: 'SO-1299',
    clientName: 'DEMO 7',
    status: 'Created',
    items: [{
      product: '512 GB SSD',
      description: '512 GB SSD',
      quantity: 1,
      demand: 1,
      orderItemId,
      orderItemIndex: 0,
      inventoryItem: inventory._id
    }],
    createdBy: support._id
  });

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await dropTemporaryDatabase();
  await mongoose.disconnect();
});

test('exact SO-1299 reproduction: direct stock logic and endpoint by role', async () => {
  const direct = {
    support: await directStockCheck(support),
    admin: await directStockCheck(admin),
    finance: await directStockCheck(finance)
  };
  const endpoint = {
    support: await endpointStockCheck(support),
    admin: await endpointStockCheck(admin),
    finance: await endpointStockCheck(finance)
  };

  console.log('R71_REPRODUCTION=' + JSON.stringify({
    orderId: order._id,
    deliveryNoteId: deliveryNote._id,
    direct,
    endpoint
  }));

  assert.equal(direct.support.status, 403);
  assert.equal(direct.admin.status, 200);
  assert.equal(direct.admin.body.data.isFullyInStock, true);
  assert.equal(direct.finance.status, 403);
  assert.equal(endpoint.support.status, 403);
  assert.equal(endpoint.admin.status, 200);
  assert.equal(endpoint.admin.body.data.isFullyInStock, true);
  assert.equal(endpoint.finance.status, 403);

  const dnEndpoint = {
    support: await deliveryNoteStockCheck(support, deliveryNote._id),
    admin: await deliveryNoteStockCheck(admin, deliveryNote._id),
    finance: await deliveryNoteStockCheck(finance, deliveryNote._id)
  };
  assert.equal(dnEndpoint.support.status, 200, JSON.stringify(dnEndpoint.support.body));
  assert.equal(dnEndpoint.support.body.data.isFullyInStock, true);
  assert.equal(dnEndpoint.support.body.data.items[0].availableQty, 1);
  assert.equal(dnEndpoint.admin.status, 200);
  assert.equal(dnEndpoint.admin.body.data.isFullyInStock, true);
  assert.equal(dnEndpoint.finance.status, 403);
});

test('fulfilled, released and zero-remaining reservations are ignored', async () => {
  const item = await InventoryItem.create({
    name: `Inactive Reservation Item ${runId}`,
    sku: `R71-INACTIVE-${runId}`,
    quantityOnHand: 7,
    reservedQuantity: 1,
    minStockLevel: 0
  });
  const inactiveStatuses = ['Fulfilled', 'Released'];
  for (const [index, reservationStatus] of inactiveStatuses.entries()) {
    const candidateOrder = await createSupportOrder({ name: item.name, quantity: 7, inventoryItem: item });
    candidateOrder.inventoryReservations = [{
      orderItemId: String(candidateOrder.items[0]._id), itemIndex: 0, inventoryItem: item._id,
      quantity: 1, remainingQuantity: 1, deliveredQuantity: 0, releasedQuantity: 0, status: reservationStatus
    }];
    await candidateOrder.save();
    const [candidateDn] = await DeliveryNote.create([{
      salesOrder: candidateOrder._id, status: 'Created',
      items: [{ product: item.name, quantity: 7, demand: 7, orderItemId: String(candidateOrder.items[0]._id), inventoryItem: item._id }],
      createdBy: support._id
    }]);
    const result = await deliveryNoteStockCheck(support, candidateDn._id);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.isFullyInStock, false, `${reservationStatus} reservation was incorrectly active`);
    assert.equal(result.body.data.items[0].availableQty, 6);
    assert.match(result.body.data.message, /need 7, available 6/);
    await DeliveryNote.deleteOne({ _id: candidateDn._id });
    await SalesOrder.deleteOne({ _id: candidateOrder._id });
    assert.equal(index >= 0, true);
  }

  const zeroOrder = await createSupportOrder({ name: item.name, quantity: 7, inventoryItem: item });
  zeroOrder.inventoryReservations = [{
    orderItemId: String(zeroOrder.items[0]._id), itemIndex: 0, inventoryItem: item._id,
    quantity: 1, remainingQuantity: 0, deliveredQuantity: 0, releasedQuantity: 0, status: 'Reserved'
  }];
  await zeroOrder.save();
  const zeroDn = await DeliveryNote.create({
    salesOrder: zeroOrder._id, status: 'Created',
    items: [{ product: item.name, quantity: 7, demand: 7, orderItemId: String(zeroOrder.items[0]._id), inventoryItem: item._id }],
    createdBy: support._id
  });
  const zeroResult = await deliveryNoteStockCheck(support, zeroDn._id);
  assert.equal(zeroResult.body.data.isFullyInStock, false);
  assert.equal(zeroResult.body.data.items[0].availableQty, 6);
});

test('stale stored inventory falls back only to one sufficiently stocked normalized match', async () => {
  const [emptyStored, usableMatch, secondUsableMatch] = await InventoryItem.create([
    { name: `Fallback SSD ${runId}`, sku: `R71-EMPTY-${runId}`, quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 },
    { name: `Fallback-SSD ${runId}`, sku: `R71-GOOD-${runId}`, quantityOnHand: 3, reservedQuantity: 0, minStockLevel: 0 },
    { name: `Fallback SSD ${runId}`, sku: `R71-SECOND-${runId}`, quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 }
  ]);
  const fallbackOrder = await createSupportOrder({ name: `Fallback SSD ${runId}`, quantity: 2, inventoryItem: emptyStored });
  fallbackOrder.inventoryReceipts = [{
    receiptId: `r71-stale-${runId}`,
    items: [{
      orderItemId: String(fallbackOrder.items[0]._id),
      productName: fallbackOrder.items[0].description,
      receivedQty: 2,
      inventoryItem: emptyStored._id,
      inventoryName: emptyStored.name
    }]
  }];
  await fallbackOrder.save();
  const fallbackDn = await DeliveryNote.create({
    salesOrder: fallbackOrder._id, status: 'Created',
    items: [{ product: `Fallback SSD ${runId}`, quantity: 2, demand: 2, orderItemId: String(fallbackOrder.items[0]._id), inventoryItem: emptyStored._id }],
    createdBy: support._id
  });
  let result = await deliveryNoteStockCheck(support, fallbackDn._id);
  assert.equal(result.body.data.isFullyInStock, true, JSON.stringify(result.body));
  assert.equal(String(result.body.data.items[0].inventoryItemId), String(usableMatch._id));
  assert.equal(result.body.data.items[0].usedFallback, true);
  const orderResult = await request(admin, `/api/sales-employee/orders/${fallbackOrder._id}/stock-check`);
  assert.equal(orderResult.status, 200);
  assert.equal(orderResult.body.data.isFullyInStock, true);
  assert.equal(String(orderResult.body.data.items[0].inventoryItemId), String(usableMatch._id));

  secondUsableMatch.quantityOnHand = 3;
  await secondUsableMatch.save();
  result = await deliveryNoteStockCheck(support, fallbackDn._id);
  assert.equal(result.body.data.isFullyInStock, false);
  assert.match(result.body.data.message, /multiple normalized inventory matches/i);
});

test('an old unreserved order gets an atomic DN reservation and cancellation releases it', async () => {
  const item = await InventoryItem.create({
    name: `Legacy DN Item ${runId}`, sku: `R71-LEGACY-${runId}`, quantityOnHand: 2, reservedQuantity: 0, minStockLevel: 0
  });
  const legacyOrder = await createSupportOrder({ name: item.name, quantity: 1, inventoryItem: item });
  const created = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({ salesOrderId: legacyOrder._id, items: [{ orderItemId: String(legacyOrder.items[0]._id), quantity: 1 }] })
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let savedItem = await InventoryItem.findById(item._id).lean();
  let savedOrder = await SalesOrder.findById(legacyOrder._id).lean();
  assert.equal(savedItem.reservedQuantity, 1);
  assert.equal(savedOrder.inventoryReservations.length, 1);
  assert.equal(String(savedOrder.inventoryReservations[0].deliveryNote), String(created.body.data._id));

  const cancelled = await request(admin, `/api/sales-employee/delivery-notes/${created.body.data._id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Cancelled' })
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  savedItem = await InventoryItem.findById(item._id).lean();
  savedOrder = await SalesOrder.findById(legacyOrder._id).lean();
  assert.equal(savedItem.reservedQuantity, 0);
  assert.equal(savedOrder.inventoryReservations[0].status, 'Released');
});

test('partial DN checks and reserves only its own quantity', async () => {
  const item = await InventoryItem.create({
    name: `Partial DN Item ${runId}`, sku: `R71-PARTIAL-${runId}`, quantityOnHand: 2, reservedQuantity: 0, minStockLevel: 0
  });
  const partialOrder = await createSupportOrder({ name: item.name, quantity: 5, inventoryItem: item });
  const created = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({ salesOrderId: partialOrder._id, items: [{ orderItemId: String(partialOrder.items[0]._id), quantity: 2 }] })
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.isPartial, true);
  const preflight = await deliveryNoteStockCheck(support, created.body.data._id);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.data.isFullyInStock, true, JSON.stringify(preflight.body));
  assert.equal(preflight.body.data.items[0].requiredQty, 2);
  assert.equal((await InventoryItem.findById(item._id).lean()).reservedQuantity, 2);

  const deleted = await request(admin, `/api/sales-employee/delivery-notes/${created.body.data._id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await InventoryItem.findById(item._id).lean()).reservedQuantity, 0);
});

test('two competing unreserved orders cannot reserve the same final unit', async () => {
  const item = await InventoryItem.create({
    name: `Competing Item ${runId}`, sku: `R71-RACE-${runId}`, quantityOnHand: 1, reservedQuantity: 0, minStockLevel: 0
  });
  const [firstOrder, secondOrder] = await Promise.all([
    createSupportOrder({ name: item.name, quantity: 1, inventoryItem: item }),
    createSupportOrder({ name: item.name, quantity: 1, inventoryItem: item })
  ]);
  const results = await Promise.all([firstOrder, secondOrder].map(candidate => request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST', body: JSON.stringify({ salesOrderId: candidate._id, items: [{ orderItemId: String(candidate.items[0]._id), quantity: 1 }] })
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal((await InventoryItem.findById(item._id).lean()).reservedQuantity, 1);
  assert.equal(await DeliveryNote.countDocuments({ salesOrder: { $in: [firstOrder._id, secondOrder._id] } }), 1);
});

test('DN creation rolls back earlier line reservations when a later line cannot reserve', async () => {
  const [availableItem, emptyItem] = await InventoryItem.create([
    { name: `Rollback Available ${runId}`, sku: `R71-ROLLBACK-A-${runId}`, quantityOnHand: 1, reservedQuantity: 0, minStockLevel: 0 },
    { name: `Rollback Empty ${runId}`, sku: `R71-ROLLBACK-B-${runId}`, quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 }
  ]);
  const rollbackOrder = await SalesOrder.create({
    clientName: `R71 rollback ${runId}`,
    items: [
      { description: availableItem.name, quantity: 1, unitPrice: 10, total: 10 },
      { description: emptyItem.name, quantity: 1, unitPrice: 10, total: 10 }
    ],
    totalAmount: 20, netAmount: 20,
    status: 'Goods Received in Office', workflowStatus: 'Goods Received in Office',
    currentDepartment: 'Support', departmentResponsible: 'Support',
    goodsReceivedInOffice: { received: true, receivedQuantity: 2, orderedQuantity: 2 },
    inventoryAnalysis: [
      { productId: String(availableItem._id), productName: availableItem.name, orderedQty: 1 },
      { productId: String(emptyItem._id), productName: emptyItem.name, orderedQty: 1 }
    ],
    createdBy: salesperson._id, salesPerson: salesperson._id, owner: salesperson._id
  });
  const attempted = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({
      salesOrderId: rollbackOrder._id,
      items: rollbackOrder.items.map(item => ({ orderItemId: String(item._id), quantity: 1 }))
    })
  });
  assert.equal(attempted.status, 409, JSON.stringify(attempted.body));
  assert.equal((await InventoryItem.findById(availableItem._id).lean()).reservedQuantity, 0);
  const savedOrder = await SalesOrder.findById(rollbackOrder._id).lean();
  assert.equal(savedOrder.inventoryReservations.length, 0);
  assert.equal(savedOrder.currentDepartment, 'Support');
  assert.equal(await DeliveryNote.countDocuments({ salesOrder: rollbackOrder._id }), 0);
});

test('order stock-check GET remains read-only', async () => {
  await SalesOrder.updateOne({ _id: order._id }, { $set: { stockStatus: 'Sentinel Read Only' } });
  const result = await endpointStockCheck(admin);
  assert.equal(result.status, 200);
  assert.equal((await SalesOrder.findById(order._id).lean()).stockStatus, 'Sentinel Read Only');
});
