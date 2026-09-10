const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Deal = require('../models/Deal');
const SalesTarget = require('../models/SalesTarget');

async function syncCleanFunnel() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas...');

    const farhan = await User.findOne({ email: 'farhan@gmail.com' });
    const kaleem = await User.findOne({ email: 'kaleem@gmail.com' });

    if (!farhan || !kaleem) {
      console.error('Farhan or Kaleem not found in database!');
      process.exit(1);
    }

    console.log(`Farhan ID: ${farhan._id}, Kaleem ID: ${kaleem._id}`);

    // Clear out legacy test/dummy collections
    await Quotation.deleteMany({});
    await CustomerPO.deleteMany({});
    await ProductFile.deleteMany({});
    await SalesOrder.deleteMany({});
    await DeliveryNote.deleteMany({});
    await Invoice.deleteMany({});
    await Payment.deleteMany({});
    await Lead.deleteMany({});
    await Deal.deleteMany({});
    await SalesTarget.deleteMany({});

    console.log('Cleared existing business collections.');

    // Create Active Monthly Targets
    await SalesTarget.create({
      employee: farhan._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 1500000,
      achievedAmount: 8700000,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Q3 Enterprise Expansion Quota'
    });

    await SalesTarget.create({
      employee: kaleem._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 1000000,
      achievedAmount: 1800000,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Q3 Regional Sales Quota'
    });

    // ==========================================
    // CASE 1: Alpha Tech Enterprises (Farhan)
    // ==========================================
    const leadAlpha = await Lead.create({
      name: 'Alpha Tech Enterprises',
      company: 'Alpha Tech Enterprises (Pvt) Ltd',
      contactPerson: 'Zubair Ahmed',
      email: 'zubair@alphatech.pk',
      phone: '+92 300 8472911',
      status: 'Converted',
      value: 5500000,
      source: 'Direct',
      requirements: 'Enterprise High-Performance Server Cluster & Cloud Storage Rack',
      notes: 'Strategic account, delivery completed.',
      assignedTo: farhan._id,
      createdBy: farhan._id
    });

    const dealAlpha = await Deal.create({
      title: 'Alpha Tech Enterprises Server Cluster',
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      value: 5500000,
      stage: 'Won',
      leadId: leadAlpha._id,
      assignedTo: farhan._id,
      createdBy: farhan._id
    });

    const quoAlpha = await Quotation.create({
      quotationNumber: 'QUO-2026-001',
      orderReference: 'QUO-2026-001',
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      salePerson: 'Farhan',
      fileNo: 'PF-2026-001',
      fileType: 'Blue',
      productSummary: 'Enterprise Cloud Infrastructure Servers & Storage',
      clientEmail: 'zubair@alphatech.pk',
      clientPhone: '+92 300 8472911',
      totalAmount: 5500000,
      netAmount: 5500000,
      status: 'Accepted',
      validUntil: new Date('2026-12-31'),
      items: [{ description: 'Enterprise Server Rack & Node Cluster - Dual Xeon, 512GB ECC RAM', quantity: 2, unitPrice: 2750000, total: 5500000 }],
      dealId: dealAlpha._id,
      leadId: leadAlpha._id,
      createdBy: farhan._id
    });

    const poAlpha = await CustomerPO.create({
      poNumber: 'PO-ALPHA-9921',
      poDate: new Date('2026-03-01'),
      customerName: 'Alpha Tech Enterprises (Pvt) Ltd',
      quotationId: quoAlpha._id,
      quotationNumber: 'QUO-2026-001',
      amount: 5500000,
      status: 'Received',
      createdBy: farhan._id
    });

    const pfAlpha = await ProductFile.create({
      fileNumber: 'PF-2026-001',
      fileType: 'Blue',
      customerName: 'Alpha Tech Enterprises (Pvt) Ltd',
      quotationId: quoAlpha._id,
      quotationNumber: 'QUO-2026-001',
      customerPOId: poAlpha._id,
      customerPONumber: 'PO-ALPHA-9921',
      status: 'Active',
      products: [{ name: 'Enterprise Server Rack & Node Cluster', quantity: 2, unit: 'Sets', description: 'Dual Xeon, 512GB ECC RAM' }],
      createdBy: farhan._id
    });

    const soAlpha = await SalesOrder.create({
      orderNo: 'SO-2026-001',
      orderReference: 'SO-2026-001',
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      clientEmail: 'zubair@alphatech.pk',
      clientPhone: '+92 300 8472911',
      salesPerson: farhan._id,
      salesPersonName: 'Farhan',
      fileNo: 'PF-2026-001',
      fileColor: 'Blue',
      fileNumber: 'PF-2026-001',
      customerPORef: 'PO-ALPHA-9921',
      quotationRef: 'QUO-2026-001',
      orderDate: new Date('2026-09-02'),
      deliveryDate: new Date('2026-09-05'),
      paymentTerms: '100% On Delivery',
      deliveryTerms: 'Ex-Factory / Delivered',
      netAmount: 5500000,
      currency: 'PKR',
      status: 'Delivered',
      stockStatus: 'In Stock',
      items: [{ product: 'Enterprise Server Rack Cluster', description: 'Dual Xeon, 512GB ECC RAM', quantity: 2, unitPrice: 2750000, total: 5500000 }],
      createdBy: farhan._id
    });

    const dnAlpha = await DeliveryNote.create({
      deliveryNumber: 'DN-2026-001',
      deliveryNoteNumber: 'DN-2026-001',
      salesOrder: soAlpha._id,
      salesOrderNumber: 'SO-2026-001',
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      deliveryDate: new Date('2026-09-05'),
      status: 'Delivered',
      items: [{ product: 'Enterprise Server Rack Cluster', description: 'Dual Xeon, 512GB ECC RAM', quantity: 2, demand: 2, availability: 'Available' }],
      carrier: 'Private Logistics LEA-4891',
      recipientName: 'Muhammad Tariq',
      createdBy: farhan._id
    });

    const invAlpha = await Invoice.create({
      invoiceNumber: 'INV-2026-001',
      clientName: 'Alpha Tech Enterprises (Pvt) Ltd',
      customerEmail: 'zubair@alphatech.pk',
      customerPhone: '+92 300 8472911',
      saleReference: 'SO-2026-001',
      salesOrderId: soAlpha._id,
      salesOrderNumber: 'SO-2026-001',
      deliveryNoteId: dnAlpha._id,
      deliveryNoteNumber: 'DN-2026-001',
      fileNumber: 'PF-2026-001',
      fileType: 'Blue',
      amount: 5500000,
      subtotal: 5500000,
      paidAmount: 5500000,
      outstandingAmount: 0,
      status: 'Paid',
      issueDate: new Date('2026-09-05'),
      dueDate: new Date('2026-09-20'),
      items: [{ description: 'Enterprise Server Rack & Node Cluster', quantity: 2, unitPrice: 2750000, total: 5500000 }],
      createdBy: farhan._id
    });

    const payAlpha = await Payment.create({
      paymentRefNumber: 'PAY-2026-001',
      customerName: 'Alpha Tech Enterprises (Pvt) Ltd',
      salesOrderId: soAlpha._id,
      salesOrderNumber: 'SO-2026-001',
      invoiceId: invAlpha._id,
      invoiceNumber: 'INV-2026-001',
      amount: 5500000,
      paymentDate: new Date('2026-09-06'),
      paymentType: 'Full',
      paymentMethod: 'Bank Transfer',
      notes: 'Full payment received via Meezan Bank transfer.',
      createdBy: farhan._id
    });

    // ==========================================
    // CASE 2: Apex Global Solutions (Farhan)
    // ==========================================
    const leadApex = await Lead.create({
      name: 'Apex Global Solutions',
      company: 'Apex Global Solutions',
      contactPerson: 'Kamran Siddiqui',
      email: 'kamran@apexgs.com',
      phone: '+92 321 4455667',
      status: 'Converted',
      value: 3200000,
      source: 'Website',
      requirements: 'Enterprise Managed Core Routing & Firewall Security Modules',
      notes: 'Quotation approved, delivery in progress.',
      assignedTo: farhan._id,
      createdBy: farhan._id
    });

    const dealApex = await Deal.create({
      title: 'Apex Global Routing & Security',
      clientName: 'Apex Global Solutions',
      value: 3200000,
      stage: 'Won',
      leadId: leadApex._id,
      assignedTo: farhan._id,
      createdBy: farhan._id
    });

    const quoApex = await Quotation.create({
      quotationNumber: 'QUO-2026-002',
      orderReference: 'QUO-2026-002',
      clientName: 'Apex Global Solutions',
      salePerson: 'Farhan',
      fileNo: 'PF-2026-002',
      fileType: 'Green',
      productSummary: 'Managed Core Routing & Firewall Security Modules',
      clientEmail: 'kamran@apexgs.com',
      clientPhone: '+92 321 4455667',
      totalAmount: 3200000,
      netAmount: 3200000,
      status: 'Accepted',
      validUntil: new Date('2026-12-31'),
      items: [{ description: 'NextGen Firewall & High-Throughput Core Switch 48 Port PoE+', quantity: 4, unitPrice: 800000, total: 3200000 }],
      dealId: dealApex._id,
      leadId: leadApex._id,
      createdBy: farhan._id
    });

    const poApex = await CustomerPO.create({
      poNumber: 'PO-APEX-8412',
      poDate: new Date('2026-09-03'),
      customerName: 'Apex Global Solutions',
      quotationId: quoApex._id,
      quotationNumber: 'QUO-2026-002',
      amount: 3200000,
      status: 'Received',
      createdBy: farhan._id
    });

    const pfApex = await ProductFile.create({
      fileNumber: 'PF-2026-002',
      fileType: 'Green',
      customerName: 'Apex Global Solutions',
      quotationId: quoApex._id,
      quotationNumber: 'QUO-2026-002',
      customerPOId: poApex._id,
      customerPONumber: 'PO-APEX-8412',
      status: 'Active',
      products: [{ name: 'NextGen Firewall & Core Switch Units', quantity: 4, unit: 'Units', description: '48 Port PoE+ with redundant PSU' }],
      createdBy: farhan._id
    });

    const soApex = await SalesOrder.create({
      orderNo: 'SO-2026-002',
      orderReference: 'SO-2026-002',
      clientName: 'Apex Global Solutions',
      clientEmail: 'kamran@apexgs.com',
      clientPhone: '+92 321 4455667',
      salesPerson: farhan._id,
      salesPersonName: 'Farhan',
      fileNo: 'PF-2026-002',
      fileColor: 'Green',
      fileNumber: 'PF-2026-002',
      customerPORef: 'PO-APEX-8412',
      quotationRef: 'QUO-2026-002',
      orderDate: new Date('2026-09-04'),
      deliveryDate: new Date('2026-09-18'),
      paymentTerms: '50% Advance, 50% on Delivery',
      deliveryTerms: 'Doorstep Courier Dispatch',
      netAmount: 3200000,
      currency: 'PKR',
      status: 'Processing',
      stockStatus: 'In Stock',
      items: [{ product: 'NextGen Firewall & Core Switch Units', description: '48 Port PoE+ with redundant PSU', quantity: 4, unitPrice: 800000, total: 3200000 }],
      createdBy: farhan._id
    });

    const dnApex = await DeliveryNote.create({
      deliveryNumber: 'DN-2026-002',
      deliveryNoteNumber: 'DN-2026-002',
      salesOrder: soApex._id,
      salesOrderNumber: 'SO-2026-002',
      clientName: 'Apex Global Solutions',
      deliveryDate: new Date('2026-09-15'),
      status: 'In Transit',
      items: [{ product: 'NextGen Firewall & Core Switch Units', description: '48 Port PoE+ with redundant PSU', quantity: 4, demand: 4, availability: 'Available' }],
      carrier: 'TCS Logistics LHR-3021',
      recipientName: 'Rashid Mahmood',
      createdBy: farhan._id
    });

    // Due date set to Sept 30, 2026 (Active Current Receivable, NOT overdue)
    const invApex = await Invoice.create({
      invoiceNumber: 'INV-2026-002',
      clientName: 'Apex Global Solutions',
      customerEmail: 'kamran@apexgs.com',
      customerPhone: '+92 321 4455667',
      saleReference: 'SO-2026-002',
      salesOrderId: soApex._id,
      salesOrderNumber: 'SO-2026-002',
      deliveryNoteId: dnApex._id,
      deliveryNoteNumber: 'DN-2026-002',
      fileNumber: 'PF-2026-002',
      fileType: 'Green',
      amount: 3200000,
      subtotal: 3200000,
      paidAmount: 1600000,
      outstandingAmount: 1600000,
      status: 'Partially Paid',
      issueDate: new Date('2026-09-06'),
      dueDate: new Date('2026-09-30'),
      items: [{ description: 'NextGen Firewall & Core Switch Units', quantity: 4, unitPrice: 800000, total: 3200000 }],
      createdBy: farhan._id
    });

    const payApex = await Payment.create({
      paymentRefNumber: 'PAY-2026-002',
      customerName: 'Apex Global Solutions',
      salesOrderId: soApex._id,
      salesOrderNumber: 'SO-2026-002',
      invoiceId: invApex._id,
      invoiceNumber: 'INV-2026-002',
      amount: 1600000,
      paymentDate: new Date('2026-09-07'),
      paymentType: 'Partial',
      paymentMethod: 'Online',
      notes: '50% advance payment received.',
      createdBy: farhan._id
    });

    // ==========================================
    // CASE 3: Crestline Logistics (Kaleem)
    // ==========================================
    const leadCrest = await Lead.create({
      name: 'Crestline Logistics',
      company: 'Crestline Logistics',
      contactPerson: 'Haris Munir',
      email: 'haris@crestlinelog.com',
      phone: '+92 333 9811234',
      status: 'Converted',
      value: 1800000,
      source: 'Referral',
      requirements: 'Heavy Fleet Telematics & GPS Tracking Gateway Hardware',
      notes: 'Quotation accepted, order confirmed.',
      assignedTo: kaleem._id,
      createdBy: kaleem._id
    });

    const dealCrest = await Deal.create({
      title: 'Crestline Logistics GPS Units',
      clientName: 'Crestline Logistics',
      value: 1800000,
      stage: 'Won',
      leadId: leadCrest._id,
      assignedTo: kaleem._id,
      createdBy: kaleem._id
    });

    const quoCrest = await Quotation.create({
      quotationNumber: 'QUO-2026-003',
      orderReference: 'QUO-2026-003',
      clientName: 'Crestline Logistics',
      salePerson: 'Kaleem',
      fileNo: 'PF-2026-003',
      fileType: 'Blue',
      productSummary: 'Fleet Telematics & GPS Gateway Modules',
      clientEmail: 'haris@crestlinelog.com',
      clientPhone: '+92 333 9811234',
      totalAmount: 1800000,
      netAmount: 1800000,
      status: 'Accepted',
      validUntil: new Date('2026-12-31'),
      items: [{ description: 'Telematics Tracking Terminal GPS V4 - Industrial OBD-II CANBus', quantity: 20, unitPrice: 90000, total: 1800000 }],
      dealId: dealCrest._id,
      leadId: leadCrest._id,
      createdBy: kaleem._id
    });

    const poCrest = await CustomerPO.create({
      poNumber: 'PO-CREST-4109',
      poDate: new Date('2026-09-04'),
      customerName: 'Crestline Logistics',
      quotationId: quoCrest._id,
      quotationNumber: 'QUO-2026-003',
      amount: 1800000,
      status: 'Received',
      createdBy: kaleem._id
    });

    const pfCrest = await ProductFile.create({
      fileNumber: 'PF-2026-003',
      fileType: 'Blue',
      customerName: 'Crestline Logistics',
      quotationId: quoCrest._id,
      quotationNumber: 'QUO-2026-003',
      customerPOId: poCrest._id,
      customerPONumber: 'PO-CREST-4109',
      status: 'Active',
      products: [{ name: 'Telematics Tracking Terminal GPS V4', quantity: 20, unit: 'Units', description: 'Industrial OBD-II CANBus Telematics' }],
      createdBy: kaleem._id
    });

    const soCrest = await SalesOrder.create({
      orderNo: 'SO-2026-003',
      orderReference: 'SO-2026-003',
      clientName: 'Crestline Logistics',
      clientEmail: 'haris@crestlinelog.com',
      clientPhone: '+92 333 9811234',
      salesPerson: kaleem._id,
      salesPersonName: 'Kaleem',
      fileNo: 'PF-2026-003',
      fileColor: 'Blue',
      fileNumber: 'PF-2026-003',
      customerPORef: 'PO-CREST-4109',
      quotationRef: 'QUO-2026-003',
      orderDate: new Date('2026-09-05'),
      deliveryDate: new Date('2026-09-22'),
      paymentTerms: '30 Days Credit',
      deliveryTerms: 'Surface Cargo Delivery',
      netAmount: 1800000,
      currency: 'PKR',
      status: 'Confirmed',
      stockStatus: 'In Stock',
      items: [{ product: 'Telematics Tracking Terminal GPS V4', description: 'Industrial OBD-II and CANBus Telematics', quantity: 20, unitPrice: 90000, total: 1800000 }],
      createdBy: kaleem._id
    });

    const dnCrest = await DeliveryNote.create({
      deliveryNumber: 'DN-2026-003',
      deliveryNoteNumber: 'DN-2026-003',
      salesOrder: soCrest._id,
      salesOrderNumber: 'SO-2026-003',
      clientName: 'Crestline Logistics',
      deliveryDate: new Date('2026-09-19'),
      status: 'Ready',
      items: [{ product: 'Telematics Tracking Terminal GPS V4', description: 'Industrial OBD-II and CANBus Telematics', quantity: 20, demand: 20, availability: 'Available' }],
      carrier: 'Leopard Courier KHI-9988',
      recipientName: 'Bilal Aslam',
      createdBy: kaleem._id
    });

    // Due date set to Oct 10, 2026 (Active Current Receivable, NOT overdue)
    const invCrest = await Invoice.create({
      invoiceNumber: 'INV-2026-003',
      clientName: 'Crestline Logistics',
      customerEmail: 'haris@crestlinelog.com',
      customerPhone: '+92 333 9811234',
      saleReference: 'SO-2026-003',
      salesOrderId: soCrest._id,
      salesOrderNumber: 'SO-2026-003',
      deliveryNoteId: dnCrest._id,
      deliveryNoteNumber: 'DN-2026-003',
      fileNumber: 'PF-2026-003',
      fileType: 'Blue',
      amount: 1800000,
      subtotal: 1800000,
      paidAmount: 0,
      outstandingAmount: 1800000,
      status: 'Sent',
      issueDate: new Date('2026-09-07'),
      dueDate: new Date('2026-10-10'),
      items: [{ description: 'Telematics Tracking Terminal GPS V4', quantity: 20, unitPrice: 90000, total: 1800000 }],
      createdBy: kaleem._id
    });

    // ==========================================
    // 4. Create Active Prospecting Funnel Leads
    // (Ensures Leads >= Quotations >= Orders)
    // ==========================================

    // Farhan Additional Leads (Total Leads = 6, Quotations = 2, Orders = 2)
    const farhanAdditionalLeads = [
      {
        name: 'TechCorp Pakistan',
        company: 'TechCorp Solutions (Pvt) Ltd',
        contactPerson: 'Sohail Tanveer',
        email: 'sohail@techcorp.pk',
        phone: '+92 300 5551122',
        status: 'Qualified',
        value: 1400000,
        source: 'Website',
        requirements: 'Fiber Optic Switches & SFP Transceivers',
        notes: 'Requested product catalog, ready for quote discussion.',
        assignedTo: farhan._id,
        createdBy: farhan._id
      },
      {
        name: 'Horizon Media Group',
        company: 'Horizon Media (Pvt) Ltd',
        contactPerson: 'Nadia Qureshi',
        email: 'nadia@horizonmedia.com',
        phone: '+92 322 7788990',
        status: 'Contacted',
        value: 950000,
        source: 'LinkedIn',
        requirements: 'High-speed SAN Storage Modules for Video Editing Workstations',
        notes: 'Introductory demo completed.',
        assignedTo: farhan._id,
        createdBy: farhan._id
      },
      {
        name: 'National Engineering Works',
        company: 'National Engineering Works',
        contactPerson: 'Engr. Junaid Babar',
        email: 'j.babar@nationaleng.com.pk',
        phone: '+92 345 1122334',
        status: 'New',
        value: 2200000,
        source: 'Direct',
        requirements: 'Plant SCADA System Backup Servers & Industrial UPS',
        notes: 'Inquiry received via direct sales visit.',
        assignedTo: farhan._id,
        createdBy: farhan._id
      },
      {
        name: 'Premier Retail Solutions',
        company: 'Premier Retail Chain',
        contactPerson: 'Aamir Shehzad',
        email: 'aamir@premierretail.pk',
        phone: '+92 334 9900112',
        status: 'Interested',
        value: 650000,
        source: 'Referral',
        requirements: 'POS Terminals & Thermal Barcode Scanners for 10 Outlets',
        notes: 'Waiting for branch opening schedule.',
        assignedTo: farhan._id,
        createdBy: farhan._id
      }
    ];

    for (const leadData of farhanAdditionalLeads) {
      await Lead.create(leadData);
    }

    // Kaleem Additional Leads (Total Leads = 5, Quotations = 1, Orders = 1)
    const kaleemAdditionalLeads = [
      {
        name: 'Matrix Global Corp',
        company: 'Matrix Global Technologies',
        contactPerson: 'Faizan Sheikh',
        email: 'faizan@matrixglobal.pk',
        phone: '+92 312 6677889',
        status: 'Qualified',
        value: 1200000,
        source: 'Website',
        requirements: 'VoIP PBX Phone Systems and IP Phones for 50 Users',
        notes: 'Needs quotation in next 48 hours.',
        assignedTo: kaleem._id,
        createdBy: kaleem._id
      },
      {
        name: 'BlueSky Telecom',
        company: 'BlueSky Telecom Solutions',
        contactPerson: 'Hassan Raza',
        email: 'hassan@blueskytelecom.pk',
        phone: '+92 301 2233445',
        status: 'Contacted',
        value: 850000,
        source: 'Cold Outreach',
        requirements: 'Outdoor Wireless PTP Bridges & Antennas',
        notes: 'Initial meeting held, follow up next Tuesday.',
        assignedTo: kaleem._id,
        createdBy: kaleem._id
      },
      {
        name: 'Indus Energy Systems',
        company: 'Indus Solar & Energy Ltd',
        contactPerson: 'Omer Farooq',
        email: 'omer@indusenergy.com.pk',
        phone: '+92 336 8899001',
        status: 'New',
        value: 1500000,
        source: 'Trade Show',
        requirements: 'Remote Solar Inverter Data Loggers and Cloud Gateways',
        notes: 'Met at ITCN Asia expo.',
        assignedTo: kaleem._id,
        createdBy: kaleem._id
      },
      {
        name: 'Summit Financial Tech',
        company: 'Summit FinTech Services',
        contactPerson: 'Saad Ur Rehman',
        email: 'saad@summitfin.pk',
        phone: '+92 321 9900887',
        status: 'Interested',
        value: 400000,
        source: 'Referral',
        requirements: 'Branch Router Failover LTE Modems',
        notes: 'Requested hardware specifications.',
        assignedTo: kaleem._id,
        createdBy: kaleem._id
      }
    ];

    for (const leadData of kaleemAdditionalLeads) {
      await Lead.create(leadData);
    }

    console.log('✅ Successfully synced and cleaned database with genuine funnel data and active targets!');
    process.exit(0);
  } catch (err) {
    console.error('Error during syncCleanFunnel:', err);
    process.exit(1);
  }
}

syncCleanFunnel();
