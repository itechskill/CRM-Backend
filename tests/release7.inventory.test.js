const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release7-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r7_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;

assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 7 tests.');
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
const DeliveryNote = require('../models/DeliveryNote');
const InventoryItem = require('../models/InventoryItem');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');
const { releaseOrderReservations } = require('../utils/inventoryReservations');

let server;
let baseUrl;
let purchaser;
let support;

const tokenFor = user => jwt.sign(
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

const createOrder = (name, quantity, overrides = {}) => SalesOrder.create({
  clientName: `Release 7 client ${runId}`,
  fileType: 'Green',
  items: [{ description: name, quantity, unitPrice: 100, total: quantity * 100 }],
  totalAmount: quantity * 100,
  netAmount: quantity * 100,
  workflowStatus: 'Pending Local Procurement',
  status: 'Pending Local Procurement',
  currentDepartment: 'Local Purchaser',
  departmentResponsible: 'Local Purchaser',
  createdBy: purchaser._id,
  salesPerson: purchaser._id,
  ...overrides
});

const reserveOrder = order => request(purchaser, `/api/purchaser/orders/${order._id}/inventory-check`, {
  method: 'POST',
  body: JSON.stringify({ moveToSupport: true })
});

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

  await Counter.create([
    { _id: getCounterKey('sales-order-number'), sequence: 1 },
    { _id: getCounterKey('delivery-note-number'), sequence: 1 }
  ]);

  const password = `Release7-${runId}`;
  [purchaser, support] = await User.create([
    {
      fullName: 'Release 7 Local Purchaser',
      email: `r7.purchaser.${runId}@example.com`,
      password,
      role: 'purchaser',
      purchaserSubDept: 'Local',
      status: 'active',
      isApproved: true
    },
    {
      fullName: 'Release 7 Support',
      email: `r7.support.${runId}@example.com`,
      password,
      role: 'support',
      department: 'Support',
      status: 'active',
      isApproved: true
    }
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

test('normalized matching reserves atomically and release returns only this order reservation', async () => {
  const inventory = await InventoryItem.create({
    name: '512 GB SSD',
    sku: 'R7-SSD',
    quantityOnHand: 12,
    reservedQuantity: 0,
    minStockLevel: 0
  });
  const order = await createOrder('512GB-SSD', 5);

  const result = await reserveOrder(order);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));

  let savedInventory = await InventoryItem.findById(inventory._id).lean();
  let savedOrder = await SalesOrder.findById(order._id);
  assert.equal(savedInventory.quantityOnHand, 12);
  assert.equal(savedInventory.reservedQuantity, 5);
  assert.equal(savedOrder.inventoryReservations.length, 1);
  assert.equal(String(savedOrder.inventoryReservations[0].inventoryItem), String(inventory._id));
  assert.equal(savedOrder.inventoryReservations[0].remainingQuantity, 5);
  assert.equal(savedOrder.currentDepartment, 'Support');

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      savedOrder = await SalesOrder.findById(order._id).session(session);
      await releaseOrderReservations({
        order: savedOrder,
        user: purchaser,
        reason: 'Release 7 cancellation test.',
        session
      });
      await savedOrder.save({ session });
    });
  } finally {
    await session.endSession();
  }

  savedInventory = await InventoryItem.findById(inventory._id).lean();
  savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(savedInventory.quantityOnHand, 12);
  assert.equal(savedInventory.reservedQuantity, 0);
  assert.equal(savedOrder.inventoryReservations[0].status, 'Released');
  assert.equal(savedOrder.inventoryReservations[0].releasedQuantity, 5);
});

