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
const tempDbName = `f_tmp_r21_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 21 tests.');
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
process.env.COUNTER_NAMESPACE = `release21-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const Counter = require('../models/Counter');
const DeliveryNote = require('../models/DeliveryNote');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const Notification = require('../models/Notification');
const SalesOrder = require('../models/SalesOrder');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');
const { serializeMonetaryVisibility } = require('../utils/monetaryVisibility');

let server;
let baseUrl;
let users;
let inventory;
let order;
let availableOrder;
let invoice;
let supplierPO;
let shipment;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { response, data: await response.json() };
};

const MONEY_KEYS = new Set([
  'unitPrice', 'price', 'lineTotal', 'subtotal', 'discount', 'tax', 'taxRate', 'gstRate', 'gstAmount', 'total', 'value',
  'vatRate', 'vatAmount', 'grandTotal', 'totalAmount', 'netAmount', 'amount', 'paidAmount',
  'outstandingAmount', 'remaining', 'totalPaid', 'outstandingBalance', 'currency', 'exchangeRate', 'exchangeRateToPKR',
  'expenses', 'costingHistory', 'stockValue', 'inventoryValue', 'totalInventoryValue', 'totalValuePKR',
  'shortageAmount', 'advanceRequiredAmount', 'advanceReceivedAmount'
]);
const assertNoMoney = (value, path = 'response') => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoMoney(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(MONEY_KEYS.has(key), false, `${path}.${key} leaked monetary data`);
    assertNoMoney(nested, `${path}.${key}`);
  }
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  await Counter.create([
    { _id: getCounterKey('delivery-note-number'), sequence: 1 },
    { _id: getCounterKey('sales-order-number'), sequence: 1 }
  ]);
  const password = `Release21-${runId}`;
  const created = await User.create([
    { fullName: 'R21 Support', email: `r21.support.${runId}@example.com`, password, role: 'support', department: 'Support', status: 'active', isApproved: true },
    { fullName: 'R21 Logistics', email: `r21.logistics.${runId}@example.com`, password, role: 'logistics', department: 'Logistics', status: 'active', isApproved: true },
    { fullName: 'R21 Accounts', email: `r21.accounts.${runId}@example.com`, password, role: 'accountant', department: 'Accounts', status: 'active', isApproved: true },
    { fullName: 'R21 Sales A', email: `r21.salesa.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true, salaryTarget: 1234500 },
    { fullName: 'R21 Sales B', email: `r21.salesb.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R21 HR', email: `r21.hr.${runId}@example.com`, password, role: 'hr_manager', department: 'HR', status: 'active', isApproved: true },
    { fullName: 'R21 Administration', email: `r21.administration.${runId}@example.com`, password, role: 'administration', department: 'Administration', status: 'active', isApproved: true },
    { fullName: 'R21 Admin', email: `r21.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true }
  ]);
  users = { support: created[0], logistics: created[1], accounts: created[2], salesA: created[3], salesB: created[4], hr: created[5], administration: created[6], admin: created[7] };

  inventory = await InventoryItem.create({ name: 'R21 Server', sku: 'R21-SRV', quantityOnHand: 8, reservedQuantity: 0, minStockLevel: 0, unitPrice: 55000 });
  order = await SalesOrder.create({
    orderNumber: `SO-R21-${runId}`, clientName: 'R21 Client', fileType: 'Green',
    items: [{ description: 'R21 Server', quantity: 2, unitPrice: 75000, total: 150000 }],
    totalAmount: 150000, discount: 5000, tax: 26100, netAmount: 171100,
    workflowStatus: 'Goods Received in Office', status: 'Goods Received in Office', currentDepartment: 'Support', departmentResponsible: 'Support',
    goodsReceivedInOffice: { received: true, receivedQuantity: 2, orderedQuantity: 2, receivedAt: new Date(), receivedBy: users.support._id, receivedByName: users.support.fullName },
    inventoryAnalysis: [{ productId: String(inventory._id), productName: 'R21 Server', orderedQty: 2, availableQty: 8, shortageQty: 0, status: 'Available' }],
    createdBy: users.salesA._id, owner: users.salesA._id, salesPerson: users.salesA._id
  });
  availableOrder = await SalesOrder.create({
    orderNumber: `SO-R21-AVAILABLE-${runId}`, clientName: 'R21 Available', fileType: 'Green',
    items: [{ description: 'R21 Server', quantity: 1, unitPrice: 75000, total: 75000 }], totalAmount: 75000, netAmount: 75000,
    workflowStatus: 'Goods Received in Office', status: 'Goods Received in Office', currentDepartment: 'Support', departmentResponsible: 'Support',
    goodsReceivedInOffice: { received: true, receivedQuantity: 1, orderedQuantity: 1, receivedAt: new Date() },
    inventoryAnalysis: [{ productId: String(inventory._id), productName: 'R21 Server', orderedQty: 1, availableQty: 8, shortageQty: 0, status: 'Available' }],
    createdBy: users.salesA._id, owner: users.salesA._id, salesPerson: users.salesA._id
  });
  invoice = await Invoice.create({
    invoiceNumber: `INV-R21-${runId}`, clientName: 'R21 Client', salesOrderId: order._id, salesOrderNumber: order.orderNumber,
    items: [{ description: 'R21 Server', quantity: 2, unitPrice: 75000, total: 150000 }], subtotal: 150000, tax: 26100,
    amount: 171100, paidAmount: 10000, outstandingAmount: 161100, dueDate: new Date(Date.now() - 86400000), status: 'Finalized', isDraft: false,
    createdBy: users.salesA._id, salesPerson: users.salesA._id
  });
  order.invoiceId = invoice._id;
  order.invoiceNumber = invoice.invoiceNumber;
  await order.save();
  supplierPO = await SupplierPO.create({
    poNumber: `LPO-R21-${runId}`, supplierName: 'R21 Supplier', poType: 'Local', salesOrderId: order._id,
    items: [{ productName: 'R21 Server', quantity: 2, unitPrice: 50000, totalAmount: 100000 }],
    subtotal: 100000, totalAmount: 118000, total: 118000, gstRate: 18, gstAmount: 18000, status: 'Issued', createdBy: users.admin._id
  });
  shipment = await Shipment.create({
    shipmentId: `SHP-R21-${runId}`, salesOrder: order._id, salesOrderNumber: order.orderNumber, salesPerson: users.salesA._id,
    fileType: 'Blue', status: 'In Transit', items: [{ description: 'R21 Server', quantity: 2, unitPrice: 50000, total: 100000 }], createdBy: users.logistics._id
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

test('single serializer removes explicit money fields recursively for Support and Logistics but preserves authorized roles', () => {
  const sample = {
    totalAmount: 10,
    items: [{ description: 'Item', quantity: 1, unitPrice: 10, total: 10 }],
    supplierPO: { totalAmount: 8, expenses: [{ amountCents: 100 }], items: [{ quantity: 1, unitPrice: 8, total: 8 }] },
    invoiceId: { amount: 10, items: [{ quantity: 1, unitPrice: 10, total: 10 }] },
    deliveryNoteId: { grandTotal: 10, items: [{ quantity: 1, unitPrice: 10, lineTotal: 10 }] }
  };
  assertNoMoney(serializeMonetaryVisibility(sample, { role: 'support' }, 'sales-order'));
  assertNoMoney(serializeMonetaryVisibility(sample, { role: 'logistics' }, 'sales-order'));
  assert.equal(serializeMonetaryVisibility(sample, { role: 'accountant' }, 'sales-order').totalAmount, 10);
  assert.equal(serializeMonetaryVisibility(sample, { role: 'finance' }, 'sales-order').totalAmount, 10);
  assert.equal(serializeMonetaryVisibility(sample, { role: 'purchaser' }, 'sales-order').totalAmount, 10);
  assert.equal(serializeMonetaryVisibility(sample, { role: 'admin' }, 'sales-order').totalAmount, 10);
  assert.equal(serializeMonetaryVisibility(sample, { role: 'ceo' }, 'sales-order').totalAmount, 10);
});

test('Support endpoint matrix returns quantity-only documents including nested and populated data', async () => {
  const paths = [
    '/api/sales-employee/orders',
    '/api/sales-employee/orders/available-for-delivery',
    '/api/sales-employee/delivery-notes',
    '/api/sales-employee/inventory',
    '/api/sales-employee/invoices',
    '/api/sales-employee/check-overdue?clientName=R21%20Client',
    `/api/sales-employee/orders/${order._id}/document-package`,
    '/api/purchaser/pos'
  ];
  for (const path of paths) {
    const result = await request(users.support, path);
    assert.equal(result.response.status, 200, `${path}: ${JSON.stringify(result.data)}`);
    assertNoMoney(result.data, path);
  }
});

test('Logistics endpoint matrix returns quantity-only documents including nested and populated data', async () => {
  const paths = [
    '/api/logistics/shipments',
    `/api/logistics/shipments/${shipment._id}`,
    '/api/logistics/incoming-orders',
    '/api/logistics/pending-grns',
    '/api/logistics/delivery-notes',
    '/api/logistics/import-inventory',
    '/api/sales-employee/orders',
    '/api/sales-employee/invoices',
    '/api/sales-employee/delivery-notes',
    '/api/sales-employee/inventory'
  ];
  for (const path of paths) {
    const result = await request(users.logistics, path);
    assert.equal(result.response.status, 200, `${path}: ${JSON.stringify(result.data)}`);
    assertNoMoney(result.data, path);
  }
});

test('Support creates quantity-only DN while stored and Accounts DN stay fully priced; confirmation still deducts stock', async () => {
  const created = await request(users.support, '/api/sales-employee/delivery-notes', {
    method: 'POST',
    body: JSON.stringify({
      salesOrderId: order._id,
      items: [{ orderItemId: String(order.items[0]._id), quantity: 2, unitPrice: 1, lineTotal: 2 }],
      subtotal: 2,
      grandTotal: 2
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assertNoMoney(created.data);
  const stored = await DeliveryNote.findById(created.data.data._id).lean();
  assert.equal(stored.items[0].unitPrice, 75000);
  assert.equal(stored.items[0].lineTotal, 150000);
  assert.equal(stored.grandTotal, 171100);

  const accountsNotes = await request(users.accounts, '/api/sales-employee/delivery-notes');
  assert.equal(accountsNotes.response.status, 200);
  const accountsDN = accountsNotes.data.data.find(item => item._id === String(stored._id));
  assert.equal(accountsDN.items[0].unitPrice, 75000);
  assert.equal(accountsDN.grandTotal, 171100);

  const before = await InventoryItem.findById(inventory._id).lean();
  const confirmed = await request(users.support, `/api/sales-employee/delivery-notes/${stored._id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ receivedBy: 'R21 Receiver', signedDeliveryNoteDocument: 'data:application/pdf;base64,WA==', signedDeliveryNoteDocumentName: 'r21-signed.pdf' })
  });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
  assertNoMoney(confirmed.data);
  const afterInventory = await InventoryItem.findById(inventory._id).lean();
  assert.equal(afterInventory.quantityOnHand, before.quantityOnHand - 2);
});

