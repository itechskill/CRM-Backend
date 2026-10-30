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
const tempDbName = `f_tmp_r27_${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run Release 27 tests.');
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
process.env.COUNTER_NAMESPACE = `release27-${runId}`;

const connectDB = require('../config/db');
const app = require('../server');
const User = require('../models/User');
const Counter = require('../models/Counter');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const { getCounterKey } = require('../utils/counterKey');
const { calculateDocumentFinancials } = require('../utils/documentFinancials');

let server;
let baseUrl;
let sales;
let admin;
let eligibleNames;

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
const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const expected = ({ items, discount, taxRate }) => calculateDocumentFinancials({ items, discount, taxRate });

// Mirrors the exact Release 27 quotation form payload: item totals and all document totals are calculated before JSON serialization.
const quotationFormPayload = ({ items, discount, taxPercentage, ...fields }) => {
  const financials = expected({ items, discount: discount === '' || discount === null ? 0 : discount, taxRate: taxPercentage });
  return {
    ...fields,
    items: financials.items,
    totalAmount: financials.subtotal,
    discount: financials.discount,
    discountPercentage: financials.subtotal ? round(financials.discount / financials.subtotal * 100) : 0,
    tax: financials.tax,
    taxPercentage: financials.taxRate,
    netAmount: financials.grandTotal
  };
};

before(async () => {
  await connectDB();
  assert.equal(mongoose.connection.name, tempDbName);
  const password = `Release27-${runId}`;
  const users = await User.create([
    { fullName: 'Alpha Labelled', email: `r27.alpha.${runId}@example.com`, password, role: 'sales_person', department: 'Sales', status: 'active', isApproved: true, priceRequestLabel: 'DELL Configurator' },
    { fullName: 'Beta Unlabelled', email: `r27.beta.${runId}@example.com`, password, role: 'sales_rep', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'Charlie Member', email: `r27.member.${runId}@example.com`, password, role: 'sales_member', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'Delta Manager', email: `r27.manager.${runId}@example.com`, password, role: 'sales_manager', department: 'Sales', status: 'active', isApproved: true },
    { fullName: 'Echo Purchaser', email: `r27.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true },
    { fullName: 'Foxtrot Admin', email: `r27.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'Golf CEO', email: `r27.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'Hidden Inactive', email: `r27.inactive.${runId}@example.com`, password, role: 'sales_person', status: 'inactive', isApproved: true },
    { fullName: 'Hidden Unapproved', email: `r27.unapproved.${runId}@example.com`, password, role: 'sales_person', status: 'active', isApproved: false },
    { fullName: 'Hidden Support', email: `r27.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true }
  ]);
  [sales, , , , , admin] = users;
  eligibleNames = users.slice(0, 7).map(user => user.fullName).sort((a, b) => a.localeCompare(b));
  await Counter.create([
    { _id: getCounterKey('file-number'), sequence: 2700 },
    { _id: getCounterKey('quotation-number'), sequence: 2700 },
    { _id: getCounterKey('sales-order-number'), sequence: 2700 }
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

test('quotation create/edit HTTP matrix replaces items and recomputes every stored and returned financial field', async () => {
  const base = { clientName: 'R27 Matrix Customer', issuingCompanyCode: 'FORTLINE_PRIVATE_LIMITED', status: 'Sent' };
  let items = [{ partNumber: 'R27-SERVER', description: 'Server', quantity: 2, unitPrice: 2050000 }];
  const scenarios = [
    ['a create', items, 100040, 18, 4100000, 100040, 719992.8, 4719952.8],
    ['b clear discount', items, 0, 18, 4100000, 0, 738000, 4838000],
    ['c discount 50,000', items, 50000, 18, 4100000, 50000, 729000, 4779000],
    ['d unit 2,000,000 x2', [{ ...items[0], unitPrice: 2000000 }], 50000, 18, 4000000, 50000, 711000, 4661000],
    ['e quantity 3', [{ ...items[0], unitPrice: 2000000, quantity: 3 }], 50000, 18, 6000000, 50000, 1071000, 7021000],
    ['f tax 0', [{ ...items[0], unitPrice: 2000000, quantity: 3 }], 50000, 0, 6000000, 50000, 0, 5950000],
    ['f tax 17.5', [{ ...items[0], unitPrice: 2000000, quantity: 3 }], 50000, 17.5, 6000000, 50000, 1041250, 6991250],
    ['g add line', [{ ...items[0], unitPrice: 2000000, quantity: 3 }, { description: 'Added line', quantity: 1, unitPrice: 500000 }], 50000, 17.5, 6500000, 50000, 1128750, 7578750],
    ['g remove original line', [{ description: 'Added line', quantity: 1, unitPrice: 500000 }], 50000, 17.5, 500000, 50000, 78750, 528750]
  ];
  let id;
  for (let index = 0; index < scenarios.length; index += 1) {
    const [name, scenarioItems, discount, taxRate, subtotal, expectedDiscount, tax, grandTotal] = scenarios[index];
    const payload = quotationFormPayload({ ...base, items: scenarioItems, discount, taxPercentage: taxRate });
    // Derived caller values are deliberately corrupted; the server must use items, discount and rate only.
    payload.totalAmount = 1;
    payload.tax = 2;
    payload.netAmount = 3;
    payload.discountPercentage = 99;
    const response = index === 0
      ? await request('/api/sales-employee/quotations', { method: 'POST', body: payload })
      : await request(`/api/sales-employee/quotations/${id}`, { method: 'PATCH', body: payload });
    assert.equal(response.status, index === 0 ? 201 : 200, `${name}: ${JSON.stringify(response.body)}`);
    id ||= response.body.data._id;
    const stored = await Quotation.findById(id).lean();
    const listedResponse = await request('/api/sales-employee/quotations?status=all');
    const listed = listedResponse.body.data.find(record => String(record._id) === String(id));
    for (const source of [stored, response.body.data, listed]) {
      assert.deepEqual([source.totalAmount, source.discount, source.taxPercentage, source.tax, source.netAmount], [subtotal, expectedDiscount, taxRate, tax, grandTotal], name);
      assert.equal(source.items.length, scenarioItems.length, `${name}: items must be replaced, not merged`);
    }
  }

  for (const clearedDiscount of ['', null, 0]) {
    const response = await request(`/api/sales-employee/quotations/${id}`, {
      method: 'PATCH', body: { items: scenarios.at(-1)[1], discount: clearedDiscount, discountPercentage: 10, taxPercentage: 18, totalAmount: 1, tax: 1, netAmount: 1 }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.discount, 0);
    assert.equal(response.body.data.netAmount, 590000);
  }

  const convertedPO = await request(`/api/sales-employee/quotations/${id}/convert-to-po`, {
    method: 'POST', body: { poNumber: 'CPO-R27', documentName: 'customer-po.pdf', uploadedDocument: 'data:application/pdf;base64,WA==' }
  });
  assert.equal(convertedPO.status, 201, JSON.stringify(convertedPO.body));
  const po = await CustomerPO.findById(convertedPO.body.data.po._id).lean();
  assert.deepEqual([po.subtotal, po.discount, po.taxRate, po.tax, po.amount], [500000, 0, 18, 90000, 590000]);

  const convertedFile = await request(`/api/sales-employee/customer-pos/${po._id}/convert-to-file`, { method: 'POST', body: {} });
  assert.equal(convertedFile.status, 201, JSON.stringify(convertedFile.body));
  const file = await ProductFile.findById(convertedFile.body.data.file._id).lean();
  assert.equal(file.products[0].total, 500000);

  const convertedOrder = await request(`/api/sales-employee/product-files/${file._id}/convert-to-order`, { method: 'POST', body: {} });
  assert.equal(convertedOrder.status, 201, JSON.stringify(convertedOrder.body));
  const order = await SalesOrder.findById(convertedOrder.body.data.order._id).lean();
  assert.deepEqual([order.totalAmount, order.discount, order.taxRate, order.tax, order.netAmount], [500000, 0, 18, 90000, 590000]);
});

test('Customer PO, Product File, Sales Order and invoice edits normalize submitted lines and ignore stale totals', async () => {
  const quote = await Quotation.findOne({ clientName: 'R27 Matrix Customer' }).lean();
  const po = await CustomerPO.findOne({ quotationId: quote._id });
  const poUpdate = await request(`/api/sales-employee/customer-pos/${po._id}`, {
    method: 'PATCH',
    body: { items: [{ description: 'PO item', quantity: 2, unitPrice: 1000, total: 999 }], discount: 100, taxRate: 10, subtotal: 1, tax: 1, amount: 1 }
  });
  assert.equal(poUpdate.status, 200, JSON.stringify(poUpdate.body));
  assert.deepEqual([poUpdate.body.data.items[0].total, poUpdate.body.data.subtotal, poUpdate.body.data.discount, poUpdate.body.data.tax, poUpdate.body.data.amount], [2000, 2000, 100, 190, 2090]);

  const file = await ProductFile.findOne({ quotationId: quote._id });
  const fileUpdate = await request(`/api/sales-employee/product-files/${file._id}`, {
    method: 'PATCH', body: { products: [{ name: 'File item', description: 'File item', quantity: 2, unitPrice: 1000, total: 999 }] }
  });
  assert.equal(fileUpdate.status, 200, JSON.stringify(fileUpdate.body));
  assert.equal(fileUpdate.body.data.products[0].total, 2000);

  const order = await SalesOrder.findOne({ quotationId: quote._id });
  const orderUpdate = await requestAs(admin, `/api/sales-employee/orders/${order._id}`, {
    method: 'PATCH', body: { items: [{ description: 'Order item', quantity: 3, unitPrice: 1000, total: 1 }], discount: 200, taxRate: 5, totalAmount: 1, tax: 1, netAmount: 1 }
  });
  assert.equal(orderUpdate.status, 200, JSON.stringify(orderUpdate.body));
  assert.deepEqual([orderUpdate.body.data.items[0].total, orderUpdate.body.data.totalAmount, orderUpdate.body.data.discount, orderUpdate.body.data.tax, orderUpdate.body.data.netAmount], [3000, 3000, 200, 140, 2940]);

  const invoiceCreate = await requestAs(admin, '/api/sales-employee/invoices', {
    method: 'POST', body: { clientName: 'R27 Matrix Customer', salesOrderId: order._id, items: [{ description: 'Invoice item', quantity: 2, unitPrice: 1000, total: 1 }], discount: 100, taxRate: 10, tax: 1, amount: 1, dueDate: new Date(Date.now() + 86400000).toISOString(), status: 'Draft' }
  });
  assert.equal(invoiceCreate.status, 201, JSON.stringify(invoiceCreate.body));
  assert.deepEqual([invoiceCreate.body.data.subtotal, invoiceCreate.body.data.discount, invoiceCreate.body.data.tax, invoiceCreate.body.data.amount], [2000, 100, 190, 2090]);
  const invoiceUpdate = await requestAs(admin, `/api/finance/invoices/${invoiceCreate.body.data._id}`, {
    method: 'PATCH', body: { items: [{ description: 'Invoice item', quantity: 4, unitPrice: 1000, total: 1 }], discount: '', taxRate: 17.5, subtotal: 1, tax: 1, amount: 1 }
  });
  assert.equal(invoiceUpdate.status, 200, JSON.stringify(invoiceUpdate.body));
  assert.deepEqual([invoiceUpdate.body.data.items[0].total, invoiceUpdate.body.data.subtotal, invoiceUpdate.body.data.discount, invoiceUpdate.body.data.tax, invoiceUpdate.body.data.amount], [4000, 4000, 0, 700, 4700]);
  const storedInvoice = await Invoice.findById(invoiceCreate.body.data._id).lean();
  assert.equal(storedInvoice.amount, 4700);
});

test('Price Request people include every active approved eligible role, labels are optional, and only safe fields are returned', async () => {
  const result = await request('/api/price-requests/labelled-users');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.data.map(person => person.name), eligibleNames);
  assert.equal(result.body.data.find(person => person.name === 'Alpha Labelled').label, 'DELL Configurator');
  assert.equal(result.body.data.find(person => person.name === 'Beta Unlabelled').label, '');
  assert.ok(result.body.data.length > 0);
  result.body.data.forEach(person => assert.deepEqual(Object.keys(person).sort(), ['_id', 'label', 'name']));
  assert.equal(result.body.data.some(person => person.name.startsWith('Hidden')), false);
});
