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
const tempDbName = `f_tmp_r28_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 28 tests.');
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
process.env.COUNTER_NAMESPACE = `release28-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const Counter = require('../models/Counter');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const DeliveryNote = require('../models/DeliveryNote');
const InventoryItem = require('../models/InventoryItem');
const Shipment = require('../models/Shipment');
const { getCounterKey } = require('../utils/counterKey');
const { resolveDocumentPartNumbers } = require('../utils/documentPartNumbers');

let server;
let baseUrl;
let users;
let chain;
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
  const password = `Release28-${runId}`;
  const created = await User.create([
    { fullName: 'R28 Sales', email: `r28.sales.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'R28 Local Purchaser', email: `r28.local.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', department: 'Local Purchaser', status: 'active', isApproved: true },
    { fullName: 'R28 Global Purchaser', email: `r28.global.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Global', department: 'Global Purchaser', status: 'active', isApproved: true },
    { fullName: 'R28 Support', email: `r28.support.${runId}@example.com`, password, role: 'support', department: 'Support', status: 'active', isApproved: true },
    { fullName: 'R28 Finance', email: `r28.finance.${runId}@example.com`, password, role: 'finance', department: 'Finance', status: 'active', isApproved: true },
    { fullName: 'R28 Admin', email: `r28.admin.${runId}@example.com`, password, role: 'admin', department: 'Administration', status: 'active', isApproved: true }
  ]);
  users = Object.fromEntries(['sales', 'local', 'global', 'support', 'finance', 'admin'].map((key, index) => [key, created[index]]));
  await Counter.create([
    { _id: getCounterKey('file-number'), sequence: 2800 },
    { _id: getCounterKey('quotation-number'), sequence: 2800 },
    { _id: getCounterKey('sales-order-number'), sequence: 2800 },
    { _id: getCounterKey('global-po-number'), sequence: 2800 },
    { _id: getCounterKey('delivery-note-number'), sequence: 2800 },
    { _id: getCounterKey('grn-number'), sequence: 2800 }
  ]);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, tempDbName);
    try { await mongoose.connection.dropDatabase(); }
    catch (error) {
      if (error.code !== 8000) throw error;
      for (const { name } of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) await mongoose.connection.db.collection(name).drop();
    }
  }
  await mongoose.disconnect();
});

test('real API chain preserves a true part number that differs from the SKU', async () => {
  const quoteResult = await request(users.sales, '/api/sales-employee/quotations', 'POST', {
    clientName: 'R28 Customer', clientAddress: 'Karachi', issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED',
    items: [{ sku: '12345', partNumber: 'ABC-777', description: 'R28 Server', quantity: 2, unitPrice: 2000000 }],
    discount: 97600, taxPercentage: 18, status: 'Sent'
  });
  assert.equal(quoteResult.status, 201, JSON.stringify(quoteResult.body));
  const quote = quoteResult.body.data;
  assert.equal(quote.items[0].sku, '12345');
  assert.equal(quote.items[0].partNumber, 'ABC-777');

  const cpoResult = await request(users.sales, `/api/sales-employee/quotations/${quote._id}/convert-to-po`, 'POST', {
    poNumber: `CPO-R28-${runId}`, documentName: 'customer-po.pdf', uploadedDocument: 'data:application/pdf;base64,WA=='
  });
  assert.equal(cpoResult.status, 201, JSON.stringify(cpoResult.body));
  const cpo = await CustomerPO.findById(cpoResult.body.data.po._id).lean();
  assert.equal(cpo.items[0].partNumber, 'ABC-777');

  const fileResult = await request(users.sales, `/api/sales-employee/customer-pos/${cpo._id}/convert-to-file`, 'POST', {});
  assert.equal(fileResult.status, 201, JSON.stringify(fileResult.body));
  const file = await ProductFile.findById(fileResult.body.data.file._id).lean();
  assert.equal(file.products[0].partNumber, 'ABC-777');

  const orderResult = await request(users.sales, `/api/sales-employee/product-files/${file._id}/convert-to-order`, 'POST', {});
  assert.equal(orderResult.status, 201, JSON.stringify(orderResult.body));
  const order = await SalesOrder.findById(orderResult.body.data.order._id);
  assert.equal(order.items[0].partNumber, 'ABC-777');
  assert.deepEqual([order.totalAmount, order.discount, order.tax, order.netAmount], [4000000, 97600, 702432, 4604832]);

  const supplier = await Supplier.create({ name: 'R28 Local Supplier', supplierType: 'Local', country: 'Pakistan' });
  order.fileType = 'Green';
  order.inventoryCheckStatus = 'Shortage';
  order.currentDepartment = 'Local Purchaser';
  order.departmentResponsible = 'Local Purchaser';
  order.workflowStatus = 'Pending Local Procurement';
  await order.save();
  const poResult = await request(users.local, '/api/purchaser/pos', 'POST', {
    poType: 'Local', supplierId: supplier._id, salesOrderId: order._id,
    issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED', currency: 'PKR', items: order.items
  });
  assert.equal(poResult.status, 201, JSON.stringify(poResult.body));
  const supplierPO = await SupplierPO.findById(poResult.body.data._id);
  assert.equal(supplierPO.items[0].partNumber, 'ABC-777');

  const receipt = await request(users.local, `/api/purchaser/pos/${supplierPO._id}/goods-received`, 'POST', {
    goodsReceiptReference: `SUP-GRN-${runId}`, goodsReceiptDate: '2026-10-30'
  });
  assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  const inventory = await InventoryItem.create({ name: 'R28 Server', sku: '12345', partNumber: 'ABC-777', quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 });
  const received = await request(users.support, `/api/sales-employee/orders/${order._id}/goods-received`, 'POST', {
    receiptId: `R28-LOCAL-${runId}`,
    items: [{ orderItemId: order.items[0]._id, receivedQty: 2, inventoryItemId: inventory._id }]
  });
  assert.equal(received.status, 200, JSON.stringify(received.body));
  const localGrn = await PurchaserGRN.findOne({ salesOrder: order._id }).lean();
  assert.equal(localGrn.items[0].partNumber, 'ABC-777');

  const dnResult = await request(users.support, '/api/sales-employee/delivery-notes', 'POST', {
    salesOrderId: order._id,
    items: [{ orderItemId: order.items[0]._id, quantity: 2 }]
  });
  assert.equal(dnResult.status, 201, JSON.stringify(dnResult.body));
  const deliveryNote = await DeliveryNote.findById(dnResult.body.data._id).lean();
  assert.equal(deliveryNote.items[0].partNumber, 'ABC-777');

  const invoiceResult = await request(users.admin, '/api/sales-employee/invoices', 'POST', {
    clientName: order.clientName, salesOrderId: order._id, deliveryNoteId: deliveryNote._id,
    dueDate: '2026-11-30', status: 'Draft'
  });
  assert.equal(invoiceResult.status, 201, JSON.stringify(invoiceResult.body));
  const draftInvoice = invoiceResult.body.data;
  assert.equal(draftInvoice.items[0].partNumber, 'ABC-777');
  assert.deepEqual(
    [draftInvoice.subtotal, draftInvoice.discount, draftInvoice.taxableAmount, draftInvoice.tax, draftInvoice.amount],
    [4000000, 97600, 3902400, 702432, 4604832]
  );
  const finalResult = await request(users.finance, `/api/sales-employee/invoices/${draftInvoice._id}/finalize`, 'POST', { invoiceType: 'GST Invoice' });
  assert.equal(finalResult.status, 200, JSON.stringify(finalResult.body));
  assert.equal(finalResult.body.data.items[0].partNumber, 'ABC-777');
  assert.equal(finalResult.body.data.amount, 4604832);
  chain = { quote, cpo, file, order: order.toObject(), supplierPO: supplierPO.toObject(), localGrn, deliveryNote, draftInvoice, finalInvoice: finalResult.body.data };
});

test('global Support Inventory IN creates a GRN carrying the part number', async () => {
  const order = await SalesOrder.create({
    clientName: 'R28 Global Customer', orderNumber: `SO-G-${runId}`, fileType: 'Blue',
    items: [{ sku: 'GLOBAL-SKU', partNumber: 'ABC-777', description: 'Global R28 Server', quantity: 1, unitPrice: 10, total: 10 }],
    totalAmount: 10, netAmount: 10, currentDepartment: 'Support', departmentResponsible: 'Support',
    workflowStatus: 'Goods Arrived / Awaiting Support Verification', createdBy: users.sales._id, salesPerson: users.sales._id
  });
  const poResult = await request(users.global, '/api/purchaser/pos', 'POST', {
    poType: 'Global', supplierName: 'R28 Global Supplier', salesOrderId: order._id,
    issuingCompanyCode: 'WWTS', currency: 'PKR', items: order.items
  });
  assert.equal(poResult.status, 201, JSON.stringify(poResult.body));
  const po = await SupplierPO.findById(poResult.body.data._id);
  order.supplierPoId = po._id;
  order.supplierPoNumber = po.poNumber;
  await order.save();
  await Shipment.create({
    salesOrder: order._id,
    salesOrderNumber: order.orderNumber,
    status: 'Received in Office',
    receivedInOffice: true,
    receivedInOfficeDate: new Date(),
    createdBy: users.global._id
  });
  const inventory = await InventoryItem.create({ name: 'Global R28 Server', sku: 'GLOBAL-SKU', partNumber: 'ABC-777', quantityOnHand: 0, reservedQuantity: 0, minStockLevel: 0 });
  const received = await request(users.support, `/api/sales-employee/orders/${order._id}/goods-received`, 'POST', {
    receiptId: `R28-GLOBAL-${runId}`,
    items: [{ orderItemId: order.items[0]._id, receivedQty: 1, inventoryItemId: inventory._id }]
  });
  assert.equal(received.status, 200, JSON.stringify(received.body));
  const grn = await PurchaserGRN.findOne({ salesOrder: order._id }).lean();
  assert.equal(grn.items[0].partNumber, 'ABC-777');
  chain.globalGrn = grn;
});

test('old-style blank lines resolve at read time from their source without changing stored data', async () => {
  const legacyQuote = await Quotation.create({
    clientName: 'R28 Legacy Source', owner: users.sales._id, createdBy: users.sales._id,
    items: [{ sku: 'LEGACY-SKU', partNumber: 'LEGACY-PN-28', description: 'Legacy source item', quantity: 1, unitPrice: 10, total: 10 }]
  });
  const legacyOrder = await SalesOrder.create({
    clientName: 'R28 Legacy Source', quotationId: legacyQuote._id, owner: users.sales._id, createdBy: users.sales._id,
    orderNumber: `SO-LEG-${runId}`, items: [{ sku: 'LEGACY-SKU', partNumber: '', description: 'Legacy source item', quantity: 1, unitPrice: 10, total: 10 }], totalAmount: 10, netAmount: 10
  });
  const resolvedOrder = await resolveDocumentPartNumbers(legacyOrder, 'sales-order');
  assert.equal(resolvedOrder.items[0].partNumber, 'LEGACY-PN-28');
  assert.equal((await SalesOrder.findById(legacyOrder._id).lean()).items[0].partNumber, '');
  const list = await request(users.admin, '/api/sales-employee/orders');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.find(item => item._id === String(legacyOrder._id)).items[0].partNumber, 'LEGACY-PN-28');
});

test('SKU is never substituted when no real part number exists', async () => {
  const quote = await Quotation.create({ clientName: 'SKU only', createdBy: users.sales._id, items: [{ sku: 'SKU-NOT-PN', description: 'SKU only line' }] });
  const resolved = await resolveDocumentPartNumbers(quote, 'quotation');
  assert.equal(resolved.items[0].partNumber, '');
});

test('new chain table includes all requested document types', () => {
  const rows = [
    ['Quotation', chain.quote.items[0]], ['Customer PO', chain.cpo.items[0]], ['Product File', chain.file.products[0]],
    ['Sales Order', chain.order.items[0]], ['Supplier PO', chain.supplierPO.items[0]], ['Local GRN', chain.localGrn.items[0]],
    ['Global GRN', chain.globalGrn.items[0]], ['Delivery Note', chain.deliveryNote.items[0]],
    ['Draft Invoice', chain.draftInvoice.items[0]], ['Final Invoice', chain.finalInvoice.items[0]]
  ];
  rows.forEach(([label, item]) => assert.equal(item.partNumber, 'ABC-777', label));
});