test('Support cannot set inventory unit price while Admin can', async () => {
  const supportCreated = await request(users.support, '/api/sales-employee/inventory', {
    method: 'POST', body: JSON.stringify({ name: `R21 Support Item ${runId}`, sku: `SUP-${runId}`, quantityOnHand: 1, unitPrice: 999999 })
  });
  assert.equal(supportCreated.response.status, 200, JSON.stringify(supportCreated.data));
  assertNoMoney(supportCreated.data);
  const stored = await InventoryItem.findById(supportCreated.data.data._id).lean();
  assert.equal(stored.unitPrice, 0);

  const adminCreated = await request(users.admin, '/api/sales-employee/inventory', {
    method: 'POST', body: JSON.stringify({ name: `R21 Admin Item ${runId}`, sku: `ADM-${runId}`, quantityOnHand: 1, unitPrice: 1234 })
  });
  assert.equal(adminCreated.response.status, 200, JSON.stringify(adminCreated.data));
  assert.equal(adminCreated.data.data.unitPrice, 1234);
});

test('Sales owner retains selling amounts and another salesperson remains blocked', async () => {
  const ownOrders = await request(users.salesA, '/api/sales-employee/orders');
  assert.equal(ownOrders.response.status, 200);
  const own = ownOrders.data.data.find(item => item._id === String(order._id));
  assert.equal(own.netAmount, 171100);
  assert.equal(own.items[0].unitPrice, 75000);
  const blocked = await request(users.salesB, `/api/sales-employee/orders/${order._id}/document-package`);
  assert.equal(blocked.response.status, 403);
});

