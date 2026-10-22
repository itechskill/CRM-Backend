const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

process.env.NODE_ENV = 'test';
const runId = randomBytes(8).toString('hex');
process.env.COUNTER_NAMESPACE = `release5-${runId}`;
mongoose.set('autoIndex', false);

const TEMP_DB_PREFIX = 'f_tmp_r5_';
const tempDbName = `${TEMP_DB_PREFIX}${runId}`;
const sourceMongoUri = process.env.MONGODB_URI;
assert.ok(sourceMongoUri, 'MONGODB_URI is required to run the Release 5 tests.');
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
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const User = require('../models/User');
const { getCounterKey } = require('../utils/counterKey');

let server;
let baseUrl;
let salesUser;
let financeUser;
let adminUser;
let ceoUser;
let salesManagerUser;
let accountantUser;
let supportUser;
let logisticsUser;
let purchaserUser;

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

const createLinkedOrder = async (core = '2001') => {
  const quotation = await Quotation.create({ clientName: `R5 client ${core}`, fileNo: core, fileType: '', createdBy: salesUser._id });
  const customerPO = await CustomerPO.create({ customerName: quotation.clientName, fileNumber: core, fileType: '', quotationId: quotation._id, createdBy: salesUser._id });
  const productFile = await ProductFile.create({ customerName: quotation.clientName, fileNumber: core, fileType: '', quotationId: quotation._id, customerPOId: customerPO._id, createdBy: salesUser._id });
  const order = await SalesOrder.create({
    clientName: quotation.clientName,
    fileNo: core,
    fileType: '',
    suggestedFileType: 'Green',
    quotationId: quotation._id,
    customerPOId: customerPO._id,
    productFileId: productFile._id,
    workflowStatus: 'Pending Finance Overdue Check',
    status: 'Pending Finance Approval',
    currentDepartment: 'Finance',
    departmentResponsible: 'Finance',
    createdBy: salesUser._id,
    salesPerson: salesUser._id
  });
  return { quotation, customerPO, productFile, order };
};

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
  await Counter.create([
    { _id: getCounterKey('file-number'), sequence: 1021 },
    { _id: getCounterKey('sales-order-number'), sequence: 1 }
  ]);
  const password = `Release5-${runId}`;
  [salesUser, financeUser, adminUser, ceoUser, salesManagerUser, accountantUser, supportUser, logisticsUser, purchaserUser] = await User.create([
    { fullName: 'R5 Sales', email: `r5.sales.${runId}@example.com`, password, role: 'employee', status: 'active', isApproved: true },
    { fullName: 'R5 Finance', email: `r5.finance.${runId}@example.com`, password, role: 'finance', status: 'active', isApproved: true },
    { fullName: 'R5 Admin', email: `r5.admin.${runId}@example.com`, password, role: 'admin', status: 'active', isApproved: true },
    { fullName: 'R5 CEO', email: `r5.ceo.${runId}@example.com`, password, role: 'ceo', status: 'active', isApproved: true },
    { fullName: 'R5 Sales Manager', email: `r5.sales.manager.${runId}@example.com`, password, role: 'sales_manager', status: 'active', isApproved: true },
    { fullName: 'R5 Accountant', email: `r5.accountant.${runId}@example.com`, password, role: 'accountant', status: 'active', isApproved: true },
    { fullName: 'R5 Support', email: `r5.support.${runId}@example.com`, password, role: 'support', status: 'active', isApproved: true },
    { fullName: 'R5 Logistics', email: `r5.logistics.${runId}@example.com`, password, role: 'logistics', status: 'active', isApproved: true },
    { fullName: 'R5 Purchaser', email: `r5.purchaser.${runId}@example.com`, password, role: 'purchaser', purchaserSubDept: 'Local', status: 'active', isApproved: true }
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

test('new quotations receive numeric-only file numbers and do not alter old suffixed records', async () => {
  const old = await Quotation.create({ clientName: 'Legacy quotation', fileNo: '900 Blue', fileType: 'Blue', createdBy: salesUser._id });
  const result = await request(salesUser, '/api/sales-employee/quotations', {
    method: 'POST',
    body: JSON.stringify({ clientName: 'New unassigned quotation', fileType: 'Blue', issuingCompanyCode: 'FORTLINE_ENTERPRISES' })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.data.fileNo, '1022');
  assert.equal(result.data.data.fileType, '');
  assert.match(result.data.data.fileNo, /^\d+$/);
  const unchanged = await Quotation.findById(old._id).lean();
  assert.equal(unchanged.fileNo, '900 Blue');
  assert.equal(unchanged.fileType, 'Blue');
});

test('Quotation, Customer PO, Product File and draft Sales Order have no implicit file-type default', () => {
  assert.equal(new Quotation({ clientName: 'Unassigned quote' }).fileType, '');
  assert.equal(new CustomerPO({ customerName: 'Unassigned CPO', createdBy: salesUser._id }).fileType, '');
  assert.equal(new ProductFile({ customerName: 'Unassigned PF', createdBy: salesUser._id }).fileType, '');
  assert.equal(new SalesOrder({ clientName: 'Unassigned SO' }).fileType, '');
  assert.equal(new SalesOrder({ clientName: 'Unassigned SO' }).suggestedFileType, '');
});

test('Finance approval requires an explicit choice and atomically updates every linked record', async () => {
  const linked = await createLinkedOrder('2001');
  const missingChoice = await request(financeUser, `/api/sales-employee/orders/${linked.order._id}/finance-review`, {
    method: 'POST', body: JSON.stringify({ action: 'clear' })
  });
  assert.equal(missingChoice.response.status, 400);

  const approved = await request(financeUser, `/api/sales-employee/orders/${linked.order._id}/finance-review`, {
    method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Green' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.data));
  assert.deepEqual(approved.data.linkWarnings, []);

  const [order, quotation, customerPO, productFile] = await Promise.all([
    SalesOrder.findById(linked.order._id).lean(), Quotation.findById(linked.quotation._id).lean(),
    CustomerPO.findById(linked.customerPO._id).lean(), ProductFile.findById(linked.productFile._id).lean()
  ]);
  for (const record of [order, quotation, customerPO, productFile]) assert.equal(record.fileType, 'Green');
  assert.equal(order.fileNo, '2001 Green');
  assert.equal(quotation.fileNo, '2001 Green');
  assert.equal(customerPO.fileNumber, '2001 Green');
  assert.equal(productFile.fileNumber, '2001 Green');
  assert.equal(order.currentDepartment, 'Local Purchaser');
});

test('Finance approval transaction rolls back the order and linked records when a linked save fails', async () => {
  const linked = await createLinkedOrder('2002');
  const originalSave = ProductFile.prototype.save;
  ProductFile.prototype.save = async function forcedFailure(options) {
    if (String(this._id) === String(linked.productFile._id)) throw new Error('forced linked write failure');
    return originalSave.call(this, options);
  };
  try {
    const result = await request(financeUser, `/api/sales-employee/orders/${linked.order._id}/finance-review`, {
      method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Blue' })
    });
    assert.equal(result.response.status, 500);
  } finally {
    ProductFile.prototype.save = originalSave;
  }

  const [order, quotation, customerPO, productFile] = await Promise.all([
    SalesOrder.findById(linked.order._id).lean(), Quotation.findById(linked.quotation._id).lean(),
    CustomerPO.findById(linked.customerPO._id).lean(), ProductFile.findById(linked.productFile._id).lean()
  ]);
  for (const record of [order, quotation, customerPO, productFile]) assert.equal(record.fileType, '');
  assert.equal(order.fileNo, '2002');
  assert.equal(quotation.fileNo, '2002');
  assert.equal(customerPO.fileNumber, '2002');
  assert.equal(productFile.fileNumber, '2002');
  assert.equal(order.currentDepartment, 'Finance');
});

test('Finance review route permits exactly Finance, Admin and CEO', async () => {
  const financeOrder = await SalesOrder.create({ clientName: 'Role Finance', fileNo: '2101', currentDepartment: 'Finance', departmentResponsible: 'Finance' });
  const financeResult = await request(financeUser, `/api/sales-employee/orders/${financeOrder._id}/finance-review`, {
    method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Green' })
  });
  assert.equal(financeResult.response.status, 200, JSON.stringify(financeResult.data));
  assert.ok(financeResult.data.linkWarnings.some(message => /Quotation link is missing/.test(message)));

  const adminOrder = await SalesOrder.create({ clientName: 'Role Admin', fileNo: '2102', currentDepartment: 'Finance', departmentResponsible: 'Finance' });
  const adminResult = await request(adminUser, `/api/sales-employee/orders/${adminOrder._id}/finance-review`, {
    method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Blue' })
  });
  assert.equal(adminResult.response.status, 200, JSON.stringify(adminResult.data));

  const ceoOrder = await SalesOrder.create({ clientName: 'Role CEO', fileNo: '2103', currentDepartment: 'Finance', departmentResponsible: 'Finance' });
  const ceoResult = await request(ceoUser, `/api/sales-employee/orders/${ceoOrder._id}/finance-review`, {
    method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Green' })
  });
  assert.equal(ceoResult.response.status, 200, JSON.stringify(ceoResult.data));

  for (const user of [salesUser, salesManagerUser, accountantUser, supportUser, logisticsUser, purchaserUser]) {
    const denied = await request(user, `/api/sales-employee/orders/${adminOrder._id}/finance-review`, {
      method: 'POST', body: JSON.stringify({ action: 'clear', fileType: 'Green' })
    });
    assert.equal(denied.response.status, 403);
  }
});

test('file-number core search still finds legacy suffixed quotations', async () => {
  const result = await request(salesUser, '/api/sales-employee/quotations?status=all&search=900');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.data.some(record => record.fileNo === '900 Blue'));
});
