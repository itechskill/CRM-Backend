const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

process.env.NODE_ENV = 'test';
mongoose.set('autoIndex', false);
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r16_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 16 tests.');
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
const PurchaserGRN = require('../models/PurchaserGRN');
const SalesOrder = require('../models/SalesOrder');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');

let server;
let baseUrl;
let users;
let statusShipment;
const selectedMonth = new Date().toISOString().slice(0, 7);
const selectedDate = new Date(`${selectedMonth}-10T12:00:00.000Z`);
const previousDate = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 10, 12));
const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;

const tokenFor = user => jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026',
  { expiresIn: '15m' }
);
const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
};
const insertLogisticsOrder = async ({ date, completed = false }) => {
  const _id = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id,
    orderNumber: `SO-R16-${String(_id).slice(-6)}`,
    orderReference: `SO-R16-${String(_id).slice(-6)}`,
    clientName: 'Release 16 Customer',
    fileType: 'Blue',
    items: [],
    currentDepartment: completed ? 'Accounts' : 'Logistics',
    departmentResponsible: completed ? 'Accounts' : 'Logistics',
    workflowStatus: completed ? 'Completed' : 'In Logistics',
    status: completed ? 'Completed' : 'In Logistics',
    deliveryStatus: completed ? 'Fully Delivered' : 'Not Delivered',
    lastActionAt: date,
    workflowHistory: [{ department: 'Global Purchaser', newStatus: 'In Logistics', timestamp: date }],
    createdAt: date,
    updatedAt: date
  });
  return _id;
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');

  const password = `Release16-${runId}`;
  const created = await User.create([
    { fullName: 'Release 16 Logistics', email: `r16.logistics.${runId}@example.com`, password, role: 'logistics', status: 'active', isApproved: true },
    { fullName: 'Release 16 Admin', email: `r16.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'Release 16 CEO', email: `r16.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'Release 16 Support', email: `r16.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true },
    { fullName: 'Release 16 Sales', email: `r16.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true }
  ]);
  users = { logistics: created[0], admin: created[1], ceo: created[2], support: created[3], sales: created[4] };

  const currentOrder = await insertLogisticsOrder({ date: selectedDate });
  const priorIncompleteOrder = await insertLogisticsOrder({ date: previousDate });
  const priorCompletedOrder = await insertLogisticsOrder({ date: previousDate, completed: true });

  const poRows = [
    { orderId: currentOrder, date: selectedDate, suffix: 'CURRENT' },
    { orderId: priorIncompleteOrder, date: previousDate, suffix: 'PRIOR-OPEN' },
    { orderId: priorCompletedOrder, date: previousDate, suffix: 'PRIOR-DONE' }
  ];
  for (const row of poRows) {
    const po = await SupplierPO.create({
      poNumber: `GPO-R16-${row.suffix}-${runId}`,
      supplierName: 'Release 16 Global Supplier',
      poType: 'Global',
      poDate: row.date,
      totalAmount: 100,
      status: 'In Logistics',
      salesOrderId: row.orderId,
      createdBy: users.logistics._id
    });
    await SupplierPO.collection.updateOne({ _id: po._id }, { $set: { createdAt: row.date, updatedAt: row.date } });

    const grn = await PurchaserGRN.create({
      grnNumber: `GRN-R16-${row.suffix}-${runId}`,
      grnType: 'Logistics',
      supplierPO: po._id,
      salesOrder: row.orderId,
      salesOrderId: row.orderId,
      grnDate: row.date,
      createdBy: users.logistics._id
    });
    await PurchaserGRN.collection.updateOne({ _id: grn._id }, { $set: { createdAt: row.date, updatedAt: row.date } });
  }

  await Shipment.create([
    { shipmentId: `SHP-R16-PICKUP-${runId}`, salesOrder: currentOrder, status: 'Picked Up', createdBy: users.logistics._id },
    { shipmentId: `SHP-R16-TRANSIT-${runId}`, salesOrder: currentOrder, status: 'In Transit', createdBy: users.logistics._id },
    { shipmentId: `SHP-R16-BOOKED-${runId}`, salesOrder: currentOrder, status: 'Booked', createdBy: users.logistics._id }
  ]);
  statusShipment = await Shipment.create({
    shipmentId: `SHP-R16-STATUS-${runId}`,
    salesOrder: currentOrder,
    status: 'PO Issued',
    createdBy: users.logistics._id
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
      if (error.code !== 8000 || !String(error.message).includes('dropDatabase')) throw error;
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      for (const { name } of collections) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('Logistics dashboard counts SOs, POs, Global GRNs and current shipment statuses', async () => {
  const result = await request(users.logistics, `/api/logistics/stats?month=${selectedMonth}`);
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.data.tiles, {
    soReceived: { count: 2 },
    poIssued: { count: 2 },
    globalGrnInput: { count: 2 },
    pickup: { count: 1 },
    inTransit: { count: 1 }
  });
});

test('current month carries an incomplete prior order while past month uses event dates only', async () => {
  const current = await request(users.logistics, `/api/logistics/stats?month=${selectedMonth}`);
  assert.equal(current.response.status, 200, JSON.stringify(current.data));
  assert.equal(current.data.data.tiles.soReceived.count, 2);
  assert.equal(current.data.data.tiles.poIssued.count, 2);
  assert.equal(current.data.data.tiles.globalGrnInput.count, 2);

  const past = await request(users.logistics, `/api/logistics/stats?month=${previousMonth}`);
  assert.equal(past.response.status, 200, JSON.stringify(past.data));
  assert.equal(past.data.data.tiles.soReceived.count, 2);
  assert.equal(past.data.data.tiles.poIssued.count, 2);
  assert.equal(past.data.data.tiles.globalGrnInput.count, 2);
});

test('dashboard access and shipment status updates enforce the Release 16 role rules', async () => {
  for (const user of [users.logistics, users.admin, users.ceo]) {
    const result = await request(user, `/api/logistics/stats?month=${selectedMonth}`);
    assert.equal(result.response.status, 200, `${user.role}: ${JSON.stringify(result.data)}`);
  }
  for (const user of [users.support, users.sales]) {
    const result = await request(user, `/api/logistics/stats?month=${selectedMonth}`);
    assert.equal(result.response.status, 403, `${user.role}: ${JSON.stringify(result.data)}`);
  }

  const pickedUp = await request(users.logistics, `/api/logistics/shipments/${statusShipment._id}/tracking`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Picked Up' })
  });
  assert.equal(pickedUp.response.status, 200, JSON.stringify(pickedUp.data));
  const inTransit = await request(users.logistics, `/api/logistics/shipments/${statusShipment._id}/tracking`, {
    method: 'PATCH', body: JSON.stringify({ status: 'In Transit' })
  });
  assert.equal(inTransit.response.status, 200, JSON.stringify(inTransit.data));

  const invalid = await request(users.logistics, `/api/logistics/shipments/${statusShipment._id}/tracking`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Sailing' })
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.data));

  for (const user of [users.admin, users.ceo, users.support, users.sales]) {
    const forbidden = await request(user, `/api/logistics/shipments/${statusShipment._id}/tracking`, {
      method: 'PATCH', body: JSON.stringify({ status: 'Picked Up' })
    });
    assert.equal(forbidden.response.status, 403, `${user.role}: ${JSON.stringify(forbidden.data)}`);
  }
});