test('HR and Administration directory/report responses omit salary while Admin retains it', async () => {
  for (const user of [users.hr, users.administration]) {
    const employees = await request(user, '/api/hr/employees');
    assert.equal(employees.response.status, 200, JSON.stringify(employees.data));
    assert.equal(JSON.stringify(employees.data).includes('salaryTarget'), false);
    const report = await request(user, '/api/hr/report-data');
    assert.equal(report.response.status, 200, JSON.stringify(report.data));
    assert.equal(JSON.stringify(report.data).includes('salaryTarget'), false);
    const directory = await request(user, '/api/admin/directory');
    assert.equal(directory.response.status, 200, JSON.stringify(directory.data));
    assert.equal(JSON.stringify(directory.data).includes('salaryTarget'), false);
    const profile = await request(user, `/api/admin/directory/${users.salesA._id}`);
    assert.equal(profile.response.status, 200, JSON.stringify(profile.data));
    assert.equal(JSON.stringify(profile.data).includes('salaryTarget'), false);
  }
  const adminDirectory = await request(users.admin, '/api/admin/directory');
  assert.equal(adminDirectory.response.status, 200);
  assert.equal(adminDirectory.data.data.find(item => item._id === String(users.salesA._id)).salaryTarget, 1234500);
});

test('notifications addressed to Support or Logistics contain no monetary value', async () => {
  await Notification.create([
    { recipient: users.support._id, sender: users.admin._id, title: 'Goods ready', message: `Sales Order ${order.orderNumber} is ready for Support.`, type: 'order' },
    { recipient: users.logistics._id, sender: users.admin._id, title: 'Shipment ready', message: `Sales Order ${order.orderNumber} is ready for Logistics.`, type: 'order' }
  ]);
  const notifications = await Notification.find({ recipient: { $in: [users.support._id, users.logistics._id] } }).lean();
  assert.ok(notifications.length >= 2);
  for (const notification of notifications) {
    assert.doesNotMatch(`${notification.title} ${notification.message}`, /(?:PKR|Rs\.?|amount|total)\s*[:=-]?\s*\d/i);
  }
});