test('ambiguous normalized names require an explicit Local Purchaser inventory link', async () => {
  const [first] = await InventoryItem.create([
    { name: 'USB-C Hub', sku: 'R7-HUB-A', quantityOnHand: 8, reservedQuantity: 0, minStockLevel: 0 },
    { name: 'USB C Hub', sku: 'R7-HUB-B', quantityOnHand: 8, reservedQuantity: 0, minStockLevel: 0 }
  ]);
  const order = await createOrder('USB C-Hub', 3);

  const ambiguous = await reserveOrder(order);
  assert.equal(ambiguous.response.status, 409, JSON.stringify(ambiguous.data));
  assert.match(ambiguous.data.message, /multiple normalized inventory matches/i);

  const linked = await request(purchaser, `/api/purchaser/orders/${order._id}/inventory-link`, {
    method: 'POST',
    body: JSON.stringify({ itemIndex: 0, inventoryItemId: first._id })
  });
  assert.equal(linked.response.status, 200, JSON.stringify(linked.data));

  const reserved = await reserveOrder(order);
  assert.equal(reserved.response.status, 200, JSON.stringify(reserved.data));
  const selected = await InventoryItem.findById(first._id).lean();
  assert.equal(selected.reservedQuantity, 3);
  const savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(String(savedOrder.inventoryReservations[0].inventoryItem), String(first._id));
});

test('DN creation uses Sales Order prices, partial confirmation preserves the remainder, and duplicate confirmation cannot deduct twice', async () => {
  const inventory = await InventoryItem.create({
    name: 'Release Seven Router',
    sku: 'R7-ROUTER',
    quantityOnHand: 12,
    reservedQuantity: 0,
    minStockLevel: 0
  });
  const order = await createOrder('Release Seven Router', 5, {
    discount: 50,
    tax: 25,
    netAmount: 475
  });
  const reserved = await reserveOrder(order);
  assert.equal(reserved.response.status, 200, JSON.stringify(reserved.data));
  const reservedOrder = await SalesOrder.findById(order._id).lean();

  const created = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({
      salesOrderId: order._id,
      recipientName: 'Release 7 Receiver',
      deliveryAddress: 'Release 7 address',
      items: [{
        orderItemId: String(reservedOrder.items[0]._id),
        quantity: 2,
        unitPrice: 1,
        lineTotal: 2
      }],
      subtotal: 2,
      grandTotal: 2
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const firstDn = await DeliveryNote.findById(created.data.data._id).lean();
  assert.equal(firstDn.status, 'Created');
  assert.equal(firstDn.isPartial, true);
  assert.equal(firstDn.items[0].unitPrice, 100);
  assert.equal(firstDn.items[0].lineTotal, 200);
  assert.equal(firstDn.subtotal, 200);
  assert.equal(firstDn.discount, 20);
  assert.equal(firstDn.tax, 10);
  assert.equal(firstDn.grandTotal, 190);

  const tamperedDn = await DeliveryNote.findById(firstDn._id);
  tamperedDn.items[0].unitPrice = 1;
  tamperedDn.items[0].lineTotal = 2;
  tamperedDn.grandTotal = 2;
  await tamperedDn.save();
  const repricedDn = await DeliveryNote.findById(firstDn._id).lean();
  assert.equal(repricedDn.items[0].unitPrice, 100);
  assert.equal(repricedDn.items[0].lineTotal, 200);
  assert.equal(repricedDn.grandTotal, 190);

  let savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(savedOrder.workflowStatus, 'DN Created');
  assert.equal(savedOrder.status, 'DN Created');
  assert.notEqual(savedOrder.deliveryStatus, 'Delivered');
  assert.equal(savedOrder.currentDepartment, 'Accounts');

  const confirmationBody = JSON.stringify({
    receivedBy: 'Release 7 Receiver',
    signedDeliveryNoteDocument: 'data:application/pdf;base64,WA==',
    signedDeliveryNoteDocumentName: 'signed-release-7.pdf'
  });
  const confirmations = await Promise.all([
    request(support, `/api/sales-employee/delivery-notes/${firstDn._id}/confirm`, { method: 'POST', body: confirmationBody }),
    request(support, `/api/sales-employee/delivery-notes/${firstDn._id}/confirm`, { method: 'POST', body: confirmationBody })
  ]);
  assert.deepEqual(confirmations.map(result => result.response.status).sort(), [200, 409]);

  let savedInventory = await InventoryItem.findById(inventory._id).lean();
  savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(savedInventory.quantityOnHand, 10);
  assert.equal(savedInventory.reservedQuantity, 3);
  assert.equal(savedInventory.stockMovements.filter(movement => movement.type === 'OUT').length, 1);
  assert.equal(savedInventory.stockMovements[0].performedByName, support.fullName);
  assert.match(savedInventory.stockMovements[0].remarks, /reserved for this Sales Order/i);
  assert.equal(savedOrder.workflowStatus, 'Partially Delivered');
  assert.equal(savedOrder.deliveryStatus, 'Partially Delivered');
  assert.equal(savedOrder.currentDepartment, 'Support');
  assert.equal(savedOrder.inventoryReservations[0].remainingQuantity, 3);

  const secondCreated = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({
      salesOrderId: order._id,
      recipientName: 'Release 7 Receiver',
      deliveryAddress: 'Release 7 address',
      items: [{ orderItemId: String(savedOrder.items[0]._id), quantity: 3 }]
    })
  });
  assert.equal(secondCreated.response.status, 201, JSON.stringify(secondCreated.data));
  assert.equal(secondCreated.data.data.items[0].unitPrice, 100);
  assert.equal(secondCreated.data.data.grandTotal, 285);

  const completed = await request(support, `/api/sales-employee/delivery-notes/${secondCreated.data.data._id}/confirm`, {
    method: 'POST',
    body: confirmationBody
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.data));

  savedInventory = await InventoryItem.findById(inventory._id).lean();
  savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(savedInventory.quantityOnHand, 7);
  assert.equal(savedInventory.reservedQuantity, 0);
  assert.equal(savedInventory.stockMovements.filter(movement => movement.type === 'OUT').length, 2);
  assert.equal(savedOrder.workflowStatus, 'Delivered');
  assert.equal(savedOrder.deliveryStatus, 'Delivered');
  assert.equal(savedOrder.currentDepartment, 'Accounts');
  assert.equal(savedOrder.inventoryReservations[0].remainingQuantity, 0);
  assert.equal(savedOrder.inventoryReservations[0].status, 'Fulfilled');
});

