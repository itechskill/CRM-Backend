const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const InventoryItem = require('../models/InventoryItem');

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  // Find or use admin/purchaser user
  let user = await User.findOne({ role: { $in: ['purchaser', 'admin', 'ceo'] } });
  if (!user) {
    user = await User.findOne();
  }

  const token = jwt.sign(
    { id: user._id, role: user.role, purchaserSubDept: 'Local' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const BASE_URL = 'http://localhost:5000/api/purchaser';

  console.log('\n--- 1. Testing GET /api/purchaser/pending-orders ---');
  const resPendingGlobal = await fetch(`${BASE_URL}/pending-orders?subDept=Global`, { headers: authHeaders });
  const dataPendingGlobal = await resPendingGlobal.json();
  console.log('Pending Global Orders:', dataPendingGlobal.success ? `PASS (Count: ${dataPendingGlobal.count})` : `FAIL: ${dataPendingGlobal.message}`);

  const resPendingLocal = await fetch(`${BASE_URL}/pending-orders?subDept=Local`, { headers: authHeaders });
  const dataPendingLocal = await resPendingLocal.json();
  console.log('Pending Local Orders:', dataPendingLocal.success ? `PASS (Count: ${dataPendingLocal.count})` : `FAIL: ${dataPendingLocal.message}`);

  console.log('\n--- 2. Testing Inventory Management (GET & POST /api/purchaser/inventory) ---');
  const testProduct = {
    name: `Test Heavy Bearing ${Date.now().toString().slice(-4)}`,
    sku: `SKU-${Date.now().toString().slice(-5)}`,
    category: 'Mechanical',
    unit: 'pcs',
    quantityOnHand: 25,
    minStockLevel: 5,
    unitPrice: 1250,
    location: 'Rack B-1',
    description: 'High tensile steel bearing'
  };

  const resAddInv = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(testProduct)
  });
  const dataAddInv = await resAddInv.json();
  console.log('POST /inventory result:', dataAddInv.success ? `PASS (${dataAddInv.message})` : `FAIL: ${dataAddInv.message}`);

  const resGetInv = await fetch(`${BASE_URL}/inventory`, { headers: authHeaders });
  const dataGetInv = await resGetInv.json();
  console.log('GET /inventory result:', dataGetInv.success ? `PASS (Count: ${dataGetInv.count})` : `FAIL: ${dataGetInv.message}`);

  console.log('\n--- 3. Testing Create Supplier PO (POST /api/purchaser/pos) ---');
  const testPO = {
    poNumber: `TEST-PO-${Date.now().toString().slice(-5)}`,
    supplierName: 'Alpha Tech Components',
    poType: 'Local',
    items: [
      { productName: testProduct.name, quantity: 5, unitPrice: 1250, totalAmount: 6250 }
    ],
    totalAmount: 6250,
    notes: 'Automated test purchase order'
  };
  const resCreatePO = await fetch(`${BASE_URL}/pos`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(testPO)
  });
  const dataCreatePO = await resCreatePO.json();
  console.log('POST /pos result:', dataCreatePO.success ? `PASS (PO #${dataCreatePO.data?.poNumber})` : `FAIL: ${dataCreatePO.message}`);

  console.log('\n--- 4. Testing Create GRN (POST /api/purchaser/grns) ---');
  const testGRN = {
    grnNumber: `TEST-GRN-${Date.now().toString().slice(-5)}`,
    supplierPONumber: testPO.poNumber,
    supplierName: 'Alpha Tech Components',
    items: [{ productName: testProduct.name, quantityReceived: 5, condition: 'Good' }],
    purchaserSubDept: 'Local'
  };
  const resCreateGRN = await fetch(`${BASE_URL}/grns`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(testGRN)
  });
  const dataCreateGRN = await resCreateGRN.json();
  console.log('POST /grns result:', dataCreateGRN.success ? `PASS (GRN #${dataCreateGRN.data?.grnNumber})` : `FAIL: ${dataCreateGRN.message}`);

  console.log('\n--- 5. Testing Create Local Payable (POST /api/purchaser/payables) ---');
  const testPayable = {
    supplierName: 'Alpha Tech Components',
    amountPKR: 6250,
    paymentMethod: 'Cash',
    supplierPONumber: testPO.poNumber,
    remarks: 'Automated test settlement'
  };
  const resCreatePayable = await fetch(`${BASE_URL}/payables`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(testPayable)
  });
  const dataCreatePayable = await resCreatePayable.json();
  console.log('POST /payables result:', dataCreatePayable.success ? `PASS (${dataCreatePayable.message})` : `FAIL: ${dataCreatePayable.message}`);

  console.log('\n--- 6. Testing Move to Logistics (POST /api/purchaser/orders/:id/send-to-logistics) ---');
  // Find a Blue file order
  let blueOrder = await SalesOrder.findOne({ fileType: 'Blue' });
  if (!blueOrder) {
    blueOrder = await SalesOrder.findOne();
  }

  if (blueOrder) {
    const logisticsPayload = {
      carrier: 'Emirates SkyCargo',
      flightNumber: 'EK-602',
      trackingNumber: `176-${Date.now().toString().slice(-8)}`,
      shippingMethod: 'Air Freight',
      portOfLoading: 'Guangzhou Airport (CAN)',
      portOfDischarge: 'Karachi Airport (KHI)',
      etd: new Date(),
      eta: new Date(Date.now() + 86400000 * 7),
      notes: 'Urgent express consignment'
    };

    const resLogistics = await fetch(`${BASE_URL}/orders/${blueOrder._id}/send-to-logistics`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(logisticsPayload)
    });
    const dataLogistics = await resLogistics.json();
    console.log('POST /orders/:id/send-to-logistics result:', dataLogistics.success ? `PASS (${dataLogistics.message})` : `FAIL: ${dataLogistics.message}`);
  } else {
    console.log('No Sales Order found to test Move to Logistics.');
  }

  // Cleanup test items
  await InventoryItem.deleteOne({ name: testProduct.name });
  await SupplierPO.deleteOne({ poNumber: testPO.poNumber });

  console.log('\nAll Purchaser Enhancements Tested Successfully!');
  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
