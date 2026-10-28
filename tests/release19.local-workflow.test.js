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
const tempDbName = `f_tmp_r19_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri);
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
process.env.COUNTER_NAMESPACE = `release19-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const Counter = require('../models/Counter');
const InventoryItem = require('../models/InventoryItem');
const PurchaserGRN = require('../models/PurchaserGRN');
const SalesOrder = require('../models/SalesOrder');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');
const { getFinanceDashboardMetrics, getPurchaserDashboardMetrics, getSupportDashboardMetrics } = require('../utils/departmentDashboardMetrics');

let server;
let baseUrl;
let users;
let supplier;
const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (user, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  return { response, data: await response.json() };
};
const createOrder = (description, quantity, overrides = {}) => SalesOrder.create({
  orderNumber: `SO-R19-${randomBytes(3).toString('hex')}`,
  clientName: 'Release 19 Client',
  fileType: 'Green',
  items: [{ description, quantity, unitPrice: 100, total: quantity * 100 }],
  totalAmount: quantity * 100,
  netAmount: quantity * 100,
    inventoryCheckStatus: 'Shortage',
  workflowStatus: 'Pending Local Procurement',
  status: 'Pending Local Procurement',
  currentDepartment: 'Local Purchaser',
  departmentResponsible: 'Local Purchaser',
  createdBy: users.purchaser._id,
  salesPerson: users.purchaser._id,
  ...overrides
});
const issuePO = order => request(users.purchaser, '/api/purchaser/pos', { method: 'POST', body: JSON.stringify({
  issuingCompanyCode: 'FORTLINE_ENTERPRISES', supplierId: supplier._id, poType: 'Local', salesOrderId: order._id,
  items: order.items.map(item => ({ productName: item.description, quantity: item.quantity, unitPrice: item.unitPrice }))
}) });

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  await Counter.create([
    { _id: getCounterKey('grn-number'), sequence: 1 },
    { _id: getCounterKey('sales-order-number'), sequence: 1 }
  ]);
  const password = `Release19-${runId}`;
  const created = await User.create([
    { fullName: 'R19 Local Purchaser', email: `r19.lp.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'R19 Support', email: `r19.support.${runId}@example.com`, password, role: 'support', department: 'Support', status: 'active', isApproved: true },
    { fullName: 'R19 Admin', email: `r19.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R19 CEO', email: `r19.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R19 Finance', email: `r19.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true }
  ]);
  users = { purchaser: created[0], support: created[1], admin: created[2], ceo: created[3], finance: created[4] };
  supplier = await Supplier.create({ name: 'R19 Local Supplier', supplierType: 'Local', createdBy: users.purchaser._id });
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

test('in-stock action reserves stock and shortage cannot use the stock route', async () => {
  const inventory = await InventoryItem.create({ name: 'R19 In Stock', sku: 'R19-STOCK', quantityOnHand: 2, reservedQuantity: 0, minStockLevel: 0 });
  const inStock = await createOrder('R19 In Stock', 1, { inventoryCheckStatus: 'Not Checked' });
  const routed = await request(users.purchaser, `/api/purchaser/orders/${inStock._id}/inventory-check`, { method: 'POST', body: JSON.stringify({ moveToSupport: true }) });
  assert.equal(routed.response.status, 200, JSON.stringify(routed.data));
  assert.equal((await InventoryItem.findById(inventory._id)).reservedQuantity, 1);
  assert.equal((await SupplierPO.countDocuments({ salesOrderId: inStock._id })), 0);
  assert.equal((await PurchaserGRN.countDocuments({ salesOrderId: inStock._id })), 0);

  const shortage = await createOrder('R19 Missing', 1);
  const blocked = await request(users.purchaser, `/api/purchaser/orders/${shortage._id}/inventory-check`, { method: 'POST', body: JSON.stringify({ moveToSupport: true }) });
  assert.equal(blocked.response.status, 409);
  assert.match(blocked.data.message, /shortage/i);
});

test('one Local PO stays with Local Purchase and receipt is required, inventory-neutral and idempotent', async () => {
  const order = await createOrder('R19 Supplier Item', 2);
  const beforeInventory = await InventoryItem.countDocuments();
  const issued = await issuePO(order);
  assert.equal(issued.response.status, 201, JSON.stringify(issued.data));
  const po = issued.data.data;
  let savedOrder = await SalesOrder.findById(order._id);
  assert.equal(savedOrder.currentDepartment, 'Local Purchaser');
  assert.equal(savedOrder.workflowStatus, 'Local PO Issued / Awaiting Supplier Goods');
  assert.equal(await InventoryItem.countDocuments(), beforeInventory);
  const duplicatePO = await issuePO(order);
  assert.equal(duplicatePO.response.status, 409);

  const invalid = await request(users.purchaser, `/api/purchaser/pos/${po._id}/goods-received`, { method: 'POST', body: '{}' });
  assert.equal(invalid.response.status, 400);
  const payload = { goodsReceiptReference: `SUP-GRN-${runId}`, goodsReceiptDate: '2026-10-28' };
  const recorded = await request(users.purchaser, `/api/purchaser/pos/${po._id}/goods-received`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(recorded.response.status, 201, JSON.stringify(recorded.data));
  const repeated = await request(users.purchaser, `/api/purchaser/pos/${po._id}/goods-received`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.data));
  assert.equal(repeated.data.existing, true);
  assert.equal(await InventoryItem.countDocuments(), beforeInventory);
  savedOrder = await SalesOrder.findById(order._id);
  assert.equal(savedOrder.currentDepartment, 'Support');
  assert.equal(savedOrder.workflowStatus, 'Goods Arrived / Awaiting Support Verification');
});

test('receipt and Inventory IN role guards are enforced', async () => {
  const order = await createOrder('R19 Roles', 1);
  const issued = await issuePO(order);
  const poId = issued.data.data._id;
  const body = JSON.stringify({ goodsReceiptReference: `ROLE-${runId}`, goodsReceiptDate: '2026-10-28' });
  assert.equal((await request(users.support, `/api/purchaser/pos/${poId}/goods-received`, { method: 'POST', body })).response.status, 403);
  assert.equal((await request(users.ceo, `/api/purchaser/pos/${poId}/goods-received`, { method: 'POST', body })).response.status, 403);
  assert.equal((await request(users.finance, `/api/purchaser/pos/${poId}/goods-received`, { method: 'POST', body })).response.status, 403);
  assert.equal((await request(users.admin, `/api/purchaser/pos/${poId}/goods-received`, { method: 'POST', body })).response.status, 201);
  assert.equal((await request(users.ceo, `/api/sales-employee/orders/${order._id}/goods-received`, { method: 'POST', body: '{}' })).response.status, 403);
});

test('Support Inventory IN adds stock once and links its internal GRN to the Supplier PO', async () => {
  const inventory = await InventoryItem.create({ name: 'R19 Verify Item', sku: 'R19-VERIFY', quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 });
  const order = await createOrder('R19 Verify Item', 1);
  const issued = await issuePO(order);
  const po = issued.data.data;
  await request(users.purchaser, `/api/purchaser/pos/${po._id}/goods-received`, { method: 'POST', body: JSON.stringify({ goodsReceiptReference: `VERIFY-${runId}`, goodsReceiptDate: '2026-10-28' }) });
  const savedOrder = await SalesOrder.findById(order._id);
  const payload = { receiptId: `RECEIPT-${runId}`, items: [{ orderItemId: savedOrder.items[0]._id, receivedQty: 1, inventoryItemId: inventory._id }] };
  const received = await request(users.support, `/api/sales-employee/orders/${order._id}/goods-received`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(received.response.status, 200, JSON.stringify(received.data));
  assert.equal((await InventoryItem.findById(inventory._id)).quantityOnHand, 1);
  const linkedPO = await SupplierPO.findById(po._id).populate('supportVerifiedGrn');
  assert.ok(linkedPO.supportVerifiedGrn?.grnNumber.startsWith('GRN-'));
  assert.ok(linkedPO.supportVerifiedAt);
  const duplicate = await request(users.support, `/api/sales-employee/orders/${order._id}/goods-received`, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(duplicate.response.status, 409);
  assert.equal((await InventoryItem.findById(inventory._id)).quantityOnHand, 1);
});

test('legacy Local PO orders already at Support still receive goods', async () => {
  const inventory = await InventoryItem.create({ name: 'R19 Legacy Item', sku: 'R19-LEGACY', quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 });
  const order = await createOrder('R19 Legacy Item', 1, {
    workflowStatus: 'Local Supplier PO Issued', status: 'Local Supplier PO Issued',
    currentDepartment: 'Support', departmentResponsible: 'Support'
  });
  const po = await SupplierPO.create({
    poNumber: `LPO-LEG-${runId}`, supplier: supplier._id, supplierName: supplier.name, poType: 'Local',
    items: [{ productName: 'R19 Legacy Item', quantity: 1, unitPrice: 100, totalAmount: 100 }],
    totalAmount: 100, salesOrderId: order._id, salesOrderNumber: order.orderNumber, createdBy: users.purchaser._id
  });
  order.supplierPoId = po._id;
  order.supplierPoNumber = po.poNumber;
  await order.save();
  const received = await request(users.support, `/api/sales-employee/orders/${order._id}/goods-received`, {
    method: 'POST',
    body: JSON.stringify({ receiptId: `LEGACY-${runId}`, items: [{ orderItemId: order.items[0]._id, receivedQty: 1, inventoryItemId: inventory._id }] })
  });
  assert.equal(received.response.status, 200, JSON.stringify(received.data));
  assert.equal((await InventoryItem.findById(inventory._id)).quantityOnHand, 1);
});

test('new Local statuses remain incomplete for dashboard carry-over', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const [localBefore, financeBefore, supportBefore] = await Promise.all([
    getPurchaserDashboardMetrics({ subDept: 'Local', month }),
    getFinanceDashboardMetrics({ month }),
    getSupportDashboardMetrics({ month })
  ]);
  const prior = new Date();
  prior.setUTCMonth(prior.getUTCMonth() - 1);
  const awaitingSupplier = await createOrder('R19 Dashboard Local', 1, {
    workflowStatus: 'Local PO Issued / Awaiting Supplier Goods', status: 'Local PO Issued / Awaiting Supplier Goods',
    inventoryCheckStatus: 'Shortage', financeApprovedAt: prior, previousDepartment: 'Finance'
  });
  await SalesOrder.collection.updateOne({ _id: awaitingSupplier._id }, { $set: { createdAt: prior, updatedAt: prior } });
  await createOrder('R19 Dashboard Support', 1, {
    workflowStatus: 'Goods Arrived / Awaiting Support Verification', status: 'Goods Arrived / Awaiting Support Verification',
    currentDepartment: 'Support', departmentResponsible: 'Support'
  });
  const [localAfter, financeAfter, supportAfter] = await Promise.all([
    getPurchaserDashboardMetrics({ subDept: 'Local', month }),
    getFinanceDashboardMetrics({ month }),
    getSupportDashboardMetrics({ month })
  ]);
  assert.equal(localAfter.tiles.saleOrderReceived.count, localBefore.tiles.saleOrderReceived.count + 2);
  assert.equal(financeAfter.tiles.so.count, financeBefore.tiles.so.count + 1);
  assert.equal(supportAfter.tiles.saleOrderReceived.count, supportBefore.tiles.saleOrderReceived.count + 1);
});
