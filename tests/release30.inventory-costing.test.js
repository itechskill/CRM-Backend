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
const tempDbName = `f_tmp_r30_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 30 tests.');
const useDatabase = (uri, name) => {
  const queryAt = uri.indexOf('?');
  const query = queryAt >= 0 ? uri.slice(queryAt) : '';
  const base = queryAt >= 0 ? uri.slice(0, queryAt) : uri;
  const pathAt = base.indexOf('/', base.indexOf('://') + 3);
  return `${pathAt >= 0 ? base.slice(0, pathAt) : base}/${name}${query}`;
};
process.env.MONGODB_URI = useDatabase(sourceMongoUri, tempDbName);

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const InventoryItem = require('../models/InventoryItem');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const SupplierPO = require('../models/SupplierPO');
const Notification = require('../models/Notification');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { planFifoAllocation, resolveBatchUnitCostCents } = require('../utils/inventoryCosting');
const { addFinanceCostingToInvoices } = require('../utils/targetPerformance');
const { totalCostPKR } = require('../utils/purchaseExpenses');

let server;
let baseUrl;
let users;
const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const request = async (user, path, method = 'GET', body) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
};
const makeOrder = async ({ item, quantity, suffix }) => SalesOrder.create({
  orderNumber: `SO-R30-${suffix}-${runId}`, orderReference: `SO-R30-${suffix}-${runId}`, clientName: 'FIFO Customer',
  currentDepartment: 'Support', departmentResponsible: 'Support', status: 'Goods Received in Office', workflowStatus: 'Goods Received in Office',
  goodsReceivedInOffice: { received: true, receivedAt: new Date(), receivedBy: users.support._id }, inventoryFulfilledFromExistingStock: true,
  inventoryAnalysis: [{ productId: item._id, item: item.name, required: quantity, available: item.quantityOnHand }],
  items: [{ description: item.name, partNumber: item.partNumber, quantity, unitPrice: 1000000, total: quantity * 1000000 }],
  subtotal: quantity * 1000000, netAmount: quantity * 1000000, totalAmount: quantity * 1000000,
  owner: users.sales._id, salesPerson: users.sales._id, createdBy: users.sales._id
});
const createDnHttp = async (order, quantity) => request(users.support, '/api/sales-employee/delivery-notes', 'POST', {
  salesOrderId: order._id, clientName: order.clientName, recipientName: order.clientName,
  items: [{ orderItemId: String(order.items[0]._id), quantity }]
});

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const roles = ['finance', 'admin', 'ceo', 'accountant', 'support', 'logistics', 'sales_person', 'purchaser'];
  const created = await User.create(roles.map(role => ({ fullName: `R30 ${role}`, email: `r30.${role}.${runId}@example.com`, password: `R30-${runId}`, role, department: role === 'sales_person' ? 'Sales' : role, purchaserSubDept: role === 'purchaser' ? 'Local' : undefined, status: 'active', isApproved: true, isActive: true })));
  users = Object.fromEntries(created.map(user => [user.role === 'sales_person' ? 'sales' : user.role, user]));
  await Counter.create({ _id: getCounterKey('sales-order-number'), sequence: 30000 });
  await Counter.create({ _id: getCounterKey('delivery-note-number'), sequence: 30000 });
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, tempDbName);
    try { await mongoose.connection.dropDatabase(); } catch (error) {
      if (error.code !== 8000) throw error;
      for (const { name } of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('FIFO allocation unit selects oldest batches and spans a partial second batch', () => {
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const plan = planFifoAllocation([{ _id: ids[1], receivedAt: new Date('2026-02-01'), quantityRemaining: 2 }, { _id: ids[0], receivedAt: new Date('2026-01-01'), quantityRemaining: 2 }], 3);
  assert.deepEqual(plan.map(row => [String(row.batchId), row.quantity]), [[String(ids[0]), 2], [String(ids[1]), 1]]);
  assert.throws(() => planFifoAllocation([{ _id: ids[0], quantityRemaining: 1 }], 2), /short by 1/);
});

test('client scenario: two 500,000 units then two 600,000 units produce FIFO COGS and profit', async () => {
  const item = await InventoryItem.create({ name: `R30 Firewall ${runId}`, partNumber: 'R30-ABC-777', sku: 'R30-12345', quantityOnHand: 4, costBatches: [
    { source: 'Manual stock entry', receivedAt: new Date('2026-01-01'), quantityReceived: 2, quantityRemaining: 2, unitCostPKRCents: 50000000, costStatus: 'recorded', enteredBy: users.finance._id },
    { source: 'Manual stock entry', receivedAt: new Date('2026-02-01'), quantityReceived: 2, quantityRemaining: 2, unitCostPKRCents: 60000000, costStatus: 'recorded', enteredBy: users.finance._id }
  ] });
  const order1 = await makeOrder({ item, quantity: 2, suffix: 'FIFO1' });
  const response1 = await createDnHttp(order1, 2);
  assert.equal(response1.status, 201, JSON.stringify(response1.body));
  assert.equal(JSON.stringify(response1.body).includes('batchAllocations'), false, 'Support response must hide batch allocations');
  const dn1 = await DeliveryNote.findById(response1.body.data._id);
  assert.deepEqual(dn1.items[0].batchAllocations.map(row => row.quantity), [2]);
  dn1.status = 'Delivered'; dn1.isStockDeducted = true; await dn1.save();
  await InventoryItem.updateOne({ _id: item._id }, { $inc: { quantityOnHand: -2, reservedQuantity: -2 } });
  const invoice1 = await Invoice.create({ invoiceNumber: `INV-R30-1-${runId}`, clientName: order1.clientName, salesOrderId: order1._id, deliveryNoteId: dn1._id, subtotal: 2000000, amount: 2000000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.accountant._id });
  const [first] = await addFinanceCostingToInvoices([invoice1]);
  assert.equal(first.financeCosting.cogsCents, 100000000);
  assert.equal(first.financeCosting.grossProfitCents, 100000000);
  for (const role of ['logistics', 'sales']) {
    const notes = await request(users[role], '/api/sales-employee/delivery-notes');
    assert.equal(notes.status, 200);
    assert.equal(JSON.stringify(notes.body).includes('batchAllocations'), false, role);
  }
  const order2 = await makeOrder({ item: await InventoryItem.findById(item._id), quantity: 2, suffix: 'FIFO2' });
  const response2 = await createDnHttp(order2, 2);
  assert.equal(response2.status, 201, JSON.stringify(response2.body));
  const dn2 = await DeliveryNote.findById(response2.body.data._id);
  const invoice2 = await Invoice.create({ invoiceNumber: `INV-R30-2-${runId}`, clientName: order2.clientName, salesOrderId: order2._id, deliveryNoteId: dn2._id, subtotal: 2000000, amount: 2000000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.accountant._id });
  const [second] = await addFinanceCostingToInvoices([invoice2]);
  assert.equal(second.financeCosting.cogsCents, 120000000);
  assert.equal(second.financeCosting.grossProfitCents, 80000000);
});

test('Support entry is cost-free; Finance setting cost later corrects sold-stock profit', async () => {
  const create = await request(users.support, '/api/sales-employee/inventory', 'POST', { name: `R30 Manual ${runId}`, sku: `MAN-${runId}`, partNumber: 'MAN-500', quantityOnHand: 1, unitCostPKR: 999999 });
  assert.equal(create.status, 200, JSON.stringify(create.body));
  assert.equal(JSON.stringify(create.body).includes('costBatches'), false);
  const item = await InventoryItem.findById(create.body.data._id);
  assert.equal(item.costBatches[0].unitCostPKRCents, null);
  const order = await makeOrder({ item, quantity: 1, suffix: 'LATE' });
  const response = await createDnHttp(order, 1);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const dn = await DeliveryNote.findById(response.body.data._id);
  const invoice = await Invoice.create({ invoiceNumber: `INV-R30-LATE-${runId}`, clientName: order.clientName, salesOrderId: order._id, deliveryNoteId: dn._id, subtotal: 1000000, amount: 1000000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.accountant._id });
  let [costed] = await addFinanceCostingToInvoices([invoice]);
  assert.equal(costed.financeCosting.issue, 'Cost not recorded');
  const batchId = dn.items[0].batchAllocations[0].batchId;
  const set = await request(users.finance, `/api/inventory-costing/items/${item._id}/batches/${batchId}/cost`, 'PATCH', { unitCostPKR: 500000, note: 'Buyer remembered price' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  [costed] = await addFinanceCostingToInvoices([invoice]);
  assert.equal(costed.financeCosting.cogsCents, 50000000);
  assert.equal(costed.financeCosting.grossProfitCents, 50000000);
  assert.ok(await Notification.exists({ recipient: users.admin._id, 'data.batchId': batchId }));
});

test('cancelled Delivery Note restores its allocated batch quantity', async () => {
  const item = await InventoryItem.create({ name: `R30 Cancel ${runId}`, sku: `CAN-${runId}`, quantityOnHand: 2, costBatches: [{ source: 'Manual stock entry', quantityReceived: 2, quantityRemaining: 2, unitCostPKRCents: 10000, costStatus: 'recorded' }] });
  const order = await makeOrder({ item, quantity: 1, suffix: 'CANCEL' });
  const created = await createDnHttp(order, 1);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await InventoryItem.findById(item._id)).costBatches[0].quantityRemaining, 1);
  const removed = await request(users.support, `/api/sales-employee/delivery-notes/${created.body.data._id}`, 'DELETE');
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await InventoryItem.findById(item._id)).costBatches[0].quantityRemaining, 2);
});

test('Inventory Costing role matrix, Admin-only cost changes and response stripping', async () => {
  const item = await InventoryItem.create({ name: `R30 Roles ${runId}`, sku: `ROLE-${runId}`, quantityOnHand: 1, costBatches: [{ source: 'Manual stock entry', quantityReceived: 1, quantityRemaining: 1, unitCostPKRCents: 10000, costStatus: 'recorded' }] });
  for (const role of ['finance', 'admin', 'ceo', 'accountant']) assert.equal((await request(users[role], '/api/inventory-costing')).status, 200, role);
  for (const role of ['support', 'logistics', 'sales', 'purchaser']) assert.equal((await request(users[role], '/api/inventory-costing')).status, 403, role);
  const batch = item.costBatches[0];
  assert.equal((await request(users.finance, `/api/inventory-costing/items/${item._id}/batches/${batch._id}/cost`, 'PATCH', { unitCostPKR: 200, reason: 'No' })).status, 403);
  assert.equal((await request(users.admin, `/api/inventory-costing/items/${item._id}/batches/${batch._id}/cost`, 'PATCH', { unitCostPKR: 200 })).status, 400);
  assert.equal((await request(users.admin, `/api/inventory-costing/items/${item._id}/batches/${batch._id}/cost`, 'PATCH', { unitCostPKR: 200, reason: 'Corrected invoice' })).status, 200);
  for (const role of ['support', 'logistics', 'sales']) {
    const response = await request(users[role], '/api/sales-employee/inventory');
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.body).includes('costBatches'), false, role);
    assert.equal(JSON.stringify(response.body).includes('unitCostPKRCents'), false, role);
  }
});

test('Supplier-PO landed cost remains exactly the existing totalCostPKR result', async () => {
  for (const [index, values] of [{ total: 500000, expense: 20000 }, { total: 750000, expense: 50000 }].entries()) {
    const order = await SalesOrder.create({ orderNumber: `SO-R30-PO-${index}-${runId}`, clientName: 'PO Customer', createdBy: users.sales._id, items: [{ description: 'PO Item', quantity: 1, unitPrice: 1000000, total: 1000000 }] });
    const po = await SupplierPO.create({ poNumber: `LPO-R30-${index}-${runId}`, poType: 'Local', supplierName: 'Supplier', salesOrderId: order._id, currency: 'PKR', totalAmount: values.total, costingStatus: 'Completed', expenses: [{ category: 'Freight', amountPKRCents: values.expense * 100, addedBy: users.finance._id }], createdBy: users.finance._id });
    const invoice = await Invoice.create({ invoiceNumber: `INV-R30-PO-${index}-${runId}`, clientName: order.clientName, salesOrderId: order._id, subtotal: 1000000, amount: 1000000, dueDate: new Date(), status: 'Finalized', isDraft: false, createdBy: users.accountant._id });
    const before = await totalCostPKR(po);
    const [row] = await addFinanceCostingToInvoices([invoice]);
    assert.equal(row.financeCosting.cogsCents, Math.round(before * 100));
    assert.equal(row.financeCosting.grossProfitCents, 100000000 - Math.round(before * 100));
  }
});

test('Supplier PO receipt batch resolves expenses live only after costing is Completed', async () => {
  const po = await SupplierPO.create({
    poNumber: `LPO-R30-LIVE-${runId}`, poType: 'Local', supplierName: 'Live Cost Supplier', currency: 'PKR', costingStatus: 'Incomplete',
    items: [{ productName: 'Live Item', quantity: 2, unitPrice: 500000, totalAmount: 1000000 }], totalAmount: 1000000,
    expenses: [{ category: 'Freight', amountPKRCents: 2000000, addedBy: users.finance._id }], createdBy: users.finance._id
  });
  const batch = { supplierPO: po._id, supplierPOLineId: po.items[0]._id, unitCostPKRCents: 50000000, costStatus: 'recorded' };
  assert.equal(await resolveBatchUnitCostCents(batch), 50000000);
  po.costingStatus = 'Completed'; await po.save();
  assert.equal(await resolveBatchUnitCostCents(batch), 51000000);
});
