const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const { getSalesManagerScope } = require('../utils/salesManagerScope');

async function runTest() {
  console.log('================================================================');
  console.log('       TESTING REGIONAL SALES MANAGER SCOPING & PRIVILEGES      ');
  console.log('================================================================');

  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log('Connected to MongoDB Atlas');

  try {
    // 1. Cleanup any previous test data
    await User.deleteMany({ email: { $in: ['test_mgr_isb@fortline.net', 'test_sales1_isb@fortline.net', 'test_sales2_isb@fortline.net'] } });
    await SalesOrder.deleteMany({ orderNumber: { $in: ['SO-TEST-ISB-001', 'SO-TEST-LHR-001'] } });

    // 2. Fetch CEO and existing Lahore Manager
    const ceo = await User.findOne({ role: 'ceo' });
    const lhrManager = await User.findOne({ email: 'waseembhatti.managerlhr@fortline.net' });
    const lhrSalesPerson = await User.findOne({ email: 'sulemanbhatti.saleslhr@fortline.net' });

    console.log(`CEO loaded: ${ceo?.fullName} (${ceo?.email})`);
    console.log(`LHR Manager loaded: ${lhrManager?.fullName} (${lhrManager?.email}) - Branch: ${lhrManager?.branch}`);
    console.log(`LHR Sales Person loaded: ${lhrSalesPerson?.fullName} (${lhrSalesPerson?.email}) - Manager: ${lhrSalesPerson?.manager}`);

    // 3. Create simulated Islamabad Sales Manager
    const isbManager = await User.create({
      fullName: 'Tariq Mehmood (ISB Manager)',
      email: 'test_mgr_isb@fortline.net',
      password: 'password123',
      role: 'sales_manager',
      department: 'Sales',
      branch: 'Islamabad',
      city: 'Islamabad',
      status: 'active',
      isApproved: true
    });

    // 4. Islamabad Manager creates 2 sales persons
    const isbSales1 = await User.create({
      fullName: 'Hamza Khan (ISB Sales 1)',
      email: 'test_sales1_isb@fortline.net',
      password: 'password123',
      role: 'sales_person',
      position: 'Sales Person',
      department: 'Sales',
      branch: 'Islamabad',
      city: 'Islamabad',
      status: 'active',
      isApproved: true,
      createdBy: isbManager._id,
      manager: isbManager._id
    });

    const isbSales2 = await User.create({
      fullName: 'Usman Ali (ISB Sales 2)',
      email: 'test_sales2_isb@fortline.net',
      password: 'password123',
      role: 'sales_person',
      position: 'Sales Person',
      department: 'Sales',
      branch: 'Islamabad',
      city: 'Islamabad',
      status: 'active',
      isApproved: true,
      createdBy: isbManager._id,
      manager: isbManager._id
    });

    console.log('\n--- Step 1: Verify Scope Helper for ISB Manager ---');
    const isbScope = await getSalesManagerScope(isbManager);
    console.log(`ISB Scope isGlobal: ${isbScope.isGlobal}`);
    console.log(`ISB Managed Members Count: ${isbScope.memberIds.length}`);
    console.log(`ISB Member Names: ${isbScope.memberNames.join(', ')}`);

    const hasIsbSales1 = isbScope.memberIds.some(id => id.toString() === isbSales1._id.toString());
    const hasIsbSales2 = isbScope.memberIds.some(id => id.toString() === isbSales2._id.toString());
    const hasLhrSales = isbScope.memberIds.some(id => id.toString() === lhrSalesPerson._id.toString());

    if (hasIsbSales1 && hasIsbSales2 && !hasLhrSales) {
      console.log('✔ PASS: ISB Manager ONLY scopes to ISB sales persons, LHR sales person excluded!');
    } else {
      throw new Error(`FAIL: ISB Manager scope isolation failed: hasIsb1=${hasIsbSales1}, hasIsb2=${hasIsbSales2}, hasLhr=${hasLhrSales}`);
    }

    console.log('\n--- Step 2: Verify Scope Helper for LHR Manager ---');
    const lhrScope = await getSalesManagerScope(lhrManager);
    console.log(`LHR Scope isGlobal: ${lhrScope.isGlobal}`);
    console.log(`LHR Member Names: ${lhrScope.memberNames.join(', ')}`);

    const lhrHasLhr = lhrScope.memberIds.some(id => id.toString() === lhrSalesPerson._id.toString());
    const lhrHasIsb1 = lhrScope.memberIds.some(id => id.toString() === isbSales1._id.toString());
    const lhrHasIsb2 = lhrScope.memberIds.some(id => id.toString() === isbSales2._id.toString());

    if (lhrHasLhr && !lhrHasIsb1 && !lhrHasIsb2) {
      console.log('✔ PASS: LHR Manager ONLY scopes to LHR sales persons, ISB sales persons excluded!');
    } else {
      throw new Error(`FAIL: LHR Manager scope isolation failed: hasLhr=${lhrHasLhr}, hasIsb1=${lhrHasIsb1}, hasIsb2=${lhrHasIsb2}`);
    }

    console.log('\n--- Step 3: Verify Scope Helper for CEO ---');
    const ceoScope = await getSalesManagerScope(ceo);
    if (ceoScope.isGlobal === true) {
      console.log('✔ PASS: CEO retains isGlobal = true (sees all teams across all branches)!');
    } else {
      throw new Error('FAIL: CEO isGlobal was not true');
    }

    console.log('\n--- Step 4: Verify Sales Orders Regional Isolation ---');
    // Create test order by ISB sales person
    const isbOrder = await SalesOrder.create({
      orderNumber: 'SO-TEST-ISB-001',
      orderReference: 'REF-ISB-001',
      clientName: 'Islamabad Tech Corp',
      customerName: 'Islamabad Tech Corp',
      createdBy: isbSales1._id,
      salesPerson: isbSales1._id,
      salePerson: isbSales1.fullName,
      totalAmount: 150000,
      netAmount: 150000,
      status: 'Sales Order'
    });

    // Create test order by LHR sales person
    const lhrOrder = await SalesOrder.create({
      orderNumber: 'SO-TEST-LHR-001',
      orderReference: 'REF-LHR-001',
      clientName: 'Lahore Manufacturing Ltd',
      customerName: 'Lahore Manufacturing Ltd',
      createdBy: lhrSalesPerson._id,
      salesPerson: lhrSalesPerson._id,
      salePerson: lhrSalesPerson.fullName,
      totalAmount: 250000,
      netAmount: 250000,
      status: 'Sales Order'
    });

    // Simulate query in /all-orders for ISB Manager
    const isbQuery = {
      $or: [
        { createdBy: { $in: isbScope.memberIds } },
        { salesPerson: { $in: isbScope.memberIds } }
      ]
    };
    const isbVisibleOrders = await SalesOrder.find(isbQuery);
    const isbOrderIds = isbVisibleOrders.map(o => o.orderNumber);

    console.log('ISB Visible Orders:', isbOrderIds);
    if (isbOrderIds.includes('SO-TEST-ISB-001') && !isbOrderIds.includes('SO-TEST-LHR-001')) {
      console.log('✔ PASS: ISB Manager only sees Islamabad sales order, Lahore order hidden!');
    } else {
      throw new Error('FAIL: ISB Manager saw orders from other branches');
    }

    // Simulate query in /all-orders for LHR Manager
    const lhrQuery = {
      $or: [
        { createdBy: { $in: lhrScope.memberIds } },
        { salesPerson: { $in: lhrScope.memberIds } }
      ]
    };
    const lhrVisibleOrders = await SalesOrder.find(lhrQuery);
    const lhrOrderIds = lhrVisibleOrders.map(o => o.orderNumber);

    console.log('LHR Visible Orders:', lhrOrderIds);
    if (lhrOrderIds.includes('SO-TEST-LHR-001') && !lhrOrderIds.includes('SO-TEST-ISB-001')) {
      console.log('✔ PASS: LHR Manager only sees Lahore sales order, Islamabad order hidden!');
    } else {
      throw new Error('FAIL: LHR Manager saw orders from other branches');
    }

    // Cleanup test records
    await User.deleteMany({ email: { $in: ['test_mgr_isb@fortline.net', 'test_sales1_isb@fortline.net', 'test_sales2_isb@fortline.net'] } });
    await SalesOrder.deleteMany({ orderNumber: { $in: ['SO-TEST-ISB-001', 'SO-TEST-LHR-001'] } });

    console.log('\n================================================================');
    console.log('  ALL REGIONAL SALES MANAGER SCOPING & PRIVILEGE TESTS PASSED!  ');
    console.log('================================================================\n');
  } finally {
    await mongoose.disconnect();
  }
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
