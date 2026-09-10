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

// 1. Full 414 rows from the 12-page PDF
const RAW_PDF_ROWS = require('./importPdfDataComplete');

// 2. Full 80 sales orders with exact payment, delivery, and ledger invoice details
const LEGIT_SALES_ORDERS = require('./legitSalesOrdersData');

async function importAllDataMaster() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas...');

    await User.updateOne({ email: 'farhan@gmail.com' }, { $set: { position: 'Sales Representative', department: 'Sales' } });
    await User.updateOne({ email: 'kaleem@gmail.com' }, { $set: { position: 'Sales Representative', department: 'Sales' } });

    const farhan = await User.findOne({ email: 'farhan@gmail.com' });
    const kaleem = await User.findOne({ email: 'kaleem@gmail.com' });

    if (!farhan || !kaleem) {
      console.error('Farhan or Kaleem not found!');
      process.exit(1);
    }

    // 1. Clear out previous records everywhere
    await Quotation.deleteMany({});
    await CustomerPO.deleteMany({});
    await ProductFile.deleteMany({});
    await SalesOrder.deleteMany({});
    await DeliveryNote.deleteMany({});
    await Invoice.deleteMany({});
    await Invoice.collection.dropIndex('invoiceNumber_1').catch(() => {});
    await Payment.deleteMany({});
    await Lead.deleteMany({});
    await Deal.deleteMany({});
    await SalesTarget.deleteMany({});

    console.log(`Cleared previous collections.`);

    // Set Up Active Monthly Targets for Farhan and Kaleem
    await SalesTarget.create({
      employee: farhan._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 50000000,
      achievedAmount: 0,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Enterprise Expansion Quota'
    });

    await SalesTarget.create({
      employee: kaleem._id,
      period: 'September 2026',
      periodType: 'Monthly',
      targetAmount: 50000000,
      achievedAmount: 0,
      status: 'Active',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      notes: 'Regional Expansion Quota'
    });

    // Create a map of legit sales orders for quick lookup
    const salesOrderMap = new Map();
    for (const so of LEGIT_SALES_ORDERS) {
      salesOrderMap.set(so.ref, so);
    }

    let totalSalesAchieved = 0;
    let totalReceivables = 0;
    let totalPaid = 0;

    const leadsToInsert = [];
    const dealsToInsert = [];
    const quotationsToInsert = [];
    const customerPOsToInsert = [];
    const productFilesToInsert = [];
    const salesOrdersToInsert = [];
    const deliveryNotesToInsert = [];
    const invoicesToInsert = [];
    const paymentsToInsert = [];

    // Track processed reference numbers to prevent duplicate quotations
    const processedRefs = new Set();

    // STEP 1: Process all 414 rows from the 12-page PDF
    for (let i = 0; i < RAW_PDF_ROWS.length; i++) {
      const row = RAW_PDF_ROWS[i];
      processedRefs.add(row.ref);

      const isSalesOrderInList = (row.status === 'Sales Order') || salesOrderMap.has(row.ref);
      const soDetails = salesOrderMap.get(row.ref);

      const rowDate = new Date(row.date || '2026-09-01');
      const leadId = new mongoose.Types.ObjectId();
      const quoId = new mongoose.Types.ObjectId();

      let fileColor = 'Green';
      let fileNum = '';
      if (row.fileNo) {
        if (row.fileNo.toLowerCase().includes('blue')) fileColor = 'Blue';
        else if (row.fileNo.toLowerCase().includes('yellow')) fileColor = 'Yellow';
        else if (row.fileNo.toLowerCase().includes('green')) fileColor = 'Green';
        fileNum = row.fileNo.split(' ')[0] || row.fileNo;
      }

      // 1. Lead
      leadsToInsert.push({
        _id: leadId,
        name: row.customer,
        company: row.customer,
        contactPerson: 'Procurement Dept',
        email: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        phone: '+92 300 ' + String(1000000 + i),
        status: isSalesOrderInList ? 'Converted' : 'Qualified',
        value: row.total,
        source: 'Direct',
        requirements: row.product,
        notes: `Extracted from reference file ${row.ref}`,
        assignedTo: farhan._id,
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: rowDate
      });

      // 2. Quotation
      quotationsToInsert.push({
        _id: quoId,
        quotationNumber: row.ref,
        orderReference: row.ref,
        creationDate: rowDate,
        clientName: row.customer,
        salePerson: 'Farhan',
        fileNo: row.fileNo || '',
        fileType: fileColor,
        productSummary: row.product,
        clientEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        clientPhone: '+92 300 ' + String(1000000 + i),
        totalAmount: row.total,
        netAmount: row.total,
        status: isSalesOrderInList ? 'Accepted' : 'Quotation',
        validUntil: new Date('2026-12-31'),
        items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
        leadId: leadId,
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: rowDate
      });

      // 3. If Sales Order -> Create downstream records
      if (isSalesOrderInList) {
        const cpoId = new mongoose.Types.ObjectId();
        const soId = new mongoose.Types.ObjectId();
        const dnId = new mongoose.Types.ObjectId();
        const invId = new mongoose.Types.ObjectId();

        const poNum = `PO-${row.ref.replace('S', '')}`;
        const orderDate = soDetails ? new Date(soDetails.orderDate) : rowDate;
        const deliveryStatus = soDetails ? soDetails.deliveryStatus : 'Fully Delivered';
        const invoiceStatus = soDetails ? soDetails.invoiceStatus : 'Fully Invoiced';
        const paymentStr = soDetails ? soDetails.payment : 'Fully Paid';
        const ledgerInvoice = soDetails?.ledgerInvoice || `INV-${row.ref}`;

        const isFullyDelivered = (deliveryStatus === 'Fully Delivered');
        const isFullyInvoiced = (invoiceStatus === 'Fully Invoiced');
        const isFullyPaid = (paymentStr === 'Fully Paid');
        const isPartialPaid = (paymentStr === 'Partial Payment');

        let paidAmount = 0;
        let outstandingAmount = row.total;
        let paymentStatus = 'Unpaid';
        let invStatus = isFullyInvoiced ? 'Sent' : 'Draft';

        if (isFullyPaid) {
          paidAmount = row.total;
          outstandingAmount = 0;
          paymentStatus = 'Paid';
          invStatus = 'Paid';
        } else if (isPartialPaid) {
          paidAmount = Math.round(row.total / 2);
          outstandingAmount = row.total - paidAmount;
          paymentStatus = 'Partially Paid';
          invStatus = 'Partially Paid';
        } else {
          paidAmount = 0;
          outstandingAmount = row.total;
          paymentStatus = 'Unpaid';
          invStatus = isFullyInvoiced ? 'Sent' : 'Draft';
        }

        totalSalesAchieved += row.total;
        totalReceivables += outstandingAmount;
        totalPaid += paidAmount;

        // Deal
        dealsToInsert.push({
          title: `${row.customer} - ${row.product}`,
          clientName: row.customer,
          value: row.total,
          stage: 'Won',
          leadId: leadId,
          assignedTo: farhan._id,
          createdBy: farhan._id,
          createdAt: rowDate,
          updatedAt: orderDate
        });

        // Customer PO
        customerPOsToInsert.push({
          _id: cpoId,
          poNumber: poNum,
          poDate: rowDate,
          customerName: row.customer,
          quotationId: quoId,
          quotationNumber: row.ref,
          amount: row.total,
          status: 'Received',
          createdBy: farhan._id,
          createdAt: rowDate,
          updatedAt: orderDate
        });

        // Product File
        productFilesToInsert.push({
          fileNumber: fileNum || `PF-${row.ref}`,
          fileType: fileColor,
          customerName: row.customer,
          quotationId: quoId,
          quotationNumber: row.ref,
          customerPOId: cpoId,
          customerPONumber: poNum,
          status: 'Active',
          products: [{ name: row.product, quantity: 1, unit: 'Units', description: row.product }],
          createdBy: farhan._id,
          createdAt: rowDate,
          updatedAt: orderDate
        });

        // Sales Order
        salesOrdersToInsert.push({
          _id: soId,
          orderNo: row.ref,
          orderReference: row.ref,
          clientName: row.customer,
          clientEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
          clientPhone: '+92 300 ' + String(1000000 + i),
          salesPerson: farhan._id,
          salesPersonName: 'Farhan',
          fileNo: row.fileNo || fileNum,
          fileColor: fileColor,
          fileNumber: fileNum,
          productSummary: row.product,
          customerPORef: poNum,
          quotationRef: row.ref,
          orderDate: orderDate,
          deliveryDate: new Date(orderDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          netAmount: row.total,
          totalAmount: row.total,
          currency: 'PKR',
          deliveryStatus: deliveryStatus,
          invoiceStatus: invoiceStatus,
          paymentStatus: paymentStatus,
          invoiceNumber: ledgerInvoice,
          status: isFullyDelivered ? 'Delivered' : 'Confirmed',
          stockStatus: 'In Stock',
          items: [{ product: row.product, description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
          createdBy: farhan._id,
          createdAt: orderDate,
          updatedAt: orderDate
        });

        // Delivery Note
        const dlineDate = new Date(orderDate.getTime() + 2 * 24 * 60 * 60 * 1000);
        deliveryNotesToInsert.push({
          _id: dnId,
          deliveryNumber: `DN-${row.ref}`,
          deliveryNoteNumber: `DN-${row.ref}`,
          salesOrder: soId,
          salesOrderNumber: row.ref,
          clientName: row.customer,
          scheduledDate: orderDate,
          deadline: dlineDate,
          deliveryDate: isFullyDelivered ? orderDate : null,
          status: isFullyDelivered ? 'Delivered' : 'Ready',
          items: [{ product: row.product, description: row.product, quantity: 1, demand: 1, availability: 'Available' }],
          carrier: 'Fortline Express Fleet',
          recipientName: 'Procurement Officer',
          createdBy: farhan._id,
          createdAt: orderDate,
          updatedAt: orderDate
        });

        // Invoice
        invoicesToInsert.push({
          _id: invId,
          invoiceNumber: ledgerInvoice,
          clientName: row.customer,
          customerEmail: `info@${row.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
          customerPhone: '+92 300 ' + String(1000000 + i),
          saleReference: row.ref,
          salesOrderId: soId,
          salesOrderNumber: row.ref,
          deliveryNoteId: dnId,
          deliveryNoteNumber: `DN-${row.ref}`,
          fileNumber: fileNum,
          fileType: fileColor,
          amount: row.total,
          subtotal: row.total,
          paidAmount: paidAmount,
          outstandingAmount: outstandingAmount,
          status: invStatus,
          issueDate: orderDate,
          dueDate: new Date(orderDate.getTime() + 30 * 24 * 60 * 60 * 1000),
          items: [{ description: row.product, quantity: 1, unitPrice: row.total, total: row.total }],
          createdBy: farhan._id,
          createdAt: orderDate,
          updatedAt: orderDate
        });

        // Payment
        if (paidAmount > 0) {
          paymentsToInsert.push({
            paymentRefNumber: `PAY-${row.ref}`,
            invoiceId: invId,
            invoiceNumber: ledgerInvoice,
            salesOrderId: soId,
            salesOrderNumber: row.ref,
            customerName: row.customer,
            amount: paidAmount,
            paymentType: isFullyPaid ? 'Full' : 'Partial',
            paymentMethod: 'Bank Transfer',
            notes: isFullyPaid ? `Full Payment received for ${row.customer} (${row.ref})` : `Partial Payment (50%) received for ${row.customer} (${row.ref})`,
            paymentDate: orderDate,
            createdBy: farhan._id,
            createdAt: orderDate,
            updatedAt: orderDate
          });
        }
      }
    }

    // STEP 2: Process any additional Sales Orders from LEGIT_SALES_ORDERS not in RAW_PDF_ROWS
    for (let j = 0; j < LEGIT_SALES_ORDERS.length; j++) {
      const soRow = LEGIT_SALES_ORDERS[j];
      if (processedRefs.has(soRow.ref)) continue; // Already processed
      processedRefs.add(soRow.ref);

      const rowDate = new Date(soRow.quoDate || '2026-06-15');
      const orderDate = new Date(soRow.orderDate || '2026-06-16');
      const leadId = new mongoose.Types.ObjectId();
      const quoId = new mongoose.Types.ObjectId();
      const cpoId = new mongoose.Types.ObjectId();
      const soId = new mongoose.Types.ObjectId();
      const dnId = new mongoose.Types.ObjectId();
      const invId = new mongoose.Types.ObjectId();

      let fileColor = 'Green';
      let fileNum = '';
      if (soRow.fileNo) {
        if (soRow.fileNo.toLowerCase().includes('blue')) fileColor = 'Blue';
        else if (soRow.fileNo.toLowerCase().includes('yellow')) fileColor = 'Yellow';
        else if (soRow.fileNo.toLowerCase().includes('green')) fileColor = 'Green';
        fileNum = soRow.fileNo.split(' ')[0] || soRow.fileNo;
      }

      const isFullyDelivered = (soRow.deliveryStatus === 'Fully Delivered');
      const isFullyInvoiced = (soRow.invoiceStatus === 'Fully Invoiced');
      const isFullyPaid = (soRow.payment === 'Fully Paid');
      const isPartialPaid = (soRow.payment === 'Partial Payment');

      let paidAmount = 0;
      let outstandingAmount = soRow.total;
      let paymentStatus = 'Unpaid';
      let invStatus = isFullyInvoiced ? 'Sent' : 'Draft';

      if (isFullyPaid) {
        paidAmount = soRow.total;
        outstandingAmount = 0;
        paymentStatus = 'Paid';
        invStatus = 'Paid';
      } else if (isPartialPaid) {
        paidAmount = Math.round(soRow.total / 2);
        outstandingAmount = soRow.total - paidAmount;
        paymentStatus = 'Partially Paid';
        invStatus = 'Partially Paid';
      } else {
        paidAmount = 0;
        outstandingAmount = soRow.total;
        paymentStatus = 'Unpaid';
        invStatus = isFullyInvoiced ? 'Sent' : 'Draft';
      }

      totalSalesAchieved += soRow.total;
      totalReceivables += outstandingAmount;
      totalPaid += paidAmount;

      const ledgerInvoice = soRow.ledgerInvoice || `INV-${soRow.ref}`;
      const poNum = `PO-${soRow.ref.replace('S', '')}`;

      leadsToInsert.push({
        _id: leadId,
        name: soRow.customer,
        company: soRow.customer,
        contactPerson: 'Procurement Dept',
        email: `info@${soRow.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        phone: '+92 300 ' + String(2000000 + j),
        status: 'Converted',
        value: soRow.total,
        source: 'Direct',
        requirements: soRow.product,
        notes: `Extracted from reference file ${soRow.ref}`,
        assignedTo: farhan._id,
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: orderDate
      });

      dealsToInsert.push({
        title: `${soRow.customer} - ${soRow.product}`,
        clientName: soRow.customer,
        value: soRow.total,
        stage: 'Won',
        leadId: leadId,
        assignedTo: farhan._id,
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: orderDate
      });

      quotationsToInsert.push({
        _id: quoId,
        quotationNumber: soRow.ref,
        orderReference: soRow.ref,
        creationDate: rowDate,
        clientName: soRow.customer,
        salePerson: 'Farhan',
        fileNo: soRow.fileNo || '',
        fileType: fileColor,
        productSummary: soRow.product,
        clientEmail: `info@${soRow.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        clientPhone: '+92 300 ' + String(2000000 + j),
        totalAmount: soRow.total,
        netAmount: soRow.total,
        status: 'Accepted',
        validUntil: new Date('2026-12-31'),
        items: [{ description: soRow.product, quantity: 1, unitPrice: soRow.total, total: soRow.total }],
        leadId: leadId,
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: orderDate
      });

      customerPOsToInsert.push({
        _id: cpoId,
        poNumber: poNum,
        poDate: rowDate,
        customerName: soRow.customer,
        quotationId: quoId,
        quotationNumber: soRow.ref,
        amount: soRow.total,
        status: 'Received',
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: orderDate
      });

      productFilesToInsert.push({
        fileNumber: fileNum || `PF-${soRow.ref}`,
        fileType: fileColor,
        customerName: soRow.customer,
        quotationId: quoId,
        quotationNumber: soRow.ref,
        customerPOId: cpoId,
        customerPONumber: poNum,
        status: 'Active',
        products: [{ name: soRow.product, quantity: 1, unit: 'Units', description: soRow.product }],
        createdBy: farhan._id,
        createdAt: rowDate,
        updatedAt: orderDate
      });

      salesOrdersToInsert.push({
        _id: soId,
        orderNo: soRow.ref,
        orderReference: soRow.ref,
        clientName: soRow.customer,
        clientEmail: `info@${soRow.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        clientPhone: '+92 300 ' + String(2000000 + j),
        salesPerson: farhan._id,
        salesPersonName: 'Farhan',
        fileNo: soRow.fileNo || fileNum,
        fileColor: fileColor,
        fileNumber: fileNum,
        productSummary: soRow.product,
        customerPORef: poNum,
        quotationRef: soRow.ref,
        orderDate: orderDate,
        deliveryDate: new Date(orderDate.getTime() + 7 * 24 * 60 * 60 * 1000),
        netAmount: soRow.total,
        totalAmount: soRow.total,
        currency: 'PKR',
        deliveryStatus: soRow.deliveryStatus,
        invoiceStatus: soRow.invoiceStatus,
        paymentStatus: paymentStatus,
        invoiceNumber: ledgerInvoice,
        status: isFullyDelivered ? 'Delivered' : 'Confirmed',
        stockStatus: 'In Stock',
        items: [{ product: soRow.product, description: soRow.product, quantity: 1, unitPrice: soRow.total, total: soRow.total }],
        createdBy: farhan._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      const dlineDate = new Date(orderDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      deliveryNotesToInsert.push({
        _id: dnId,
        deliveryNumber: `DN-${soRow.ref}`,
        deliveryNoteNumber: `DN-${soRow.ref}`,
        salesOrder: soId,
        salesOrderNumber: soRow.ref,
        clientName: soRow.customer,
        scheduledDate: orderDate,
        deadline: dlineDate,
        deliveryDate: isFullyDelivered ? orderDate : null,
        status: isFullyDelivered ? 'Delivered' : 'Ready',
        items: [{ product: soRow.product, description: soRow.product, quantity: 1, demand: 1, availability: 'Available' }],
        carrier: 'Fortline Express Fleet',
        recipientName: 'Procurement Officer',
        createdBy: farhan._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      invoicesToInsert.push({
        _id: invId,
        invoiceNumber: ledgerInvoice,
        clientName: soRow.customer,
        customerEmail: `info@${soRow.customer.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}.pk`,
        customerPhone: '+92 300 ' + String(2000000 + j),
        saleReference: soRow.ref,
        salesOrderId: soId,
        salesOrderNumber: soRow.ref,
        deliveryNoteId: dnId,
        deliveryNoteNumber: `DN-${soRow.ref}`,
        fileNumber: fileNum,
        fileType: fileColor,
        amount: soRow.total,
        subtotal: soRow.total,
        paidAmount: paidAmount,
        outstandingAmount: outstandingAmount,
        status: invStatus,
        issueDate: orderDate,
        dueDate: new Date(orderDate.getTime() + 30 * 24 * 60 * 60 * 1000),
        items: [{ description: soRow.product, quantity: 1, unitPrice: soRow.total, total: soRow.total }],
        createdBy: farhan._id,
        createdAt: orderDate,
        updatedAt: orderDate
      });

      if (paidAmount > 0) {
        paymentsToInsert.push({
          paymentRefNumber: `PAY-${soRow.ref}`,
          invoiceId: invId,
          invoiceNumber: ledgerInvoice,
          salesOrderId: soId,
          salesOrderNumber: soRow.ref,
          customerName: soRow.customer,
          amount: paidAmount,
          paymentType: isFullyPaid ? 'Full' : 'Partial',
          paymentMethod: 'Bank Transfer',
          notes: isFullyPaid ? `Full Payment received for ${soRow.customer} (${soRow.ref})` : `Partial Payment (50%) received for ${soRow.customer} (${soRow.ref})`,
          paymentDate: orderDate,
          createdBy: farhan._id,
          createdAt: orderDate,
          updatedAt: orderDate
        });
      }
    }

    console.log(`Inserting ${leadsToInsert.length} leads...`);
    await Lead.insertMany(leadsToInsert);
    console.log(`Inserting ${dealsToInsert.length} deals...`);
    await Deal.insertMany(dealsToInsert);
    console.log(`Inserting ${quotationsToInsert.length} quotations...`);
    await Quotation.insertMany(quotationsToInsert);
    console.log(`Inserting ${customerPOsToInsert.length} customer POs...`);
    await CustomerPO.insertMany(customerPOsToInsert);
    console.log(`Inserting ${productFilesToInsert.length} product files...`);
    await ProductFile.insertMany(productFilesToInsert);
    console.log(`Inserting ${salesOrdersToInsert.length} sales orders...`);
    await SalesOrder.insertMany(salesOrdersToInsert);
    console.log(`Inserting ${deliveryNotesToInsert.length} delivery notes...`);
    await DeliveryNote.insertMany(deliveryNotesToInsert);
    console.log(`Inserting ${invoicesToInsert.length} invoices...`);
    await Invoice.insertMany(invoicesToInsert);
    console.log(`Inserting ${paymentsToInsert.length} payments...`);
    await Payment.insertMany(paymentsToInsert);

    // Update target for Farhan
    await SalesTarget.updateOne({ employee: farhan._id }, { $set: { achievedAmount: totalSalesAchieved } });

    console.log(`\n🎉 MASTER IMPORT COMPLETE FOR FARHAN!`);
    console.log(`Total Leads: ${leadsToInsert.length}`);
    console.log(`Total Quotations: ${quotationsToInsert.length}`);
    console.log(`Total Sales Orders: ${salesOrdersToInsert.length}`);
    console.log(`Total Customer Payments: ${paymentsToInsert.length}`);
    console.log(`Total Sales Achieved: Rs. ${totalSalesAchieved.toLocaleString()}`);
    console.log(`Total Paid Collected: Rs. ${totalPaid.toLocaleString()}`);
    console.log(`Total Receivables: Rs. ${totalReceivables.toLocaleString()}`);

    process.exit(0);
  } catch (err) {
    console.error('Import error:', err);
    process.exit(1);
  }
}

importAllDataMaster();
