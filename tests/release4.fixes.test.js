const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release4-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r4_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 4 tests.');
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
const SalesOrder = require('../models/SalesOrder');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let purchaser;
let logistics;

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

const createOrder = overrides => SalesOrder.create({
  clientName: `Release 4 client ${runId}`,
  fileType: 'Blue',
  items: [{ description: 'Release 4 item', quantity: 2, unitPrice: 100, total: 200 }],
  totalAmount: 200,
  netAmount: 200,
  workflowStatus: 'Pending Global Procurement',
  status: 'Pending Global Procurement',
  currentDepartment: 'Global Purchaser',
  departmentResponsible: 'Global Purchaser',
  issuingCompany: {
    code: 'FORTLINE_ENTERPRISES', legalName: 'Fortline Enterprises',
    allowedDocumentTypes: ['Quotation', 'LocalPO', 'GlobalPO']
  },
  createdBy: purchaser._id,
  salesPerson: purchaser._id,
  ...(overrides || {})
});

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
  await SupplierPO.collection.createIndex({ poNumber: 1 }, { unique: true });
  await Counter.create([
    { _id: getCounterKey('sales-order-number'), sequence: 1 },
    { _id: getCounterKey('global-po-number'), sequence: 1 },
    { _id: getCounterKey('delivery-note-number'), sequence: 1 }
  ]);
  const password = `Release4-${runId}`;
  [purchaser, logistics] = await User.create([
    { fullName: 'Release 4 Global Purchaser', email: `r4.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true },
    { fullName: 'Release 4 Logistics', email: `r4.logistics.${runId}@example.com`, password, role: 'logistics', status: 'active', isApproved: true }
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

test('concurrent Global PO creation allocates unique server numbers and ignores caller input', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => request(purchaser, '/api/purchaser/pos', {
    method: 'POST',
    body: JSON.stringify({
      poType: 'Global', poNumber: 'CALLER-SUPPLIED', issuingCompanyCode: 'FORTLINE_ENTERPRISES',
      supplierName: `Concurrent Global Supplier ${index}`, supplierCountry: 'China',
      items: [{ productName: `Item ${index}`, quantity: 1, unitPricePKR: 100, totalPricePKR: 100 }]
    })
  })));
  assert.ok(results.every(result => result.response.status === 201), results.map(result => result.data));
  const numbers = results.map(result => result.data.data.poNumber);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(numbers.every(number => /^GPO-\d{6,}$/.test(number)));
  assert.ok(numbers.every(number => number !== 'CALLER-SUPPLIED'));
});

test('Global PO VAT is saved on the PO and synchronized to the Sales Order snapshot', async () => {
  const order = await createOrder();
  const result = await request(purchaser, '/api/purchaser/pos', {
    method: 'POST',
    body: JSON.stringify({
      poType: 'Global', salesOrderId: order._id, issuingCompanyCode: 'FORTLINE_ENTERPRISES',
      supplierName: 'VAT Global Supplier', supplierCountry: 'Germany', vatRate: 15,
      items: [{ productName: 'Release 4 item', quantity: 2, unitPricePKR: 100, totalPricePKR: 200 }]
    })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  const po = await SupplierPO.findById(result.data.data._id).lean();
  const savedOrder = await SalesOrder.findById(order._id).lean();
  assert.equal(po.subtotal, 200);
  assert.equal(po.vatRate, 15);
  assert.equal(po.vatAmount, 30);
  assert.equal(po.totalAmount, 230);
  assert.equal(savedOrder.supplierPO.poNumber, po.poNumber);
  assert.equal(savedOrder.supplierPO.vatRate, 15);
  assert.equal(savedOrder.supplierPO.vatAmount, 30);
  assert.equal(savedOrder.supplierPO.total, 230);
});

test('shipment initialization trusts the order Global PO and received shipments reject tracking edits', async () => {
  const order = await createOrder({
    supplierPoNumber: 'GPO-009999',
    supplierPO: { poNumber: 'GPO-009999', poType: 'International', supplierName: 'Order Supplier', supplierCountry: 'China' }
  });
  const initialized = await request(logistics, '/api/logistics/shipments', {
    method: 'POST',
    body: JSON.stringify({ salesOrderId: order._id, supplierPoNumber: 'GPO-000000', trackingNumber: 'ORIGINAL' })
  });
  assert.equal(initialized.response.status, 201, JSON.stringify(initialized.data));
  assert.equal(initialized.data.data.supplierPoNumber, 'GPO-009999');

  await Shipment.updateOne({ _id: initialized.data.data._id }, { $set: { receivedInOffice: true, status: 'Received in Office' } });
  const locked = await request(logistics, `/api/logistics/shipments/${initialized.data.data._id}/tracking`, {
    method: 'PATCH', body: JSON.stringify({ trackingNumber: 'CHANGED' })
  });
  assert.equal(locked.response.status, 409);
  assert.match(locked.data.message, /locked.*Received in Office/i);
  const saved = await Shipment.findById(initialized.data.data._id).lean();
  assert.equal(saved.trackingNumber, 'ORIGINAL');
});

test('concurrent Delivery Note creation uses the atomic server counter without duplicates', async () => {
  const notes = await Promise.all(Array.from({ length: 20 }, (_, index) => DeliveryNote.create({
    deliveryNumber: '', deliveryNoteNumber: 'CALLER-SUPPLIED',
    clientName: `DN client ${index}`, createdBy: logistics._id
  })));
  const numbers = notes.map(note => note.deliveryNumber);
  assert.equal(new Set(numbers).size, notes.length);
  assert.ok(numbers.every(number => /^WH\/OUT\/\d{5,}$/.test(number)));
  assert.ok(notes.every(note => note.deliveryNoteNumber === note.deliveryNumber));
  assert.ok(numbers.every(number => number !== 'CALLER-SUPPLIED'));
});