test('an old unreserved order deducts on hand without consuming another order reservation', async () => {
  const inventory = await InventoryItem.create({
    name: 'Legacy Release Seven Item',
    sku: 'R7-LEGACY',
    quantityOnHand: 10,
    reservedQuantity: 2,
    minStockLevel: 0
  });
  const order = await createOrder('Legacy Release Seven Item', 3, {
    workflowStatus: 'Goods Received in Office',
    status: 'Goods Received in Office',
    currentDepartment: 'Support',
    departmentResponsible: 'Support',
    goodsReceivedInOffice: {
      received: true,
      receivedQuantity: 3,
      orderedQuantity: 3,
      receivedAt: new Date(),
      receivedBy: support._id,
      receivedByName: support.fullName
    },
    inventoryAnalysis: [{
      productId: String(inventory._id),
      productName: 'Legacy Release Seven Item',
      orderedQty: 3,
      availableQty: 8,
      shortageQty: 0,
      status: 'Available'
    }]
  });

  const created = await request(support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({ salesOrderId: order._id })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const confirmed = await request(support, `/api/sales-employee/delivery-notes/${created.data.data._id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      receivedBy: 'Legacy Receiver',
      signedDeliveryNoteDocument: 'data:application/pdf;base64,WA==',
      signedDeliveryNoteDocumentName: 'legacy-signed.pdf'
    })
  });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));

  const savedInventory = await InventoryItem.findById(inventory._id).lean();
  assert.equal(savedInventory.quantityOnHand, 7);
  assert.equal(savedInventory.reservedQuantity, 2);
});
