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
const tempDbName = `f_tmp_r24_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 24 tests.');
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
process.env.COUNTER_NAMESPACE = `release24-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const Counter = require('../models/Counter');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const SupplierPO = require('../models/SupplierPO');
const DeliveryNote = require('../models/DeliveryNote');
const { getCounterKey } = require('../utils/counterKey');
const { calculateDocumentFinancials } = require('../utils/documentFinancials');

let server;
let baseUrl;
let sales;
let purchaser;
let chain;

const tokenFor = user => jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'nexus_crm_super_secret_jwt_token_key_2026');
const requestAs = async (user, path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};
const request = (path, options) => requestAs(sales, path, options);

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  sales = await User.create({
    fullName: 'Release 24 Sales', email: `r24.sales.${runId}@example.com`, password: `Release24-${runId}`,
    role: 'sales_person', department: 'Sales', status: 'active', isApproved: true
  });
  purchaser = await User.create({
    fullName: 'Release 24 Global Purchaser', email: `r24.purchaser.${runId}@example.com`, password: `Release24-${runId}`,
    role: 'purchaser', purchaserSubDept: 'Global', status: 'active', isApproved: true
  });
  await Counter.create([
    { _id: getCounterKey('file-number'), sequence: 2400 },
    { _id: getCounterKey('sales-order-number'), sequence: 2400 },
    { _id: getCounterKey('global-po-number'), sequence: 2400 },
    { _id: getCounterKey('delivery-note-number'), sequence: 2400 }
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

test('tax uses subtotal minus discount for zero, decimal and 18 percent rates', () => {
  const items = [{ partNumber: 'R450-PN', description: 'Server', quantity: 2, unitPrice: 1800000 }];
  assert.deepEqual(calculateDocumentFinancials({ items, discount: 100000, taxRate: 0 }), {
    items: [{ ...items[0], total: 3600000 }], subtotal: 3600000, discount: 100000,
    taxableAmount: 3500000, taxRate: 0, tax: 0, grandTotal: 3500000
  });
  assert.equal(calculateDocumentFinancials({ items, discount: 100000, taxRate: 7.5 }).tax, 262500);
  const atEighteen = calculateDocumentFinancials({ items, discount: 100000, taxRate: 18 });
  assert.equal(atEighteen.tax, 630000);
  assert.equal(atEighteen.grandTotal, 4130000);
});

test('quotation part number and discount survive reopen and the sales conversion chain', async () => {
  const created = await request('/api/sales-employee/quotations', {
    method: 'POST',
    body: {
      clientName: 'Release 24 Customer', issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED',
      items: [{ partNumber: 'R450-PN-24', sku: 'SKU-R450', description: 'Dell R450 Server', quantity: 2, unitPrice: 1800000 }],
      discount: 100000, discountPercentage: 0, taxPercentage: 18, status: 'Sent'
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const quote = created.body.data;
  assert.equal(quote.items[0].partNumber, 'R450-PN-24');
  assert.deepEqual([quote.totalAmount, quote.discount, quote.tax, quote.netAmount], [3600000, 100000, 630000, 4130000]);

  const reopened = await request('/api/sales-employee/quotations');
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.data.find(item => item._id === quote._id).items[0].partNumber, 'R450-PN-24');

  const convertedPO = await request(`/api/sales-employee/quotations/${quote._id}/convert-to-po`, {
    method: 'POST', body: { poNumber: 'CPO-R24', documentName: 'customer-po.pdf', uploadedDocument: 'data:application/pdf;base64,WA==' }
  });
  assert.equal(convertedPO.status, 201, JSON.stringify(convertedPO.body));
  const po = await CustomerPO.findById(convertedPO.body.data.po._id).lean();
  assert.equal(po.items[0].partNumber, 'R450-PN-24');
  assert.equal(po.discount, 100000);

  const convertedFile = await request(`/api/sales-employee/customer-pos/${po._id}/convert-to-file`, { method: 'POST', body: {} });
  assert.equal(convertedFile.status, 201, JSON.stringify(convertedFile.body));
  const file = await ProductFile.findById(convertedFile.body.data.file._id).lean();
  assert.equal(file.products[0].partNumber, 'R450-PN-24');

  const convertedOrder = await request(`/api/sales-employee/product-files/${file._id}/convert-to-order`, { method: 'POST', body: {} });
  assert.equal(convertedOrder.status, 201, JSON.stringify(convertedOrder.body));
  const order = await SalesOrder.findById(convertedOrder.body.data.order._id).lean();
  assert.equal(order.items[0].partNumber, 'R450-PN-24');
  assert.deepEqual([order.totalAmount, order.discount, order.taxRate, order.tax, order.netAmount], [3600000, 100000, 18, 630000, 4130000]);
  chain = { quote, po, file, order };
});

test('part number carries from the Sales Order into Supplier PO and Delivery Note lines', async () => {
  assert.ok(chain?.order, 'conversion chain must be created first');
  const issued = await requestAs(purchaser, '/api/purchaser/pos', {
    method: 'POST',
    body: {
      poType: 'Global', issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED', currency: 'PKR',
      supplierName: 'Release 24 Supplier', salesOrderId: chain.order._id, items: chain.order.items
    }
  });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const po = await SupplierPO.findById(issued.body.data._id).lean();
  assert.equal(po.items[0].partNumber, 'R450-PN-24');

  const sourceItem = chain.order.items[0];
  const dn = await DeliveryNote.create({
    salesOrder: chain.order._id,
    salesOrderNumber: chain.order.orderNumber,
    clientName: chain.order.clientName,
    items: [{
      product: sourceItem.description,
      description: sourceItem.description,
      orderItemId: String(sourceItem._id),
      orderItemIndex: 0,
      demand: sourceItem.quantity,
      quantity: sourceItem.quantity
    }],
    createdBy: sales._id
  });
  assert.equal(dn.items[0].partNumber, 'R450-PN-24');
  assert.equal(dn.items[0].unitPrice, 1800000);
});

test('invoice reopens with part number and server-derived discounted tax totals', async () => {
  assert.ok(chain?.order, 'conversion chain must be created first');
  const created = await request('/api/sales-employee/invoices', {
    method: 'POST',
    body: {
      clientName: chain.order.clientName, salesOrderId: chain.order._id, salesOrderNumber: chain.order.orderNumber,
      items: chain.order.items, discount: chain.order.discount, taxRate: chain.order.taxRate,
      tax: 1, amount: 1, dueDate: new Date(Date.now() + 30 * 86400000).toISOString(), status: 'Draft'
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.items[0].partNumber, 'R450-PN-24');
  assert.deepEqual(
    [created.body.data.subtotal, created.body.data.discount, created.body.data.taxableAmount, created.body.data.tax, created.body.data.amount],
    [3600000, 100000, 3500000, 630000, 4130000]
  );

  const stored = await Invoice.findById(created.body.data._id).lean();
  assert.equal(stored.items[0].partNumber, 'R450-PN-24');
  assert.equal(stored.tax, 630000, 'caller-supplied tax must be ignored');
  assert.equal(stored.amount, 4130000, 'caller-supplied total must be ignored');

  const reopened = await request('/api/sales-employee/invoices');
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  const invoice = reopened.body.data.find(item => item._id === String(stored._id));
  assert.equal(invoice.items[0].partNumber, 'R450-PN-24');
  assert.equal(invoice.amount, 4130000);
});

test('old documents without part numbers remain blank', async () => {
  const legacyQuote = await Quotation.create({ clientName: 'Legacy Customer', items: [{ description: 'Legacy item', quantity: 1, unitPrice: 10, total: 10 }] });
  assert.equal(legacyQuote.items[0].partNumber, '');
});
