const fs = require('fs');
const mongoose = require('mongoose');
const { PDFParse } = require('pdf-parse');
require('dotenv').config({ path: __dirname + '/../.env' });

const User = require('../models/User');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const DeliveryNote = require('../models/DeliveryNote');
const Payment = require('../models/Payment');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const ProformaInvoice = require('../models/ProformaInvoice');
const Deal = require('../models/Deal');
const Lead = require('../models/Lead');
const SalesActivity = require('../models/SalesActivity');
const Shipment = require('../models/Shipment');
const PurchaserGRN = require('../models/PurchaserGRN');
const SupplierPO = require('../models/SupplierPO');
const FinancialCharge = require('../models/FinancialCharge');
const MaintenanceCharge = require('../models/MaintenanceCharge');
const LocalPayable = require('../models/LocalPayable');
const EditPermissionRequest = require('../models/EditPermissionRequest');
const EditAuditLog = require('../models/EditAuditLog');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

const p1Path = 'C:/Users/HP/.gemini/antigravity-ide/brain/4fd059f6-8c89-47cd-9fc5-8e6cced8b691/.user_uploaded/media_1790252133169.pdf';
const p2Path = 'C:/Users/HP/.gemini/antigravity-ide/brain/4fd059f6-8c89-47cd-9fc5-8e6cced8b691/.user_uploaded/media_1790252180461.pdf';

