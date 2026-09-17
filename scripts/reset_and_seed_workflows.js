const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Lead = require('../models/Lead');
const Deal = require('../models/Deal');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const Shipment = require('../models/Shipment');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const InventoryItem = require('../models/InventoryItem');
const SalesActivity = require('../models/SalesActivity');
const Notification = require('../models/Notification');
const FollowUp = require('../models/FollowUp');
const ProformaInvoice = require('../models/ProformaInvoice');

async function runResetAndSeed() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fortline_crm';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully.');

  // 1. Clean out previous transactional dummy data
  console.log('Clearing old dummy transactional records...');
  await Promise.all([
    Lead.deleteMany({}),
    Deal.deleteMany({}),
    Quotation.deleteMany({}),
    CustomerPO.deleteMany({}),
    ProductFile.deleteMany({}),
    SalesOrder.deleteMany({}),
    Shipment.deleteMany({}),
    DeliveryNote.deleteMany({}),
    Invoice.deleteMany({}),
    Payment.deleteMany({}),
    InventoryItem.deleteMany({}),
    SalesActivity.deleteMany({}),
    Notification.deleteMany({}),
    FollowUp.deleteMany({}),
    ProformaInvoice.deleteMany({})
  ]);
  console.log('Old dummy data cleared.');

  // 2. Resolve users
  let admin = await User.findOne({ role: 'admin' });
  let salesRep = await User.findOne({ email: 'tariq.rep@fortline.net' }) || await User.findOne({ role: { $in: ['sales_rep', 'sales_member', 'sales_person'] } });
  let salesPerson = await User.findOne({ email: 'zain.sales@fortline.net' }) || await User.findOne({ role: 'sales_person' });
  let logisticsUser = await User.findOne({ role: 'logistics' }) || await User.findOne({ department: /logistic/i });
  let financeUser = await User.findOne({ role: 'finance' }) || await User.findOne({ department: /finance/i });

  if (!salesRep) {
    salesRep = await User.create({
      fullName: 'Tariq Mahmood',
      email: 'tariq.rep@fortline.net',
      password: 'Password123!',
      role: 'sales_rep',
      position: 'Sales Representative',
      department: 'Sales',
      phone: '+92 301 9876543',
      status: 'active',
      isApproved: true
    });
  }

  if (!salesPerson) {
    salesPerson = await User.create({
      fullName: 'Zain Malik',
      email: 'zain.sales@fortline.net',
      password: 'Password123!',
      role: 'sales_person',
      position: 'Sales Person',
      department: 'Sales',
      phone: '+92 302 1234567',
      status: 'active',
      isApproved: true
    });
  }

  if (!logisticsUser) {
    logisticsUser = await User.create({
      fullName: 'Owais Khan',
      email: 'owais.logistics@fortline.net',
      password: 'Password123!',
      role: 'logistics',
      position: 'Logistics Lead',
      department: 'Logistics',
      phone: '+92 305 5551234',
      status: 'active',
      isApproved: true
    });
  }

  console.log('Using Users:', {
    salesRep: salesRep.fullName,
    salesPerson: salesPerson.fullName,
    logisticsUser: logisticsUser?.fullName
  });

  // 3. Create Warehouse Inventory Items
  const inv1 = await InventoryItem.create({
    name: 'Industrial Temperature Sensor PT-100',
    sku: 'SN-PT100-IND',
    category: 'Sensors',
    unit: 'Units',
    quantityOnHand: 45,
    minStockLevel: 10,
    unitPrice: 42500,
    location: 'Warehouse Rack A-04',
    description: 'High precision industrial RTD temperature transmitter sensor',
    status: 'In Stock'
  });

  const inv2 = await InventoryItem.create({
    name: 'High-Pressure Pneumatic Control Valve 2"',
    sku: 'VLV-HP-2INCH',
    category: 'Valves',
    unit: 'Sets',
    quantityOnHand: 12,
    minStockLevel: 5,
    unitPrice: 245000,
    location: 'Warehouse Bay C-02',
    description: 'Flanged ANSI 300# stainless steel pneumatic globe valve',
    status: 'In Stock'
  });

  // =========================================================================
  // WORKFLOW 1: GREEN FILE (LOCAL ORDER WORKFLOW)
  // Lead -> Deal -> Quotation -> Customer PO -> Product File -> Sales Order (Green)
  // -> Local Supplier PO -> Support (BL & Inventory) -> Delivery Note -> Accounts Invoice -> Finance Finalized & Payment
  // =========================================================================
  console.log('\n--- Creating Workflow 1 (Green File: Local Order) ---');

  const lead1 = await Lead.create({
    name: 'Engro Polymer & Chemicals Ltd',
    company: 'Engro Polymer & Chemicals Ltd',
    contactPerson: 'Muhammad Rashid (Procurement Manager)',
    email: 'procurement@engropolymer.com',
    phone: '+92 21 35297500',
    requirements: 'Procurement of 20 units Industrial Temperature Sensors for Port Qasim plant revamp.',
    source: 'Direct Inquiry',
    status: 'Converted to Deal',
    value: 850000,
    notes: 'Urgent replacement requirement for plant maintenance cycle.',
    assignedTo: salesRep._id,
    createdBy: salesRep._id
  });

  const deal1 = await Deal.create({
    title: 'Engro Polymer - 20x Temperature Sensors',
    clientName: 'Engro Polymer & Chemicals Ltd',
    company: 'Engro Polymer & Chemicals Ltd',
    contactPerson: 'Muhammad Rashid (Procurement Manager)',
    contactEmail: 'procurement@engropolymer.com',
    contactPhone: '+92 21 35297500',
    requirements: '20 units PT-100 RTD Temperature Sensors 4-20mA Output, 1/2" NPT, 150mm probe length',
    value: 850000,
    stage: 'Closed Won',
    probability: 100,
    leadId: lead1._id,
    assignedTo: salesRep._id,
    createdBy: salesRep._id,
    closingDate: new Date()
  });

  const quotation1 = await Quotation.create({
    quotationNumber: 'QT-2026-001',
    orderReference: 'QT-2026-001',
    leadId: lead1._id,
    dealId: deal1._id,
    clientName: 'Engro Polymer & Chemicals Ltd',
    clientEmail: 'procurement@engropolymer.com',
    clientPhone: '+92 21 35297500',
    clientAddress: '12th Floor, Ocean Tower, Clifton, Karachi, Pakistan',
    salePerson: salesRep.fullName,
    fileType: 'Green',
    items: [
      {
        description: 'Industrial Temperature Sensor PT-100 (4-20mA Output, 150mm probe length)',
        quantity: 20,
        unitPrice: 42500,
        total: 850000
      }
    ],
    totalAmount: 850000,
    netAmount: 850000,
    status: 'Converted to Customer PO',
    convertedAt: new Date(),
    createdBy: salesRep._id
  });

  const customerPo1 = await CustomerPO.create({
    poNumber: 'CPO-ENG-9011',
    customerName: 'Engro Polymer & Chemicals Ltd',
    quotationId: quotation1._id,
    quotationNumber: 'QT-2026-001',
    amount: 850000,
    notes: 'Approved PO for 20 units PT-100 sensors. Delivery to Port Qasim.',
    status: 'Processed',
    createdBy: salesRep._id
  });

  const productFile1 = await ProductFile.create({
    fileNumber: 'PF-2026-001',
    fileType: 'Green',
    customerName: 'Engro Polymer & Chemicals Ltd',
    quotationId: quotation1._id,
    quotationNumber: 'QT-2026-001',
    customerPOId: customerPo1._id,
    customerPONumber: 'CPO-ENG-9011',
    products: [
      {
        name: 'Industrial Temperature Sensor PT-100',
        quantity: 20,
        unit: 'Units',
        description: 'PT-100 RTD 4-20mA Output, 150mm probe'
      }
    ],
    status: 'Completed',
    notes: 'Green File - Local vendor procurement & warehouse delivery.',
    createdBy: salesRep._id
  });

  const salesOrder1 = await SalesOrder.create({
    orderNumber: 'SO-2026-001',
    orderReference: 'SO-2026-001',
    clientName: 'Engro Polymer & Chemicals Ltd',
    clientEmail: 'procurement@engropolymer.com',
    clientPhone: '+92 21 35297500',
    clientAddress: 'Engro Plant, Port Qasim Industrial Zone, Karachi',
    salePerson: salesRep.fullName,
    fileType: 'Green',
    items: [
      {
        description: 'Industrial Temperature Sensor PT-100 (4-20mA Output, 150mm probe length)',
        quantity: 20,
        unitPrice: 42500,
        total: 850000
      }
    ],
    totalAmount: 850000,
    netAmount: 850000,
    status: 'Completed',
    workflowStatus: 'Completed',
    departmentResponsible: 'Finance',
    quotationId: quotation1._id,
    customerPOId: customerPo1._id,
    customerPONumber: 'CPO-ENG-9011',
    productFileId: productFile1._id,
    financeApprovedByName: financeUser?.fullName || 'Finance Manager',
    financeApprovedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    supplierPO: {
      poNumber: 'LPO-100201',
      poType: 'Local',
      supplierName: 'Pak Automation Supplies Lahore',
      supplierCountry: 'Pakistan',
      issueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      status: 'Issued',
      totalAmount: 620000,
      notes: 'Local PO issued for calibrated temperature sensors.'
    },
    blNumber: 'BL-LOC-4412',
    blInput: {
      blNumber: 'BL-LOC-4412',
      blDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      carrier: 'TCS Freight Local',
      enteredByName: 'Support Dept',
      enteredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    },
    deliveryStatus: 'Fully Delivered',
    invoiceStatus: 'Fully Invoiced',
    invoiceNumber: 'INV-2026-001',
    paymentStatus: 'Partially Paid',
    totalPaid: 500000,
    outstandingBalance: 350000,
    workflowHistory: [
      {
        userName: salesRep.fullName,
        department: 'Sales',
        action: 'Sales Order Created (Green File)',
        previousStatus: 'Draft',
        newStatus: 'Pending Finance Approval',
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },
      {
        userName: 'Finance Manager',
        department: 'Finance',
        action: 'Finance Approved',
        previousStatus: 'Pending Finance Approval',
        newStatus: 'Finance Approved',
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },
      {
        userName: 'Support Dept',
        department: 'Support',
        action: 'Delivery Note Confirmed & Stock Deducted',
        previousStatus: 'Sent to Support',
        newStatus: 'Sent to Accounts',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      },
      {
        userName: 'Finance Manager',
        department: 'Finance',
        action: 'GST Invoice Finalized & Advance Payment Received',
        previousStatus: 'Pending Finance Finalization',
        newStatus: 'Completed',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      }
    ],
    createdBy: salesRep._id
  });

  // Link salesOrderId to ProductFile and CustomerPO
  customerPo1.salesOrderId = salesOrder1._id;
  await customerPo1.save();
  productFile1.salesOrderId = salesOrder1._id;
  productFile1.salesOrderNumber = 'SO-2026-001';
  await productFile1.save();

  const deliveryNote1 = await DeliveryNote.create({
    deliveryNumber: 'DN-2026-001',
    deliveryNoteNumber: 'DN-2026-001',
    salesOrder: salesOrder1._id,
    salesOrderNumber: 'SO-2026-001',
    clientName: 'Engro Polymer & Chemicals Ltd',
    clientAddress: 'Port Qasim Plant Site, Karachi',
    clientContact: '+92 21 35297500',
    salesPerson: salesRep._id,
    fileType: 'Green',
    carrier: 'TCS Cargo / Fortline Vehicle 4A',
    deliveryDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    status: 'Done',
    isStockDeducted: true,
    invoiced: true,
    receivedBy: 'Engro Warehouse Receiving Incharge (Rashid Minhas)',
    items: [
      {
        product: 'Industrial Temperature Sensor PT-100',
        description: 'PT-100 RTD 4-20mA Output, 150mm probe length',
        quantity: 20,
        unitPrice: 42500,
        total: 850000
      }
    ],
    createdBy: salesRep._id
  });

  const invoice1 = await Invoice.create({
    invoiceNumber: 'INV-2026-001',
    salesOrderId: salesOrder1._id,
    salesOrderNumber: 'SO-2026-001',
    deliveryNoteId: deliveryNote1._id,
    deliveryNoteNumber: 'DN-2026-001',
    clientName: 'Engro Polymer & Chemicals Ltd',
    customerEmail: 'procurement@engropolymer.com',
    customerAddress: 'Engro Plant, Port Qasim, Karachi',
    items: salesOrder1.items,
    amount: 850000,
    paidAmount: 500000,
    outstandingAmount: 350000,
    status: 'Partially Paid',
    isDraft: false,
    invoiceType: 'GST Invoice',
    departmentResponsible: 'Finance',
    issueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    dueDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    finalizedByName: 'Finance Manager',
    finalizedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    createdBy: admin?._id || salesRep._id
  });

  const payment1 = await Payment.create({
    paymentRefNumber: 'PAY-2026-001',
    invoiceId: invoice1._id,
    invoiceNumber: 'INV-2026-001',
    salesOrderId: salesOrder1._id,
    salesOrderNumber: 'SO-2026-001',
    customerName: 'Engro Polymer & Chemicals Ltd',
    amount: 500000,
    paymentMethod: 'Bank Transfer',
    paymentType: 'Advance',
    paymentDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    status: 'Verified',
    referenceNumber: 'HBL-FT-9948123',
    notes: 'Advance 58.8% bank transfer received into Fortline HBL Corporate Account.',
    receivedBy: financeUser?._id || admin?._id,
    createdBy: financeUser?._id || admin?._id || salesRep._id
  });

  console.log('Green File Workflow Complete:', {
    lead: lead1.name,
    deal: deal1.title,
    quote: quotation1.quotationNumber,
    customerPO: customerPo1.poNumber,
    productFile: productFile1.fileNumber,
    salesOrder: salesOrder1.orderNumber,
    deliveryNote: deliveryNote1.deliveryNumber,
    invoice: invoice1.invoiceNumber,
    payment: payment1.paymentRefNumber
  });

  // =========================================================================
  // WORKFLOW 2: BLUE FILE (INTERNATIONAL ORDER & LOGISTICS WORKFLOW)
  // Lead -> Deal -> Quotation -> Customer PO -> Product File -> Sales Order (Blue)
  // -> International Supplier PO -> Logistics (Shipment Tracking in Transit) -> Support DN -> Accounts Invoice
  // =========================================================================
  console.log('\n--- Creating Workflow 2 (Blue File: International Supply Chain) ---');

  const lead2 = await Lead.create({
    name: 'Fatima Fertilizer Company Ltd',
    company: 'Fatima Fertilizer Company Ltd',
    contactPerson: 'Tariq Javed (Imports Lead)',
    email: 'import.orders@fatima-group.com',
    phone: '+92 42 111 328 462',
    requirements: 'Import of 10x High-Pressure Pneumatic Control Valves 2" ANSI 300# with Smart Positioners.',
    source: 'Direct Tender',
    status: 'Converted to Deal',
    value: 2450000,
    notes: 'International Blue File order required from OEM supplier in Shenzhen, China.',
    assignedTo: salesPerson._id,
    createdBy: salesPerson._id
  });

  const deal2 = await Deal.create({
    title: 'Fatima Fertilizer - 10x Imported Control Valves',
    clientName: 'Fatima Fertilizer Company Ltd',
    company: 'Fatima Fertilizer Company Ltd',
    contactPerson: 'Tariq Javed (Imports Lead)',
    contactEmail: 'import.orders@fatima-group.com',
    contactPhone: '+92 42 111 328 462',
    requirements: '10 Sets High-Pressure Control Valves ANSI 300# CF8M Body, PTFE Seat, 4-20mA HART Positioner',
    value: 2450000,
    stage: 'Closed Won',
    probability: 100,
    leadId: lead2._id,
    assignedTo: salesPerson._id,
    createdBy: salesPerson._id,
    closingDate: new Date()
  });

  const quotation2 = await Quotation.create({
    quotationNumber: 'QT-2026-002',
    orderReference: 'QT-2026-002',
    leadId: lead2._id,
    dealId: deal2._id,
    clientName: 'Fatima Fertilizer Company Ltd',
    clientEmail: 'import.orders@fatima-group.com',
    clientPhone: '+92 42 111 328 462',
    clientAddress: 'Fatima Group Head Office, E-110, Khayaban-e-Jinnah, Lahore Cantt, Pakistan',
    salePerson: salesPerson.fullName,
    fileType: 'Blue',
    items: [
      {
        description: 'High-Pressure Pneumatic Control Valve 2" (ANSI 300# CF8M Body, 4-20mA HART Positioner)',
        quantity: 10,
        unitPrice: 245000,
        total: 2450000
      }
    ],
    totalAmount: 2450000,
    netAmount: 2450000,
    status: 'Converted to Customer PO',
    convertedAt: new Date(),
    createdBy: salesPerson._id
  });

  const customerPo2 = await CustomerPO.create({
    poNumber: 'CPO-FFC-8820',
    customerName: 'Fatima Fertilizer Company Ltd',
    quotationId: quotation2._id,
    quotationNumber: 'QT-2026-002',
    amount: 2450000,
    notes: 'Client PO for 10x Imported Pneumatic Control Valves. Air freight CFR Karachi.',
    status: 'Processed',
    createdBy: salesPerson._id
  });

  const productFile2 = await ProductFile.create({
    fileNumber: 'PF-2026-002',
    fileType: 'Blue',
    customerName: 'Fatima Fertilizer Company Ltd',
    quotationId: quotation2._id,
    quotationNumber: 'QT-2026-002',
    customerPOId: customerPo2._id,
    customerPONumber: 'CPO-FFC-8820',
    products: [
      {
        name: 'High-Pressure Pneumatic Control Valve 2"',
        quantity: 10,
        unit: 'Sets',
        description: 'ANSI 300# CF8M Body with Smart Positioners'
      }
    ],
    status: 'In Progress',
    notes: 'Blue File - International supplier procurement & logistics air freight tracking.',
    createdBy: salesPerson._id
  });

  const salesOrder2 = await SalesOrder.create({
    orderNumber: 'SO-2026-002',
    orderReference: 'SO-2026-002',
    clientName: 'Fatima Fertilizer Company Ltd',
    clientEmail: 'import.orders@fatima-group.com',
    clientPhone: '+92 42 111 328 462',
    clientAddress: 'Fatima Fertilizer Plant Site, Mukhtar Garh, Sadiqabad, Punjab',
    salePerson: salesPerson.fullName,
    fileType: 'Blue',
    items: [
      {
        description: 'High-Pressure Pneumatic Control Valve 2" (ANSI 300# CF8M Body, 4-20mA HART Positioner)',
        quantity: 10,
        unitPrice: 245000,
        total: 2450000
      }
    ],
    totalAmount: 2450000,
    netAmount: 2450000,
    status: 'In Transit',
    workflowStatus: 'Routed to Logistics',
    departmentResponsible: 'Logistics',
    quotationId: quotation2._id,
    customerPOId: customerPo2._id,
    customerPONumber: 'CPO-FFC-8820',
    productFileId: productFile2._id,
    financeApprovedByName: financeUser?.fullName || 'Finance Manager',
    financeApprovedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    supplierPO: {
      poNumber: 'IPO-772901',
      poType: 'International',
      supplierName: 'Shenzhen Global Valve Tech Ltd',
      supplierCountry: 'China',
      issueDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      status: 'Issued',
      totalAmount: 1680000,
      currency: 'PKR',
      notes: 'International PO issued for OEM valve fabrication.'
    },
    deliveryStatus: 'Not Delivered',
    invoiceStatus: 'Fully Invoiced',
    invoiceNumber: 'INV-2026-002',
    paymentStatus: 'Partially Paid',
    totalPaid: 1225000,
    outstandingBalance: 1225000,
    workflowHistory: [
      {
        userName: salesPerson.fullName,
        department: 'Sales',
        action: 'Sales Order Created (Blue File)',
        previousStatus: 'Draft',
        newStatus: 'Pending Finance Approval',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      },
      {
        userName: 'Finance Manager',
        department: 'Finance',
        action: 'Finance Approved (International PO)',
        previousStatus: 'Pending Finance Approval',
        newStatus: 'Finance Approved',
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      },
      {
        userName: 'Logistics Lead',
        department: 'Logistics',
        action: 'Air Shipment Initialized & Dispatched',
        previousStatus: 'PO Issued',
        newStatus: 'In Transit',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        notes: 'Flight PK-853 departing Guangzhou Baiyun Airport, transit via Dubai to Karachi.'
      }
    ],
    createdBy: salesPerson._id
  });

  customerPo2.salesOrderId = salesOrder2._id;
  await customerPo2.save();
  productFile2.salesOrderId = salesOrder2._id;
  productFile2.salesOrderNumber = 'SO-2026-002';
  await productFile2.save();

  const shipment1 = await Shipment.create({
    shipmentId: 'SHP-1001',
    salesOrder: salesOrder2._id,
    salesOrderNumber: 'SO-2026-002',
    salesPerson: salesPerson._id,
    salePerson: salesPerson.fullName,
    clientName: 'Fatima Fertilizer Company Ltd',
    clientEmail: 'import.orders@fatima-group.com',
    clientPhone: '+92 42 111 328 462',
    supplierName: 'Shenzhen Global Valve Tech Ltd',
    supplierCountry: 'China',
    supplierPoNumber: 'IPO-772901',
    supplierPoDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    fileType: 'Blue',
    status: 'In Transit',
    etd: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    eta: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    flightNumber: 'EK-601 / PK-853',
    carrier: 'Emirates SkyCargo',
    shippingMethod: 'Air Freight',
    trackingNumber: 'AWB-176-92837412',
    departureLocation: 'Guangzhou Baiyun Airport (CAN), China',
    arrivalLocation: 'Jinnah International Airport (KHI), Karachi, Pakistan',
    description: '10 Sets High-Pressure Pneumatic Control Valves 2" with Smart Positioners',
    referenceDocs: 'Commercial Invoice CI-772901, Packing List PL-772901, Certificate of Origin CO-CN-2026',
    remarks: 'Air freight in transit. Customs clearing documents pre-filed with Karachi Airport Cargo customs agent.',
    receivedInOffice: false,
    items: [
      {
        description: 'High-Pressure Pneumatic Control Valve 2"',
        quantity: 10,
        unitPrice: 245000,
        total: 2450000
      }
    ],
    trackingHistory: [
      {
        status: 'PO Issued',
        location: 'Shenzhen, China',
        notes: 'International Supplier PO issued and fabrication confirmed.',
        updatedByName: 'Logistics Lead',
        timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      },
      {
        status: 'Booked',
        location: 'Guangzhou Airport',
        notes: 'Air freight space booked on Emirates SkyCargo flight EK-601.',
        updatedByName: 'Logistics Lead',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      },
      {
        status: 'In Transit',
        location: 'Guangzhou -> Karachi',
        notes: 'Dispatched from Guangzhou Airport. In-transit with AWB 176-92837412. ETA Karachi 3 days.',
        updatedByName: 'Logistics Lead',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    ],
    createdBy: logisticsUser._id
  });

  salesOrder2.shipmentId = shipment1._id;
  salesOrder2.shipmentNumber = shipment1.shipmentId;
  await salesOrder2.save();

  const deliveryNote2 = await DeliveryNote.create({
    deliveryNumber: 'DN-2026-002',
    deliveryNoteNumber: 'DN-2026-002',
    salesOrder: salesOrder2._id,
    salesOrderNumber: 'SO-2026-002',
    shipmentId: shipment1._id,
    clientName: 'Fatima Fertilizer Company Ltd',
    clientAddress: 'Fatima Fertilizer Plant Site, Sadiqabad',
    clientContact: '+92 42 111 328 462',
    salesPerson: salesPerson._id,
    fileType: 'Blue',
    carrier: 'Emirates SkyCargo / Logistics Air Freight',
    status: 'Ready',
    isStockDeducted: false,
    invoiced: true,
    items: [
      {
        product: 'High-Pressure Pneumatic Control Valve 2"',
        description: 'ANSI 300# CF8M Body with Smart Positioners',
        quantity: 10,
        unitPrice: 245000,
        total: 2450000
      }
    ],
    createdBy: salesPerson._id
  });

  const invoice2 = await Invoice.create({
    invoiceNumber: 'INV-2026-002',
    salesOrderId: salesOrder2._id,
    salesOrderNumber: 'SO-2026-002',
    deliveryNoteId: deliveryNote2._id,
    deliveryNoteNumber: 'DN-2026-002',
    clientName: 'Fatima Fertilizer Company Ltd',
    customerEmail: 'import.orders@fatima-group.com',
    customerAddress: 'Fatima Group Head Office, Lahore',
    items: salesOrder2.items,
    amount: 2450000,
    paidAmount: 1225000,
    outstandingAmount: 1225000,
    status: 'Partially Paid',
    isDraft: false,
    invoiceType: 'GST Invoice',
    departmentResponsible: 'Finance',
    issueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    dueDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    finalizedByName: 'Finance Manager',
    finalizedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    createdBy: admin?._id || salesPerson._id
  });

  const payment2 = await Payment.create({
    paymentRefNumber: 'PAY-2026-002',
    invoiceId: invoice2._id,
    invoiceNumber: 'INV-2026-002',
    salesOrderId: salesOrder2._id,
    salesOrderNumber: 'SO-2026-002',
    customerName: 'Fatima Fertilizer Company Ltd',
    amount: 1225000,
    paymentMethod: 'Bank Transfer',
    paymentType: 'Advance',
    paymentDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    status: 'Verified',
    referenceNumber: 'MCB-FT-881920',
    notes: '50% advance payment received against Blue File imported valve order.',
    receivedBy: financeUser?._id || admin?._id,
    createdBy: financeUser?._id || admin?._id || salesPerson._id
  });

  // 4. Create Department Notifications
  await Notification.create([
    {
      recipient: salesRep._id,
      title: 'Green File Completed: SO-2026-001',
      message: 'Sales Order SO-2026-001 for Engro Polymer has been delivered, invoiced (INV-2026-001), and partial payment received.',
      type: 'order',
      link: '/employee/sales/orders',
      isRead: false
    },
    {
      recipient: salesPerson._id,
      title: 'Blue File In-Transit: SHP-1001',
      message: 'International shipment SHP-1001 for Fatima Fertilizer is in-transit via Emirates SkyCargo (Flight EK-601).',
      type: 'shipment',
      link: '/employee/sales/orders',
      isRead: false
    },
    {
      recipient: logisticsUser._id,
      title: 'Active Shipment Monitored: SHP-1001',
      message: 'Shipment SHP-1001 (10x Pneumatic Valves) departed Guangzhou Baiyun Airport, ETA Karachi in 3 days.',
      type: 'shipment',
      link: '/logistics/shipments',
      isRead: false
    }
  ]);

  console.log('Blue File Workflow Complete:', {
    lead: lead2.name,
    deal: deal2.title,
    quote: quotation2.quotationNumber,
    customerPO: customerPo2.poNumber,
    productFile: productFile2.fileNumber,
    salesOrder: salesOrder2.orderNumber,
    shipment: shipment1.shipmentId,
    deliveryNote: deliveryNote2.deliveryNumber,
    invoice: invoice2.invoiceNumber,
    payment: payment2.paymentRefNumber
  });

  console.log('\n--- SUCCESS: Database reset and 2 complete workflows created! ---');
  await mongoose.disconnect();
}

runResetAndSeed().catch(err => {
  console.error('Reset & seed script failed:', err);
  process.exit(1);
});
