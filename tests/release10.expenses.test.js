const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
const TEMP_DB_PREFIX = 'f_tmp_r10_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 10 tests.');
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
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const Notification = require('../models/Notification');
const User = require('../models/User');
const PurchaseExpenseCategory = require('../models/PurchaseExpenseCategory');
const SalesOrder = require('../models/SalesOrder');
const InventoryItem = require('../models/InventoryItem');
const PurchaserGRN = require('../models/PurchaserGRN');
const Counter = require('../models/Counter');
const SalesActivity = require('../models/SalesActivity');
const { getCounterKey } = require('../utils/counterKey');
const { buildExpenseValues, summarizeExpenses, totalCostPKR } = require('../utils/purchaseExpenses');
const { canAccessPO } = require('../controllers/purchaseExpenseController');

let server;
let baseUrl;
let admin;
let finance;
let support;
let localPurchaser;
let globalPurchaser;
let ceo;
let sales;
let salesOther;
let localPO;
let globalPO;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026', { expiresIn: '15m' });
const request = async (user, path, method = 'GET', body = undefined) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  assert.notEqual(mongoose.connection.name, 'test');
  assert.notEqual(mongoose.connection.name, 'fortline_dev');
  const password = `R10-${runId}`;
  [admin, finance, support, localPurchaser, globalPurchaser, ceo, sales, salesOther] = await User.create([
    { fullName: 'R10 Admin', email: `r10.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R10 Finance', email: `r10.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R10 Support', email: `r10.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true },
    { fullName: 'R10 Local', email: `r10.local.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'R10 Global', email: `r10.global.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true },
    { fullName: 'R10 CEO', email: `r10.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R10 Sales', email: `r10.sales.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true },
    { fullName: 'R10 Other Sales', email: `r10.other.sales.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true }
  ]);
  const supplier = await Supplier.create({ name: 'R10 Supplier', supplierType: 'Local', country: 'Pakistan', createdBy: localPurchaser._id });
  const globalSupplier = await Supplier.create({ name: 'R10 Global Supplier', supplierType: 'Global', country: 'United States', createdBy: globalPurchaser._id });
  localPO = await SupplierPO.create({
    poNumber: `LPO-R10-${runId}`, supplier: supplier._id, supplierName: supplier.name, poType: 'Local',
    items: [{ productName: 'SSD', quantity: 1, unitPrice: 1000, totalAmount: 1000 }],
    subtotal: 1000, gstRate: 18, gstAmount: 180, total: 1180, totalAmount: 1180,
    salesOrderNumber: 'SO-R10', createdBy: localPurchaser._id, createdByName: localPurchaser.fullName
  });
  globalPO = await SupplierPO.create({
    poNumber: `GPO-R10-${runId}`, supplier: globalSupplier._id, supplierName: globalSupplier.name, poType: 'Global',
    items: [{ productName: 'Server', quantity: 1, unitPrice: 100, totalAmount: 100 }],
    subtotal: 100, total: 100, totalAmount: 100, currency: 'USD', exchangeRateToPKR: 280,
    salesOrderNumber: 'SO-R10-GLOBAL', createdBy: globalPurchaser._id, createdByName: globalPurchaser.fullName
  });
  await Counter.create({ _id: getCounterKey('grn-number'), sequence: 0 });
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 2000 });
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

test('percentage and foreign-currency expense lines use integer PKR cents', () => {
  const percentage = buildExpenseValues({ category: 'Customs Duty', calculationType: 'Percentage', percentage: 10, currency: 'USD', exchangeRateToPKR: 280 }, localPO);
  assert.equal(percentage.amountPKRCents, 10000);
  assert.equal(percentage.currency, 'PKR');
  assert.equal(percentage.exchangeRateToPKR, 1);
  const currency = buildExpenseValues({ category: 'Freight', amount: 10, currency: 'USD', exchangeRateToPKR: 280 }, localPO);
  assert.equal(currency.amountCents, 1000);
  assert.equal(currency.amountPKRCents, 280000);
  const attachment = Buffer.from('receipt').toString('base64');
  const withAttachment = buildExpenseValues({ category: 'Freight', amount: 1, attachments: [{ name: 'receipt.txt', mimeType: 'text/plain', size: 1, data: `data:text/plain;base64,${attachment}` }] }, localPO);
  assert.equal(withAttachment.attachments[0].size, 7);
  assert.throws(() => buildExpenseValues({ category: 'Freight', amount: 1, attachments: [{ name: 'too-large.bin', size: 1, data: `data:application/octet-stream;base64,${Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64')}` }] }, localPO), /3 MB/);
});

test('Finance can add/edit/soft-delete expenses, history is retained, and Admin is notified each time', async () => {
  const added = await request(finance, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', {
    category: 'Freight', description: 'International freight', amount: 10, currency: 'USD', exchangeRateToPKR: 280, taxable: true
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  let expense = added.body.data.expenses.find(item => !item.isDeleted);
  assert.equal(expense.amountPKRCents, 280000);
  assert.equal(expense.editHistory.length, 1);
  assert.equal(added.body.data.expenseTotals.landedCostPKRCents, 398000);

  const edited = await request(finance, `/api/purchaser/pos/${localPO._id}/expenses/${expense._id}`, 'PATCH', { amount: 12 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  expense = edited.body.data.expenses.id ? edited.body.data.expenses.id(expense._id) : edited.body.data.expenses.find(item => item._id === String(expense._id));
  assert.equal(expense.amountPKRCents, 336000);
  assert.equal(expense.editHistory.length, 2);

  const removed = await request(finance, `/api/purchaser/pos/${localPO._id}/expenses/${expense._id}`, 'DELETE');
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  expense = removed.body.data.expenses.find(item => item._id === String(expense._id));
  assert.equal(expense.isDeleted, true);
  assert.equal(expense.editHistory.at(-1).action, 'Removed');
  assert.equal(removed.body.data.expenseTotals.totalExpensesPKRCents, 0);
  assert.equal(await Notification.countDocuments({ recipient: admin._id, 'data.supplierPOId': localPO._id }), 3);
  assert.equal(await Notification.countDocuments({ recipient: admin._id, 'data.supplierPOId': localPO._id, link: '/admin/supplier-po-expenses' }), 3);
});

test('role matrix allows Support and matching purchasers to add, but only Finance and Admin may edit or delete', async () => {
  assert.equal(canAccessPO(support, localPO, 'add'), true);
  assert.equal(canAccessPO(support, localPO, 'edit'), false);
  assert.equal(canAccessPO(localPurchaser, localPO, 'add'), true);
  assert.equal(canAccessPO(localPurchaser, localPO, 'edit'), false);
  assert.equal(canAccessPO(globalPurchaser, localPO, 'add'), false);
  assert.equal(canAccessPO(globalPurchaser, globalPO, 'add'), true);
  assert.equal(canAccessPO(globalPurchaser, globalPO, 'edit'), false);
  assert.equal(canAccessPO(finance, localPO, 'edit'), true);
  assert.equal(canAccessPO(admin, localPO, 'edit'), true);
  assert.equal(canAccessPO(ceo, localPO, 'read'), true);
  assert.equal(canAccessPO(ceo, localPO, 'add'), false);
  assert.equal(canAccessPO(ceo, localPO, 'edit'), false);

  const supportAdd = await request(support, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Delivery', amount: 50 });
  assert.equal(supportAdd.status, 201, JSON.stringify(supportAdd.body));
  const supportExpense = supportAdd.body.data.expenses.find(item => item.addedBy === String(support._id) && !item.isDeleted);
  assert.equal((await request(support, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'PATCH', { amount: 51 })).status, 403);
  assert.equal((await request(support, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'DELETE')).status, 403);

  const localAdd = await request(localPurchaser, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'GST', amount: 20 });
  assert.equal(localAdd.status, 201, JSON.stringify(localAdd.body));
  const localExpense = localAdd.body.data.expenses.find(item => item.addedBy === String(localPurchaser._id) && !item.isDeleted);
  assert.equal((await request(localPurchaser, `/api/purchaser/pos/${localPO._id}/expenses/${localExpense._id}`, 'PATCH', { amount: 21 })).status, 403);
  assert.equal((await request(localPurchaser, `/api/purchaser/pos/${localPO._id}/expenses/${localExpense._id}`, 'DELETE')).status, 403);

  assert.equal((await request(globalPurchaser, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Other', amount: 1 })).status, 403);
  const globalAdd = await request(globalPurchaser, `/api/purchaser/pos/${globalPO._id}/expenses`, 'POST', { category: 'Freight', amount: 10, currency: 'USD', exchangeRateToPKR: 280 });
  assert.equal(globalAdd.status, 201, JSON.stringify(globalAdd.body));
  const globalExpense = globalAdd.body.data.expenses.find(item => !item.isDeleted);
  assert.equal((await request(globalPurchaser, `/api/purchaser/pos/${globalPO._id}/expenses/${globalExpense._id}`, 'PATCH', { amount: 11 })).status, 403);
  assert.equal((await request(globalPurchaser, `/api/purchaser/pos/${globalPO._id}/expenses/${globalExpense._id}`, 'DELETE')).status, 403);
  assert.equal((await request(localPurchaser, `/api/purchaser/pos/${globalPO._id}/expenses`, 'POST', { category: 'Other', amount: 1 })).status, 403);

  const adminAdd = await request(admin, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Miscellaneous', amount: 5 });
  assert.equal(adminAdd.status, 201, JSON.stringify(adminAdd.body));
  const adminExpense = adminAdd.body.data.expenses.find(item => item.addedBy === String(admin._id) && !item.isDeleted);
  assert.equal((await request(admin, `/api/purchaser/pos/${localPO._id}/expenses/${adminExpense._id}`, 'PATCH', { amount: 6 })).status, 200);
  assert.equal((await request(admin, `/api/purchaser/pos/${localPO._id}/expenses/${adminExpense._id}`, 'DELETE')).status, 200);

  assert.equal((await request(ceo, `/api/purchaser/pos/${localPO._id}/expenses`)).status, 200);
  assert.equal((await request(ceo, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Other', amount: 1 })).status, 403);
  assert.equal((await request(ceo, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'PATCH', { amount: 1 })).status, 403);
  assert.equal((await request(ceo, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'DELETE')).status, 403);
  assert.equal((await request(sales, `/api/purchaser/pos/${localPO._id}/expenses`)).status, 403);
  assert.equal((await request(sales, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Other', amount: 1 })).status, 403);
  assert.equal((await request(sales, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'PATCH', { amount: 1 })).status, 403);
  assert.equal((await request(sales, `/api/purchaser/pos/${localPO._id}/expenses/${supportExpense._id}`, 'DELETE')).status, 403);
  assert.equal((await request(sales, '/api/purchaser/pos')).status, 403);
});

test('Support Inventory IN records the expense on the canonical PO and links it to the new GRN transactionally', async () => {
  const inventory = await InventoryItem.create({ name: 'R10 Receipt Item', sku: 'R10-ITEM', quantityOnHand: 0, reservedQuantity: 0 });
  const order = await SalesOrder.create({
    orderNumber: `SO-R10-${runId}`, clientName: 'R10 Customer', fileType: 'Green',
    items: [{ description: 'R10 Receipt Item', sku: 'R10-ITEM', quantity: 1, unitPrice: 1000, total: 1000 }],
    supplierPoId: localPO._id,
    supplierPO: { poNumber: localPO.poNumber, poType: 'Local', supplierName: localPO.supplierName, currency: 'PKR' },
    currentDepartment: 'Support', departmentResponsible: 'Support', workflowStatus: 'Local Supplier PO Issued',
    owner: sales._id, createdBy: sales._id, salesPerson: sales._id
  });
  const result = await request(support, `/api/sales-employee/orders/${order._id}/goods-received`, 'POST', {
    receiptId: `R10-RECEIPT-${runId}`,
    referenceNumber: `BILL-${runId}`,
    items: [{ orderItemId: order.items[0]._id, receivedQty: 1, inventoryItemId: inventory._id }],
    expenses: [{ category: 'Custom receiving cost', description: 'Known at receipt', amount: 25, currency: 'PKR', taxable: false }]
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const grn = await PurchaserGRN.findOne({ salesOrder: order._id });
  const po = await SupplierPO.findById(localPO._id);
  const receiptExpense = po.expenses.find(item => item.description === 'Known at receipt');
  assert.ok(grn);
  assert.equal(String(receiptExpense.grn), String(grn._id));
  assert.equal(receiptExpense.grnNumber, grn.grnNumber);
  assert.equal(receiptExpense.amountPKRCents, 2500);
  assert.ok(await SalesActivity.findOne({ type: 'Inventory IN', performedBy: support._id, relatedId: order._id }));
});

test('all six Release 10.2 activity types save and activity feeds remain performer-scoped except for Admin and CEO', async () => {
  const types = [
    'Quotation Converted to Customer PO',
    'Customer PO Converted to Product File',
    'Product File Converted to Sales Order',
    'Order Sent to Finance',
    'Invoice Finalized',
    'Inventory IN'
  ];
  const marker = `R10.2 ${runId}`;
  await SalesActivity.create(types.map(type => ({ type, description: `${marker}: ${type}`, performedBy: sales._id })));
  assert.equal(await SalesActivity.countDocuments({ performedBy: sales._id, description: { $regex: `^${marker}` } }), 6);

  const own = await request(sales, '/api/sales-employee/activities');
  const other = await request(salesOther, '/api/sales-employee/activities');
  const adminView = await request(admin, '/api/sales-employee/activities');
  const ceoView = await request(ceo, '/api/sales-employee/activities');
  assert.equal(own.status, 200);
  assert.equal(own.body.data.filter(item => item.description.startsWith(marker)).length, 6);
  assert.equal(other.status, 200);
  assert.equal(other.body.data.filter(item => item.description.startsWith(marker)).length, 0);
  assert.equal(adminView.body.data.filter(item => item.description.startsWith(marker)).length, 6);
  assert.equal(ceoView.body.data.filter(item => item.description.startsWith(marker)).length, 6);
});

test('custom categories are case-insensitively de-duplicated and Admin can rename/deactivate', async () => {
  const first = await request(finance, '/api/purchaser/expense-categories', 'POST', { name: 'Port Handling' });
  const second = await request(support, '/api/purchaser/expense-categories', 'POST', { name: ' port   handling ' });
  assert.ok([200, 201].includes(first.status));
  assert.equal(second.status, 200);
  assert.equal(await PurchaseExpenseCategory.countDocuments({ key: 'port handling' }), 1);
  const updated = await request(admin, '/api/purchaser/expense-categories/port%20handling', 'PATCH', { name: 'Port Charges', isActive: false });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.name, 'Port Charges');
  assert.equal(updated.body.data.isActive, false);
  assert.equal((await request(finance, '/api/purchaser/expense-categories/freight', 'PATCH', { isActive: false })).status, 403);
  const inactiveUse = await request(finance, `/api/purchaser/pos/${localPO._id}/expenses`, 'POST', { category: 'Port Charges', amount: 1 });
  assert.equal(inactiveUse.status, 409);
});

test('totalCostPKR accepts SupplierPO or SalesOrder shape, excludes soft-deleted lines, and old POs remain empty', async () => {
  const po = await SupplierPO.findById(localPO._id);
  const summary = summarizeExpenses(po);
  assert.equal(summary.totalExpensesPKRCents, 9500);
  assert.equal(await totalCostPKR(po), 1275);
  assert.equal(await totalCostPKR({ _id: new mongoose.Types.ObjectId(), supplierPoId: po._id }), 1275);
  const oldPO = await SupplierPO.create({
    poNumber: `LPO-OLD-${runId}`, supplierName: 'Old supplier', poType: 'Local',
    items: [{ productName: 'Old', quantity: 1, unitPrice: 500, totalAmount: 500 }], totalAmount: 500,
    createdBy: localPurchaser._id
  });
  assert.deepEqual(oldPO.expenses, []);
  assert.equal(await totalCostPKR(oldPO), 500);
});
