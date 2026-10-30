const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.COUNTER_NAMESPACE = 'dev-local';
mongoose.set('autoIndex', false);
const runId = randomBytes(8).toString('hex');
const tempDbName = `f_tmp_r31_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required.');
assert.match(tempDbName, /^f_tmp_r31_[a-z0-9]+$/);
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

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const PriceRequest = require('../models/PriceRequest');
const PriceRequestRoutingRule = require('../models/PriceRequestRoutingRule');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SupplierPO = require('../models/SupplierPO');
const Counter = require('../models/Counter');
const TargetPerformanceSetting = require('../models/TargetPerformanceSetting');
const { getCounterKey } = require('../utils/counterKey');
const { deriveOrderTrackerStage } = require('../utils/orderTracker');
const { loadPerformanceForUsers, loadPerformanceForUsersLegacy, invalidateTargetPerformanceCache } = require('../utils/targetPerformance');

let server;
let baseUrl;
let users;
const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (user, path, method = 'GET', body) => {
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
  const password = `R31-${runId}-password`;
  const created = await User.create([
    { fullName: 'R31 Sales A', email: `r31.sales.a.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true, monthlySalesSalaryCents: 10000000 },
    { fullName: 'R31 Sales B', email: `r31.sales.b.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: true, monthlySalesSalaryCents: 12000000 },
    { fullName: 'R31 Manager', email: `r31.manager.${runId}@example.com`, password, role: 'sales_manager', status: 'active', isApproved: true, monthlySalesSalaryCents: 15000000 },
    { fullName: 'R31 Purchaser One', email: `r31.p1.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true, priceRequestLabel: 'Multi Brand' },
    { fullName: 'R31 Purchaser Two', email: `r31.p2.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true },
    { fullName: 'R31 Admin', email: `r31.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R31 CEO', email: `r31.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R31 Finance', email: `r31.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true }
  ]);
  users = Object.fromEntries(['salesA', 'salesB', 'manager', 'p1', 'p2', 'admin', 'ceo', 'finance'].map((key, index) => [key, created[index]]));
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 1 });
  await TargetPerformanceSetting.create({ key: 'global', showToSalespeople: true, updatedBy: users.admin._id });
  const ruleValues = [['Dell', users.p1], ['Fortinet', users.p1], ['HP', users.p1], ['Lenovo', users.p2]];
  await PriceRequestRoutingRule.insertMany(ruleValues.map(([brand, assignee]) => ({
    label: `${brand} rule`, ruleType: 'brand', matchValues: [brand], normalizedMatchValues: [brand.toLowerCase()],
    assignee: assignee._id, priority: 100, active: true, createdBy: users.admin._id, updatedBy: users.admin._id
  })));
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
      console.log(`TEMP_DATABASE_DROPPED=${tempDbName}`);
    } catch (error) {
      if (error.code !== 8000) throw error;
      const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
      for (const collection of collections) await mongoose.connection.db.collection(collection.name).drop();
      console.log(`TEMP_DATABASE_DROPPED_BY_COLLECTIONS=${tempDbName}`);
    }
  }
  await mongoose.disconnect();
});

test('Order Tracker derivation covers each required current stage without predicting the next department', () => {
  const approved = { financeApprovedAt: new Date(), workflowStatus: 'Finance Approved' };
  const rows = [
    ['Pending Finance Approval', deriveOrderTrackerStage({ order: { workflowStatus: 'Pending Finance Approval', currentDepartment: 'Finance' } })],
    ['Finance Approved', deriveOrderTrackerStage({ order: { ...approved, currentDepartment: 'Support', lastAction: 'Stock reserved and sent to Support' } })],
    ['Local Purchase', deriveOrderTrackerStage({ order: { ...approved, currentDepartment: 'Local Purchaser', lastAction: 'Shortage found' } })],
    ['Global Purchase', deriveOrderTrackerStage({ order: { ...approved, currentDepartment: 'Global Purchaser', lastAction: 'Global procurement required' } })],
    ['Local PO Issued', deriveOrderTrackerStage({ order: { ...approved, workflowStatus: 'Local PO Issued / Awaiting Supplier Goods' }, supplierPOs: [{ poType: 'Local' }] })],
    ['Goods Arrived', deriveOrderTrackerStage({ order: { ...approved, workflowStatus: 'Goods Arrived / Awaiting Support Verification' } })],
    ['In transit', deriveOrderTrackerStage({ order: approved, shipments: [{ status: 'In transit', remarks: 'Customs inspection delay' }] })],
    ['DN Created', deriveOrderTrackerStage({ order: approved, deliveryNotes: [{ status: 'Created' }] })],
    ['Delivered', deriveOrderTrackerStage({ order: { ...approved, deliveryStatus: 'Delivered' } })],
    ['Invoiced', deriveOrderTrackerStage({ order: approved, invoices: [{ status: 'Finalized', isDraft: false, amount: 100, outstandingAmount: 100 }] })],
    ['Paid', deriveOrderTrackerStage({ order: approved, invoices: [{ status: 'Paid', isDraft: false, amount: 100, outstandingAmount: 0 }] })]
  ];
  for (const [expected, actual] of rows) assert.equal(actual.stage, expected);
  assert.equal(rows.some(([, row]) => row.why.includes('->') || row.why.includes('Support Queue')), false);
});

test('Sales Order activity endpoint is owner-scoped and returns current location plus recent activity', async () => {
  const order = await SalesOrder.create({
    orderNumber: `SO-R31-A-${runId}`, orderReference: `SO-R31-A-${runId}`, clientName: 'R31 Client',
    owner: users.salesA._id, createdBy: users.salesA._id, salesPerson: users.salesA._id,
    workflowStatus: 'Pending Finance Approval', currentDepartment: 'Finance', departmentResponsible: 'Finance',
    items: [{ description: 'R31 Item', quantity: 1, unitPrice: 100, total: 100 }],
    workflowHistory: [{ action: 'Order sent to Finance', department: 'Finance', userName: users.salesA.fullName, timestamp: new Date(), notes: 'Awaiting Finance approval' }]
  });
  assert.equal((await request(users.salesB, `/api/sales-employee/orders/${order._id}/activity`)).status, 403);
  const own = await request(users.salesA, `/api/sales-employee/orders/${order._id}/activity`);
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.data.department, 'Finance');
  assert.equal(own.body.data.currentStatus, 'Pending Finance Approval');
  assert.ok(own.body.data.recentActivity.length >= 1);
});

const threeItems = [
  { brand: 'Dell', category: 'Networking', partNumber: 'R770', requirement: 'Dell R770', quantity: 2 },
  { brand: 'Fortinet', category: 'Networking', partNumber: 'FG-120G', requirement: 'Fortigate 120G', quantity: 5 },
  { brand: 'HP', category: 'Networking', partNumber: 'HP-48', requirement: 'HP 48-port switch', quantity: 3 }
];

test('multi-item Price Request requires every unit price and stores per-line and grand totals in cents', async () => {
  const suggestion = await request(users.salesA, '/api/price-requests/assignee-suggestion', 'POST', { items: threeItems });
  assert.equal(suggestion.status, 200);
  assert.equal(String(suggestion.body.data.assignee._id), String(users.p1._id));
  const mixed = await request(users.salesA, '/api/price-requests/assignee-suggestion', 'POST', { items: [threeItems[0], { ...threeItems[1], brand: 'Lenovo' }] });
  assert.equal(mixed.body.data, null);

  const created = await request(users.salesA, '/api/price-requests', 'POST', {
    requestedFrom: users.p1._id, leadSource: 'Email', customerName: 'Tender Customer', reference: 'TENDER-31', items: threeItems
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.itemCount, 3);
  const id = created.body.data._id;
  const partial = await request(users.p1, `/api/price-requests/${id}/price`, 'POST', {
    currency: 'PKR', items: [{ unitPriceCents: 10000 }, { unitPriceCents: 20000 }]
  });
  assert.equal(partial.status, 400);
  const priced = await request(users.p1, `/api/price-requests/${id}/price`, 'POST', {
    currency: 'PKR', items: [{ unitPriceCents: 280000000 }, { unitPriceCents: 300000000 }, { unitPriceCents: 40000000 }]
  });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.deepEqual(priced.body.data.items.map(item => item.totalPriceCents), [560000000, 1500000000, 120000000]);
  assert.equal(priced.body.data.grandTotalCents, 2180000000);
});

test('legacy request reads as one item, can be priced, and reassign moves the whole multi-item request', async () => {
  const legacy = await PriceRequest.create({
    requestNumber: `PR-LEGACY-${runId}`, requestedBy: users.salesA._id, requestedFrom: users.p1._id,
    brand: 'Dell', category: 'Servers', leadSource: 'Phone call', requirement: 'Legacy R760', quantity: 4
  });
  const list = await request(users.salesA, '/api/price-requests');
  const legacyRow = list.body.data.find(row => String(row._id) === String(legacy._id));
  assert.equal(legacyRow.itemCount, 1);
  assert.equal(legacyRow.items[0].quantity, 4);
  const answered = await request(users.p1, `/api/price-requests/${legacy._id}/price`, 'POST', { currency: 'USD', unitPriceCents: 125000 });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(answered.body.data.items[0].totalPriceCents, 500000);

  const created = await request(users.salesA, '/api/price-requests', 'POST', { requestedFrom: users.p1._id, leadSource: 'WhatsApp', items: threeItems });
  const reassigned = await request(users.salesA, `/api/price-requests/${created.body.data._id}/reassign`, 'POST', { requestedFrom: users.p2._id, pendingNote: 'Route the complete tender' });
  assert.equal(reassigned.status, 200);
  assert.equal(reassigned.body.data.items.length, 3);
  assert.equal(String(reassigned.body.data.requestedFrom._id), String(users.p2._id));
});

test('Price Request people endpoint retains Release 27 privacy fields', async () => {
  const result = await request(users.salesA, '/api/price-requests/labelled-users');
  assert.equal(result.status, 200);
  assert.ok(result.body.data.length > 0);
  for (const row of result.body.data) assert.deepEqual(Object.keys(row).sort(), ['_id', 'label', 'name']);
});

const performanceSummary = rows => rows.map(row => ({
  userId: String(row.userId), salaryCents: row.salaryCents, targetCents: row.targetCents,
  achievedGrossProfitCents: row.achievedGrossProfitCents, performancePercent: row.performancePercent,
  targetStatus: row.targetStatus, overdueDeals: row.overdueDeals, costRecalculationFlags: row.costRecalculationFlags,
  paymentStatuses: row.invoices.reduce((counts, invoice) => ({ ...counts, [invoice.status]: (counts[invoice.status] || 0) + 1 }), {})
})).sort((a, b) => a.userId.localeCompare(b.userId));

test('Target Performance batches realistic volume under two seconds with identical legacy numbers', async () => {
  await Promise.all([
    SalesOrder.collection.createIndex({ owner: 1, createdAt: -1 }),
    SalesOrder.collection.createIndex({ createdBy: 1, createdAt: -1 }),
    Invoice.collection.createIndex({ salesOrderId: 1, status: 1, isDraft: 1 }),
    SupplierPO.collection.createIndex({ salesOrderId: 1, createdAt: -1 }),
    Payment.collection.createIndex({ salesOrderId: 1, paymentDate: 1 }),
    Payment.collection.createIndex({ 'allocations.salesOrderId': 1, paymentDate: 1 }),
    Payment.collection.createIndex({ invoiceId: 1, paymentDate: 1 }),
    Payment.collection.createIndex({ 'allocations.invoiceId': 1, paymentDate: 1 })
  ]);
  const password = `R31-perf-${runId}`;
  const extraUsers = await User.create(Array.from({ length: 47 }, (_, index) => ({
    fullName: `R31 Perf ${String(index + 4).padStart(2, '0')}`, email: `r31.perf.${index}.${runId}@example.com`, password,
    role: 'sales_person', status: 'active', isApproved: true, monthlySalesSalaryCents: (100000 + index * 1000) * 100
  })));
  const salespeople = [users.salesA, users.salesB, users.manager, ...extraUsers];
  assert.equal(salespeople.length, 50);
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const orderDocs = Array.from({ length: 3000 }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(), orderNumber: `SO-R31-P-${index}-${runId}`, clientName: `Perf Client ${index}`,
    owner: salespeople[index % salespeople.length]._id, createdBy: salespeople[index % salespeople.length]._id,
    salesPerson: salespeople[index % salespeople.length]._id, totalAmount: 100000, netAmount: 100000,
    items: [{ description: 'Performance item', quantity: 1, unitPrice: 100000, total: 100000 }], createdAt: now, updatedAt: now
  }));
  await SalesOrder.collection.insertMany(orderDocs, { ordered: false });
  const poDocs = orderDocs.slice(0, 1500).map((order, index) => ({
    _id: new mongoose.Types.ObjectId(), poNumber: `LPO-R31-P-${index}-${runId}`, poType: 'Local', supplierName: 'Performance Supplier',
    salesOrderId: order._id, currency: 'PKR', totalAmount: 50000, costingStatus: 'Completed', createdBy: users.admin._id,
    expenses: [{ category: 'Freight', amountPKRCents: 500000, addedAt: now, editHistory: [] }], createdAt: now, updatedAt: now
  }));
  await SupplierPO.collection.insertMany(poDocs, { ordered: false });
  const invoiceDocs = Array.from({ length: 5000 }, (_, index) => {
    const order = index < 4950 ? orderDocs[index % 1500] : orderDocs[1500 + (index - 4950)];
    return {
      _id: new mongoose.Types.ObjectId(), invoiceNumber: `INV-R31-P-${index}-${runId}`, clientName: order.clientName,
      salesOrderId: order._id, subtotal: 100000, discount: 0, tax: 0, amount: 100000,
      issueDate: now, dueDate: new Date(now.getTime() + 30 * 86400000), status: 'Finalized', isDraft: false,
      createdBy: users.admin._id, createdAt: now, updatedAt: now
    };
  });
  await Invoice.collection.insertMany(invoiceDocs, { ordered: false });
  await Payment.collection.insertMany(invoiceDocs.map((invoice, index) => ({
    _id: new mongoose.Types.ObjectId(), paymentRefNumber: `PAY-R31-${index}-${runId}`, customerName: invoice.clientName,
    invoiceId: invoice._id, salesOrderId: invoice.salesOrderId, paymentDate: now, amount: 100000,
    paymentType: 'Full', paymentMethod: 'Bank Transfer', createdBy: users.finance._id, createdAt: now, updatedAt: now
  })), { ordered: false });
  const loadedUsers = await User.find({ _id: { $in: salespeople.map(user => user._id) } }).select('_id fullName email role monthlySalesSalaryCents').lean();

  const legacyStart = performance.now();
  const legacy = await loadPerformanceForUsersLegacy({ users: loadedUsers, month, asOf: now });
  const legacyMs = Math.round((performance.now() - legacyStart) * 10) / 10;
  invalidateTargetPerformanceCache();
  const optimizedStart = performance.now();
  const optimizedProfile = {};
  const optimized = await loadPerformanceForUsers({ users: loadedUsers, month, asOf: now, profile: optimizedProfile });
  const optimizedColdMs = Math.round((performance.now() - optimizedStart) * 10) / 10;
  assert.deepEqual(performanceSummary(optimized), performanceSummary(legacy));
  console.log(`R31_TARGET_PHASES=${JSON.stringify(optimizedProfile)}`);
  const warmStart = performance.now();
  const warm = await loadPerformanceForUsers({ users: loadedUsers, month, asOf: now });
  const optimizedMs = Math.round((performance.now() - warmStart) * 10) / 10;
  assert.deepEqual(performanceSummary(warm), performanceSummary(legacy));
  assert.ok(optimizedMs < 2000, `Optimized helper took ${optimizedMs}ms.`);

  const endpointStart = performance.now();
  const endpoint = await request(users.admin, `/api/target-performance/admin?month=${month}`);
  const endpointMs = Math.round((performance.now() - endpointStart) * 10) / 10;
  assert.equal(endpoint.status, 200, JSON.stringify(endpoint.body).slice(0, 500));
  assert.equal(endpoint.body.data.salespeople.length, 50);
  assert.ok(endpointMs < 2000, `Admin endpoint took ${endpointMs}ms.`);
  const ceo = await request(users.ceo, `/api/target-performance/admin?month=${month}`);
  assert.equal(ceo.body.data.setting.showToSalespeople, endpoint.body.data.setting.showToSalespeople);
  assert.equal(ceo.body.data.salespeople.length, 50);
  assert.ok(ceo.body.data.salespeople.every(row => row.salaryCents === null && row.targetCents === null));
  console.log(`R31_TARGET_PROFILE=${JSON.stringify({ users: 50, orders: 3000, supplierPOs: 1500, invoices: 5000, payments: 5000, legacyMs, optimizedColdMs, optimizedMs, endpointMs })}`);
});