async function runImport() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB successfully.');

  // 1. Fetch Users
  const allUsers = await User.find().lean();
  console.log(`Loaded ${allUsers.length} system users.`);

  // Find department & key role users
  const adminUser = allUsers.find(u => u.email === 'admin@yourcompany.com') || allUsers.find(u => u.role === 'admin');
  const ceoUser = allUsers.find(u => u.email === 'ceo@fortline.net') || allUsers.find(u => u.role === 'ceo');
  const financeUser = allUsers.find(u => u.email === 'wajihsiddiqui.finance@fortline.net') || allUsers.find(u => u.role === 'finance');
  const accountsUser = allUsers.find(u => u.email === 'mustafasheikh.accounts@fortline.net') || allUsers.find(u => u.role === 'accountant');
  const supportUser = allUsers.find(u => u.email === 'bilalahmed.support@fortline.net') || allUsers.find(u => u.role === 'support');
  const purchaserGlobal = allUsers.find(u => u.email === 'aryansurani.globalpurchaser@fortline.net');

  // Managers
  const waseemBhattiLhr = allUsers.find(u => u.email === 'waseembhatti.managerlhr@fortline.net');
  const shoaibMehfoozIsb = allUsers.find(u => u.email === 'shoaibmehfooz.managerisb@fortline.net');
  const umairSiddiquiKhi = allUsers.find(u => u.email === 'umairsiddiqui.managerkhi@fortline.net');

  // Ensure branches on managers
  if (shoaibMehfoozIsb && (!shoaibMehfoozIsb.branch || shoaibMehfoozIsb.branch !== 'Islamabad')) {
    await User.updateOne({ _id: shoaibMehfoozIsb._id }, { branch: 'Islamabad' });
    console.log('Updated Shoaib Mehfooz branch to Islamabad.');
  }
  if (umairSiddiquiKhi && (!umairSiddiquiKhi.branch || umairSiddiquiKhi.branch !== 'Karachi')) {
    await User.updateOne({ _id: umairSiddiquiKhi._id }, { branch: 'Karachi' });
    console.log('Updated Umair Siddiqui branch to Karachi.');
  }
  if (waseemBhattiLhr && (!waseemBhattiLhr.branch || waseemBhattiLhr.branch !== 'Lahore')) {
    await User.updateOne({ _id: waseemBhattiLhr._id }, { branch: 'Lahore' });
    console.log('Updated Waseem Bhatti branch to Lahore.');
  }

  // Salespersons
  const sulemanLhr = allUsers.find(u => u.email === 'sulemanbhatti.saleslhr@fortline.net');
  const yasirLatifLhr = allUsers.find(u => u.email === 'yasirlatif.saleslhr@fortline.net');
  const zubairIsb = allUsers.find(u => u.email === 'zubair.salesisb@fortline.net');
  const raeesIsb = allUsers.find(u => u.email === 'raees.salesisb@fortline.net');
  const arishSuraniKhi = allUsers.find(u => u.email === 'arishsuarani.saleskhi@fortline.net');
  const elizbethMirandaKhi = allUsers.find(u => u.email === 'elizbethmiranda.saleskhi@fortline.net');
  const adnanAhmedKhi = allUsers.find(u => u.email === 'adnanahmed.saleskhi@fortline.net');
  const amanSuraniKhi = allUsers.find(u => u.email === 'amansurani.saleskhi@fortline.net');

  // Salesperson mapping dictionary
  const spMap = {
    'Wasim Bhatti LHR': waseemBhattiLhr,
    'Suleman Bhatti LHR': sulemanLhr,
    'Yasir Latif LHR': yasirLatifLhr,
    'Shoaib Mehfooz ISB': shoaibMehfoozIsb,
    'Zubair ISB': zubairIsb,
    'Raees ISB': raeesIsb,
    'Umair Siddiqui': umairSiddiquiKhi,
    'Arish Surani': arishSuraniKhi,
    'Elizabeth Miranda': elizbethMirandaKhi,
    'Adnan Ahmed': adnanAhmedKhi,
    'Aman Surani': amanSuraniKhi,
    'Aryan Surani': purchaserGlobal,
    'Sir Karim': ceoUser,
    'Wajih Siddiqui': financeUser,
    'Karachi Office': umairSiddiquiKhi,
    'Finance approved': financeUser,
    'Talha Ahmed': umairSiddiquiKhi
  };

  function getSalesPersonUser(spString) {
    if (!spString) return adminUser;
    for (const [key, userObj] of Object.entries(spMap)) {
      if (spString.includes(key)) {
        return userObj || adminUser;
      }
    }
    return adminUser;
  }

  // 2. Parse PDF 2 (Sales Order Report, 297 rows)
  console.log('Parsing PDF 2 (Sales Order Report)...');
  const parser2 = new PDFParse(new Uint8Array(fs.readFileSync(p2Path)));
  const data2 = await parser2.getText();
  const lines2 = data2.text.split('\n').map(l => l.trim()).filter(Boolean);

  const pdf2Rows = [];
  let cur2 = null;
  for (const line of lines2) {
    if (line.includes('Sales Order Report') || line.includes('Order Reference Quotation Date') || line.includes('Sheet:')) continue;
    const match = line.match(/^(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/);
    if (match) {
      if (cur2) pdf2Rows.push(cur2);
      cur2 = { refNum: parseInt(match[1], 10), qDate: match[2], oDate: match[3], rest: match[4] };
    } else if (cur2) {
      cur2.rest += ' ' + line;
    }
  }
  if (cur2) pdf2Rows.push(cur2);

  console.log(`Extracted ${pdf2Rows.length} rows from PDF 2.`);

  pdf2Rows.forEach(r => {
    let clean = r.rest.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();
    
    // Payment status at end: Fully Paid, Partial Payment, NO
    const payMatch = clean.match(/(Fully Paid|Partial Payment|NO)\s*$/i);
    r.paymentStatus = payMatch ? payMatch[1] : 'NO';
    let beforePay = payMatch ? clean.slice(0, payMatch.index).trim() : clean;

    // LedgerMax invoice number
    let invNum = '';
    const invMatch = beforePay.match(/\b(INVFL\s*\d+(?:\s*,\s*\d+)?|INV\d+(?:\s*,\s*INV\d+)?|WWTS\d+(?:\s*-\s*WWTS\d+)?|IVFL\d+)\s*$/i);
    if (invMatch) {
      invNum = invMatch[1].trim();
      beforePay = beforePay.slice(0, invMatch.index).trim();
    }
    r.invoiceNumber = invNum;

    // Invoice status: Fully Invoiced, To Invoice
    const invStatMatch = beforePay.match(/(Fully Invoiced|To Invoice)\s*$/i);
    r.invoiceStatus = invStatMatch ? invStatMatch[1] : 'To Invoice';
    let beforeInvStat = invStatMatch ? beforePay.slice(0, invStatMatch.index).trim() : beforePay;

    // Delivery status: Not Delivered, Partially Delivered, Fully Delivered, Delivered
    const delStatMatch = beforeInvStat.match(/(Not Delivered|Partially Delivered|Fully Delivered|Delivered)\s*$/i);
    r.deliveryStatus = delStatMatch ? delStatMatch[1] : 'Not Delivered';
    let beforeDelStat = delStatMatch ? beforeInvStat.slice(0, delStatMatch.index).trim() : beforeInvStat;

    // Total amount
    const amtMatch = beforeDelStat.match(/([\d\.\+eE]+)\s*$/);
    r.totalAmount = amtMatch ? Math.round(Number(amtMatch[1])) : 0;
    let beforeAmt = amtMatch ? beforeDelStat.slice(0, amtMatch.index).trim() : beforeDelStat;

    // File-No#
    const fnMatch = beforeAmt.match(/(\b\d{3,4}\s*(?:Green|Blue|Yellow|Greem|green|blue|yellow)?|\bDN\d+(?:\s*-\s*\d+)?|\b709\b|\b850\b|\bDN3013\s*-\b)\s*$/i);
    r.fileNo = fnMatch ? fnMatch[1].trim() : '';
    let beforeFn = fnMatch ? beforeAmt.slice(0, fnMatch.index).trim() : beforeAmt;

    // Customer & Product Summary
    r.remainingText = beforeFn;
  });

  // 3. Parse PDF 1 (Complete File Data, 1388 rows)
  console.log('Parsing PDF 1 (Complete File Data)...');
  const parser1 = new PDFParse(new Uint8Array(fs.readFileSync(p1Path)));
  const data1 = await parser1.getText();
  const lines1 = data1.text.split('\n').map(l => l.trim()).filter(Boolean);

  const pdf1Rows = [];
  let cur1 = null;
  for (const line of lines1) {
    if (line.includes('Sales Order (sale.order)') || line.includes('Order Reference Creation Date') || line.includes('Complete File Data')) continue;
    const match = line.match(/^(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/);
    if (match) {
      if (cur1) pdf1Rows.push(cur1);
      cur1 = { refNum: parseInt(match[1], 10), creationDate: match[2], rest: match[3] };
    } else if (cur1) {
      cur1.rest += ' ' + line;
    }
  }
  if (cur1) pdf1Rows.push(cur1);

  console.log(`Extracted ${pdf1Rows.length} rows from PDF 1.`);

  const knownSPList = Object.keys(spMap).concat(['Syed Salman']);

  pdf1Rows.forEach(r => {
    let clean = r.rest.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();
    r.clean = clean;

    // Status at the end
    const statusMatch = clean.match(/(Quotation|Sales Order|Cancelled)\s*$/i);
    r.status = statusMatch ? statusMatch[1] : '';
    let beforeStatus = statusMatch ? clean.slice(0, statusMatch.index).trim() : clean;

    // Amount before status
    const amtMatch = beforeStatus.match(/([\d\.\+eE]+)\s*$/);
    r.totalAmount = amtMatch ? Math.round(Number(amtMatch[1])) : 0;
    let beforeAmt = amtMatch ? beforeStatus.slice(0, amtMatch.index).trim() : beforeStatus;

    // Sales person identification
    r.salePerson = knownSPList.find(sp => beforeAmt.includes(sp)) || '';
    
    if (r.salePerson) {
      const spIndex = beforeAmt.indexOf(r.salePerson);
      r.customerName = beforeAmt.slice(0, spIndex).trim();
      const afterSP = beforeAmt.slice(spIndex + r.salePerson.length).trim();
      
      // File number right after salesperson
      const fnMatch = afterSP.match(/^(\d{3,4}\s*(?:Green|Blue|Yellow|Greem|green|blue|yellow)?|DN\d+(?:\s*-\s*\d+)?|\b709\b|\b850\b|\bDN3013\s*-\b)\b/i);
      if (fnMatch) {
        r.fileNo = fnMatch[1].trim();
        r.productSummary = afterSP.slice(fnMatch[0].length).trim();
      } else {
        r.fileNo = '';
        r.productSummary = afterSP;
      }
    } else {
      r.customerName = beforeAmt;
      r.fileNo = '';
      r.productSummary = '';
    }
  });

  // Filter out Syed Salman
  const validP1Rows = pdf1Rows.filter(r => r.salePerson !== 'Syed Salman');
  console.log(`Total PDF 1 rows after neglecting Syed Salman: ${validP1Rows.length} (excluded ${pdf1Rows.length - validP1Rows.length} rows)`);

  // 4. PURGE TEST DATA
  console.log('Purging old test data from database...');
  await Promise.all([
    Quotation.deleteMany({}),
    SalesOrder.deleteMany({}),
    Invoice.deleteMany({}),
    DeliveryNote.deleteMany({}),
    Payment.deleteMany({}),
    CustomerPO.deleteMany({}),
    ProductFile.deleteMany({}),
    ProformaInvoice.deleteMany({}),
    Deal.deleteMany({}),
    Lead.deleteMany({}),
    SalesActivity.deleteMany({}),
    Shipment.deleteMany({}),
    PurchaserGRN.deleteMany({}),
    SupplierPO.deleteMany({}),
    FinancialCharge.deleteMany({}),
    MaintenanceCharge.deleteMany({}),
    LocalPayable.deleteMany({}),
    EditPermissionRequest.deleteMany({}),
    EditAuditLog.deleteMany({}),
    AuditLog.deleteMany({}),
    Notification.deleteMany({})
  ]);
  console.log('All test sample data purged successfully.');

  // Helper function to extract file number digits
  function getDigits(str) {
    if (!str) return '';
    const m = str.match(/\d+/);
    return m ? m[0] : '';
  }

  function getFileType(fileNoStr) {
    if (!fileNoStr) return '';
    const lower = fileNoStr.toLowerCase();
    if (lower.includes('blue')) return 'Blue';
    if (lower.includes('green') || lower.includes('greem')) return 'Green';
    if (lower.includes('yellow') || lower.includes('yello')) return 'Yellow';
    return '';
  }

  // 5. INGEST QUOTATIONS FROM PDF 1
  const quotationRows = validP1Rows.filter(r => r.status.toLowerCase() === 'quotation');
  console.log(`Inserting ${quotationRows.length} Quotations into database...`);

  const quotationsToInsert = quotationRows.map(r => {
    const userObj = getSalesPersonUser(r.salePerson);
    const refStr = 'SQ-' + String(10000 + r.refNum);
    const creationD = new Date(r.creationDate);

    return {
      orderReference: refStr,
      quotationNumber: refStr,
      creationDate: creationD,
      salePerson: userObj.fullName,
      createdBy: userObj._id,
      fileNo: r.fileNo || '',
      fileType: getFileType(r.fileNo),
      productSummary: r.productSummary || 'Network and IT Equipment',
      clientName: r.customerName || 'General Client',
      items: [
        {
          description: r.productSummary || 'Network and IT Equipment',
          quantity: 1,
          unitPrice: r.totalAmount,
          total: r.totalAmount
        }
      ],
      totalAmount: r.totalAmount,
      netAmount: r.totalAmount,
      status: 'Quotation',
      validityDate: new Date(creationD.getTime() + 30 * 24 * 60 * 60 * 1000)
    };
  });

  await Quotation.insertMany(quotationsToInsert);
  console.log(`Inserted ${quotationsToInsert.length} Quotations.`);

  // 6. INGEST SALES ORDERS & LINK TO PDF 2
  const soRowsP1 = validP1Rows.filter(r => r.status.toLowerCase() === 'sales order');
  console.log(`Processing ${soRowsP1.length} Sales Orders from PDF 1...`);

  const usedP2Indices = new Set();
  const salesOrdersToInsert = [];
  const deliveryNotesToInsert = [];
  const invoicesToInsert = [];
  const paymentsToInsert = [];

  let nextOrderNum = 1000;

  for (const r1 of soRowsP1) {
    const userObj = getSalesPersonUser(r1.salePerson);
    const r1Digits = getDigits(r1.fileNo);
    const creationD = new Date(r1.creationDate);

    // Find best match in PDF 2
    let matchedP2 = null;
    let matchedIdx = -1;

    // 1. Match by exact file number digits
    if (r1Digits && r1Digits.length >= 3) {
      matchedIdx = pdf2Rows.findIndex((p2, idx) => !usedP2Indices.has(idx) && getDigits(p2.fileNo) === r1Digits);
    }
    // 2. Or match by customer + amount
    if (matchedIdx === -1 && r1.totalAmount > 0) {
      const firstCust = (r1.customerName || '').split(' ')[0].toLowerCase();
      matchedIdx = pdf2Rows.findIndex((p2, idx) => !usedP2Indices.has(idx) && p2.totalAmount === r1.totalAmount && p2.remainingText.toLowerCase().includes(firstCust));
    }
    // 3. Or match by date + customer
    if (matchedIdx === -1) {
      const dateStr = r1.creationDate.slice(0, 10);
      const firstCust = (r1.customerName || '').split(' ')[0].toLowerCase();
      matchedIdx = pdf2Rows.findIndex((p2, idx) => !usedP2Indices.has(idx) && (p2.oDate.startsWith(dateStr) || p2.qDate.startsWith(dateStr)) && p2.remainingText.toLowerCase().includes(firstCust));
    }

    if (matchedIdx !== -1) {
      matchedP2 = pdf2Rows[matchedIdx];
      usedP2Indices.add(matchedIdx);
    }

    // Determine statuses
    const deliveryStatus = matchedP2 ? matchedP2.deliveryStatus : 'Fully Delivered';
    const invoiceStatus = matchedP2 ? matchedP2.invoiceStatus : 'Fully Invoiced';
    const rawPayment = matchedP2 ? matchedP2.paymentStatus : 'Fully Paid';
    const invoiceNum = matchedP2 && matchedP2.invoiceNumber ? matchedP2.invoiceNumber : `INV-${String(nextOrderNum).padStart(4, '0')}`;

    let paymentStatus = 'Pending';
    let totalPaid = 0;
    if (rawPayment.toLowerCase().includes('fully') || rawPayment.toLowerCase() === 'paid') {
      paymentStatus = 'Fully Paid';
      totalPaid = r1.totalAmount;
    } else if (rawPayment.toLowerCase().includes('partial')) {
      paymentStatus = 'Partially Paid';
      totalPaid = Math.round(r1.totalAmount * 0.5);
    } else {
      paymentStatus = 'Pending';
      totalPaid = 0;
    }

    const orderId = new mongoose.Types.ObjectId();
    const orderNumber = 'SO-' + String(nextOrderNum);
    const orderRef = 'S0' + String(nextOrderNum);
    nextOrderNum++;

    const fileType = getFileType(r1.fileNo) || (matchedP2 ? getFileType(matchedP2.fileNo) : '');

    // Current department and workflow status
    let currentDepartment = 'Sales';
    let workflowStatus = 'Sales Order Created';
    let departmentResponsible = 'Sales';

    if (invoiceStatus === 'Fully Invoiced') {
      currentDepartment = 'Finance';
      departmentResponsible = 'Finance';
      workflowStatus = 'Finance Approved';
    } else if (invoiceStatus === 'To Invoice') {
      currentDepartment = 'Accounts';
      departmentResponsible = 'Accounts';
      workflowStatus = 'Sent to Accounts';
    }

    const salesOrderDoc = {
      _id: orderId,
      orderReference: orderRef,
      orderNumber: orderNumber,
      clientName: r1.customerName || (matchedP2 ? matchedP2.remainingText.split('  ')[0] : 'Corporate Client'),
      creationDate: creationD,
      orderDate: matchedP2 ? new Date(matchedP2.oDate) : creationD,
      salePerson: userObj.fullName,
      salesPerson: userObj._id,
      createdBy: userObj._id,
      fileNo: r1.fileNo || (matchedP2 ? matchedP2.fileNo : ''),
      fileType: fileType,
      productSummary: r1.productSummary || 'IT Equipment and Solutions',
      items: [
        {
          description: r1.productSummary || 'IT Equipment and Solutions',
          quantity: 1,
          unitPrice: r1.totalAmount,
          total: r1.totalAmount
        }
      ],
      totalAmount: r1.totalAmount,
      netAmount: r1.totalAmount,
      status: 'Sales Order',
      deliveryStatus: deliveryStatus === 'Partially Delivered' ? 'Partially Delivered' : (deliveryStatus === 'Not Delivered' ? 'Not Delivered' : 'Fully Delivered'),
      invoiceStatus: invoiceStatus === 'Fully Invoiced' ? 'Fully Invoiced' : 'To Invoice',
      invoiceNumber: invoiceNum,
      paymentStatus: paymentStatus,
      totalPaid: totalPaid,
      outstandingBalance: Math.max(0, r1.totalAmount - totalPaid),
      currentDepartment: currentDepartment,
      departmentResponsible: departmentResponsible,
      workflowStatus: workflowStatus,
      stockStatus: 'Available'
    };

    salesOrdersToInsert.push(salesOrderDoc);

    // Support Department (Delivery Note)
    if (['Fully Delivered', 'Partially Delivered', 'Delivered'].includes(deliveryStatus)) {
      const dnId = new mongoose.Types.ObjectId();
      salesOrderDoc.deliveryNoteId = dnId;
      salesOrderDoc.deliveryNoteNumber = 'WH/OUT/' + String(deliveryNotesToInsert.length + 372).padStart(5, '0');

      deliveryNotesToInsert.push({
        _id: dnId,
        deliveryNumber: salesOrderDoc.deliveryNoteNumber,
        deliveryNoteNumber: salesOrderDoc.deliveryNoteNumber,
        salesOrder: orderId,
        salesOrderNumber: orderNumber,
        sourceDocument: orderNumber,
        clientName: salesOrderDoc.clientName,
        status: deliveryStatus === 'Partially Delivered' ? 'Partially Delivered' : 'Done',
        scheduledDate: salesOrderDoc.orderDate,
        deliveryDate: salesOrderDoc.orderDate,
        items: salesOrderDoc.items.map(it => ({
          product: it.description,
          description: it.description,
          demand: it.quantity,
          quantity: it.quantity,
          availability: 'Available'
        })),
        fileType: fileType,
        invoiced: invoiceStatus === 'Fully Invoiced',
        invoiceNumber: invoiceStatus === 'Fully Invoiced' ? invoiceNum : '',
        salesPerson: userObj._id,
        salePerson: userObj.fullName,
        createdBy: supportUser ? supportUser._id : userObj._id
      });
    }

    // Finance Department (Invoice & Payment)
    if (invoiceStatus === 'Fully Invoiced') {
      const invId = new mongoose.Types.ObjectId();
      salesOrderDoc.invoiceId = invId;

      let invStatus = 'Approved';
      if (paymentStatus === 'Fully Paid') invStatus = 'Paid';
      else if (paymentStatus === 'Partially Paid') invStatus = 'Partially Paid';

      const invoiceDoc = {
        _id: invId,
        invoiceNumber: invoiceNum,
        clientName: salesOrderDoc.clientName,
        salesOrderId: orderId,
        salesOrderNumber: orderNumber,
        saleReference: orderRef,
        fileNumber: salesOrderDoc.fileNo,
        fileType: fileType,
        items: salesOrderDoc.items,
        amount: salesOrderDoc.totalAmount,
        subtotal: salesOrderDoc.totalAmount,
        paidAmount: totalPaid,
        outstandingAmount: Math.max(0, salesOrderDoc.totalAmount - totalPaid),
        status: invStatus,
        isDraft: false,
        departmentResponsible: 'Finance',
        reviewedBy: financeUser ? financeUser._id : null,
        reviewedAt: salesOrderDoc.orderDate,
        issueDate: salesOrderDoc.orderDate,
        dueDate: new Date(new Date(salesOrderDoc.orderDate).getTime() + 30 * 24 * 60 * 60 * 1000),
        salesPerson: userObj._id,
        salePerson: userObj.fullName,
        createdBy: accountsUser ? accountsUser._id : userObj._id
      };

      invoicesToInsert.push(invoiceDoc);

      if (totalPaid > 0) {
        paymentsToInsert.push({
          paymentRefNumber: 'PAY-' + String(paymentsToInsert.length + 36).padStart(4, '0'),
          customerName: salesOrderDoc.clientName,
          salesOrderId: orderId,
          salesOrderNumber: orderNumber,
          invoiceId: invId,
          invoiceNumber: invoiceNum,
          amount: totalPaid,
          paymentType: paymentStatus === 'Fully Paid' ? 'Full' : 'Partial',
          paymentDate: salesOrderDoc.orderDate,
          paymentMethod: 'Bank Transfer',
          salesPerson: userObj._id,
          salePerson: userObj.fullName,
          createdBy: financeUser ? financeUser._id : userObj._id
        });
      }
    }
  }

  // 7. Check if any remaining PDF 2 rows need to be imported
  const remainingP2 = pdf2Rows.filter((_, idx) => !usedP2Indices.has(idx));
  console.log(`Remaining orders exclusively in PDF 2: ${remainingP2.length}`);

  for (const r2 of remainingP2) {
    // Attempt to deduce salesperson by branch/customer context or default to Umair / Karachi Manager
    let matchedUser = umairSiddiquiKhi;
    const lowerTxt = r2.remainingText.toLowerCase();
    if (lowerTxt.includes('lahore') || lowerTxt.includes('nishat') || lowerTxt.includes('hotel')) {
      matchedUser = waseemBhattiLhr;
    } else if (lowerTxt.includes('islamabad') || lowerTxt.includes('nescom') || lowerTxt.includes('scientific')) {
      matchedUser = shoaibMehfoozIsb;
    } else if (lowerTxt.includes('marriott') || lowerTxt.includes('datacomm')) {
      matchedUser = zubairIsb;
    } else if (lowerTxt.includes('louis dreyfus')) {
      matchedUser = raeesIsb;
    }

    const orderId = new mongoose.Types.ObjectId();
    const orderNumber = 'SO-' + String(nextOrderNum);
    const orderRef = 'S0' + String(nextOrderNum);
    nextOrderNum++;

    const fileType = getFileType(r2.fileNo);
    const invoiceNum = r2.invoiceNumber || `INV-${String(nextOrderNum).padStart(4, '0')}`;

    let paymentStatus = 'Pending';
    let totalPaid = 0;
    if (r2.paymentStatus.toLowerCase().includes('fully') || r2.paymentStatus.toLowerCase() === 'paid') {
      paymentStatus = 'Fully Paid';
      totalPaid = r2.totalAmount;
    } else if (r2.paymentStatus.toLowerCase().includes('partial')) {
      paymentStatus = 'Partially Paid';
      totalPaid = Math.round(r2.totalAmount * 0.5);
    }

    let currentDepartment = r2.invoiceStatus === 'Fully Invoiced' ? 'Finance' : 'Accounts';
    let departmentResponsible = currentDepartment;
    let workflowStatus = r2.invoiceStatus === 'Fully Invoiced' ? 'Finance Approved' : 'Sent to Accounts';

    const orderDoc = {
      _id: orderId,
      orderReference: orderRef,
      orderNumber: orderNumber,
      clientName: r2.remainingText.split('  ')[0].trim() || 'Corporate Client',
      creationDate: new Date(r2.qDate),
      orderDate: new Date(r2.oDate),
      salePerson: matchedUser.fullName,
      salesPerson: matchedUser._id,
      createdBy: matchedUser._id,
      fileNo: r2.fileNo,
      fileType: fileType,
      productSummary: 'Enterprise IT Infrastructure',
      items: [
        {
          description: 'Enterprise IT Infrastructure',
          quantity: 1,
          unitPrice: r2.totalAmount,
          total: r2.totalAmount
        }
      ],
      totalAmount: r2.totalAmount,
      netAmount: r2.totalAmount,
      status: 'Sales Order',
      deliveryStatus: r2.deliveryStatus === 'Partially Delivered' ? 'Partially Delivered' : (r2.deliveryStatus === 'Not Delivered' ? 'Not Delivered' : 'Fully Delivered'),
      invoiceStatus: r2.invoiceStatus === 'Fully Invoiced' ? 'Fully Invoiced' : 'To Invoice',
      invoiceNumber: invoiceNum,
      paymentStatus: paymentStatus,
      totalPaid: totalPaid,
      outstandingBalance: Math.max(0, r2.totalAmount - totalPaid),
      currentDepartment: currentDepartment,
      departmentResponsible: departmentResponsible,
      workflowStatus: workflowStatus,
      stockStatus: 'Available'
    };

    salesOrdersToInsert.push(orderDoc);

    if (['Fully Delivered', 'Partially Delivered', 'Delivered'].includes(r2.deliveryStatus)) {
      const dnId = new mongoose.Types.ObjectId();
      orderDoc.deliveryNoteId = dnId;
      orderDoc.deliveryNoteNumber = 'WH/OUT/' + String(deliveryNotesToInsert.length + 372).padStart(5, '0');

      deliveryNotesToInsert.push({
        _id: dnId,
        deliveryNumber: orderDoc.deliveryNoteNumber,
        deliveryNoteNumber: orderDoc.deliveryNoteNumber,
        salesOrder: orderId,
        salesOrderNumber: orderNumber,
        sourceDocument: orderNumber,
        clientName: orderDoc.clientName,
        status: r2.deliveryStatus === 'Partially Delivered' ? 'Partially Delivered' : 'Done',
        scheduledDate: orderDoc.orderDate,
        deliveryDate: orderDoc.orderDate,
        items: orderDoc.items.map(it => ({
          product: it.description,
          description: it.description,
          demand: it.quantity,
          quantity: it.quantity,
          availability: 'Available'
        })),
        fileType: fileType,
        invoiced: r2.invoiceStatus === 'Fully Invoiced',
        invoiceNumber: r2.invoiceStatus === 'Fully Invoiced' ? invoiceNum : '',
        salesPerson: matchedUser._id,
        salePerson: matchedUser.fullName,
        createdBy: supportUser ? supportUser._id : matchedUser._id
      });
    }

    if (r2.invoiceStatus === 'Fully Invoiced') {
      const invId = new mongoose.Types.ObjectId();
      orderDoc.invoiceId = invId;

      let invStatus = 'Approved';
      if (paymentStatus === 'Fully Paid') invStatus = 'Paid';
      else if (paymentStatus === 'Partially Paid') invStatus = 'Partially Paid';

      const invoiceDoc = {
        _id: invId,
        invoiceNumber: invoiceNum,
        clientName: orderDoc.clientName,
        salesOrderId: orderId,
        salesOrderNumber: orderNumber,
        saleReference: orderRef,
        fileNumber: orderDoc.fileNo,
        fileType: fileType,
        items: orderDoc.items,
        amount: orderDoc.totalAmount,
        subtotal: orderDoc.totalAmount,
        paidAmount: totalPaid,
        outstandingAmount: Math.max(0, orderDoc.totalAmount - totalPaid),
        status: invStatus,
        isDraft: false,
        departmentResponsible: 'Finance',
        reviewedBy: financeUser ? financeUser._id : null,
        reviewedAt: orderDoc.orderDate,
        issueDate: orderDoc.orderDate,
        dueDate: new Date(new Date(orderDoc.orderDate).getTime() + 30 * 24 * 60 * 60 * 1000),
        salesPerson: matchedUser._id,
        salePerson: matchedUser.fullName,
        createdBy: accountsUser ? accountsUser._id : matchedUser._id
      };

      invoicesToInsert.push(invoiceDoc);

      if (totalPaid > 0) {
        paymentsToInsert.push({
          paymentRefNumber: 'PAY-' + String(paymentsToInsert.length + 36).padStart(4, '0'),
          customerName: orderDoc.clientName,
          salesOrderId: orderId,
          salesOrderNumber: orderNumber,
          invoiceId: invId,
          invoiceNumber: invoiceNum,
          amount: totalPaid,
          paymentType: paymentStatus === 'Fully Paid' ? 'Full' : 'Partial',
          paymentDate: orderDoc.orderDate,
          paymentMethod: 'Bank Transfer',
          salesPerson: matchedUser._id,
          salePerson: matchedUser.fullName,
          createdBy: financeUser ? financeUser._id : matchedUser._id
        });
      }
    }
  }

  // 8. Execute Database Insertions
  console.log(`Inserting ${salesOrdersToInsert.length} Sales Orders...`);
  await SalesOrder.insertMany(salesOrdersToInsert);

  console.log(`Inserting ${deliveryNotesToInsert.length} Delivery Notes into Support...`);
  await DeliveryNote.insertMany(deliveryNotesToInsert);

  console.log(`Inserting ${invoicesToInsert.length} Invoices into Finance...`);
  await Invoice.insertMany(invoicesToInsert);

  console.log(`Inserting ${paymentsToInsert.length} Payments into Finance/Accounts...`);
  await Payment.insertMany(paymentsToInsert);

  console.log('--- DATA INGESTION COMPLETED SUCCESSFULLY ---');
  console.log({
    quotationsInserted: quotationsToInsert.length,
    salesOrdersInserted: salesOrdersToInsert.length,
    deliveryNotesInserted: deliveryNotesToInsert.length,
    invoicesInserted: invoicesToInsert.length,
    paymentsInserted: paymentsToInsert.length
  });

  process.exit(0);
}

runImport().catch(err => {
  console.error('Data import failed:', err);
  process.exit(1);
});
