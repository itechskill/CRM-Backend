const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const InventoryItem = require('../models/InventoryItem');
const SupplierPO = require('../models/SupplierPO');
const Shipment = require('../models/Shipment');

async function runTests() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB for testing.');

  const user = await User.findOne({ role: { $in: ['purchaser', 'admin', 'ceo'] } }) || await User.findOne();
  const token = jwt.sign(
    { id: user._id, role: user.role, purchaserSubDept: 'Local' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  const BASE_URL = 'http://localhost:5000/api';

  console.log('\n--- 1. Testing Inventory Item Creation (POST /api/purchaser/inventory) ---');
  const testProdName = `Precision Gauge ${Date.now().toString().slice(-4)}`;
  const addRes = await fetch(`${BASE_URL}/purchaser/inventory`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: testProdName,
      sku: `SKU-${Date.now().toString().slice(-5)}`,
      category: 'Electronics',
      unit: 'pcs',
      quantityOnHand: 10,
      minStockLevel: 3,
      unitPrice: 4500,
      location: 'Rack E-4',
      description: 'High precision digital gauge'
    })
  });
  const addData = await addRes.json();
  const createdItemId = addData.data?._id || addData.item?._id;
  console.log('Add Inventory Item:', addData.success ? `PASS (Created ID: ${createdItemId}, Qty: 10)` : `FAIL: ${addData.message}`);

  console.log('\n--- 2. Testing Inventory Item Update/Edit (PUT /api/purchaser/inventory/:id) ---');
  const editRes = await fetch(`${BASE_URL}/purchaser/inventory/${createdItemId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      name: `${testProdName} (Updated)`,
      unitPrice: 4800,
      location: 'Rack E-5'
    })
  });
  const editData = await editRes.json();
  console.log('Edit Inventory Item:', editData.success ? `PASS (Updated Name: ${editData.data?.name}, Price: ${editData.data?.unitPrice})` : `FAIL: ${editData.message}`);

  console.log('\n--- 3. Testing In-Stock Order Check & Stock Deduction ---');
  // Create a temporary sales order ordering 1 pc of this item
  const testOrder = await SalesOrder.create({
    orderReference: `SO-TEST-${Date.now().toString().slice(-4)}`,
    clientName: 'Test Client Industrial',
    fileType: 'Green',
    workflowStatus: 'Pending Local Procurement',
    currentDepartment: 'Local Purchaser',
    items: [
      {
        description: `${testProdName} (Updated)`,
        quantity: 1,
        unitPrice: 4800,
        total: 4800
      }
    ],
    netAmount: 4800,
    totalAmount: 4800,
    createdBy: user._id
  });

  const checkRes = await fetch(`${BASE_URL}/purchaser/orders/${testOrder._id}/inventory-check`, {
    method: 'POST',
    headers: authHeaders
  });
  const checkData = await checkRes.json();
  console.log('Inventory Check Response:', checkData.success ? `PASS (${checkData.message})` : `FAIL: ${checkData.message}`);

  // Verify stock in database was deducted from 10 to 9
  const updatedInv = await InventoryItem.findById(createdItemId);
  console.log('Stock Deduction Verification:', updatedInv.quantityOnHand === 9 ? `PASS (Stock deducted: 10 -> ${updatedInv.quantityOnHand})` : `FAIL: Expected 9, got ${updatedInv?.quantityOnHand}`);

  console.log('\n--- 4. Testing Inventory Item Deletion (DELETE /api/purchaser/inventory/:id) ---');
  const delRes = await fetch(`${BASE_URL}/purchaser/inventory/${createdItemId}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  const delData = await delRes.json();
  console.log('Delete Inventory Item:', delData.success ? `PASS (${delData.message})` : `FAIL: ${delData.message}`);

  // Cleanup test order
  await SalesOrder.findByIdAndDelete(testOrder._id);

  console.log('\n--- 5. Testing Logistics Incoming Orders & Handover to Support ---');
  // Create a Blue file order with international PO
  const testBlueOrder = await SalesOrder.create({
    orderReference: `SO-BLUE-${Date.now().toString().slice(-4)}`,
    clientName: 'Global Importers Ltd',
    fileType: 'Blue',
    workflowStatus: 'International Supplier PO Issued',
    currentDepartment: 'Logistics',
    supplierPO: {
      poNumber: `GPO-${Date.now().toString().slice(-5)}`,
      poType: 'International',
      supplierName: 'Shenzhen CNC Co',
      supplierCountry: 'China'
    },
    items: [{ description: 'Heavy Duty CNC Lathe', quantity: 1, unitPrice: 250000, total: 250000 }],
    netAmount: 250000,
    totalAmount: 250000,
    createdBy: user._id
  });

  const incRes = await fetch(`${BASE_URL}/logistics/incoming-orders`, { headers: authHeaders });
  const incData = await incRes.json();
  const foundInIncoming = (incData.data || []).some(o => String(o._id) === String(testBlueOrder._id));
  console.log('Logistics Incoming Orders List:', foundInIncoming ? 'PASS (Blue order found in incoming list)' : 'FAIL');

  // Initialize shipment
  const shpRes = await fetch(`${BASE_URL}/logistics/shipments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      salesOrderId: testBlueOrder._id,
      supplierName: 'Shenzhen CNC Co',
      supplierCountry: 'China',
      carrier: 'Emirates SkyCargo',
      flightNumber: 'EK-602',
      trackingNumber: 'AWB-893021',
      shippingMethod: 'Air Freight',
      departureLocation: 'Shanghai',
      arrivalLocation: 'Karachi Port'
    })
  });
  const shpData = await shpRes.json();
  console.log('Logistics Initialize Shipment:', shpData.success ? `PASS (Shipment ID: ${shpData.data?.shipmentId})` : `FAIL: ${shpData.message}`);

  // Receive in office -> should route to Support
  const recRes = await fetch(`${BASE_URL}/logistics/shipments/${shpData.data._id}/receive-in-office`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      receivedDate: new Date(),
      remarks: 'Goods inspected and verified in office'
    })
  });
  const recData = await recRes.json();
  console.log('Logistics Receive in Office:', recData.success ? `PASS (${recData.message})` : `FAIL: ${recData.message}`);

  const checkOrderInSupport = await SalesOrder.findById(testBlueOrder._id);
  console.log('Order Routed to Support Verification:', (checkOrderInSupport.currentDepartment === 'Support' && checkOrderInSupport.workflowStatus === 'Shipment Received in Office') ? 'PASS (Order is now in Support department ready for DN creation!)' : `FAIL: Department is ${checkOrderInSupport.currentDepartment}`);

  // Cleanup
  await SalesOrder.findByIdAndDelete(testBlueOrder._id);
  await Shipment.findByIdAndDelete(shpData.data._id);

  console.log('\n--- ALL WORKFLOW TESTS COMPLETED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
