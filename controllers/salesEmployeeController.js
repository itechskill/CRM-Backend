const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const DeliveryNote = require('../models/DeliveryNote');
const FollowUp = require('../models/FollowUp');
const SalesTarget = require('../models/SalesTarget');
const SalesActivity = require('../models/SalesActivity');
const Invoice = require('../models/Invoice');
const ProformaInvoice = require('../models/ProformaInvoice');
const Deal = require('../models/Deal');
const CustomerPO = require('../models/CustomerPO');
const ProductFile = require('../models/ProductFile');
const Payment = require('../models/Payment');
const InventoryItem = require('../models/InventoryItem');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Payroll = require('../models/Payroll');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const User = require('../models/User');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { notifyRoleHelper, createNotificationHelper } = require('./notificationController');
const { verifyAndConsumeCEOPermission, logCategoryAEdit, hasFieldValueChanged } = require('../utils/editPermissionHelper');
const { getSalesManagerScope } = require('../utils/salesManagerScope');

// ─────────────────────────────────────────────
// Helper: Log a sales activity
// ─────────────────────────────────────────────
const logSalesActivity = async ({ type, description, relatedModel, relatedId, performedBy }) => {
  try {
    await SalesActivity.create({ type, description, relatedModel, relatedId, performedBy });
  } catch (e) {
    console.error('[SalesActivity Log Error]:', e.message);
  }
};

const checkOwnership = (record, fields, userId, reqUser) => {
  if (reqUser && ['sales_manager', 'admin', 'ceo'].includes(reqUser.role)) {
    return true; // Sales Manager, Admin, CEO have full authorized access to view, edit, and delete any record
  }
  if (!record) return false;
  const userStr = userId.toString();
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return fieldList.some(field => {
    const val = record[field]?.toString?.() || record[field];
    return val === userStr;
  });
};

const CUSTOMER_PO_ATTACHMENT_EXTENSION = /\.(pdf|xls|xlsx|png|jpe?g|webp|gif|bmp)$/i;
const CUSTOMER_PO_ATTACHMENT_DATA_URL = /^data:(application\/pdf|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|image\/(png|jpeg|webp|gif|bmp));base64,/i;
const CUSTOMER_PO_ATTACHMENT_MAX_SIZE = 3 * 1024 * 1024;
const CUSTOMER_PO_ATTACHMENT_MESSAGE = 'Attach the Customer PO as a PDF, Excel file, or screenshot (maximum 3 MB) before continuing.';
const SIGNED_DN_ATTACHMENT_EXTENSION = /\.(pdf|png|jpe?g|webp|gif|bmp)$/i;
const SIGNED_DN_ATTACHMENT_DATA_URL = /^data:(application\/pdf|image\/(png|jpeg|webp|gif|bmp));base64,/i;
const SIGNED_DN_ATTACHMENT_MESSAGE = 'Attach the signed Delivery Note as a PDF or image (maximum 3 MB) before confirming delivery.';

const getBase64DataSize = (dataUrl) => {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.floor((base64.length * 3) / 4) - padding;
};

const hasValidCustomerPOAttachment = (po) => {
  const uploadedDocument = String(po?.uploadedDocument || '').trim();
  const documentName = String(po?.documentName || '').trim();
  return Boolean(
    uploadedDocument &&
    documentName &&
    CUSTOMER_PO_ATTACHMENT_EXTENSION.test(documentName) &&
    CUSTOMER_PO_ATTACHMENT_DATA_URL.test(uploadedDocument) &&
    getBase64DataSize(uploadedDocument) <= CUSTOMER_PO_ATTACHMENT_MAX_SIZE
  );
};

const hasValidSignedDeliveryNoteAttachment = (document, documentName) => Boolean(
  String(document || '').trim() &&
  String(documentName || '').trim() &&
  SIGNED_DN_ATTACHMENT_EXTENSION.test(String(documentName).trim()) &&
  SIGNED_DN_ATTACHMENT_DATA_URL.test(String(document).trim()) &&
  getBase64DataSize(document) <= CUSTOMER_PO_ATTACHMENT_MAX_SIZE
);

const normalizeInventoryName = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const duplicatedSuffix = normalized.match(/^(.*?)\s*\((.*?)\)$/);
  if (duplicatedSuffix && duplicatedSuffix[1].trim() === duplicatedSuffix[2].trim()) {
    return duplicatedSuffix[1].trim();
  }
  return normalized;
};

const getInventoryMatches = (orderItem, inventoryItems) => {
  const productName = normalizeInventoryName(orderItem?.description || orderItem?.name);
  const sku = String(orderItem?.sku || '').trim().toLowerCase();
  return inventoryItems.filter(item => {
    const nameMatches = productName && normalizeInventoryName(item.name) === productName;
    const skuMatches = sku && String(item.sku || '').trim().toLowerCase() === sku;
    return Boolean(nameMatches || skuMatches);
  });
};

const hasInventoryContextMismatch = (inventoryItem, fileType) => {
  const context = `${inventoryItem?.category || ''} ${inventoryItem?.location || ''}`.toLowerCase();
  if (fileType === 'Green') return /(import|logistic|international|global)/.test(context);
  if (fileType === 'Blue') return /(local|domestic)/.test(context);
  return false;
};

const getReceivedQuantityByOrderItem = (order) => {
  const totals = new Map();
  (order.inventoryReceipts || []).forEach(receipt => {
    (receipt.items || []).forEach(item => {
      const key = String(item.orderItemId || '');
      totals.set(key, (totals.get(key) || 0) + (Number(item.receivedQty) || 0));
    });
  });
  return totals;
};

const getSupplierPOForOrder = async (order, session) => {
  let supplierPO = null;
  if (order.supplierPoId && mongoose.Types.ObjectId.isValid(order.supplierPoId)) {
    supplierPO = await SupplierPO.findById(order.supplierPoId).session(session || null);
  }
  if (!supplierPO && order.supplierPO?.poNumber) {
    supplierPO = await SupplierPO.findOne({
      salesOrderId: order._id,
      poNumber: order.supplierPO.poNumber
    }).sort({ createdAt: -1 }).session(session || null);
  }
  if (!supplierPO) {
    supplierPO = await SupplierPO.findOne({ salesOrderId: order._id }).sort({ createdAt: -1 }).session(session || null);
  }
  return supplierPO;
};

const CONFIRMED_DELIVERY_STATUSES = ['Done', 'Delivered', 'Confirmed', 'Fully Delivered'];

const getDeliveryStockRequirements = async (order, { session = null, excludeDeliveryNoteId = null } = {}) => {
  const orderItems = order.items && order.items.length
    ? order.items
    : [{ _id: 'product-summary', description: order.productSummary || 'Product Scope Items', quantity: 1, quantityAssumed: true }];
  const deliveredQuery = {
    salesOrder: order._id,
    status: { $in: CONFIRMED_DELIVERY_STATUSES }
  };
  if (excludeDeliveryNoteId) deliveredQuery._id = { $ne: excludeDeliveryNoteId };
  const [inventoryItems, earlierDeliveryNotes] = await Promise.all([
    InventoryItem.find({}).session(session || null),
    DeliveryNote.find(deliveredQuery).session(session || null)
  ]);

  const deliveredByName = new Map();
  earlierDeliveryNotes.forEach(note => {
    (note.items || []).forEach(item => {
      const name = normalizeInventoryName(item.product || item.description);
      if (!name) return;
      deliveredByName.set(name, (deliveredByName.get(name) || 0) + (Number(item.quantity) || Number(item.demand) || 1));
    });
  });

  const receiptInventoryByOrderItem = new Map();
  (order.inventoryReceipts || []).forEach(receipt => {
    (receipt.items || []).forEach(item => {
      if (item.orderItemId && item.inventoryItem) {
        receiptInventoryByOrderItem.set(String(item.orderItemId), String(item.inventoryItem));
      }
    });
  });

  const requirements = orderItems.map((item, index) => {
    const itemName = String(item.description || item.name || order.productSummary || 'Item').trim();
    const orderedQty = Number(item.quantity) || 1;
    const normalizedItemName = normalizeInventoryName(itemName);
    const deliveredAvailable = deliveredByName.get(normalizedItemName) || 0;
    const deliveredQty = Math.min(orderedQty, deliveredAvailable);
    deliveredByName.set(normalizedItemName, Math.max(0, deliveredAvailable - deliveredQty));
    const requiredQty = Math.max(0, orderedQty - deliveredQty);
    const receiptInventoryId = receiptInventoryByOrderItem.get(String(item._id || 'product-summary'));
    const checkedInventoryId = order.inventoryAnalysis?.[index]?.productId;
    const preferredInventoryId = receiptInventoryId || checkedInventoryId;
    const exactMatches = getInventoryMatches(item, inventoryItems);
    const inventoryItem = preferredInventoryId
      ? inventoryItems.find(candidate => String(candidate._id) === String(preferredInventoryId))
      : (exactMatches.length === 1 ? exactMatches[0] : null);

    return {
      item: itemName,
      quantityAssumed: item.quantityAssumed === true || !(order.items && order.items.length),
      orderedQty,
      deliveredQty,
      requiredQty,
      inventoryItem,
      ambiguous: !preferredInventoryId && exactMatches.length > 1
    };
  });

  const totalsByInventoryId = new Map();
  requirements.forEach(line => {
    if (!line.inventoryItem || line.requiredQty <= 0) return;
    const key = String(line.inventoryItem._id);
    totalsByInventoryId.set(key, (totalsByInventoryId.get(key) || 0) + line.requiredQty);
  });

  const shortages = [];
  const availableByInventoryId = new Map();
  requirements.forEach(line => {
    if (line.requiredQty <= 0) return;
    const inventoryItemId = line.inventoryItem ? String(line.inventoryItem._id) : '';
    if (inventoryItemId && !availableByInventoryId.has(inventoryItemId)) {
      availableByInventoryId.set(
        inventoryItemId,
        Math.max(0, (Number(line.inventoryItem.quantityOnHand) || 0) - (Number(line.inventoryItem.reservedQuantity) || 0))
      );
    }
    const available = inventoryItemId ? availableByInventoryId.get(inventoryItemId) : 0;
    line.availableQty = available;
    if (inventoryItemId) availableByInventoryId.set(inventoryItemId, Math.max(0, available - line.requiredQty));
    if (!line.inventoryItem || available < line.requiredQty) {
      shortages.push({
        item: line.item,
        required: line.requiredQty,
        available,
        reason: line.ambiguous ? 'Multiple exact inventory matches' : (!line.inventoryItem ? 'Not in inventory' : 'Insufficient stock')
      });
    }
  });

  const deductions = Array.from(totalsByInventoryId.entries()).map(([inventoryItemId, quantity]) => ({
    inventoryItemId,
    quantity,
    item: requirements.filter(line => String(line.inventoryItem?._id) === inventoryItemId).map(line => line.item).join(', ')
  }));

  return {
    requirements,
    shortages,
    deductions,
    isFullyInStock: requirements.some(line => line.requiredQty > 0) && shortages.length === 0
  };
};

const formatStockShortageMessage = (shortages) => {
  const details = shortages.map(item => `${item.item} (required ${item.required}, available ${item.available})`).join('; ');
  return `Add inventory first. Insufficient stock: ${details}.`;
};

const allocateGrnNumber = async (session) => {
  const counterKey = getCounterKey('grn-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey, sequence: { $lt: 999999 } },
    { $inc: { sequence: 1 } },
    { new: true, session }
  );
  if (!counter) {
    const exists = await Counter.exists({ _id: counterKey }).session(session || null);
    if (!exists) throw createHttpError(503, 'The GRN counter has not been initialized. Run the approved one-time seed before receiving inventory.');
    throw createHttpError(409, 'The GRN sequence has reached GRN-999999. No further GRNs can be allocated.');
  }
  return `GRN-${String(counter.sequence).padStart(6, '0')}`;
};

const allocateFileNumber = async (fileType) => {
  const normalizedType = fileType === 'Blue' ? 'Blue' : (fileType === 'Green' ? 'Green' : '');
  if (!normalizedType) throw createHttpError(400, 'Select Green or Blue before creating the record.');
  const counterKey = getCounterKey('file-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { sequence: 1 } },
    { new: true }
  );
  if (!counter) {
    throw createHttpError(503, 'The file-number counter has not been initialized. Run the approved one-time seed before creating files.');
  }
  return `${counter.sequence} ${normalizedType}`;
};

const withFileColour = (fileNumber, fileType) => {
  const match = String(fileNumber || '').trim().match(/^(\d+)(?:\s+(?:Green|Blue))?$/i);
  return match ? `${match[1]} ${fileType}` : String(fileNumber || '').trim();
};

const updateLinkedFileColour = async (order, fileType) => {
  const linkedRecords = [
    [Quotation, order.quotationId, 'fileNo'],
    [CustomerPO, order.customerPOId, 'fileNumber'],
    [ProductFile, order.productFileId, 'fileNumber']
  ];

  for (const [Model, recordId, numberField] of linkedRecords) {
    if (!recordId) continue;
    const record = await Model.findById(recordId);
    if (!record) continue;
    record[numberField] = withFileColour(record[numberField], fileType);
    record.fileType = fileType;
    await record.save();
  }
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// DASHBOARD STATS & FINANCIALS FOR SALES TEAM MEMBER
// ══════════════════════════════════════════════
/**
 * @desc    Get Sales Dashboard Stats & Financials for logged-in sales employee
 * @route   GET /api/sales-employee/stats
 * @access  Private/Employee/Sales
 */
const getMySalesStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [leads, quotations, orders, deals, followUps, targets, user, invoices, payroll, attendances, leaves, tasks, projects] = await Promise.all([
      Lead.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] }),
      Quotation.find({ createdBy: userId }),
      SalesOrder.find({ $or: [{ salesPerson: userId }, { createdBy: userId }] }),
      Deal.find({ $or: [{ assignedTo: userId }, { createdBy: userId }] }),
      FollowUp.find({ createdBy: userId }),
      SalesTarget.find({ employee: userId }).sort({ createdAt: -1 }),
      User.findById(userId),
      Invoice.find({ $or: [{ salesPerson: userId }, { createdBy: userId }] }),
      Payroll.findOne({ user: userId, month: now.getMonth() + 1, year: now.getFullYear() }),
      Attendance.find({ user: userId, date: { $gte: startOfMonth } }),
      Leave.find({ user: userId, createdAt: { $gte: startOfMonth } }),
      Task.find({ assignedTo: userId }),
      Project.find({ $or: [{ team: userId }, { createdBy: userId }, { projectManager: userId }] })
    ]);

    // Lead stats
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted').length;
    const qualifiedLeads = leads.filter(l => l.status === 'Qualified').length;
    const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
    const leadConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Quotation stats
    const totalQuotations = quotations.length;
    const acceptedQuotations = quotations.filter(q => q.status === 'Accepted').length;
    const sentQuotations = quotations.filter(q => q.status === 'Sent').length;

    // Order stats
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.status === 'Delivered' || o.status === 'Completed').length;
    const totalOrdersValue = orders.reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);
    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Completed', 'Finance Approved', 'Sales Order'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.netAmount) || Number(o.totalAmount) || 0), 0);

    // Deal stats
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const activeDeals = deals.filter(d => !['Won', 'Closed Won', 'Closed Lost'].includes(d.stage));
    const pipelineValue = activeDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // Invoice stats
    const totalInvoicesCount = invoices.length;
    const approvedInvoicesList = invoices.filter(i => ['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue', 'Paid'].includes(i.status) || (!i.isDraft && i.status !== 'Draft' && i.status !== 'Cancelled'));
    const approvedInvoicesCount = approvedInvoicesList.length;
    const approvedInvoicesAmount = approvedInvoicesList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const paidInvoicesAmount = invoices.reduce((sum, i) => sum + (Number(i.paidAmount) || (i.status === 'Paid' ? Number(i.amount) : 0)), 0);

    // Follow-up stats
    const totalFollowUps = followUps.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    const pendingFollowUps = totalFollowUps - completedFollowUps;

    // ── LEGIT SALES ACHIEVED ──
    const salesAchieved = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);

    // ── TARGET QUOTA ──
    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || (user?.salaryTarget ? user.salaryTarget * 5 : 0);
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);
    const targetAchievementPct = monthlyTarget > 0 ? Math.round((salesAchieved / monthlyTarget) * 100) : (salesAchieved > 0 ? 100 : 0);

    // ── FINANCIALS ──
    // 1. Receivables: Strictly approved / finalized invoices with unpaid balance
    const receivableInvoices = invoices.filter(i =>
      (['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status) || (!i.isDraft && i.status !== 'Draft')) &&
      i.status !== 'Paid' &&
      i.status !== 'Cancelled'
    );
    const receivables = receivableInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const invoiceReceivables = receivables;
    const orderReceivables = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Completed', 'Finance Approved'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.outstandingBalance != null ? o.outstandingBalance : (o.netAmount || o.totalAmount)) || 0), 0);

    // 2. Overdue: Strictly approved / finalized invoices past due date or marked overdue with unpaid balance
    const overdueInvoices = invoices.filter(i => {
      const isApproved = ['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status) || (!i.isDraft && i.status !== 'Draft');
      const isPastDue = i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now);
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return isApproved && isPastDue && outstanding > 0 && i.status !== 'Paid' && i.status !== 'Cancelled';
    });
    const overdueAmount = overdueInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);
    const overdueInvoiceAmount = overdueAmount;
    const overdueOrderAmount = 0;

    // 3. Salary Target: From employee user record, payroll base/net salary
    const salaryTarget = Number(user?.salaryTarget) || Number(user?.salary) || Number(payroll?.baseSalary) || Number(payroll?.netPay) || 0;

    // 4. Liability: Cancelled orders or liabilities
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);

    // 5. Net Revenue: Settled/collected revenue or sales achieved
    const netRevenue = paidInvoicesAmount > 0 ? paidInvoicesAmount : salesAchieved;

    // ── ATTENDANCE & LEAVE SUMMARY ──
    const presentDays = attendances.filter(a => a.status === 'Present').length;
    const lateDays = attendances.filter(a => a.status === 'Late').length;
    const leaveDays = leaves.filter(l => l.status === 'Approved').length;
    const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;

    // ── ASSIGNED PROJECTS & PENDING TASKS ──
    const pendingTasksList = tasks.filter(t => t.status !== 'Completed');
    const completedTasksCount = tasks.filter(t => t.status === 'Completed').length;
    const pendingTasksCount = pendingTasksList.length;
    const assignedProjectsCount = projects.length;

    return res.status(200).json({
      success: true,
      data: {
        // Sales Performance Metrics
        salesPerformance: {
          monthlyTarget,
          salesAchieved,
          remainingTarget,
          targetAchievementPct,
          totalLeads,
          convertedLeads,
          qualifiedLeads,
          pendingLeads,
          leadConversionRate,
          totalQuotations,
          acceptedQuotations,
          sentQuotations,
          totalOrders,
          completedOrders,
          totalOrdersValue,
          totalDeals,
          wonDealsCount,
          wonDealsValue,
          pipelineValue,
          totalFollowUps,
          completedFollowUps,
          pendingFollowUps
        },
        // Financial Performance Metrics
        financialPerformance: {
          receivables,
          invoiceReceivables,
          orderReceivables,
          overdueAmount,
          overdueInvoiceAmount,
          overdueOrderAmount,
          salaryTarget,
          liability,
          netRevenue,
          totalInvoicesCount,
          approvedInvoicesCount,
          paidInvoicesAmount,
          paidInvoicesCount: paidInvoices.length,
          unpaidInvoicesCount: receivableInvoices.length,
          overdueInvoicesCount: overdueInvoices.length
        },
        // Flat aliases for backwards compatibility
        totalLeads,
        convertedLeads,
        pendingLeads,
        totalQuotations,
        acceptedQuotations,
        totalOrders,
        completedOrders,
        totalFollowUps,
        completedFollowUps,
        monthlyTarget,
        salesAchieved,
        remainingTarget,
        targetAchievementPct,
        receivables,
        overdueAmount,
        salaryTarget,
        liability,
        totalInvoicesCount,
        approvedInvoicesCount,
        paidInvoicesAmount,
        activeTarget: activeTarget ? { ...activeTarget.toJSON(), achievedAmount: salesAchieved, targetAmount: monthlyTarget } : null,
        // Projects & Tasks
        assignedProjectsCount,
        pendingTasksCount,
        completedTasksCount,
        pendingTasks: pendingTasksList.slice(0, 10),
        assignedProjects: projects.slice(0, 10),
        attendanceSummary: {
          presentDays,
          lateDays,
          leaveDays,
          pendingLeaves
        }
      }
    });
  } catch (error) {
    console.error('[Sales Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching sales stats.' });
  }
};

// ══════════════════════════════════════════════
// LEADS (SALES TEAM MEMBER)
// ══════════════════════════════════════════════
/**
 * @desc    Get my leads (assigned or created)
 * @route   GET /api/sales-employee/leads
 */
const getMyLeads = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, search } = req.query;

    const query = {
      $or: [{ assignedTo: userId }, { createdBy: userId }]
    };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [
        { $or: [{ assignedTo: userId }, { createdBy: userId }] },
        { $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }] }
      ];
      delete query.$or;
    }

    const leads = await Lead.find(query).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: leads.length, data: leads });
  } catch (error) {
    console.error('[Get My Leads Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching leads.' });
  }
};

/**
 * @desc    Create a lead for logged-in sales team member
 * @route   POST /api/sales-employee/leads
 */
const createMyLead = async (req, res) => {
  try {
    const { name, company, contactPerson, email, phone, status, value, source, notes, requirements, followUpDate } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Lead name is required.' });

    const lead = await Lead.create({
      name: name.trim(),
      company: company?.trim() || '',
      contactPerson: contactPerson?.trim() || '',
      email: email?.trim() || '',
      phone: phone?.trim() || '',
      status: status || 'New',
      value: value ? Number(value) : 0,
      source: source || 'Direct',
      notes: notes || '',
      requirements: requirements || '',
      followUpDate: followUpDate || null,
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Lead Created',
      description: `Created lead: ${lead.name}${lead.company ? ` from ${lead.company}` : ''}`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      relatedCustomer: lead.name,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Lead Created',
      message: `${req.user.fullName} created a new lead: ${lead.name}${lead.company ? ' from ' + lead.company : ''}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Lead created successfully.', data: lead });
  } catch (error) {
    console.error('[Create Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating lead.' });
  }
};

/**
 * @desc    Update my lead (ownership enforced)
 * @route   PATCH /api/sales-employee/leads/:id
 */
const updateMyLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    if (!checkOwnership(lead, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own leads.' });
    }

    const prevStatus = lead.status;
    const allowedFields = ['name', 'company', 'contactPerson', 'email', 'phone', 'status', 'value', 'source', 'notes', 'requirements', 'followUpDate'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) lead[field] = req.body[field];
    });

    await lead.save();

    const actType = (lead.status === 'Converted' || lead.status === 'Converted to Deal') ? 'Lead Converted' : 'Lead Updated';
    await logSalesActivity({
      type: actType,
      description: `Updated lead: ${lead.name} — status: ${lead.status} (was ${prevStatus})`,
      relatedModel: 'Lead',
      relatedId: lead._id,
      relatedCustomer: lead.name,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Lead updated.', data: lead });
  } catch (error) {
    console.error('[Update Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating lead.' });
  }
};

/**
 * @desc    Convert Lead to Deal (Preserves Lead record as Converted)
 * @route   POST /api/sales-employee/leads/:id/convert-to-deal
 */
const convertLeadToDeal = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });

    const { title, value, stage, probability, closingDate, notes } = req.body;

    // Create linked Deal
    const deal = await Deal.create({
      title: (title || `${lead.name} - Deal`).trim(),
      clientName: lead.company || lead.name,
      company: lead.company || '',
      contactPerson: lead.contactPerson || lead.name,
      contactEmail: lead.email || '',
      contactPhone: lead.phone || '',
      requirements: lead.requirements || '',
      value: Number(value || lead.value || 0),
      stage: stage || 'Qualification',
      probability: probability !== undefined ? Number(probability) : 60,
      closingDate: closingDate ? new Date(closingDate) : null,
      notes: notes || lead.notes || '',
      leadId: lead._id,
      assignedTo: lead.assignedTo || req.user._id,
      createdBy: req.user._id
    });

    // Update Lead status to 'Converted' without deleting the lead record!
    lead.status = 'Converted';
    await lead.save();

    await logSalesActivity({
      type: 'Lead Converted',
      description: `Converted lead "${lead.name}" to deal "${deal.title}" (Rs. ${Number(deal.value).toLocaleString()})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      relatedCustomer: deal.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Lead Converted to Deal',
      message: `${req.user.fullName} converted lead "${lead.name}" into deal "${deal.title}".`,
      type: 'sales'
    });

    return res.status(201).json({
      success: true,
      message: 'Lead successfully converted to Deal.',
      data: { deal, lead }
    });
  } catch (error) {
    console.error('[Convert Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error converting lead.' });
  }
};

// ══════════════════════════════════════════════
// DEALS (SALES TEAM MEMBER)
// ══════════════════════════════════════════════
/**
 * @desc    Get my deals
 * @route   GET /api/sales-employee/deals
 */
const getMyDeals = async (req, res) => {
  try {
    const userId = req.user._id;
    const { stage, search } = req.query;

    const query = {
      $or: [{ assignedTo: userId }, { createdBy: userId }]
    };

    if (stage && stage !== 'all') {
      query.stage = stage;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [
        { $or: [{ assignedTo: userId }, { createdBy: userId }] },
        { $or: [{ title: regex }, { clientName: regex }] }
      ];
      delete query.$or;
    }

    const deals = await Deal.find(query).populate('leadId', 'name company email phone').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: deals.length, data: deals });
  } catch (error) {
    console.error('[Get My Deals Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching deals.' });
  }
};

/**
 * @desc    Create a deal for sales employee
 * @route   POST /api/sales-employee/deals
 */
const createMyDeal = async (req, res) => {
  try {
    const { title, clientName, company, contactPerson, contactEmail, contactPhone, requirements, products, value, stage, probability, closingDate, leadId, notes } = req.body;
    if (!title || !clientName) {
      return res.status(400).json({ success: false, message: 'Deal title and client name are required.' });
    }

    const deal = await Deal.create({
      title: title.trim(),
      clientName: clientName.trim(),
      company: company?.trim() || '',
      contactPerson: contactPerson?.trim() || '',
      contactEmail: contactEmail?.trim() || '',
      contactPhone: contactPhone?.trim() || '',
      requirements: requirements || '',
      products: products || [],
      value: value ? Number(value) : 0,
      stage: stage || 'Qualification',
      probability: probability !== undefined ? Number(probability) : 50,
      closingDate: closingDate || null,
      leadId: leadId || null,
      notes: notes || '',
      assignedTo: req.user._id,
      createdBy: req.user._id
    });

    if (leadId) {
      await Lead.findByIdAndUpdate(leadId, { status: 'Converted' });
    }

    await logSalesActivity({
      type: 'Deal Created',
      description: `Created deal "${deal.title}" for ${deal.clientName} (Rs. ${Number(deal.value).toLocaleString()})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      relatedCustomer: deal.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager about new deal
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Deal Created',
      message: `${req.user.fullName} created deal "${deal.title}" for ${deal.clientName} (Rs. ${Number(deal.value).toLocaleString()}).`,
      type: 'sales'
    });

    if (['Won', 'Closed Won'].includes(deal.stage)) {
      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} ($${(deal.value || 0).toLocaleString()}) won by ${req.user.fullName}. Ready for invoice.`,
        type: 'deal'
      });
    }

    return res.status(201).json({ success: true, message: 'Deal created successfully.', data: deal });
  } catch (error) {
    console.error('[Create Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating deal.' });
  }
};

/**
 * @desc    Update my deal
 * @route   PATCH /api/sales-employee/deals/:id
 */
const updateMyDeal = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });

    if (!checkOwnership(deal, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own deals.' });
    }

    const prevStage = deal.stage;
    const allowedFields = ['title', 'clientName', 'company', 'contactPerson', 'contactEmail', 'contactPhone', 'requirements', 'products', 'value', 'stage', 'probability', 'closingDate', 'leadId', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) deal[field] = req.body[field];
    });

    await deal.save();

    await logSalesActivity({
      type: deal.stage === 'Won' || deal.stage === 'Closed Won' ? 'Deal Won' : 'Deal Updated',
      description: `Updated deal "${deal.title}" — stage: ${deal.stage} (was ${prevStage})`,
      relatedModel: 'Deal',
      relatedId: deal._id,
      performedBy: req.user._id
    });

    if (['Won', 'Closed Won'].includes(deal.stage) && !['Won', 'Closed Won'].includes(prevStage)) {
      if (deal.leadId) {
        await Lead.findByIdAndUpdate(deal.leadId, { status: 'Converted' });
      } else if (deal.clientName) {
        await Lead.updateMany(
          { $or: [{ name: deal.clientName }, { company: deal.clientName }], status: { $ne: 'Converted' } },
          { status: 'Converted' }
        );
      }

      await notifyRoleHelper({
        role: 'accountant',
        sender: req.user._id,
        title: 'New Deal Won — Ready for Invoice',
        message: `Deal "${deal.title}" for ${deal.clientName} (Rs. ${(deal.value || 0).toLocaleString()}) won by ${req.user.fullName}. Ready for invoice.`,
        type: 'deal'
      });
    }

    return res.status(200).json({ success: true, message: 'Deal updated successfully.', data: deal });
  } catch (error) {
    console.error('[Update Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating deal.' });
  }
};

// ══════════════════════════════════════════════
// INVOICES (SALES TEAM MEMBER WORKFLOW)
// ══════════════════════════════════════════════
/**
 * @desc    Get my invoices & eligible won deals/sales
 * @route   GET /api/sales-employee/invoices
 */
const getMyInvoices = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, search } = req.query;

    const isGlobal = ['admin', 'ceo', 'accountant', 'finance', 'sales_manager'].includes(req.user.role) ||
      ['accounts', 'finance', 'administration'].includes((req.user.department || '').toLowerCase());
    const query = isGlobal ? {} : { createdBy: userId };
    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ invoiceNumber: regex }, { clientName: regex }, { dealTitle: regex }, { saleReference: regex }, { salePerson: regex }];
    }

    const [invoices, eligibleDeals, eligibleOrders] = await Promise.all([
      Invoice.find(query)
        .populate('dealId', 'title value stage clientName contactEmail contactPhone')
        .populate('createdBy', 'fullName email position role')
        .populate('reviewedBy', 'fullName email position role')
        .populate('salesPerson', 'fullName email position role')
        .sort({ createdAt: -1 }),
      Deal.find({
        assignedTo: userId,
        stage: { $in: ['Won', 'Closed Won'] }
      }).select('title value stage clientName contactEmail contactPhone description createdAt').sort({ createdAt: -1 }),
      SalesOrder.find({
        createdBy: userId,
        status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered'] }
      }).select('orderNumber clientName contactEmail contactPhone netAmount items status createdAt').sort({ createdAt: -1 })
    ]);

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices,
      eligibleWonSales: {
        deals: eligibleDeals,
        orders: eligibleOrders
      }
    });
  } catch (error) {
    console.error('[Get My Invoices Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching invoices.' });
  }
};

/**
 * @desc    Create invoice for won deal or sales order
 * @route   POST /api/sales-employee/invoices
 */
const createMyInvoice = async (req, res) => {
  try {
    const {
      clientName,
      customerEmail,
      customerPhone,
      customerAddress,
      dealId,
      dealTitle,
      saleReference,
      salesOrderId,
      salesOrderNumber,
      deliveryNoteId,
      deliveryNoteNumber,
      fileNumber,
      fileType,
      items,
      subtotal,
      tax,
      taxRate,
      discount,
      amount,
      paymentTerms,
      issueDate,
      dueDate,
      description,
      notes,
      status
    } = req.body;

    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid total invoice amount is required.' });
    }
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'Due date is required.' });
    }

    // Check if invoice already exists for this deal to prevent accidental duplicates
    if (dealId) {
      const existing = await Invoice.findOne({ dealId });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `An invoice (${existing.invoiceNumber}) has already been generated for this deal.`
        });
      }
    }

    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${String(count + 1001).padStart(5, '0')}`;

    // Process line items if provided
    let processedItems = [];
    if (Array.isArray(items) && items.length > 0) {
      processedItems = items.map(item => ({
        description: item.description || 'Sales Item',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        total: Number(item.total) || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0))
      }));
    } else {
      processedItems = [{
        description: dealTitle || 'Professional Sales / Project Services',
        quantity: 1,
        unitPrice: Number(amount),
        total: Number(amount)
      }];
    }

    const initialStatus = status || 'Draft';
    const isDraft = initialStatus === 'Draft' || initialStatus === 'Pending Finance Finalization' || req.body.isDraft !== false;

    let resolvedSalePerson = req.body.salePerson || '';
    let resolvedSalesPersonId = null;
    let resolvedDeliveryNoteId = deliveryNoteId || null;
    let resolvedDeliveryNoteNumber = deliveryNoteNumber || '';

    if (salesOrderId) {
      const linkedSo = await SalesOrder.findById(salesOrderId).populate('salesPerson');
      if (linkedSo) {
        resolvedSalePerson = resolvedSalePerson || linkedSo.salePerson || (linkedSo.salesPerson && linkedSo.salesPerson.fullName) || '';
        resolvedSalesPersonId = linkedSo.salesPerson?._id || linkedSo.salesPerson || linkedSo.createdBy || null;
        if (!resolvedDeliveryNoteId && linkedSo.deliveryNoteId) {
          resolvedDeliveryNoteId = linkedSo.deliveryNoteId;
          resolvedDeliveryNoteNumber = linkedSo.deliveryNoteNumber || '';
        }
      }
    }

    if (resolvedDeliveryNoteId && (!resolvedSalesPersonId || !resolvedSalePerson)) {
      const linkedDn = await DeliveryNote.findById(resolvedDeliveryNoteId).populate('salesOrder');
      if (linkedDn) {
        if (!salesOrderId && linkedDn.salesOrder) {
          salesOrderId = linkedDn.salesOrder._id || linkedDn.salesOrder;
          salesOrderNumber = linkedDn.salesOrderNumber || linkedDn.salesOrder.orderNumber || linkedDn.salesOrder.orderReference || '';
        }
        resolvedSalePerson = resolvedSalePerson || linkedDn.salePerson || (linkedDn.salesOrder && (linkedDn.salesOrder.salePerson || (linkedDn.salesOrder.salesPerson && linkedDn.salesOrder.salesPerson.fullName))) || '';
        resolvedSalesPersonId = resolvedSalesPersonId || linkedDn.salesPerson || (linkedDn.salesOrder && (linkedDn.salesOrder.salesPerson?._id || linkedDn.salesOrder.salesPerson)) || null;
      }
    }

    const invoice = await Invoice.create({
      invoiceNumber,
      clientName: clientName.trim(),
      customerEmail: customerEmail?.trim() || '',
      customerPhone: customerPhone?.trim() || '',
      customerAddress: customerAddress?.trim() || '',
      dealId: dealId || null,
      dealTitle: dealTitle || '',
      saleReference: saleReference || '',
      salesOrderId: salesOrderId || null,
      salesOrderNumber: salesOrderNumber || '',
      deliveryNoteId: resolvedDeliveryNoteId,
      deliveryNoteNumber: resolvedDeliveryNoteNumber,
      fileNumber: fileNumber || '',
      fileType: fileType || '',
      items: processedItems,
      subtotal: Number(subtotal) || Number(amount),
      tax: Number(tax) || 0,
      taxRate: Number(taxRate) || 0,
      discount: Number(discount) || 0,
      amount: Number(amount),
      paidAmount: 0,
      outstandingAmount: Number(amount),
      status: initialStatus,
      isDraft: isDraft,
      invoiceType: req.body.invoiceType || 'Standard',
      paymentTerms: paymentTerms || 'Net 30',
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: new Date(dueDate),
      description: description || '',
      notes: notes || '',
      salePerson: resolvedSalePerson || req.user.fullName || '',
      salesPerson: resolvedSalesPersonId || (req.user.department === 'Sales' ? req.user._id : null),
      departmentResponsible: 'Accounts',
      createdBy: req.user._id
    });

    // Mark linked Delivery Note as invoiced (removes DN from Accounts Pending Draft Invoices queue)
    if (resolvedDeliveryNoteId) {
      await DeliveryNote.findByIdAndUpdate(resolvedDeliveryNoteId, {
        invoiced: true,
        invoiceId: invoice._id,
        invoiceNumber: invoiceNumber,
        invoicedAt: new Date()
      });
    }

    // Update Sales Order linkage
    if (salesOrderId) {
      await SalesOrder.findByIdAndUpdate(salesOrderId, {
        invoiceId: invoice._id,
        invoiceNumber: invoiceNumber,
        invoiceStatus: 'To Invoice',
        workflowStatus: 'Draft Invoice Created',
        departmentResponsible: 'Accounts',
        currentDepartment: 'Accounts',
        currentStatus: 'DRAFT_INVOICE_CREATED',
        previousDepartment: 'Support',
        previousStatus: 'Delivery Note Created',
        lastAction: `Draft Invoice ${invoiceNumber} Created`,
        lastActionBy: req.user._id,
        lastActionByName: req.user.fullName,
        lastActionAt: new Date()
      });
    }

    await logSalesActivity({
      type: 'Invoice Created',
      description: `Generated ${isDraft ? 'Draft ' : ''}invoice ${invoiceNumber} for ${invoice.clientName} (PKR ${Number(invoice.amount).toLocaleString()}) - Status: ${initialStatus}`,
      relatedModel: 'Invoice',
      relatedId: invoice._id,
      performedBy: req.user._id
    });

    // Notify Sales Manager for invoice review
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Invoice Submitted for Review',
      message: `New invoice ${invoiceNumber} has been submitted by ${req.user.fullName} for review.`,
      type: 'sales'
    });

    // Also Notify Finance / Accountant portal
    await notifyRoleHelper({
      role: 'accountant',
      sender: req.user._id,
      title: 'New Invoice Created',
      message: `Invoice ${invoiceNumber} for ${invoice.clientName} ($${invoice.amount.toLocaleString()}) was created by ${req.user.fullName}.`,
      type: 'finance'
    });

    return res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNumber} created and submitted for review.`,
      data: invoice
    });
  } catch (error) {
    console.error('[Create Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating invoice.' });
  }
};

// ══════════════════════════════════════════════
// QUOTATIONS
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// CUSTOMER OVERDUE HELPER & QUOTATION CONVERSION
// ══════════════════════════════════════════════
const calculateCustomerOverdue = async (clientName) => {
  if (!clientName || !clientName.trim()) return { isOverdue: false, overdueAmount: 0, overdueInvoices: [] };
  const trimmed = clientName.trim();
  const now = new Date();

  // Check all non-cancelled, unpaid invoices (including draft invoices from Accounts/Finance) past dueDate
  const invoices = await Invoice.find({
    clientName: { $regex: new RegExp('^' + trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
    status: { $nin: ['Cancelled', 'Paid'] },
    dueDate: { $lt: now }
  });

  let overdueAmount = 0;
  const overdueInvoices = [];
  invoices.forEach(inv => {
    const amt = Number(inv.amount) || 0;
    const paid = Number(inv.paidAmount) || 0;
    const remaining = Math.max(0, amt - paid);
    if (remaining > 0) {
      const daysOverdue = Math.max(0, Math.floor((now - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24)));
      overdueAmount += remaining;
      overdueInvoices.push({
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        salesOrderNumber: inv.salesOrderNumber || '',
        amount: amt,
        paidAmount: paid,
        remaining,
        dueDate: inv.dueDate,
        daysOverdue,
        status: inv.status
      });
    }
  });

  return {
    isOverdue: overdueAmount > 0,
    overdueAmount,
    overdueInvoices
  };
};

const checkCustomerOverdueApi = async (req, res) => {
  try {
    const { clientName } = req.query;
    const result = await calculateCustomerOverdue(clientName);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Check Customer Overdue Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error checking customer overdue status.' });
  }
};

/**
 * @desc    Convert Quotation to Customer Purchase Order (PO)
 * @route   POST /api/sales-employee/quotations/:id/convert-to-po
 */
const convertQuotationToCustomerPO = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    const { poNumber, poDate, notes, uploadedDocument, documentName } = req.body;
    if (!hasValidCustomerPOAttachment({ uploadedDocument, documentName })) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const netAmt = Number(quotation.netAmount) || Number(quotation.totalAmount) || 0;

    const po = await CustomerPO.create({
      poNumber: poNumber?.trim() || '',
      poDate: poDate ? new Date(poDate) : new Date(),
      customerName: quotation.clientName,
      quotationId: quotation._id,
      quotationNumber: quotation.orderReference || quotation.quotationNumber || '',
      fileNumber: quotation.fileNo || '',
      fileType: quotation.fileType || '',
      amount: netAmt,
      notes: notes || quotation.notes || '',
      uploadedDocument: uploadedDocument || '',
      documentName: documentName || '',
      status: 'Received',
      createdBy: req.user._id
    });

    // Mark quotation as converted to Customer PO so it is removed from active quotations
    quotation.status = 'Converted to Customer PO';
    quotation.customerPOId = po._id;
    quotation.convertedAt = new Date();
    await quotation.save();

    await logSalesActivity({
      type: 'Quotation Converted to Customer PO',
      description: `Converted Quotation ${quotation.orderReference || quotation.quotationNumber} to Customer PO ${po.poNumber}`,
      relatedModel: 'CustomerPO',
      relatedId: po._id,
      relatedCustomer: po.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(201).json({
      success: true,
      message: `Quotation ${quotation.orderReference || quotation.quotationNumber} successfully converted to Customer PO ${po.poNumber}!`,
      data: { po, quotation }
    });
  } catch (error) {
    console.error('[Convert Quotation to PO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error converting quotation to customer PO.' });
  }
};

/**
 * @desc    Convert Customer PO to Product File (Blue/Green/Yellow)
 * @route   POST /api/sales-employee/customer-pos/:id/convert-to-file
 */
const convertCustomerPOToProductFile = async (req, res) => {
  try {
    const po = await CustomerPO.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: 'Customer PO not found.' });
    }
    if (!hasValidCustomerPOAttachment(po)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }

    const { fileType, products, notes } = req.body;

    let quoteItems = [];
    let quotationNumber = po.quotationNumber || '';
    let linkedQuotation = null;
    if (po.quotationId) {
      linkedQuotation = await Quotation.findById(po.quotationId);
      if (linkedQuotation) {
        quotationNumber = linkedQuotation.orderReference || linkedQuotation.quotationNumber || quotationNumber;
        if (linkedQuotation.items && linkedQuotation.items.length) {
          quoteItems = linkedQuotation.items.map(it => ({
            name: it.description || 'Item',
            quantity: it.quantity || 1,
            unit: 'pcs',
            description: it.description || ''
          }));
        }
      }
    }

    const resolvedFileType = po.fileType || linkedQuotation?.fileType || fileType;
    const resolvedFileNumber = po.fileNumber || linkedQuotation?.fileNo || await allocateFileNumber(resolvedFileType);

    const file = await ProductFile.create({
      fileNumber: resolvedFileNumber,
      fileType: resolvedFileType,
      customerName: po.customerName,
      quotationId: po.quotationId || null,
      quotationNumber: quotationNumber,
      customerPOId: po._id,
      customerPONumber: po.poNumber || '',
      products: Array.isArray(products) && products.length > 0 ? products : quoteItems,
      notes: notes || po.notes || '',
      status: 'Active',
      createdBy: req.user._id
    });

    // Mark PO as Processed so it is removed from active POs list
    po.status = 'Processed';
    if (!po.fileNumber) po.fileNumber = resolvedFileNumber;
    if (!po.fileType) po.fileType = resolvedFileType;
    await po.save();

    await logSalesActivity({
      type: 'Customer PO Converted to Product File',
      description: `Converted Customer PO ${po.poNumber} to ${file.fileType} File ${file.fileNumber || file._id}`,
      relatedModel: 'ProductFile',
      relatedId: file._id,
      relatedCustomer: file.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(201).json({
      success: true,
      message: `Customer PO ${po.poNumber} converted to Product File ${file.fileNumber || file._id}!`,
      data: { file, po }
    });
  } catch (error) {
    console.error('[Convert PO to File Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error converting customer PO to product file.' });
  }
};

/**
 * @desc    Convert Product File to Sales Order (auto links Quotation + PO + File & moves to Finance)
 * @route   POST /api/sales-employee/product-files/:id/convert-to-order
 */
const convertProductFileToSalesOrder = async (req, res) => {
  try {
    const file = await ProductFile.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ success: false, message: 'Product file not found.' });
    }

    if (!file.customerPOId) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const customerPO = await CustomerPO.findById(file.customerPOId);
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }

    const { orderReference, clientAddress, clientEmail, clientPhone, items, totalAmount, discount, tax, netAmount, deliveryDate, notes, stockStatus } = req.body;

    // Check overdue balance of customer
    const overdueInfo = await calculateCustomerOverdue(file.customerName);
    const requiresApproval = overdueInfo.isOverdue;

    let quoteRef = null;
    let netAmt = Number(netAmount) || Number(totalAmount) || 0;
    let orderItems = Array.isArray(items) && items.length > 0 ? items : [];

    if (file.quotationId) {
      quoteRef = await Quotation.findById(file.quotationId);
      if (quoteRef && (!netAmt || netAmt === 0)) {
        netAmt = Number(quoteRef.netAmount) || Number(quoteRef.totalAmount) || 0;
      }
      if (quoteRef && orderItems.length === 0 && quoteRef.items && quoteRef.items.length) {
        orderItems = quoteRef.items;
      }
    }

    if (orderItems.length === 0 && file.products && file.products.length) {
      orderItems = file.products.map(p => ({
        description: p.description || p.name,
        quantity: p.quantity || 1,
        unitPrice: netAmt / (p.quantity || 1) || 0,
        total: netAmt || 0
      }));
    }

    const order = await SalesOrder.create({
      orderReference: orderReference?.trim() || (quoteRef ? quoteRef.orderReference : '') || '',
      clientName: file.customerName,
      clientAddress: clientAddress || (quoteRef ? quoteRef.clientAddress : '') || '',
      salePerson: req.user.fullName,
      fileNo: file.fileNumber || '',
      fileType: file.fileType || '',
      productSummary: orderItems.map(i => i.description).filter(Boolean).join(', ') || 'Standard Order Items',
      clientEmail: clientEmail || (quoteRef ? quoteRef.clientEmail : '') || '',
      clientPhone: clientPhone || (quoteRef ? quoteRef.clientPhone : '') || '',
      items: orderItems,
      totalAmount: Number(totalAmount) || netAmt,
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      netAmount: netAmt,
      outstandingBalance: netAmt,
      totalPaid: 0,
      status: 'Sales Order',
      workflowStatus: 'Draft',
      departmentResponsible: 'Sales',
      currentDepartment: 'Sales',
      currentStatus: 'SALES_ORDER_CREATED',
      previousDepartment: '',
      previousStatus: '',
      lastAction: 'Sales Order Created',
      lastActionBy: req.user._id,
      lastActionByName: req.user.fullName,
      lastActionAt: new Date(),
      customerOverdueAtCreation: overdueInfo.overdueAmount,
      requiresFinanceApproval: false,
      stockStatus: stockStatus || 'Available',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Pending',
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      creationDate: new Date(),
      orderDate: new Date(),
      notes: notes || file.notes || '',
      quotationId: file.quotationId || (quoteRef ? quoteRef._id : null),
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || file.customerPONumber || '',
      productFileId: file._id,
      salesPerson: req.user._id,
      createdBy: req.user._id,
      workflowHistory: [
        {
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Sales',
          action: 'Sales Order Created',
          previousStatus: 'None',
          newStatus: 'Draft',
          timestamp: new Date(),
          notes: `Created from Product File ${file.fileNumber || file._id}. Ready in Sales portal for Move to Finance.`
        }
      ]
    });

    // Mark Product File as Completed so it is removed from active files list
    file.status = 'Completed';
    file.salesOrderId = order._id;
    file.salesOrderNumber = order.orderNumber || order.orderReference;
    await file.save();

    // If quotation linked, mark converted
    if (file.quotationId) {
      await Quotation.findByIdAndUpdate(file.quotationId, {
        status: 'Converted to Sales Order',
        salesOrderId: order._id,
        salesOrderNumber: order.orderNumber || order.orderReference,
        convertedAt: new Date()
      });
    }

    // If Customer PO linked, mark processed
    if (file.customerPOId) {
      await CustomerPO.findByIdAndUpdate(file.customerPOId, {
        status: 'Processed',
        salesOrderId: order._id
      });
    }

    await logSalesActivity({
      type: 'Product File Converted to Sales Order',
      description: `Converted Product File ${file.fileNumber || file._id} to Sales Order ${order.orderNumber || order.orderReference}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: order.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(201).json({
      success: true,
      message: `Product File ${file.fileNumber || file._id} successfully converted to Sales Order ${order.orderNumber || order.orderReference}! Click 'Move to Finance' when ready for overdue approval.`,
      data: { order, file }
    });
  } catch (error) {
    console.error('[Convert File to Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error converting product file to sales order.' });
  }
};

/**
 * @desc    Convert Quotation to Sales Order (removes quotation from active list)
 * @route   POST /api/sales-employee/quotations/:id/convert-to-order
 */
const convertQuotationToSalesOrder = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    if (quotation.status === 'Converted to Sales Order' || quotation.status === 'Converted') {
      return res.status(400).json({
        success: false,
        message: 'This quotation has already been converted to a Sales Order.',
        salesOrderId: quotation.salesOrderId,
        salesOrderNumber: quotation.salesOrderNumber
      });
    }

    if (!quotation.customerPOId) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const customerPO = await CustomerPO.findById(quotation.customerPOId);
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }

    const { deliveryDate, notes, stockStatus } = req.body;

    // Check overdue balance of customer using finalized invoices only
    const overdueInfo = await calculateCustomerOverdue(quotation.clientName);
    const requiresApproval = overdueInfo.isOverdue;
    const netAmt = Number(quotation.netAmount) || Number(quotation.totalAmount) || 0;

    const order = await SalesOrder.create({
      orderReference: req.body.orderReference || quotation.orderReference || '',
      clientName: quotation.clientName,
      clientAddress: quotation.clientAddress || '',
      salePerson: quotation.salePerson || req.user.fullName,
      fileNo: quotation.fileNo || '',
      fileType: quotation.fileType || '',
      productSummary: quotation.productSummary || '',
      clientEmail: quotation.clientEmail || '',
      clientPhone: quotation.clientPhone || '',
      items: quotation.items && quotation.items.length > 0 ? quotation.items : [{
        description: quotation.productSummary || 'Standard Scope Item',
        quantity: 1,
        unitPrice: netAmt,
        total: netAmt
      }],
      totalAmount: Number(quotation.totalAmount) || netAmt,
      discount: Number(quotation.discount) || 0,
      tax: Number(quotation.tax) || 0,
      netAmount: netAmt,
      outstandingBalance: netAmt,
      totalPaid: 0,
      status: 'Sales Order',
      workflowStatus: 'Draft',
      departmentResponsible: 'Sales',
      currentDepartment: 'Sales',
      currentStatus: 'SALES_ORDER_CREATED',
      previousDepartment: '',
      previousStatus: '',
      lastAction: 'Sales Order Created',
      lastActionBy: req.user._id,
      lastActionByName: req.user.fullName,
      lastActionAt: new Date(),
      customerOverdueAtCreation: overdueInfo.overdueAmount,
      requiresFinanceApproval: false,
      stockStatus: stockStatus || 'Available',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Pending',
      deliveryDate: deliveryDate ? new Date(deliveryDate) : (quotation.validUntil || null),
      creationDate: new Date(),
      orderDate: new Date(),
      notes: notes || quotation.notes || '',
      quotationId: quotation._id,
      leadId: quotation.leadId || null,
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || '',
      salesPerson: req.user._id,
      createdBy: req.user._id,
      workflowHistory: [
        {
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Sales',
          action: 'Sales Order Created',
          previousStatus: 'None',
          newStatus: 'Draft',
          timestamp: new Date(),
          notes: `Created from Quotation ${quotation.orderReference || quotation.quotationNumber}. Ready in Sales portal for Move to Finance.`
        }
      ]
    });

    // Mark quotation as Converted to Sales Order (preserves record in DB for history/audit)
    quotation.status = 'Converted to Sales Order';
    quotation.salesOrderId = order._id;
    quotation.salesOrderNumber = order.orderNumber || order.orderReference;
    quotation.convertedAt = new Date();
    await quotation.save();

    await logSalesActivity({
      type: 'Quotation Converted',
      description: `Converted Quotation ${quotation.orderReference || quotation.quotationNumber} to Sales Order ${order.orderNumber || order.orderReference}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: quotation.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Quotation successfully converted to Sales Order ${order.orderNumber || order.orderReference}! Click 'Move to Finance' when ready for overdue approval.`,
      data: {
        order,
        quotation
      }
    });
  } catch (error) {
    console.error('[Convert Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error converting quotation.' });
  }
};

// ══════════════════════════════════════════════
// QUOTATIONS
// ══════════════════════════════════════════════
/**
 * @desc    Get quotations for sales employee
 * @route   GET /api/sales-employee/quotations
 */
const getMyQuotations = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isGlobal = ['admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (req.user.role === 'sales_manager') {
      const scope = await getSalesManagerScope(req.user);
      const nameRegexes = scope.memberNames.map(n => new RegExp(`^${n}$`, 'i'));
      const managerConditions = [
        { createdBy: { $in: scope.memberIds } },
        { salesPerson: { $in: scope.memberIds } }
      ];
      if (nameRegexes.length > 0) {
        managerConditions.push({ salePerson: { $in: nameRegexes } });
      }

      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) {
          return res.status(200).json({ success: true, count: 0, data: [] });
        }
        query.$or = [{ createdBy: employeeId }, { salesPerson: employeeId }];
      } else {
        query.$or = managerConditions;
      }
    } else if (isGlobal) {
      if (employeeId && employeeId !== 'all') query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    // Pending workflow: 'active' filter excludes converted quotations
    if (status === 'active' || !status) {
      query.status = { $nin: ['Converted to Customer PO', 'Converted to Sales Order', 'Converted', 'Rejected', 'Expired'] };
    } else if (status === 'converted') {
      query.status = { $in: ['Converted to Customer PO', 'Converted to Sales Order', 'Converted'] };
    } else if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { orderReference: regex },
        { quotationNumber: regex },
        { clientName: regex },
        { salePerson: regex },
        { productSummary: regex },
        { fileNo: regex }
      ];
    }

    const quotations = await Quotation.find(query).sort({ creationDate: -1, createdAt: -1 });
    return res.status(200).json({ success: true, count: quotations.length, data: quotations });
  } catch (error) {
    console.error('[Get Quotations Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching quotations.' });
  }
};

/**
 * @desc    Create a quotation
 * @route   POST /api/sales-employee/quotations
 */
const createMyQuotation = async (req, res) => {
  try {
    const {
      orderReference,
      clientName,
      fileType,
      productSummary,
      clientEmail,
      clientPhone,
      items,
      totalAmount,
      discount,
      discountPercentage,
      tax,
      taxPercentage,
      netAmount,
      status,
      validUntil,
      creationDate,
      notes,
      leadId
    } = req.body;

    if (!clientName) return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });
    const assignedFileNumber = await allocateFileNumber(fileType);

    const quotation = await Quotation.create({
      orderReference: orderReference?.trim() || '',
      clientName: clientName.trim(),
      salePerson: req.user.fullName || '',
      fileNo: assignedFileNumber,
      fileType,
      productSummary: productSummary?.trim() || '',
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || (productSummary ? [{ description: productSummary, quantity: 1, unitPrice: Number(totalAmount || netAmount || 0), total: Number(totalAmount || netAmount || 0) }] : []),
      totalAmount: Number(totalAmount) || Number(netAmount) || 0,
      discount: Number(discount) || 0,
      discountPercentage: Number(discountPercentage) || 0,
      tax: Number(tax) || 0,
      taxPercentage: Number(taxPercentage) || 0,
      netAmount: Number(netAmount) || Number(totalAmount) || 0,
      status: status || 'Quotation',
      validUntil: validUntil || null,
      creationDate: creationDate ? new Date(creationDate) : new Date(),
      notes: notes || '',
      leadId: leadId || null,
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Quotation Created',
      description: `Created quotation ${quotation.orderReference || quotation.quotationNumber} for ${quotation.clientName}`,
      relatedModel: 'Quotation',
      relatedId: quotation._id,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Quotation created successfully.', data: quotation });
  } catch (error) {
    console.error('[Create Quotation Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error creating quotation.' });
  }
};

/**
 * @desc    Update quotation
 * @route   PATCH /api/sales-employee/quotations/:id
 */
const updateMyQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found.' });

    const allowedFields = [
      'orderReference',
      'clientName',
      'productSummary',
      'clientEmail',
      'clientPhone',
      'items',
      'totalAmount',
      'discount',
      'discountPercentage',
      'tax',
      'taxPercentage',
      'netAmount',
      'status',
      'validUntil',
      'creationDate',
      'notes'
    ];

    const changes = [];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== quotation[field]) {
        changes.push({ field, oldValue: quotation[field], newValue: req.body[field] });
        quotation[field] = req.body[field];
      }
    });

    if (req.body.creationDate) {
      quotation.creationDate = new Date(req.body.creationDate);
    }

    await quotation.save();

    // Log to EditAuditLog
    try {
      await logCategoryAEdit({
        documentType: 'Quotation',
        documentId: quotation._id,
        documentNumber: quotation.orderReference || quotation.quotationNumber || 'Quotation',
        changedBy: req.user,
        changes,
        reason: req.body.remarks || 'Direct Quotation edit by Sales Person.'
      });
    } catch (auditErr) {
      console.warn('EditAuditLog creation notice for Quotation:', auditErr.message);
    }

    await logSalesActivity({
      type: 'Quotation Updated',
      description: `Updated quotation ${quotation.orderReference || quotation.quotationNumber} — status: ${quotation.status}`,
      relatedModel: 'Quotation',
      relatedId: quotation._id,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Quotation updated successfully.', data: quotation });
  } catch (error) {
    console.error('[Update Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating quotation.' });
  }
};

// ══════════════════════════════════════════════
// SALES ORDERS
// ══════════════════════════════════════════════
/**
 * @desc    Get sales orders
 * @route   GET /api/sales-employee/orders
 */
const getMyOrders = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isGlobalAccess = ['admin', 'ceo', 'support', 'accountant', 'finance'].includes(req.user.role) ||
      ['support', 'accounts', 'finance', 'administration'].includes((req.user.department || '').toLowerCase());
    
    const conditions = [];

    if (req.user.role === 'sales_manager') {
      const scope = await getSalesManagerScope(req.user);
      const nameRegexes = scope.memberNames.map(n => new RegExp(`^${n}$`, 'i'));
      const managerConditions = [
        { createdBy: { $in: scope.memberIds } },
        { salesPerson: { $in: scope.memberIds } }
      ];
      if (nameRegexes.length > 0) {
        managerConditions.push({ salePerson: { $in: nameRegexes } });
      }

      if (employeeId && employeeId !== 'all') {
        const isMember = scope.memberIds.some(id => id.toString() === employeeId.toString());
        if (!isMember) {
          return res.status(200).json({ success: true, count: 0, data: [] });
        }
        conditions.push({ $or: [{ createdBy: employeeId }, { salesPerson: employeeId }] });
      } else {
        conditions.push({ $or: managerConditions });
      }
    } else if (isGlobalAccess) {
      if (employeeId) conditions.push({ createdBy: employeeId });
    } else {
      conditions.push({
        $or: [{ createdBy: req.user._id }, { salesPerson: req.user._id }]
      });
    }

    // Pending workflow: 'active' filter shows orders pending action by Sales (including rejected ones awaiting salesperson action)
    if (status === 'active' || status === 'pending') {
      conditions.push({
        workflowStatus: { $nin: ['Sent to Support', 'Delivery Note Created', 'Delivery Note Confirmed', 'Sent to Accounts', 'Draft Invoice Created', 'Sent to Finance', 'Pending Finance Finalization', 'Completed'] }
      });
    } else if (status === 'pending_finance') {
      conditions.push({
        $or: [
          { status: 'Pending Finance Overdue Check' },
          { workflowStatus: 'Pending Finance Overdue Check' },
          { workflowStatus: 'Pending Finance Approval' },
          { departmentResponsible: 'Finance' }
        ]
      });
    } else if (status === 'finance_approved') {
      conditions.push({
        $or: [
          { status: 'Finance Approved' },
          { workflowStatus: 'Finance Approved' },
          { departmentResponsible: 'Support' }
        ]
      });
    } else if (status === 'rejected') {
      conditions.push({
        $or: [
          { status: 'Rejected' },
          { status: 'Sales Order Rejected due to overdue amount' },
          { workflowStatus: 'Finance Rejected' }
        ]
      });
    } else if (status === 'sent_to_support') {
      conditions.push({
        workflowStatus: { $in: ['Sent to Support', 'Delivery Note Created', 'Delivery Note Confirmed', 'Sent to Accounts', 'Draft Invoice Created', 'Sent to Finance', 'Pending Finance Finalization', 'Completed'] }
      });
    } else if (status && status !== 'all') {
      conditions.push({ status: status });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { orderReference: regex },
          { orderNumber: regex },
          { clientName: regex },
          { salePerson: regex },
          { productSummary: regex },
          { fileNo: regex }
        ]
      });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const orders = await SalesOrder.find(query)
      .populate('createdBy', 'fullName email position role department')
      .populate('salesPerson', 'fullName email position role department')
      .populate('financeApprovedBy', 'fullName email')
      .populate('deliveryNoteId', 'deliveryNumber deliveryNoteNumber status invoiced')
      .populate('invoiceId', 'invoiceNumber amount status isDraft')
      .sort({ creationDate: -1, createdAt: -1 });

    let responseOrders = orders;
    const isSupportUser = req.user.role === 'support' || (req.user.department || '').toLowerCase().includes('support');
    if (isSupportUser) {
      const shipments = await Shipment.find({
        salesOrder: { $in: orders.filter(order => order.fileType === 'Blue').map(order => order._id) }
      }).select('salesOrder shipmentId awbNumber trackingNumber carrier flightNumber shippingMethod departureLocation transitLocation arrivalLocation etd eta actualDepartureDate actualArrivalDate status customsClearanceStatus receivedInOffice receivedInOfficeDate').lean();
      const shipmentsByOrder = new Map(shipments.map(shipment => [shipment.salesOrder.toString(), shipment]));
      responseOrders = orders.map(order => ({
        ...order.toObject(),
        shipmentDetails: shipmentsByOrder.get(order._id.toString()) || null
      }));
    }

    return res.status(200).json({ success: true, count: orders.length, data: responseOrders });
  } catch (error) {
    console.error('[Get Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching orders.' });
  }
};

/**
 * @desc    Create a sales order
 * @route   POST /api/sales-employee/orders
 */
const createMyOrder = async (req, res) => {
  try {
    const {
      orderReference,
      clientName,
      clientAddress,
      salePerson,
      fileType,
      productSummary,
      clientEmail,
      clientPhone,
      items,
      totalAmount,
      discount,
      tax,
      netAmount,
      status,
      deliveryDate,
      creationDate,
      notes,
      quotationId,
      customerPOId,
      customerPONumber,
      productFileId,
      leadId,
      stockStatus
    } = req.body;

    if (!clientName) return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });

    if (!customerPOId || !mongoose.Types.ObjectId.isValid(customerPOId)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const customerPO = await CustomerPO.findById(customerPOId);
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }

    const linkedProductFile = productFileId && mongoose.Types.ObjectId.isValid(productFileId)
      ? await ProductFile.findById(productFileId)
      : null;
    const linkedQuotationId = quotationId && mongoose.Types.ObjectId.isValid(quotationId)
      ? quotationId
      : (linkedProductFile?.quotationId || customerPO.quotationId || null);
    const linkedQuotation = linkedQuotationId ? await Quotation.findById(linkedQuotationId) : null;
    const resolvedFileType = linkedProductFile?.fileType || linkedQuotation?.fileType || customerPO.fileType || fileType;
    const resolvedFileNumber = linkedProductFile?.fileNumber || linkedQuotation?.fileNo || customerPO.fileNumber || await allocateFileNumber(resolvedFileType);

    // Check customer overdue balance
    const overdueInfo = await calculateCustomerOverdue(clientName);
    const requiresApproval = overdueInfo.isOverdue;

    const netAmt = Number(netAmount) || Number(totalAmount) || 0;
    const order = await SalesOrder.create({
      orderReference: orderReference?.trim() || '',
      clientName: clientName.trim(),
      clientAddress: clientAddress?.trim() || '',
      salePerson: salePerson?.trim() || req.user.fullName || '',
      fileNo: resolvedFileNumber,
      fileType: resolvedFileType,
      productSummary: productSummary?.trim() || '',
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      items: items || (productSummary ? [{ description: productSummary, quantity: 1, unitPrice: netAmt, total: netAmt }] : []),
      totalAmount: Number(totalAmount) || netAmt,
      discount: Number(discount) || 0,
      tax: Number(tax) || 0,
      netAmount: netAmt,
      outstandingBalance: netAmt,
      totalPaid: 0,
      status: 'Sales Order',
      workflowStatus: 'Draft',
      departmentResponsible: 'Sales',
      currentDepartment: 'Sales',
      currentStatus: 'SALES_ORDER_CREATED',
      previousDepartment: '',
      previousStatus: '',
      lastAction: 'Sales Order Created',
      lastActionBy: req.user._id,
      lastActionByName: req.user.fullName,
      lastActionAt: new Date(),
      customerOverdueAtCreation: overdueInfo.overdueAmount,
      requiresFinanceApproval: false,
      stockStatus: stockStatus || 'Available',
      deliveryStatus: 'Not Delivered',
      invoiceStatus: 'Not Invoiced',
      paymentStatus: 'Pending',
      deliveryDate: deliveryDate || null,
      creationDate: creationDate ? new Date(creationDate) : new Date(),
      orderDate: creationDate ? new Date(creationDate) : new Date(),
      notes: notes || '',
      quotationId: quotationId && mongoose.Types.ObjectId.isValid(quotationId) ? quotationId : null,
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || customerPONumber || '',
      productFileId: productFileId && mongoose.Types.ObjectId.isValid(productFileId) ? productFileId : null,
      leadId: leadId && mongoose.Types.ObjectId.isValid(leadId) ? leadId : null,
      salesPerson: req.user._id,
      createdBy: req.user._id
    });

    // Link the Quotation if provided, mark as Converted
    if (quotationId) {
      await Quotation.findByIdAndUpdate(quotationId, {
        status: 'Converted to Sales Order',
        salesOrderId: order._id,
        salesOrderNumber: order.orderNumber || order.orderReference,
        convertedAt: new Date()
      });
    }

    // Link the CustomerPO to this order if provided
    if (customerPOId) {
      await CustomerPO.findByIdAndUpdate(customerPOId, { status: 'Processed', salesOrderId: order._id });
    }
    // Link the ProductFile to this order if provided
    if (productFileId) {
      await ProductFile.findByIdAndUpdate(productFileId, { salesOrderId: order._id, salesOrderNumber: order.orderNumber });
    }

    await logSalesActivity({
      type: 'Sales Order Created',
      description: `Created sales order ${order.orderReference || order.orderNumber} for ${order.clientName}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: order.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'New Sales Order Created',
      message: `${req.user.fullName} created Sales Order ${order.orderNumber || order.orderReference} for ${order.clientName} (Rs. ${netAmt.toLocaleString()}).`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Sales order created successfully.', data: order });
  } catch (error) {
    console.error('[Create Order Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error creating order.' });
  }
};

/**
 * @desc    Finance review (approve / clear, block / hold, or reject) a sales order based on overdue verification
 * @route   POST /api/sales-employee/orders/:id/finance-review
 */
const financeReviewSalesOrder = async (req, res) => {
  try {
    const action = (req.body.action || req.body.decision || '').toLowerCase().trim(); // 'approve', 'clear', 'block', 'hold', 'reject'
    const reason = req.body.reason || req.body.notes || '';
    const fileTypeChoice = (req.body.fileType || '').trim(); // 'Green' or 'Blue'
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    if (action === 'block' || action === 'hold') {
      // Flowchart: Overdue? YES -> Order Blocked / Hold -> STOP
      order.isOverdueBlocked = true;
      order.overdueBlockReason = reason || 'Customer has outstanding overdue balance according to Financial Overdue Verification.';
      order.overdueBlockedAt = new Date();
      order.overdueBlockedBy = req.user._id;
      order.overdueBlockedByName = req.user.fullName;
      order.workflowStatus = 'Order Blocked / Hold';
      order.status = 'Order Blocked / Hold';
      order.departmentResponsible = 'Finance';
      order.currentDepartment = 'Finance';
      order.currentStatus = 'ORDER_BLOCKED_OVERDUE';
      order.previousDepartment = 'Finance';
      order.previousStatus = 'Pending Finance Overdue Check';
      order.lastAction = 'Order Blocked / Hold (Overdue = YES)';
      order.lastActionBy = req.user._id;
      order.lastActionByName = req.user.fullName;
      order.lastActionAt = new Date();

      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Finance',
        action: 'Order Blocked / Hold (Overdue = YES)',
        previousStatus: order.workflowStatus,
        newStatus: 'Order Blocked / Hold',
        timestamp: new Date(),
        notes: reason || `Order placed on HOLD by Finance due to customer overdue balance (PKR ${Number(order.customerOverdueAtCreation || 0).toLocaleString()}).`
      });

      await order.save();

      await logSalesActivity({
        type: 'Order Blocked by Finance',
        description: `Sales Order ${order.orderNumber || order.orderReference} blocked/placed on hold by Finance (${req.user.fullName}) due to overdue balance`,
        relatedModel: 'SalesOrder',
        relatedId: order._id,
        performedBy: req.user._id
      });

      if (order.salesPerson || order.createdBy) {
        await createNotificationHelper({
          recipient: order.salesPerson || order.createdBy,
          sender: req.user._id,
          title: 'Sales Order Blocked / On Hold',
          message: `Finance has placed Sales Order ${order.orderNumber || order.orderReference} on HOLD due to customer overdue balance.${reason ? ` Reason: ${reason}` : ''}`,
          type: 'finance',
          link: '/employee/sales/orders'
        });
      }

      return res.status(200).json({
        success: true,
        message: `Sales Order ${order.orderNumber || order.orderReference} successfully placed on HOLD / BLOCKED. Downstream processing halted.`,
        data: order
      });
    } else if (action === 'approve' || action === 'clear') {
      // Flowchart: Overdue? NO / All Clear -> File Type? -> Green vs Blue
      order.isOverdueBlocked = false;
      order.overdueBlockReason = '';
      order.requiresFinanceApproval = false;
      order.financeApprovedBy = req.user._id;
      order.financeApprovedByName = req.user.fullName;
      order.financeApprovedAt = new Date();

      // Resolve file type: must be 'Green' or 'Blue'
      const resolvedFileType = fileTypeChoice === 'Blue' || fileTypeChoice === 'Green'
        ? fileTypeChoice
        : (order.fileType === 'Blue' ? 'Blue' : 'Green');
      order.fileType = resolvedFileType;
      order.fileNo = withFileColour(order.fileNo, resolvedFileType);

      const isBlue = resolvedFileType === 'Blue';

      if (isBlue) {
        // BLUE FILE FLOW: Routes to Global Purchaser Portal!
        order.workflowStatus = 'Pending Global Procurement';
        order.status = 'Pending Global Procurement';
        order.departmentResponsible = 'Global Purchaser';
        order.currentDepartment = 'Global Purchaser';
        order.currentStatus = 'BLUE_FILE_GLOBAL_PURCHASER';
        order.previousDepartment = 'Finance';
        order.previousStatus = 'Pending Finance Overdue Check';
        order.lastAction = 'Finance Approved — Blue File (Routed to Global Purchaser)';
        order.lastActionBy = req.user._id;
        order.lastActionByName = req.user.fullName;
        order.lastActionAt = new Date();

        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Finance',
          action: 'Finance Approved — Blue File (Routed to Global Purchaser)',
          previousStatus: 'Pending Finance Overdue Check',
          newStatus: 'Pending Global Procurement',
          timestamp: new Date(),
          notes: `Finance verified overdue clear. Blue File order ${order.orderNumber || order.orderReference} routed to Global Purchaser for International PO creation.`
        });

        // Notify Global Purchaser
        await notifyRoleHelper(['purchaser', 'admin', 'ceo'], {
          type: 'order',
          title: 'New Blue File Order for Global Purchaser',
          message: `Blue File Sales Order ${order.orderNumber || order.orderReference} is ready for Global Procurement & Supplier PO creation.`,
          link: '/purchaser/supplier_pos',
          sender: req.user._id
        });
      } else {
        // GREEN FILE FLOW: Routes to Local Purchaser Portal for Inventory Check!
        order.workflowStatus = 'Pending Local Procurement';
        order.status = 'Pending Local Procurement';
        order.departmentResponsible = 'Local Purchaser';
        order.currentDepartment = 'Local Purchaser';
        order.currentStatus = 'GREEN_FILE_LOCAL_PURCHASER';
        order.previousDepartment = 'Finance';
        order.previousStatus = 'Pending Finance Overdue Check';
        order.lastAction = 'Finance Approved — Green File (Routed to Local Purchaser)';
        order.lastActionBy = req.user._id;
        order.lastActionByName = req.user.fullName;
        order.lastActionAt = new Date();
        order.inventoryCheckStatus = 'Not Checked';

        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Finance',
          action: 'Finance Approved — Green File (Routed to Local Purchaser)',
          previousStatus: 'Pending Finance Overdue Check',
          newStatus: 'Pending Local Procurement',
          timestamp: new Date(),
          notes: `Finance verified overdue clear. Green File order ${order.orderNumber || order.orderReference} routed to Local Purchaser for Inventory Check.`
        });

        // Notify Local Purchaser
        await notifyRoleHelper(['purchaser', 'admin', 'ceo'], {
          type: 'order',
          title: 'New Green File Order for Local Purchaser',
          message: `Green File Sales Order ${order.orderNumber || order.orderReference} is ready for Local Procurement Inventory Check.`,
          link: '/purchaser/dashboard',
          sender: req.user._id
        });
      }

      await order.save();
      await updateLinkedFileColour(order, resolvedFileType);

      await logSalesActivity({
        type: `Finance Approved (${resolvedFileType} File)`,
        description: `Sales Order ${order.orderNumber || order.orderReference} verified All Clear by Finance (${req.user.fullName}) - ${resolvedFileType} File routed to ${isBlue ? 'Global Purchaser' : 'Local Purchaser'}`,
        relatedModel: 'SalesOrder',
        relatedId: order._id,
        performedBy: req.user._id
      });

      if (order.salesPerson || order.createdBy) {
        await createNotificationHelper({
          recipient: order.salesPerson || order.createdBy,
          sender: req.user._id,
          title: `Sales Order Approved: ${resolvedFileType} File`,
          message: `Finance approved Sales Order ${order.orderNumber || order.orderReference} (${resolvedFileType} File). Routed to ${isBlue ? 'Global Purchaser' : 'Local Purchaser'} for Supplier PO creation.`,
          type: 'finance',
          link: '/employee/sales/orders'
        });
      }

      return res.status(200).json({
        success: true,
        message: `Sales Order approved as ${resolvedFileType} File! Routed to ${isBlue ? 'Global Purchaser Portal' : 'Local Purchaser Portal'}.`,
        data: order
      });
    } else if (action === 'reject') {
      order.workflowStatus = 'Finance Rejected';
      order.status = 'Sales Order Rejected due to overdue amount';
      order.departmentResponsible = 'Sales';
      order.currentDepartment = 'Sales';
      order.currentStatus = 'FINANCE_REJECTED';
      order.previousDepartment = 'Finance';
      order.previousStatus = 'Pending Finance Overdue Check';
      order.lastAction = 'Sales Order Rejected by Finance (Overdue)';
      order.lastActionBy = req.user._id;
      order.lastActionByName = req.user.fullName;
      order.lastActionAt = new Date();
      order.financeRejectionReason = reason || 'Rejected by Finance due to overdue amount.';
      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Finance',
        action: 'Sales Order Rejected by Finance (Overdue)',
        previousStatus: order.workflowStatus,
        newStatus: 'Sales Order Rejected due to overdue amount',
        timestamp: new Date(),
        notes: reason || 'Rejected by Finance due to overdue amount. Returned to Sales Person.'
      });

      await order.save();

      if (order.salesPerson || order.createdBy) {
        await createNotificationHelper({
          recipient: order.salesPerson || order.createdBy,
          sender: req.user._id,
          title: 'Sales Order Rejected by Finance',
          message: `Finance rejected Sales Order ${order.orderNumber || order.orderReference} due to overdue balance.${reason ? ` Reason: ${reason}` : ''}`,
          type: 'finance',
          link: '/employee/sales/orders'
        });
      }

      return res.status(200).json({
        success: true,
        message: `Sales Order ${order.orderNumber || order.orderReference} rejected due to overdue balance and returned to Sales Person.`,
        data: order
      });
    } else {
      return res.status(400).json({ success: false, message: 'Action must be "approve", "clear", "block", "hold", or "reject".' });
    }

    await logSalesActivity({
      type: action === 'approve' ? 'Order Approved by Finance' : 'Order Rejected by Finance',
      description: `Sales Order ${order.orderNumber || order.orderReference} ${action}d by Finance (${req.user.fullName})`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    // Notify the original sales representative
    if (order.salesPerson || order.createdBy) {
      const recipientId = order.salesPerson || order.createdBy;
      await createNotificationHelper({
        recipient: recipientId,
        sender: req.user._id,
        title: action === 'approve' ? 'Sales Order Approved by Finance' : 'Sales Order Rejected by Finance',
        message: action === 'approve'
          ? `Finance approved Sales Order ${order.orderNumber || order.orderReference}.`
          : `Finance rejected Sales Order ${order.orderNumber || order.orderReference}.${reason ? ` Reason: ${reason}` : ''}`,
        type: 'finance',
        link: '/employee/sales/orders'
      });
    }

    // Notify Support Department on approval
    if (action === 'approve') {
      await notifyRoleHelper(['support', 'operations', 'admin', 'ceo'], {
        type: 'order',
        title: 'Sales Order Ready for Delivery Processing',
        message: `Sales Order ${order.orderNumber || order.orderReference} is ready for Delivery Note processing.`,
        link: '/support/orders',
        sender: req.user._id
      });
    }

    return res.status(200).json({
      success: true,
      message: `Sales Order ${order.orderNumber || order.orderReference} ${action}d successfully.`,
      data: order
    });
  } catch (error) {
    console.error('[Finance Review Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error reviewing sales order.' });
  }
};

/**
 * @desc    Update sales order (Category B - CEO Approval Required)
 * @route   PATCH /api/sales-employee/orders/:id
 */
const updateMyOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    if (req.body.orderNumber && !req.body.orderReference) req.body.orderReference = req.body.orderNumber;
    if (req.body.orderReference && !req.body.orderNumber) req.body.orderNumber = req.body.orderReference;

    const changes = {};
    const allowedFields = [
      'orderReference', 'orderNumber', 'clientName', 'clientAddress', 'salePerson', 'fileType',
      'productSummary', 'clientEmail', 'clientPhone', 'items', 'totalAmount', 'discount',
      'tax', 'netAmount', 'status', 'deliveryDate', 'creationDate', 'notes',
      'stockStatus', 'deliveryStatus', 'invoiceStatus', 'invoiceNumber',
      'paymentStatus', 'totalPaid', 'outstandingBalance'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && hasFieldValueChanged(order[field], req.body[field])) {
        changes[field] = { old: order[field], new: req.body[field] };
      }
    });

    // Enforce Category B CEO approval verification
    const check = await verifyAndConsumeCEOPermission({
      documentType: 'Sales Order',
      documentId: order._id,
      documentNumber: order.orderReference || order.orderNumber,
      requestingUser: req.user,
      changes
    });

    if (!check.authorized) {
      return res.status(403).json({ success: false, message: check.message });
    }

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) order[field] = req.body[field];
    });

    if (req.body.orderNumber || req.body.orderReference) {
      const val = req.body.orderNumber || req.body.orderReference;
      order.orderNumber = val;
      order.orderReference = val;
    }

    if (req.body.creationDate) {
      order.creationDate = new Date(req.body.creationDate);
    }

    await order.save();

    await logSalesActivity({
      type: 'Sales Order Updated',
      description: `Updated order ${order.orderReference || order.orderNumber} — status: ${order.status}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      relatedCustomer: order.clientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Order updated successfully.', data: order });
  } catch (error) {
    console.error('[Update Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating order.' });
  }
};

/**
 * @desc    Check actual warehouse inventory stock for a Sales Order
 * @route   GET /api/sales-employee/orders/:id/stock-check
 */
const checkOrderStock = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });
    const stock = await getDeliveryStockRequirements(order);
    const stockCheckResults = stock.requirements.map(line => {
      const inv = line.inventoryItem;
      const available = Number(line.availableQty) || 0;
      const isItemInStock = Boolean(inv) && available >= line.requiredQty;
      return {
        productName: line.item,
        requiredQty: line.requiredQty,
        orderedQty: line.orderedQty,
        deliveredQty: line.deliveredQty,
        quantityAssumed: line.quantityAssumed,
        quantityOnHand: Number(inv?.quantityOnHand) || 0,
        reservedQuantity: Number(inv?.reservedQuantity) || 0,
        availableQty: available,
        unit: inv?.unit || 'pcs',
        status: line.ambiguous ? 'Ambiguous Inventory Match' : (!inv ? 'Missing from Inventory' : (isItemInStock ? 'In Stock' : 'Insufficient Stock')),
        shortageQty: Math.max(0, line.requiredQty - available),
        inventoryItemId: inv?._id || null,
        inventoryName: inv?.name || '',
        inventorySku: inv?.sku || '',
        inventoryCategory: inv?.category || '',
        inventoryLocation: inv?.location || ''
      };
    });

    // Update order stock status
    const newStockStatus = stock.isFullyInStock ? 'Available' : 'Purchase Required';
    if (order.stockStatus !== newStockStatus) {
      order.stockStatus = newStockStatus;
      await order.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber || order.orderReference,
        clientName: order.clientName,
        stockStatus: newStockStatus,
        isFullyInStock: stock.isFullyInStock,
        items: stockCheckResults
      }
    });
  } catch (error) {
    console.error('[Check Order Stock Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error checking inventory stock.' });
  }
};

/**
 * @desc    Preview inventory matches and receipt balances for a Support order
 * @route   GET /api/sales-employee/orders/:id/receiving-preview
 */
const getGoodsReceivingPreview = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    const inventoryItems = await InventoryItem.find({}).sort({ name: 1 });
    const receivedTotals = getReceivedQuantityByOrderItem(order);
    const orderItems = order.items && order.items.length ? order.items : [
      { _id: 'product-summary', description: order.productSummary || 'Product Scope Items', quantity: 1, quantityAssumed: true }
    ];

    const items = orderItems.map(item => {
      const orderItemId = String(item._id || 'product-summary');
      const orderedQty = Number(item.quantity) || 1;
      const previouslyReceivedQty = receivedTotals.get(orderItemId) || 0;
      const matches = getInventoryMatches(item, inventoryItems).map(match => ({
        _id: match._id,
        name: match.name,
        sku: match.sku,
        category: match.category,
        location: match.location,
        unit: match.unit,
        quantityOnHand: match.quantityOnHand,
        reservedQuantity: match.reservedQuantity,
        contextMismatch: hasInventoryContextMismatch(match, order.fileType)
      }));

      return {
        orderItemId,
        productName: item.description || item.name || 'Item',
        sku: item.sku || '',
        orderedQty,
        quantityAssumed: item.quantityAssumed === true,
        previouslyReceivedQty,
        remainingQty: Math.max(0, orderedQty - previouslyReceivedQty),
        matches,
        recommendedInventoryItemId: matches.length === 1 ? matches[0]._id : null
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber || order.orderReference,
        fileType: order.fileType,
        inventoryReceived: order.inventoryReceived === true,
        items,
        inventoryOptions: inventoryItems.map(item => ({
          _id: item._id,
          name: item.name,
          sku: item.sku,
          category: item.category,
          location: item.location,
          unit: item.unit,
          quantityOnHand: item.quantityOnHand,
          reservedQuantity: item.reservedQuantity,
          contextMismatch: hasInventoryContextMismatch(item, order.fileType)
        }))
      }
    });
  } catch (error) {
    console.error('[Goods Receiving Preview Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error loading inventory receiving details.' });
  }
};

/**
 * @desc    Get Sales Orders ready / eligible for delivery note
 * @route   GET /api/sales-employee/orders/available-for-delivery
 */
const getAvailableOrdersForDelivery = async (req, res) => {
  try {
    // Support queue: goods must be physically received in office before Delivery Note creation.
    const orders = await SalesOrder.find({
      goodsReceivedInOffice: { $ne: null },
      'goodsReceivedInOffice.received': true,
      $or: [{ currentDepartment: 'Support' }, { departmentResponsible: 'Support' }],
      deliveryNoteId: null
    }).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('[Get Available Orders Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching available orders.' });
  }
};

// ══════════════════════════════════════════════
// DELIVERY NOTES
// ══════════════════════════════════════════════
const getMyDeliveryNotes = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'sales_manager') {
      const scope = await getSalesManagerScope(req.user);
      filter = {
        $or: [
          { createdBy: { $in: scope.memberIds } },
          { salesPerson: { $in: scope.memberIds } }
        ]
      };
    } else {
      const isPrivilegedOrDept = ['admin', 'ceo', 'support', 'accountant', 'finance'].includes(req.user.role) ||
        ['support', 'accounts', 'finance'].includes((req.user.department || '').toLowerCase());
      filter = isPrivilegedOrDept
        ? {}
        : { $or: [{ createdBy: req.user._id }, { salesPerson: req.user._id }] };
    }
    const notes = await DeliveryNote.find(filter)
      .populate('salesOrder', 'orderNumber orderReference clientName netAmount totalAmount discount tax items clientEmail clientPhone clientAddress fileNo fileType salePerson')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: notes.length, data: notes });
  } catch (error) {
    console.error('[Get Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching delivery notes.' });
  }
};

const createMyDeliveryNote = async (req, res) => {
  try {
    const {
      salesOrderId,
      salesOrderNumber,
      clientName,
      recipientName,
      recipientPhone,
      deliveryAddress,
      trackingNumber,
      carrier,
      deliveryDate,
      items,
      notes,
      status,
      isPartial,
      operationType,
      sourceLocation,
      scheduledDate,
      deadline,
      productAvailability,
      sourceDocument,
      starred
    } = req.body;

    const requestedStatus = status || 'Ready';
    const dnStatus = CONFIRMED_DELIVERY_STATUSES.includes(requestedStatus) ? 'Ready' : requestedStatus;

    let resolvedSalesPersonId = null;
    let resolvedSalePerson = req.body.salePerson || '';

    // Auto-populate items from Sales Order if not provided
    let dnItems = items || [];
    let resolvedFileType = req.body.fileType || '';
    let resolvedSupplierPoNum = req.body.supplierPoNumber || '';
    let resolvedBlNum = req.body.blNumber || '';
    let resolvedShipmentId = null;
    let resolvedShipmentNum = '';

    if (!salesOrderId || !mongoose.Types.ObjectId.isValid(salesOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Sales Order in the Support stage is required to create a Delivery Note.'
      });
    }

    const parentSo = await SalesOrder.findById(salesOrderId).populate('salesPerson');
    if (!parentSo) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }
    if (parentSo.isOverdueBlocked) {
      return res.status(400).json({
        success: false,
        message: `Cannot create Delivery Note: Sales Order ${parentSo.orderNumber || parentSo.orderReference} is on Finance HOLD due to overdue customer balance.`
      });
    }

    const isInSupport = parentSo.currentDepartment === 'Support' || parentSo.departmentResponsible === 'Support';
    if (!isInSupport || parentSo.goodsReceivedInOffice?.received !== true) {
      return res.status(400).json({
        success: false,
        message: 'Delivery Notes can only be created after the Sales Order reaches Support and goods are received in office.'
      });
    }
    if (parentSo.deliveryNoteId) {
      return res.status(400).json({
        success: false,
        message: `A Delivery Note already exists for Sales Order ${parentSo.orderNumber || parentSo.orderReference}.`
      });
    }

    const stock = await getDeliveryStockRequirements(parentSo);
    if (!stock.isFullyInStock) {
      const shortages = stock.shortages.length
        ? stock.shortages
        : [{ item: parentSo.productSummary || 'Order items', required: 1, available: 0 }];
      return res.status(409).json({
        success: false,
        message: formatStockShortageMessage(shortages),
        shortages
      });
    }

    resolvedSalesPersonId = parentSo.salesPerson?._id || parentSo.salesPerson || parentSo.createdBy || null;
    resolvedSalePerson = resolvedSalePerson || parentSo.salePerson || (parentSo.salesPerson && parentSo.salesPerson.fullName) || '';
    resolvedFileType = parentSo.fileType || resolvedFileType;
    resolvedSupplierPoNum = parentSo.supplierPO?.poNumber || resolvedSupplierPoNum;
    resolvedBlNum = parentSo.blNumber || resolvedBlNum;
    resolvedShipmentId = parentSo.shipmentId || null;
    resolvedShipmentNum = parentSo.shipmentNumber || '';

    dnItems = stock.requirements
      .filter(line => line.requiredQty > 0)
      .map(line => ({
        product: line.item || 'Delivered Product',
        description: line.item || '',
        demand: line.requiredQty,
        quantity: line.requiredQty,
        unit: line.inventoryItem?.unit || 'Units',
        availability: 'Available',
        totalOrderedQty: line.orderedQty
      }));

    const deliveryNote = await DeliveryNote.create({
      salesOrder: parentSo._id,
      salesOrderNumber: parentSo.orderReference || parentSo.orderNumber || salesOrderNumber || '',
      sourceDocument: sourceDocument || parentSo.orderReference || parentSo.orderNumber || salesOrderNumber || '',
      clientName: parentSo.clientName || clientName || recipientName || '',
      recipientName: recipientName || clientName || '',
      recipientPhone: recipientPhone || '',
      deliveryAddress: deliveryAddress || '',
      trackingNumber: trackingNumber || '',
      carrier: carrier || '',
      operationType: operationType || 'Fortline: Delivery Orders',
      sourceLocation: sourceLocation || 'WH/Stock',
      scheduledDate: scheduledDate || deliveryDate || new Date(),
      deadline: deadline || scheduledDate || deliveryDate || new Date(),
      productAvailability: productAvailability || 'Available',
      starred: !!starred,
      deliveryDate: deliveryDate || scheduledDate || new Date(),
      items: dnItems,
      notes: notes || '',
      status: dnStatus,
      isPartial: !!isPartial,
      invoiced: false,
      fileType: resolvedFileType,
      supplierPoNumber: resolvedSupplierPoNum,
      blNumber: resolvedBlNum,
      shipmentId: resolvedShipmentId,
      shipmentNumber: resolvedShipmentNum,
      salesPerson: resolvedSalesPersonId || (req.user.department === 'Sales' ? req.user._id : null),
      salePerson: resolvedSalePerson || (req.user.department === 'Sales' ? req.user.fullName : ''),
      createdBy: req.user._id
    });

    // Auto-update Sales Order delivery status and link Delivery Note (removes SO from Support Pending Queue, hands off to Accounts)
    if (salesOrderId) {
      const deliveryStatusUpdate = isPartial ? 'Partially Delivered' : 'Fully Delivered';
      const soStatusUpdate = isPartial ? 'Processing' : 'Delivered';
      await SalesOrder.findByIdAndUpdate(salesOrderId, {
        deliveryStatus: deliveryStatusUpdate,
        status: soStatusUpdate,
        deliveryNoteId: deliveryNote._id,
        deliveryNoteNumber: deliveryNote.deliveryNoteNumber || deliveryNote.deliveryNumber,
        workflowStatus: 'Delivery Note Created',
        departmentResponsible: 'Accounts',
        currentDepartment: 'Accounts',
        currentStatus: 'DELIVERY_NOTE_CREATED_IN_ACCOUNTS',
        previousDepartment: 'Support',
        previousStatus: 'Pending Delivery Note',
        lastAction: `Delivery Note ${deliveryNote.deliveryNoteNumber || deliveryNote.deliveryNumber} Created by Support`,
        lastActionBy: req.user._id,
        lastActionByName: req.user.fullName,
        lastActionAt: new Date()
      });
    }

    await logSalesActivity({
      type: 'Delivery Note Created',
      description: `Created delivery note ${deliveryNote.deliveryNoteNumber} — ${dnStatus}`,
      relatedModel: 'DeliveryNote',
      relatedId: deliveryNote._id,
      relatedCustomer: clientName || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    // Notify Sales Manager
    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Delivery Note Created',
      message: `${req.user.fullName} created delivery note ${deliveryNote.deliveryNoteNumber} — Status: ${dnStatus}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Delivery note created successfully.', data: deliveryNote });
  } catch (error) {
    console.error('[Create Delivery Note Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error creating delivery note.' });
  }
};

// ══════════════════════════════════════════════
// FOLLOW-UPS
// ══════════════════════════════════════════════
const getMyFollowUps = async (req, res) => {
  try {
    const followUps = await FollowUp.find({ createdBy: req.user._id })
      .populate('lead', 'name company email phone')
      .sort({ scheduledAt: 1 });
    return res.status(200).json({ success: true, count: followUps.length, data: followUps });
  } catch (error) {
    console.error('[Get FollowUps Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching follow-ups.' });
  }
};

const createMyFollowUp = async (req, res) => {
  try {
    const { title, description, customer, contactName, contactEmail, contactPhone, type, followUpType, scheduledAt, nextFollowUpDate, leadId, relatedModel, relatedId, notes } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Follow-up title is required.' });

    const followUp = await FollowUp.create({
      title: title.trim(),
      description: description || '',
      customer: customer?.trim() || '',
      contactName: contactName?.trim() || '',
      contactEmail: contactEmail?.trim() || '',
      contactPhone: contactPhone?.trim() || '',
      type: type || 'Call',
      followUpType: followUpType || '',
      status: 'Pending',
      scheduledAt: scheduledAt || null,
      nextFollowUpDate: nextFollowUpDate || null,
      lead: leadId || null,
      relatedModel: relatedModel || null,
      relatedId: relatedId || null,
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Follow-up Created',
      description: `Scheduled follow-up: "${followUp.title}" (${followUp.type})${customer ? ' for ' + customer : ''}`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
      relatedCustomer: customer || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Follow-up scheduled.', data: followUp });
  } catch (error) {
    console.error('[Create FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error scheduling follow-up.' });
  }
};

const updateMyFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ success: false, message: 'Follow-up not found.' });

    if (!checkOwnership(followUp, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const allowedFields = ['title', 'description', 'customer', 'contactName', 'contactEmail', 'contactPhone', 'type', 'followUpType', 'status', 'scheduledAt', 'nextFollowUpDate', 'notes', 'outcome', 'completedAt'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) followUp[field] = req.body[field];
    });

    if (followUp.status === 'Completed' && !followUp.completedAt) {
      followUp.completedAt = new Date();
    }

    await followUp.save();

    const actType = followUp.status === 'Completed' ? 'Follow-up Completed' : 'Follow-up Created';
    await logSalesActivity({
      type: actType,
      description: `${followUp.status === 'Completed' ? 'Completed' : 'Updated'} follow-up "${followUp.title}"`,
      relatedModel: 'FollowUp',
      relatedId: followUp._id,
      relatedCustomer: followUp.customer || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    return res.status(200).json({ success: true, message: 'Follow-up updated.', data: followUp });
  } catch (error) {
    console.error('[Update FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating follow-up.' });
  }
};

// ══════════════════════════════════════════════
// TARGETS & ACTIVITIES
// ══════════════════════════════════════════════
const getMyTargets = async (req, res) => {
  try {
    const userId = req.user._id;
    let targets = await SalesTarget.find({ employee: userId })
      .populate('assignedBy', 'fullName')
      .sort({ createdAt: -1 });

    // Calculate actual achieved amount from deals, orders, and invoices
    const [deals, orders, invoices] = await Promise.all([
      Deal.find({ $or: [{ assignedTo: userId }, { createdBy: userId }], stage: { $in: ['Won', 'Closed Won'] } }),
      SalesOrder.find({ $or: [{ salesPerson: userId }, { createdBy: userId }], status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'] } }),
      Invoice.find({ createdBy: userId, status: { $in: ['Approved', 'Paid', 'Sent', 'Partially Paid'] } })
    ]);

    const wonDealsValue = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const ordersAchieved = orders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const invoicesAchieved = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const legitAchieved = Math.max(wonDealsValue, ordersAchieved, invoicesAchieved);

    // If no targets found in DB, provide default monthly target
    if (targets.length === 0) {
      const now = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const currentPeriod = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      const defaultTarget = await SalesTarget.create({
        employee: userId,
        period: currentPeriod,
        periodType: 'Monthly',
        targetAmount: 50000,
        achievedAmount: legitAchieved,
        status: legitAchieved >= 50000 ? 'Achieved' : 'Active',
        currency: 'PKR',
        notes: 'Monthly sales quota based on team objectives'
      });
      targets = [defaultTarget];
    } else {
      // Keep active targets updated with legit achieved
      targets = targets.map(t => {
        if (t.status === 'Active' || t.status === 'Ongoing') {
          t.achievedAmount = legitAchieved;
          if (t.targetAmount > 0 && legitAchieved >= t.targetAmount) {
            t.status = 'Achieved';
          }
        }
        return t;
      });
    }

    return res.status(200).json({ success: true, count: targets.length, data: targets });
  } catch (error) {
    console.error('[Get Targets Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching targets.' });
  }
};

const getMyActivities = async (req, res) => {
  try {
    const activities = await SalesActivity.find({ performedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(200).json({ success: true, count: activities.length, data: activities });
  } catch (error) {
    console.error('[Get Activities Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching activities.' });
  }
};

// ══════════════════════════════════════════════
// SALES MANAGER — TEAM MANAGEMENT CONTROLLER METHODS
// ══════════════════════════════════════════════
/**
 * @desc    Get all sales team members with calculated stats & financials
 * @route   GET /api/sales-manager/team-members
 * @access  Private/sales_manager/admin/ceo
 */
const getSalesTeamMembers = async (req, res) => {
  try {
    const now = new Date();
    const scope = await getSalesManagerScope(req.user);

    const baseQuery = {
      $or: [
        { role: { $in: ['employee', 'sales_rep', 'sales_member', 'sales_person'] }, department: { $regex: /^sales$/i } },
        { role: { $in: ['sales_rep', 'sales_member', 'sales_person'] } },
        { department: { $regex: /^sales$/i } },
        { position: { $regex: /sales/i } }
      ],
      role: { $nin: ['admin', 'ceo', 'hr_manager', 'accountant', 'administration', 'project_manager', 'marketing', 'sales_manager'] }
    };

    if (!scope.isGlobal) {
      const managedMemberObjectIds = scope.memberIds.filter(id => id.toString() !== req.user._id.toString());
      baseQuery._id = { $in: managedMemberObjectIds };
    }

    const salesEmployees = await User.find(baseQuery).select('-password').sort({ fullName: 1 });

    // Attach full stats & financial calculations for each member
    const membersWithStats = await Promise.all(
      salesEmployees.map(async (emp) => {
        const empId = emp._id;
        const empNameRegex = new RegExp(emp.fullName?.split(' ')[0] || '', 'i');
        const [leads, quotations, orders, deals, followUps, activeTarget, invoices, payroll] = await Promise.all([
          Lead.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }),
          Quotation.find({ $or: [{ createdBy: empId }, { salesPerson: empId }, { salePerson: empNameRegex }] }),
          SalesOrder.find({ $or: [{ salesPerson: empId }, { createdBy: empId }, { salePerson: empNameRegex }] }),
          Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }),
          FollowUp.find({ createdBy: empId }),
          SalesTarget.findOne({ employee: empId, status: { $in: ['Active', 'Ongoing'] } }).sort({ createdAt: -1 }),
          Invoice.find({ $or: [{ createdBy: empId }, { salesPerson: empId }, { salePerson: empNameRegex }] }),
          Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
        ]);

        const ordersAchieved = orders
          .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'].includes(o.status))
          .reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
        const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
        const wonDealsValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        
        const approvedInvoicesList = invoices.filter(i => ['Approved', 'Sent', 'Partially Paid', 'Overdue', 'Paid'].includes(i.status));
        const approvedInvoicesAmount = approvedInvoicesList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        const paidInvoicesAmount = invoices.reduce((sum, i) => sum + (Number(i.paidAmount) || (i.status === 'Paid' ? Number(i.amount) : 0)), 0);

        const achievedAmount = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);
        const targetAmount = activeTarget?.targetAmount || Number(emp.target) || Number(emp.salaryTarget) || 0;
        const remainingTarget = Math.max(0, targetAmount - achievedAmount);
        const targetPct = targetAmount > 0 ? Math.round((achievedAmount / targetAmount) * 100) : (achievedAmount > 0 ? 100 : 0);

        const convertedLeads = leads.filter(l => l.status === 'Converted' || l.status === 'Converted to Deal').length;
        const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
        const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;

        // 1. Receivables: Approved unpaid invoices + uninvoiced orders
        const receivableInvoices = invoices.filter(i =>
          ['Approved', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status) &&
          i.status !== 'Paid' &&
          i.status !== 'Cancelled'
        );
        const invoiceReceivables = receivableInvoices.reduce((sum, i) => {
          const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
          return sum + Math.max(0, outstanding);
        }, 0);

        const uninvoicedOrders = orders.filter(o => o.invoiceStatus !== 'Fully Invoiced' && o.status !== 'Cancelled');
        const orderReceivables = uninvoicedOrders.reduce((sum, o) => {
          return sum + Math.max(0, Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0));
        }, 0);

        const receivables = invoiceReceivables + orderReceivables;

        // 2. Overdue: Strictly approved invoices past due date or status Overdue with unpaid balance + orders past due
        const overdueInvoices = invoices.filter(i => {
          const isApproved = ['Approved', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status);
          const isPastDue = i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now);
          const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
          return isApproved && isPastDue && outstanding > 0 && i.status !== 'Paid' && i.status !== 'Cancelled';
        });
        const overdueInvoiceAmountPart = overdueInvoices.reduce((sum, i) => {
          const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
          return sum + Math.max(0, outstanding);
        }, 0);

        const overdueOrders = uninvoicedOrders.filter(o => {
          const orderBaseDate = o.orderDate || o.creationDate || o.createdAt;
          const isPastDue = orderBaseDate && (new Date(orderBaseDate).getTime() + 30 * 24 * 60 * 60 * 1000) < now.getTime();
          return isPastDue && (Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0) > 0);
        });
        const overdueOrderAmount = overdueOrders.reduce((sum, o) => sum + Math.max(0, Number(o.outstandingBalance || o.netAmount || o.totalAmount || 0)), 0);

        const overdueAmount = overdueInvoiceAmountPart + overdueOrderAmount;

        const salaryTarget = Number(emp.salaryTarget) || Number(payroll?.baseSalary) || Number(payroll?.netSalary) || Math.round(targetAmount * 0.1) || 0;
        const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
        const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
        const netRevenue = paidInvoicesAmount > 0 ? paidInvoicesAmount : achievedAmount;

        return {
          ...emp.toJSON(),
          stats: {
            totalLeads: leads.length,
            convertedLeads,
            pendingLeads,
            totalQuotations: quotations.length,
            totalOrders: orders.length,
            totalDeals: deals.length,
            wonDealsCount: wonDeals.length,
            wonDealsValue,
            approvedInvoicesCount: approvedInvoicesList.length,
            paidInvoicesAmount,
            completedFollowUps,
            targetAmount,
            achievedAmount,
            remainingTarget,
            targetAchievementPct: targetPct,
            receivables,
            overdueAmount,
            salaryTarget,
            liability,
            netRevenue
          }
        };
      })
    );

    return res.status(200).json({ success: true, count: membersWithStats.length, data: membersWithStats });
  } catch (error) {
    console.error('[Get Sales Team Members Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching sales team members.' });
  }
};

/**
 * @desc    Get detailed profile of a specific sales employee (Sales Manager view)
 * @route   GET /api/sales-manager/team-members/:id/profile
 * @access  Private/sales_manager/admin/ceo
 */
const getSalesTeamMemberProfile = async (req, res) => {
  try {
    const now = new Date();
    const scope = await getSalesManagerScope(req.user);

    if (!scope.isGlobal) {
      const isAllowed = scope.memberIds.some(id => id.toString() === req.params.id.toString());
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view team members belonging to your regional branch.'
        });
      }
    }

    const emp = await User.findById(req.params.id).select('-password');

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Sales team member not found.' });
    }

    const empId = emp._id;
    const empNameRegex = new RegExp(emp.fullName?.split(' ')[0] || '', 'i');

    const [leads, quotations, orders, deliveryNotes, followUps, targets, activities, invoices, deals, customerPOs, productFiles, payments, payroll] = await Promise.all([
      Lead.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }).sort({ createdAt: -1 }),
      Quotation.find({ $or: [{ createdBy: empId }, { salesPerson: empId }, { salePerson: empNameRegex }] }).sort({ creationDate: -1, createdAt: -1 }),
      SalesOrder.find({ $or: [{ salesPerson: empId }, { createdBy: empId }, { salePerson: empNameRegex }] }).sort({ creationDate: -1, createdAt: -1 }),
      DeliveryNote.find({ $or: [{ createdBy: empId }, { salesPerson: empId }, { salePerson: empNameRegex }] }).populate('salesOrder', 'orderNumber orderReference').sort({ createdAt: -1 }),
      FollowUp.find({ createdBy: empId }).populate('lead', 'name company').sort({ scheduledAt: 1 }),
      SalesTarget.find({ employee: empId }).populate('assignedBy', 'fullName').sort({ createdAt: -1 }),
      SalesActivity.find({ performedBy: empId }).sort({ createdAt: -1 }).limit(50),
      Invoice.find({ $or: [{ createdBy: empId }, { salesPerson: empId }, { salePerson: empNameRegex }] }).sort({ createdAt: -1 }),
      Deal.find({ $or: [{ assignedTo: empId }, { createdBy: empId }] }).sort({ createdAt: -1 }),
      CustomerPO.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }).sort({ createdAt: -1 }),
      ProductFile.find({ createdBy: empId }).sort({ createdAt: -1 }),
      Payment.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }).sort({ createdAt: -1 }),
      Payroll.findOne({ user: empId, month: now.getMonth() + 1, year: now.getFullYear() })
    ]);

    // Lead & Quotation performance
    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.status === 'Converted' || l.status === 'Converted to Deal').length;
    const pendingLeads = leads.filter(l => ['New', 'Contacted', 'Qualified'].includes(l.status)).length;
    const totalQuotations = quotations.length;
    const acceptedQuotations = quotations.filter(q => q.status === 'Accepted').length;
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => ['Delivered', 'Done', 'Completed'].includes(o.status) || ['Delivered', 'Done', 'Fully Delivered'].includes(o.deliveryStatus)).length;
    const pendingOrders = orders.filter(o => !['Delivered', 'Done', 'Completed', 'Cancelled', 'Rejected'].includes(o.status)).length;
    const approvedOrders = orders.filter(o => Boolean(o.financeApprovedBy) || ['Local Supplier PO Issued', 'International Supplier PO Issued', 'Finance Approved', 'Delivered', 'Completed'].includes(o.workflowStatus) || ['Delivered', 'Completed'].includes(o.status)).length;
    const heldOrders = orders.filter(o => o.isOverdueBlocked || o.workflowStatus === 'Order Blocked / Hold' || o.status === 'Order Blocked / Hold' || o.workflowStatus === 'Finance Rejected' || o.status === 'Rejected').length;
    const totalOrderAmount = orders.reduce((sum, o) => sum + (Number(o.netAmount || o.totalAmount) || 0), 0);
    const totalDeliveryNotes = deliveryNotes.length;
    const completedFollowUps = followUps.filter(f => f.status === 'Completed').length;
    
    // Deals & Invoices
    const totalDeals = deals.length;
    const wonDeals = deals.filter(d => ['Won', 'Closed Won'].includes(d.stage));
    const wonDealsCount = wonDeals.length;
    const wonDealsValue = wonDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    const ordersAchieved = orders
      .filter(o => ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'].includes(o.status))
      .reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const approvedInvoicesList = invoices
      .filter(i => ['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue', 'Paid'].includes(i.status));
    const approvedInvoicesAmount = approvedInvoicesList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const paidInvoicesAmount = invoices.reduce((sum, i) => sum + (Number(i.paidAmount) || (i.status === 'Paid' ? Number(i.amount) : 0)), 0);

    // Sales Achieved & Targets
    const salesAchieved = Math.max(wonDealsValue, ordersAchieved, approvedInvoicesAmount);
    const activeTarget = targets.find(t => t.status === 'Active' || t.status === 'Ongoing') || targets[0];
    const monthlyTarget = activeTarget?.targetAmount || Number(emp.target) || Number(emp.salaryTarget) || 0;
    const remainingTarget = Math.max(0, monthlyTarget - salesAchieved);
    const achievementPct = monthlyTarget > 0 ? Math.round((salesAchieved / monthlyTarget) * 100) : (salesAchieved > 0 ? 100 : 0);

    // Financial calculations (PKR / Rs.)
    // 1. Receivables: Strictly approved / active invoices with unpaid balance
    const receivableInvoices = invoices.filter(i =>
      ['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status) &&
      i.status !== 'Paid' &&
      i.status !== 'Cancelled'
    );
    const receivables = receivableInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);

    // 2. Overdue: Strictly approved invoices past due date or status Overdue with unpaid balance
    const overdueInvoices = invoices.filter(i => {
      const isApproved = ['Approved', 'Finalized', 'Sent', 'Partially Paid', 'Overdue'].includes(i.status);
      const isPastDue = i.status === 'Overdue' || (i.dueDate && new Date(i.dueDate) < now);
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return isApproved && isPastDue && outstanding > 0 && i.status !== 'Paid' && i.status !== 'Cancelled';
    });
    const overdueAmount = overdueInvoices.reduce((sum, i) => {
      const outstanding = i.outstandingAmount != null ? Number(i.outstandingAmount) : (Number(i.amount) - (Number(i.paidAmount) || 0));
      return sum + Math.max(0, outstanding);
    }, 0);

    const salaryTarget = Number(emp.salaryTarget) || Number(payroll?.baseSalary) || Number(payroll?.netSalary) || (monthlyTarget > 0 ? Math.round(monthlyTarget * 0.1) : 0);
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled');
    const liability = cancelledOrders.reduce((sum, o) => sum + (Number(o.netAmount) || 0), 0);
    const netRevenue = paidInvoicesAmount > 0 ? paidInvoicesAmount : salesAchieved;

    return res.status(200).json({
      success: true,
      data: {
        employee: emp.toJSON(),
        performance: {
          totalLeads,
          convertedLeads,
          pendingLeads,
          totalQuotations,
          acceptedQuotations,
          totalOrders,
          totalOrderAmount,
          completedOrders,
          pendingOrders,
          approvedOrders,
          heldOrders,
          totalDeals,
          wonDealsCount,
          wonDealsValue,
          totalDeliveryNotes,
          completedFollowUps,
          approvedInvoicesCount: approvedInvoicesList.length,
          paidInvoicesAmount,
          monthlyTarget,
          salesAchieved,
          remainingTarget,
          achievementPct,
          receivables,
          overdueAmount,
          salaryTarget,
          liability,
          netRevenue
        },
        leads,
        quotations,
        orders,
        deliveryNotes,
        followUps,
        targets,
        activities,
        invoices,
        deals,
        customerPOs,
        productFiles,
        payments
      }
    });
  } catch (error) {
    console.error('[Get Sales Team Member Profile Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching profile.' });
  }
};

// ══════════════════════════════════════════════
// DELETE & UPDATE HANDLERS FOR SALES EMPLOYEES & MANAGERS
// ══════════════════════════════════════════════
const deleteMyLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found.' });
    if (!checkOwnership(lead, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own leads.' });
    }
    await Lead.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Lead deleted successfully.' });
  } catch (error) {
    console.error('[Delete Lead Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting lead.' });
  }
};

const deleteMyDeal = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });
    if (!checkOwnership(deal, ['assignedTo', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own deals.' });
    }
    await Deal.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Deal deleted successfully.' });
  } catch (error) {
    console.error('[Delete Deal Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting deal.' });
  }
};

const deleteMyQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found.' });
    if (!checkOwnership(quotation, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own quotations.' });
    }
    await Quotation.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Quotation deleted successfully.' });
  } catch (error) {
    console.error('[Delete Quotation Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting quotation.' });
  }
};

const updateMyInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const changes = {};
    const allowedFields = ['clientName', 'customerEmail', 'customerPhone', 'customerAddress', 'items', 'subtotal', 'tax', 'taxRate', 'discount', 'amount', 'paymentTerms', 'issueDate', 'dueDate', 'description', 'notes', 'status', 'salesOrderId', 'deliveryNoteId', 'fileNumber', 'fileType', 'paidAmount', 'outstandingAmount'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && hasFieldValueChanged(invoice[field], req.body[field])) {
        changes[field] = { old: invoice[field], new: req.body[field] };
      }
    });

    const docType = invoice.status === 'Draft' || invoice.type === 'Draft' ? 'Draft Invoice' : 'Final Invoice';
    const check = await verifyAndConsumeCEOPermission({
      documentType: docType,
      documentId: invoice._id,
      documentNumber: invoice.invoiceNumber,
      requestingUser: req.user,
      changes
    });

    if (!check.authorized) {
      return res.status(403).json({ success: false, message: check.message });
    }

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) invoice[field] = req.body[field];
    });
    if (req.body.status) invoice.status = req.body.status;
    await invoice.save();
    return res.status(200).json({ success: true, message: 'Invoice updated successfully.', data: invoice });
  } catch (error) {
    console.error('[Update Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating invoice.' });
  }
};

const deleteMyInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (!checkOwnership(invoice, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own invoices.' });
    }
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    if (!isManagerOrAdmin && (invoice.status === 'Approved' || invoice.status === 'Paid')) {
      return res.status(400).json({ success: false, message: 'Approved or paid invoices cannot be deleted.' });
    }
    await Invoice.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Invoice deleted successfully.' });
  } catch (error) {
    console.error('[Delete Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting invoice.' });
  }
};

const deleteMyOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });
    if (!checkOwnership(order, ['salesPerson', 'createdBy'], req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own sales orders.' });
    }

    const orderRef = order.orderReference || order.orderNumber;
    const linkedDN = await DeliveryNote.findOne({
      $or: [{ salesOrderId: req.params.id }, { salesOrderNumber: orderRef }]
    });
    if (linkedDN) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Delivery Note (${linkedDN.deliveryNumber || linkedDN.deliveryNoteNumber}) is linked to it.`
      });
    }

    const linkedInv = await Invoice.findOne({
      $or: [{ salesOrderId: req.params.id }, { salesOrderNumber: orderRef }]
    });
    if (linkedInv) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Invoice (${linkedInv.invoiceNumber}) is linked to it.`
      });
    }

    await SalesOrder.findByIdAndDelete(req.params.id);
    await logSalesActivity({
      type: 'Sales Order Deleted',
      description: `Sales Order ${orderRef} was deleted by ${req.user.fullName || 'Sales Member'}`,
      relatedModel: 'SalesOrder',
      relatedId: req.params.id,
      performedBy: req.user._id
    });
    return res.status(200).json({ success: true, message: 'Sales order deleted successfully.' });
  } catch (error) {
    console.error('[Delete Order Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting order.' });
  }
};

const updateMyDeliveryNote = async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id).session(session);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });

    const changes = {};
    const allowedFields = [
      'clientName',
      'recipientName',
      'recipientPhone',
      'deliveryAddress',
      'trackingNumber',
      'carrier',
      'deliveryDate',
      'items',
      'notes',
      'status',
      'receivedBy',
      'deliveryType',
      'salesOrderId',
      'salesOrderNumber',
      'operationType',
      'sourceLocation',
      'scheduledDate',
      'deadline',
      'productAvailability',
      'sourceDocument',
      'starred'
    ];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && hasFieldValueChanged(deliveryNote[field], req.body[field])) {
        changes[field] = { old: deliveryNote[field], new: req.body[field] };
      }
    });

    const check = await verifyAndConsumeCEOPermission({
      documentType: 'Delivery Note',
      documentId: deliveryNote._id,
      documentNumber: deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber,
      requestingUser: req.user,
      changes
    });

    if (!check.authorized) {
      return res.status(403).json({ success: false, message: check.message });
    }

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) deliveryNote[field] = req.body[field];
    });
    await deliveryNote.save();
    return res.status(200).json({ success: true, message: 'Delivery note updated.', data: deliveryNote });
  } catch (error) {
    console.error('[Update Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating delivery note.' });
  }
};

const deleteMyDeliveryNote = async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    if (!checkOwnership(deliveryNote, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own delivery notes.' });
    }
    await DeliveryNote.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Delivery note deleted successfully.' });
  } catch (error) {
    console.error('[Delete Delivery Note Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting delivery note.' });
  }
};

const deleteMyFollowUp = async (req, res) => {
  try {
    const followUp = await FollowUp.findById(req.params.id);
    if (!followUp) return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    if (!checkOwnership(followUp, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own follow-ups.' });
    }
    await FollowUp.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Follow-up deleted successfully.' });
  } catch (error) {
    console.error('[Delete FollowUp Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting follow-up.' });
  }
};

// ══════════════════════════════════════════════
// CUSTOMER PURCHASE ORDERS
// ══════════════════════════════════════════════
const getMyCustomerPOs = async (req, res) => {
  try {
    const { status, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (status === 'active' || !status) {
      query.status = { $nin: ['Processed'] };
    } else if (status === 'processed') {
      query.status = 'Processed';
    } else if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ poNumber: regex }, { customerName: regex }, { quotationNumber: regex }];
    }
    const pos = await CustomerPO.find(query).populate('quotationId', 'quotationNumber clientName').populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: pos.length, data: pos });
  } catch (error) {
    console.error('[Get CustomerPOs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching customer POs.' });
  }
};

const createMyCustomerPO = async (req, res) => {
  try {
    const { customerName, quotationId, quotationNumber, poDate, amount, notes, uploadedDocument, documentName } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });
    if (!hasValidCustomerPOAttachment({ uploadedDocument, documentName })) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const linkedQuotation = quotationId && mongoose.Types.ObjectId.isValid(quotationId)
      ? await Quotation.findById(quotationId)
      : null;

    const po = await CustomerPO.create({
      customerName: customerName.trim(),
      quotationId: quotationId || null,
      quotationNumber: quotationNumber || '',
      fileNumber: linkedQuotation?.fileNo || '',
      fileType: linkedQuotation?.fileType || '',
      poDate: poDate ? new Date(poDate) : new Date(),
      amount: Number(amount) || 0,
      notes: notes || '',
      uploadedDocument: uploadedDocument || '',
      documentName: documentName || '',
      status: 'Received',
      createdBy: req.user._id
    });

    // Link quotation to this PO and mark it Accepted if not already
    if (quotationId) {
      await Quotation.findByIdAndUpdate(quotationId, { customerPOId: po._id, status: 'Accepted' });
    }

    await logSalesActivity({
      type: 'Customer PO Uploaded',
      description: `Recorded Customer PO ${po.poNumber} for ${po.customerName} (Rs. ${Number(po.amount).toLocaleString()})`,
      relatedModel: 'CustomerPO',
      relatedId: po._id,
      relatedCustomer: po.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Customer PO Received',
      message: `${req.user.fullName} recorded Customer PO ${po.poNumber} for ${po.customerName} (Rs. ${Number(po.amount).toLocaleString()}).`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Customer PO recorded successfully.', data: po });
  } catch (error) {
    console.error('[Create CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating customer PO.' });
  }
};

const updateMyCustomerPO = async (req, res) => {
  try {
    const po = await CustomerPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Customer PO not found.' });
    if (!checkOwnership(po, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own customer POs.' });
    }

    const allowedFields = ['customerName', 'quotationNumber', 'poDate', 'amount', 'notes', 'uploadedDocument', 'documentName', 'status'];
    allowedFields.forEach(field => { if (req.body[field] !== undefined) po[field] = req.body[field]; });
    if ((req.body.uploadedDocument !== undefined || req.body.documentName !== undefined) && !hasValidCustomerPOAttachment(po)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    await po.save();
    return res.status(200).json({ success: true, message: 'Customer PO updated.', data: po });
  } catch (error) {
    console.error('[Update CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating customer PO.' });
  }
};

const deleteMyCustomerPO = async (req, res) => {
  try {
    const po = await CustomerPO.findById(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Customer PO not found.' });
    if (!checkOwnership(po, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own customer POs.' });
    }
    await CustomerPO.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Customer PO deleted.' });
  } catch (error) {
    console.error('[Delete CustomerPO Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting customer PO.' });
  }
};

// ══════════════════════════════════════════════
// PRODUCT FILES (BLUE / GREEN)
// ══════════════════════════════════════════════
const getMyProductFiles = async (req, res) => {
  try {
    const { status, fileType, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo'].includes(req.user.role);
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (status === 'active' || !status) {
      query.status = { $nin: ['Completed', 'Cancelled'] };
    } else if (status === 'completed') {
      query.status = 'Completed';
    } else if (status && status !== 'all') {
      query.status = status;
    }

    if (fileType && fileType !== 'all') query.fileType = fileType;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ fileNumber: regex }, { customerName: regex }];
    }
    const files = await ProductFile.find(query).populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: files.length, data: files });
  } catch (error) {
    console.error('[Get ProductFiles Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching product files.' });
  }
};

const createMyProductFile = async (req, res) => {
  try {
    const { fileType, customerName, quotationId, quotationNumber, customerPOId, customerPONumber, salesOrderId, salesOrderNumber, products, notes } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });

    const safeQuotationId = quotationId && mongoose.Types.ObjectId.isValid(quotationId) ? quotationId : null;
    const safeCustomerPOId = customerPOId && mongoose.Types.ObjectId.isValid(customerPOId) ? customerPOId : null;
    const safeSalesOrderId = salesOrderId && mongoose.Types.ObjectId.isValid(salesOrderId) ? salesOrderId : null;

    const customerPO = safeCustomerPOId ? await CustomerPO.findById(safeCustomerPOId) : null;
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const linkedQuotationId = safeQuotationId || customerPO.quotationId || null;
    const linkedQuotation = linkedQuotationId ? await Quotation.findById(linkedQuotationId) : null;
    const resolvedFileType = customerPO.fileType || linkedQuotation?.fileType || fileType;
    const resolvedFileNumber = customerPO.fileNumber || linkedQuotation?.fileNo || await allocateFileNumber(resolvedFileType);

    const pf = await ProductFile.create({
      fileNumber: resolvedFileNumber,
      fileType: resolvedFileType,
      customerName: customerName.trim(),
      quotationId: linkedQuotationId,
      quotationNumber: linkedQuotation?.orderReference || linkedQuotation?.quotationNumber || quotationNumber || customerPO.quotationNumber || '',
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || customerPONumber || '',
      salesOrderId: safeSalesOrderId,
      salesOrderNumber: salesOrderNumber || '',
      products: Array.isArray(products) ? products : [],
      notes: notes || '',
      createdBy: req.user._id
    });

    await logSalesActivity({
      type: 'Product File Created',
      description: `Created ${pf.fileType} file ${pf.fileNumber || pf._id} for ${pf.customerName}`,
      relatedModel: 'ProductFile',
      relatedId: pf._id,
      relatedCustomer: pf.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Product File Created',
      message: `${req.user.fullName} created a ${pf.fileType} Product File (${pf.fileNumber || 'File'}) for ${pf.customerName}.`,
      type: 'sales'
    });

    return res.status(201).json({ success: true, message: 'Product file created successfully.', data: pf });
  } catch (error) {
    console.error('[Create ProductFile Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : (error.message || 'Server error creating product file.') });
  }
};

const updateMyProductFile = async (req, res) => {
  try {
    const pf = await ProductFile.findById(req.params.id);
    if (!pf) return res.status(404).json({ success: false, message: 'Product file not found.' });
    if (!checkOwnership(pf, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own product files.' });
    }

    const allowedFields = ['fileType', 'customerName', 'quotationNumber', 'customerPONumber', 'salesOrderNumber', 'products', 'notes', 'status'];
    allowedFields.forEach(field => { if (req.body[field] !== undefined) pf[field] = req.body[field]; });

    if (req.body.quotationId !== undefined) {
      pf.quotationId = req.body.quotationId && mongoose.Types.ObjectId.isValid(req.body.quotationId) ? req.body.quotationId : null;
    }
    if (req.body.customerPOId !== undefined) {
      pf.customerPOId = req.body.customerPOId && mongoose.Types.ObjectId.isValid(req.body.customerPOId) ? req.body.customerPOId : null;
    }
    if (req.body.salesOrderId !== undefined) {
      pf.salesOrderId = req.body.salesOrderId && mongoose.Types.ObjectId.isValid(req.body.salesOrderId) ? req.body.salesOrderId : null;
    }

    await pf.save();

    await logSalesActivity({
      type: 'Product File Updated',
      description: `Updated ${pf.fileType} file ${pf.fileNumber || pf._id} for ${pf.customerName}`,
      relatedModel: 'ProductFile',
      relatedId: pf._id,
      relatedCustomer: pf.customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Product File Updated',
      message: `${req.user.fullName} updated Product File ${pf.fileNumber || pf._id} for ${pf.customerName}.`,
      type: 'sales'
    });

    return res.status(200).json({ success: true, message: 'Product file updated successfully.', data: pf });
  } catch (error) {
    console.error('[Update ProductFile Error]:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error updating product file.' });
  }
};

const deleteMyProductFile = async (req, res) => {
  try {
    const pf = await ProductFile.findById(req.params.id);
    if (!pf) return res.status(404).json({ success: false, message: 'Product file not found.' });
    if (!checkOwnership(pf, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own product files.' });
    }
    await ProductFile.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Product file deleted.' });
  } catch (error) {
    console.error('[Delete ProductFile Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting product file.' });
  }
};

// ══════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════
const getMyPayments = async (req, res) => {
  try {
    const { salesOrderId, search, employeeId } = req.query;
    const isManagerOrAdmin = ['sales_manager', 'admin', 'ceo', 'finance', 'accountant'].includes(req.user.role) ||
      ['finance', 'accounts', 'administration'].includes((req.user.department || '').toLowerCase());
    const query = {};

    if (isManagerOrAdmin) {
      if (employeeId) query.createdBy = employeeId;
    } else {
      query.createdBy = req.user._id;
    }

    if (salesOrderId) query.salesOrderId = salesOrderId;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { paymentRefNumber: regex },
        { customerName: regex },
        { salesOrderNumber: regex },
        { invoiceNumber: regex },
        { 'allocations.salesOrderNumber': regex },
        { 'allocations.invoiceNumber': regex },
        { salePerson: regex },
        { paymentMethod: regex },
        { paymentType: regex }
      ];
    }
    const payments = await Payment.find(query)
      .populate('createdBy', 'fullName email position role department')
      .populate('salesPerson', 'fullName email')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (error) {
    console.error('[Get Payments Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching payments.' });
  }
};

const toMoneyCents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : NaN;
};
const fromMoneyCents = (cents) => cents / 100;

const getPaymentCentsForInvoice = (payment, invoiceId) => {
  if (Array.isArray(payment.allocations) && payment.allocations.length > 0) {
    return payment.allocations.reduce((sum, allocation) => (
      String(allocation.invoiceId) === String(invoiceId) ? sum + toMoneyCents(allocation.amount) : sum
    ), 0);
  }
  return String(payment.invoiceId) === String(invoiceId) ? toMoneyCents(payment.amount) : 0;
};

const getPaymentCentsForOrder = (payment, salesOrderId) => {
  if (Array.isArray(payment.allocations) && payment.allocations.length > 0) {
    return payment.allocations.reduce((sum, allocation) => (
      String(allocation.salesOrderId) === String(salesOrderId) ? sum + toMoneyCents(allocation.amount) : sum
    ), 0);
  }
  return String(payment.salesOrderId) === String(salesOrderId) ? toMoneyCents(payment.amount) : 0;
};

// Helper to synchronize Invoice and SalesOrder balances after payment changes
const syncInvoiceAndOrderBalances = async (invoiceId, salesOrderId) => {
  try {
    if (invoiceId) {
      const invoice = await Invoice.findById(invoiceId);
      if (invoice) {
        const allPayments = await Payment.find({ $or: [{ invoiceId }, { 'allocations.invoiceId': invoiceId }] });
        const totalPaidCents = allPayments.reduce((sum, payment) => sum + getPaymentCentsForInvoice(payment, invoiceId), 0);
        const invTotalCents = toMoneyCents(invoice.amount) || 0;
        const outstandingCents = Math.max(0, invTotalCents - totalPaidCents);
        const totalPaid = fromMoneyCents(totalPaidCents);
        const outstanding = fromMoneyCents(outstandingCents);
        let invStatus = invoice.status;
        if (outstandingCents === 0 && invTotalCents > 0) {
          invStatus = 'Paid';
        } else if (totalPaid > 0) {
          invStatus = 'Partially Paid';
        } else if (invStatus === 'Partially Paid' || invStatus === 'Paid') {
          invStatus = 'Approved';
        }
        await Invoice.findByIdAndUpdate(invoiceId, {
          paidAmount: totalPaid,
          outstandingAmount: outstanding,
          status: invStatus
        });
      }
    }

    if (salesOrderId) {
      const order = await SalesOrder.findById(salesOrderId);
      if (order) {
        const allOrderPayments = await Payment.find({ $or: [{ salesOrderId }, { 'allocations.salesOrderId': salesOrderId }] });
        const totalPaidCents = allOrderPayments.reduce((sum, payment) => sum + getPaymentCentsForOrder(payment, salesOrderId), 0);
        const orderTotalCents = toMoneyCents(order.netAmount || order.totalAmount) || 0;
        const outstandingCents = Math.max(0, orderTotalCents - totalPaidCents);
        const totalPaid = fromMoneyCents(totalPaidCents);
        const outstanding = fromMoneyCents(outstandingCents);
        let paymentStatus = 'Pending';
        if (totalPaidCents === 0) paymentStatus = 'Pending';
        else if (outstandingCents === 0 && orderTotalCents > 0) paymentStatus = 'Fully Paid';
        else paymentStatus = 'Partially Paid';
        await SalesOrder.findByIdAndUpdate(salesOrderId, {
          totalPaid,
          outstandingBalance: outstanding,
          paymentStatus
        });
      }
    }
  } catch (err) {
    console.error('[Sync Balances Error]:', err);
  }
};

const createMyPayment = async (req, res) => {
  try {
    let { customerName, salesOrderId, salesOrderNumber, invoiceId, invoiceNumber, paymentDate, amount, paymentType, paymentMethod, notes } = req.body;
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ success: false, message: 'Customer name is required.' });
    }

    const requestedAllocations = Array.isArray(req.body.allocations) && req.body.allocations.length > 1
      ? req.body.allocations
      : null;
    const allocations = [];
    const allocatedInvoiceIds = new Set();
    let resolvedSalesPersonId = null;
    let resolvedSalePerson = '';

    if (requestedAllocations) {
      for (const requested of requestedAllocations) {
        if (!requested.invoiceId || !mongoose.Types.ObjectId.isValid(requested.invoiceId)) {
          return res.status(400).json({ success: false, message: 'Each allocation must select a valid invoice.' });
        }
        if (allocatedInvoiceIds.has(String(requested.invoiceId))) {
          return res.status(400).json({ success: false, message: 'Each invoice can only appear once on a receipt.' });
        }
        allocatedInvoiceIds.add(String(requested.invoiceId));
        const invoice = await Invoice.findById(requested.invoiceId).populate('salesPerson');
        if (!invoice) {
          return res.status(404).json({ success: false, message: 'An invoice selected for allocation was not found.' });
        }
        const invoiceCustomer = (invoice.clientName || invoice.customerName || '').trim().toLowerCase();
        if (invoiceCustomer && invoiceCustomer !== customerName.trim().toLowerCase()) {
          return res.status(400).json({ success: false, message: 'One receipt can only be allocated to invoices for the same customer.' });
        }

        const allocationCents = toMoneyCents(requested.amount);
        const remainingCents = Math.max(0, (toMoneyCents(invoice.amount) || 0) - (toMoneyCents(invoice.paidAmount) || 0));
        if (!Number.isInteger(allocationCents) || allocationCents <= 0) {
          return res.status(400).json({ success: false, message: 'Each invoice allocation must be greater than 0.00.' });
        }
        if (allocationCents > remainingCents) {
          return res.status(400).json({
            success: false,
            message: `Allocation for ${invoice.invoiceNumber} exceeds its remaining receivable of PKR ${fromMoneyCents(remainingCents).toFixed(2)}.`
          });
        }

        allocations.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber || '',
          salesOrderId: invoice.salesOrderId || null,
          salesOrderNumber: invoice.salesOrderNumber || invoice.saleReference || '',
          amount: fromMoneyCents(allocationCents)
        });
        resolvedSalesPersonId = resolvedSalesPersonId || invoice.salesPerson?._id || invoice.salesPerson || null;
        resolvedSalePerson = resolvedSalePerson || invoice.salePerson || invoice.salesPerson?.fullName || '';
      }

      const first = allocations[0];
      invoiceId = first.invoiceId;
      invoiceNumber = first.invoiceNumber;
      salesOrderId = first.salesOrderId;
      salesOrderNumber = first.salesOrderNumber;
      amount = fromMoneyCents(allocations.reduce((sum, allocation) => sum + toMoneyCents(allocation.amount), 0));
    } else {
      const payAmountCents = toMoneyCents(amount);
      if (!Number.isInteger(payAmountCents) || payAmountCents <= 0) {
        return res.status(400).json({ success: false, message: 'Valid payment amount is required.' });
      }
      amount = fromMoneyCents(payAmountCents);

      if (invoiceId) {
        const invoice = await Invoice.findById(invoiceId).populate('salesPerson');
        if (invoice) {
          resolvedSalesPersonId = invoice.salesPerson?._id || invoice.salesPerson || null;
          resolvedSalePerson = invoice.salePerson || invoice.salesPerson?.fullName || '';
          if (!salesOrderId && invoice.salesOrderId) {
            salesOrderId = invoice.salesOrderId;
            salesOrderNumber = invoice.salesOrderNumber || invoice.saleReference || salesOrderNumber;
          }
          invoiceNumber = invoiceNumber || invoice.invoiceNumber;
          const remainingCents = Math.max(0, (toMoneyCents(invoice.amount) || 0) - (toMoneyCents(invoice.paidAmount) || 0));
          if (payAmountCents > remainingCents) {
            return res.status(400).json({
              success: false,
              message: `Payment amount (PKR ${amount.toFixed(2)}) exceeds the invoice's remaining receivable of PKR ${fromMoneyCents(remainingCents).toFixed(2)}.`
            });
          }
        }
      }
    }

    if (salesOrderId && (!resolvedSalesPersonId || !resolvedSalePerson)) {
      const parentSo = await SalesOrder.findById(salesOrderId).populate('salesPerson');
      if (parentSo) {
        resolvedSalesPersonId = resolvedSalesPersonId || parentSo.salesPerson?._id || parentSo.salesPerson || parentSo.createdBy || null;
        resolvedSalePerson = resolvedSalePerson || parentSo.salePerson || parentSo.salesPerson?.fullName || '';
      }
    }

    const payment = await Payment.create({
      customerName: customerName.trim(),
      salesOrderId: salesOrderId || null,
      salesOrderNumber: requestedAllocations ? allocations.map(a => a.salesOrderNumber).filter(Boolean).join(', ') : (salesOrderNumber || ''),
      invoiceId: invoiceId || null,
      invoiceNumber: requestedAllocations ? allocations.map(a => a.invoiceNumber).join(', ') : (invoiceNumber || ''),
      allocations: requestedAllocations ? allocations : undefined,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      amount,
      paymentType: paymentType || 'Partial',
      paymentMethod: paymentMethod || 'Bank Transfer',
      notes: notes || '',
      salesPerson: resolvedSalesPersonId || (req.user.department === 'Sales' ? req.user._id : null),
      salePerson: resolvedSalePerson || (req.user.department === 'Sales' ? req.user.fullName : ''),
      createdBy: req.user._id
    });

    const balanceTargets = requestedAllocations
      ? allocations
      : [{ invoiceId, salesOrderId }];
    const syncedInvoices = new Set();
    const syncedOrders = new Set();
    for (const target of balanceTargets) {
      const targetInvoiceId = target.invoiceId ? String(target.invoiceId) : '';
      const targetOrderId = target.salesOrderId ? String(target.salesOrderId) : '';
      await syncInvoiceAndOrderBalances(
        targetInvoiceId && !syncedInvoices.has(targetInvoiceId) ? target.invoiceId : null,
        targetOrderId && !syncedOrders.has(targetOrderId) ? target.salesOrderId : null
      );
      if (targetInvoiceId) syncedInvoices.add(targetInvoiceId);
      if (targetOrderId) syncedOrders.add(targetOrderId);
    }

    await logSalesActivity({
      type: 'Payment Recorded',
      description: `Recorded ${paymentType || 'Partial'} payment of PKR ${Number(amount).toFixed(2)} from ${customerName}`,
      relatedModel: 'Payment',
      relatedId: payment._id,
      relatedCustomer: customerName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper(['finance', 'accountant', 'sales_manager', 'sales_member', 'sales_rep', 'sales_person', 'admin', 'ceo'], {
      role: 'finance',
      sender: req.user._id,
      title: 'Payment Recorded',
      message: `Payment of PKR ${Number(amount).toFixed(2)} recorded for Invoice ${payment.invoiceNumber || 'Direct'}.`,
      type: 'finance',
      link: '/finance/payments'
    });

    return res.status(201).json({ success: true, message: 'Payment recorded successfully.', data: payment });
  } catch (error) {
    console.error('[Create Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error recording payment.' });
  }
};

const updateMyPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (!checkOwnership(payment, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own payments.' });
    }

    const oldInvoiceId = payment.invoiceId;
    const oldSalesOrderId = payment.salesOrderId;

    if (Array.isArray(payment.allocations) && payment.allocations.length > 0 && ['amount', 'invoiceId', 'salesOrderId'].some(field => req.body[field] !== undefined)) {
      return res.status(400).json({ success: false, message: 'Invoice allocations on a split receipt cannot be changed. Delete it and record a corrected receipt.' });
    }

    const allowedFields = ['customerName', 'paymentDate', 'amount', 'paymentType', 'paymentMethod', 'notes', 'invoiceNumber', 'salesOrderNumber', 'invoiceId', 'salesOrderId'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'amount') payment[field] = fromMoneyCents(toMoneyCents(req.body[field]));
        else payment[field] = req.body[field];
      }
    });

    await payment.save();

    // Re-sync balances
    await syncInvoiceAndOrderBalances(payment.invoiceId || oldInvoiceId, payment.salesOrderId || oldSalesOrderId);
    if (oldInvoiceId && String(oldInvoiceId) !== String(payment.invoiceId)) {
      await syncInvoiceAndOrderBalances(oldInvoiceId, null);
    }
    if (oldSalesOrderId && String(oldSalesOrderId) !== String(payment.salesOrderId)) {
      await syncInvoiceAndOrderBalances(null, oldSalesOrderId);
    }

    return res.status(200).json({ success: true, message: 'Payment updated.', data: payment });
  } catch (error) {
    console.error('[Update Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating payment.' });
  }
};

const deleteMyPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (!checkOwnership(payment, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own payments.' });
    }
    const balanceTargets = Array.isArray(payment.allocations) && payment.allocations.length > 0
      ? payment.allocations.map(allocation => ({ invoiceId: allocation.invoiceId, salesOrderId: allocation.salesOrderId }))
      : [{ invoiceId: payment.invoiceId, salesOrderId: payment.salesOrderId }];

    await Payment.findByIdAndDelete(req.params.id);

    // Re-sync balances after deletion
    const syncedInvoices = new Set();
    const syncedOrders = new Set();
    for (const target of balanceTargets) {
      const invoiceKey = target.invoiceId ? String(target.invoiceId) : '';
      const orderKey = target.salesOrderId ? String(target.salesOrderId) : '';
      await syncInvoiceAndOrderBalances(
        invoiceKey && !syncedInvoices.has(invoiceKey) ? target.invoiceId : null,
        orderKey && !syncedOrders.has(orderKey) ? target.salesOrderId : null
      );
      if (invoiceKey) syncedInvoices.add(invoiceKey);
      if (orderKey) syncedOrders.add(orderKey);
    }

    return res.status(200).json({ success: true, message: 'Payment deleted.' });
  } catch (error) {
    console.error('[Delete Payment Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting payment.' });
  }
};

// ══════════════════════════════════════════════
// PROFORMA INVOICES (OPTIONAL STAGE IN SALES WORKFLOW)
// ══════════════════════════════════════════════
const getMyProformaInvoices = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'sales_manager') {
      const scope = await getSalesManagerScope(req.user);
      query = { createdBy: { $in: scope.memberIds } };
    } else if (['admin', 'ceo'].includes(req.user.role)) {
      query = {};
    } else {
      query = { createdBy: req.user._id };
    }

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { proformaNumber: searchRegex },
        { salesOrderNumber: searchRegex },
        { orderReference: searchRegex },
        { clientName: searchRegex },
        { customerPONumber: searchRegex }
      ];
    }

    const proformas = await ProformaInvoice.find(query)
      .populate('salesOrder', 'orderReference orderNumber clientName totalAmount netAmount status deliveryStatus paymentStatus')
      .populate('quotationId', 'quotationNumber')
      .populate('customerPOId', 'poNumber')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: proformas.length,
      data: proformas
    });
  } catch (error) {
    console.error('[Get Proforma Invoices Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching proforma invoices.' });
  }
};

const createMyProformaInvoice = async (req, res) => {
  try {
    const {
      salesOrderId,
      salesOrderNumber,
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      totalAmount,
      discount,
      discountPercentage,
      tax,
      taxPercentage,
      netAmount,
      status,
      issueDate,
      dueDate,
      paymentTerms,
      deliveryTerms,
      notes
    } = req.body;

    if (!salesOrderId) {
      return res.status(400).json({ success: false, message: 'Sales Order reference is required to create a Proforma Invoice.' });
    }

    const salesOrder = await SalesOrder.findById(salesOrderId);
    if (!salesOrder) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    const resolvedClientName = clientName?.trim() || salesOrder.clientName || 'Customer';
    const resolvedItems = Array.isArray(items) && items.length > 0
      ? items.map(it => {
          const q = Number(it.quantity) || 1;
          const u = Number(it.unitPrice) || 0;
          return {
            description: it.description || it.product || '',
            quantity: q,
            unitPrice: u,
            total: q * u
          };
        })
      : salesOrder.items.map(it => {
          const q = Number(it.quantity) || 1;
          const u = Number(it.unitPrice) || 0;
          return {
            description: it.description || '',
            quantity: q,
            unitPrice: u,
            total: q * u
          };
        });

    let calculatedSubtotal = 0;
    resolvedItems.forEach(it => { calculatedSubtotal += it.total; });
    const discPct = discountPercentage !== undefined ? Number(discountPercentage) || 0 : (salesOrder.discountPercentage || 0);
    const disc = discount !== undefined ? Number(discount) || 0 : (salesOrder.discount || (discPct > 0 ? (calculatedSubtotal * discPct) / 100 : 0));
    const taxableBase = Math.max(0, calculatedSubtotal - disc);
    const txPct = taxPercentage !== undefined ? Number(taxPercentage) || 0 : (salesOrder.taxPercentage || 0);
    const tx = tax !== undefined ? Number(tax) || 0 : (salesOrder.tax || (txPct > 0 ? (taxableBase * txPct) / 100 : 0));
    const calculatedNetAmount = Math.max(0, calculatedSubtotal - disc + tx);

    const proforma = await ProformaInvoice.create({
      salesOrder: salesOrder._id,
      salesOrderNumber: salesOrder.orderReference || salesOrder.orderNumber || salesOrderNumber || '',
      orderReference: salesOrder.orderReference || salesOrder.orderNumber || '',
      quotationId: salesOrder.quotationId || null,
      customerPOId: salesOrder.customerPOId || null,
      customerPONumber: salesOrder.customerPONumber || '',
      productFileId: salesOrder.productFileId || null,
      clientName: resolvedClientName,
      clientEmail: clientEmail?.trim() || salesOrder.clientEmail || '',
      clientPhone: clientPhone?.trim() || salesOrder.clientPhone || '',
      clientAddress: clientAddress?.trim() || salesOrder.clientAddress || '',
      items: resolvedItems,
      totalAmount: calculatedSubtotal,
      discount: disc,
      discountPercentage: discPct,
      tax: tx,
      taxPercentage: txPct,
      netAmount: calculatedNetAmount,
      currency: 'PKR',
      status: status || 'Issued',
      issueDate: issueDate || new Date(),
      dueDate: dueDate || null,
      paymentTerms: paymentTerms?.trim() || 'Advance 100%',
      deliveryTerms: deliveryTerms?.trim() || 'Ex-Works / Standard Dispatch',
      notes: notes?.trim() || '',
      createdBy: req.user._id
    });

    // Link Proforma Invoice back to Sales Order without deleting or replacing the Sales Order
    await SalesOrder.findByIdAndUpdate(salesOrder._id, {
      proformaInvoiceId: proforma._id,
      proformaInvoiceNumber: proforma.proformaNumber,
      proformaStatus: proforma.status
    });

    await logSalesActivity({
      type: 'Proforma Invoice Created',
      description: `Created Proforma Invoice ${proforma.proformaNumber} for Sales Order ${salesOrder.orderReference || salesOrder.orderNumber} (Rs. ${proforma.netAmount.toLocaleString()})`,
      relatedModel: 'SalesOrder',
      relatedId: salesOrder._id,
      relatedCustomer: resolvedClientName,
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifyRoleHelper({
      role: 'sales_manager',
      sender: req.user._id,
      title: 'Proforma Invoice Created',
      message: `${req.user.fullName} generated Proforma Invoice ${proforma.proformaNumber} for ${resolvedClientName} (Rs. ${proforma.netAmount.toLocaleString()}).`,
      type: 'sales'
    });

    return res.status(201).json({
      success: true,
      message: `Proforma Invoice ${proforma.proformaNumber} created successfully.`,
      data: proforma
    });
  } catch (error) {
    console.error('[Create Proforma Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating proforma invoice.' });
  }
};

const updateMyProformaInvoice = async (req, res) => {
  try {
    const proforma = await ProformaInvoice.findById(req.params.id);
    if (!proforma) {
      return res.status(404).json({ success: false, message: 'Proforma Invoice not found.' });
    }

    if (!checkOwnership(proforma, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only update your own proforma invoices.' });
    }

    const {
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      items,
      discount,
      discountPercentage,
      tax,
      taxPercentage,
      status,
      issueDate,
      dueDate,
      paymentTerms,
      deliveryTerms,
      notes
    } = req.body;

    if (clientName) proforma.clientName = clientName.trim();
    if (clientEmail !== undefined) proforma.clientEmail = clientEmail.trim();
    if (clientPhone !== undefined) proforma.clientPhone = clientPhone.trim();
    if (clientAddress !== undefined) proforma.clientAddress = clientAddress.trim();
    if (paymentTerms !== undefined) proforma.paymentTerms = paymentTerms.trim();
    if (deliveryTerms !== undefined) proforma.deliveryTerms = deliveryTerms.trim();
    if (notes !== undefined) proforma.notes = notes.trim();
    if (issueDate) proforma.issueDate = issueDate;
    if (dueDate !== undefined) proforma.dueDate = dueDate;
    if (discount !== undefined) proforma.discount = Number(discount) || 0;
    if (discountPercentage !== undefined) proforma.discountPercentage = Number(discountPercentage) || 0;
    if (tax !== undefined) proforma.tax = Number(tax) || 0;
    if (taxPercentage !== undefined) proforma.taxPercentage = Number(taxPercentage) || 0;

    if (Array.isArray(items) && items.length > 0) {
      proforma.items = items.map(it => {
        const q = Number(it.quantity) || 1;
        const u = Number(it.unitPrice) || 0;
        return {
          description: it.description || it.product || '',
          quantity: q,
          unitPrice: u,
          total: q * u
        };
      });
      let subtotal = 0;
      proforma.items.forEach(it => { subtotal += it.total; });
      proforma.totalAmount = subtotal;
      proforma.netAmount = Math.max(0, subtotal - proforma.discount + proforma.tax);
    }

    if (status) {
      proforma.status = status;
      if (proforma.salesOrder) {
        await SalesOrder.findByIdAndUpdate(proforma.salesOrder, { proformaStatus: status });
      }
    }

    await proforma.save();

    return res.status(200).json({
      success: true,
      message: `Proforma Invoice ${proforma.proformaNumber} updated successfully.`,
      data: proforma
    });
  } catch (error) {
    console.error('[Update Proforma Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating proforma invoice.' });
  }
};

const deleteMyProformaInvoice = async (req, res) => {
  try {
    const proforma = await ProformaInvoice.findById(req.params.id);
    if (!proforma) {
      return res.status(404).json({ success: false, message: 'Proforma Invoice not found.' });
    }

    if (!checkOwnership(proforma, 'createdBy', req.user._id, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own proforma invoices.' });
    }

    if (proforma.salesOrder) {
      await SalesOrder.findByIdAndUpdate(proforma.salesOrder, {
        proformaInvoiceId: null,
        proformaInvoiceNumber: '',
        proformaStatus: 'None'
      });
    }

    await ProformaInvoice.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: `Proforma Invoice ${proforma.proformaNumber} deleted.`
    });
  } catch (error) {
    console.error('[Delete Proforma Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting proforma invoice.' });
  }
};

// ─────────────────────────────────────────────
// Department Handoff & Departmental Controllers
// ─────────────────────────────────────────────

const getDateRangeFilter = (filter, startDate, endDate, dateField = 'createdAt') => {
  if (!filter || filter === 'all') return null;
  const now = new Date();
  let start, end;
  if (filter === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (filter === 'week' || filter === 'this_week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
    end = new Date();
  } else if (filter === 'month' || filter === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date();
  } else if (filter === 'last_month') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (filter === 'year' || filter === 'this_year') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    end = new Date();
  } else if (filter === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else {
    return null;
  }
  return { [dateField]: { $gte: start, $lte: end } };
};

const sendOrderToSupport = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    if (!order.clientName || !order.netAmount) {
      return res.status(400).json({ success: false, message: 'Sales Order is incomplete.' });
    }

    // Strictly enforce Finance approval if customer has overdue balance
    if (order.requiresFinanceApproval && order.workflowStatus !== 'Finance Approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot send order to Support: Order requires Finance approval due to customer overdue balance (PKR ${Number(order.customerOverdueAtCreation || 0).toLocaleString()}).`
      });
    }

    const prevStatus = order.workflowStatus || 'Sales Order Created';
    order.workflowStatus = 'Sent to Support';
    order.status = 'Sent to Support';
    order.departmentResponsible = 'Support';
    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Sales',
      action: 'Sent to Support',
      previousStatus: prevStatus,
      newStatus: 'Sent to Support',
      timestamp: new Date(),
      notes: req.body.notes || 'Order sent to Support Department for fulfillment.'
    });

    await order.save();

    await logSalesActivity({
      type: 'Order Sent to Support',
      description: `Sales Order ${order.orderReference || order.orderNumber} sent to Support by ${req.user.fullName}.`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    await notifyRoleHelper(['support', 'operations', 'admin', 'ceo'], {
      type: 'order',
      title: 'Sales Order Sent to Support',
      message: `${req.user.fullName} sent Sales Order ${order.orderReference || order.orderNumber} to Support for delivery processing.`,
      link: '/support/orders',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Sales Order ${order.orderReference || order.orderNumber} successfully sent to Support.`,
      data: order
    });
  } catch (error) {
    console.error('[Send Order To Support Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error sending order to support.' });
  }
};

/**
 * @desc    Send / route Sales Order to Finance for Overdue check
 * @route   POST /api/sales-employee/orders/:id/send-to-finance
 */
const sendSalesOrderToFinance = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    // Check customer overdue status in real-time
    const overdueInfo = await calculateCustomerOverdue(order.clientName || order.customerName);

    const prevStatus = order.status || order.workflowStatus || 'Sales Order';
    order.departmentResponsible = 'Finance';
    order.currentDepartment = 'Finance';
    order.currentStatus = 'SENT_TO_FINANCE';
    order.previousDepartment = 'Sales';
    order.previousStatus = prevStatus;
    order.lastAction = 'Sent to Finance for Overdue Verification';
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();
    order.workflowStatus = 'Pending Finance Overdue Check';
    order.status = 'Pending Finance Approval';
    order.requiresFinanceApproval = true;
    order.isOverdueBlocked = false;
    order.financeRejectionReason = '';
    order.customerOverdueAtCreation = overdueInfo.overdueAmount;
    order.financeApprovedBy = null;
    order.financeApprovedByName = '';
    order.financeApprovedAt = null;
    if (order.supplierPO) {
      order.supplierPO.status = '';
    }

    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Sales',
      action: 'Sent to Finance for Overdue Verification',
      previousStatus: prevStatus,
      newStatus: 'Pending Finance Overdue Check',
      timestamp: new Date(),
      notes: req.body.notes || `Routed to Finance for overdue balance check (Current overdue: PKR ${overdueInfo.overdueAmount.toLocaleString()}).`
    });

    await order.save();

    await logSalesActivity({
      type: 'Order Sent to Finance',
      description: `Sales Order ${order.orderNumber || order.orderReference} sent to Finance by ${req.user.fullName} for overdue check`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    await notifyRoleHelper(['finance', 'accountant', 'admin', 'ceo'], {
      type: 'finance',
      title: 'Sales Order Awaiting Overdue Check',
      message: `Sales Person ${req.user.fullName} submitted Sales Order ${order.orderNumber || order.orderReference} for Finance approval/overdue check.`,
      link: '/finance/invoices',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Sales Order ${order.orderNumber || order.orderReference} successfully sent to Finance for overdue verification!`,
      data: order
    });
  } catch (error) {
    console.error('[Send Sales Order to Finance Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error sending order to Finance.' });
  }
};

/**
 * @desc    Record Goods Received in Office (Support Department Action)
 * @route   POST /api/sales-employee/orders/:id/goods-received
 */
const recordGoodsReceivedInOffice = async (req, res) => {
  const session = await mongoose.startSession();
  let savedOrder = null;
  try {
    await session.withTransaction(async () => {
      const order = await SalesOrder.findById(req.params.id).session(session);
      if (!order) throw createHttpError(404, 'Sales order not found.');
      if (order.isOverdueBlocked) {
        throw createHttpError(400, 'Cannot receive goods: Order is on Finance HOLD due to customer overdue balance.');
      }
      if (order.currentDepartment !== 'Support' && order.departmentResponsible !== 'Support') {
        throw createHttpError(400, 'Goods can only be received after the order reaches Support.');
      }
      if (order.inventoryFulfilledFromExistingStock === true) {
        throw createHttpError(409, 'This order is using existing warehouse stock. Do not record another Inventory IN; create the Delivery Note when ready.');
      }

      if (order.fileType === 'Blue') {
        const shipment = await Shipment.findOne({ salesOrder: order._id }).session(session);
        if (!shipment || (!shipment.receivedInOffice && shipment.status !== 'Received in Office')) {
          throw createHttpError(400, 'Cannot receive goods for Blue File: Logistics has not confirmed the shipment as Received in Office.');
        }
      }

      const supplierPO = await getSupplierPOForOrder(order, session);
      const supplierName = String(supplierPO?.supplierName || order.supplierPO?.supplierName || '').trim();

      const receiptId = String(req.body.receiptId || '').trim();
      if (!receiptId) throw createHttpError(400, 'Receipt ID is required. Please reopen the Receive Goods form and try again.');
      if ((order.inventoryReceipts || []).some(receipt => receipt.receiptId === receiptId)) {
        throw createHttpError(409, 'This goods receipt was already saved. Refresh the order before entering another receipt.');
      }

      const submittedItems = Array.isArray(req.body.items) ? req.body.items : [];
      if (!submittedItems.length) throw createHttpError(400, 'Enter at least one received product quantity.');
      const grnNumber = await allocateGrnNumber(session);

      const receivedTotals = getReceivedQuantityByOrderItem(order);
      const inventoryItems = await InventoryItem.find({}).session(session);
      const receiptItems = [];
      const newlyCreatedByName = new Map();
      let receiptQuantity = 0;

      for (const submitted of submittedItems) {
        const receivedQty = Number(submitted.receivedQty);
        if (!Number.isFinite(receivedQty) || receivedQty < 0) {
          throw createHttpError(400, 'Received quantities must be zero or greater.');
        }
        if (receivedQty === 0) continue;

        const orderItem = (order.items || []).find(item => String(item._id) === String(submitted.orderItemId));
        if (!orderItem) throw createHttpError(400, 'One of the submitted order lines is invalid. Refresh and try again.');

        const orderedQty = Number(orderItem.quantity) || 1;
        const previouslyReceivedQty = receivedTotals.get(String(orderItem._id)) || 0;
        if (previouslyReceivedQty + receivedQty > orderedQty) {
          throw createHttpError(400, `${orderItem.description || 'Order item'} can receive at most ${Math.max(0, orderedQty - previouslyReceivedQty)} more.`);
        }

        const matches = getInventoryMatches(orderItem, inventoryItems);
        let inventoryItem = null;
        let createdNew = false;

        if (submitted.createNew) {
          const newProduct = submitted.newProduct || {};
          const newName = String(newProduct.name || orderItem.description || '').trim();
          const newSku = String(newProduct.sku || '').trim();
          const canonicalName = normalizeInventoryName(newName);
          inventoryItem = newlyCreatedByName.get(canonicalName) || null;

          if (!inventoryItem) {
            const duplicate = inventoryItems.find(item =>
              normalizeInventoryName(item.name) === canonicalName ||
              (newSku && String(item.sku || '').trim().toLowerCase() === newSku.toLowerCase())
            );
            if (duplicate) {
              throw createHttpError(409, `Inventory already contains ${duplicate.name}${duplicate.sku ? ` (${duplicate.sku})` : ''}. Select that existing row instead of creating another product.`);
            }

            const created = await InventoryItem.create([{
              name: newName,
              sku: newSku,
              category: String(newProduct.category || (order.fileType === 'Blue' ? 'Imported Goods' : 'General')).trim(),
              unit: String(newProduct.unit || 'pcs').trim(),
              quantityOnHand: 0,
              reservedQuantity: 0,
              minStockLevel: Number(newProduct.minStockLevel) || 5,
              unitPrice: Number(newProduct.unitPrice) || Number(orderItem.unitPrice) || 0,
              location: String(newProduct.location || 'WH/Stock').trim(),
              description: String(newProduct.description || orderItem.description || '').trim(),
              supplierName,
              supplierPoNumber: String(order.supplierPO?.poNumber || '').trim(),
              orderReference: order.orderNumber || order.orderReference || ''
            }], { session });
            inventoryItem = created[0];
            inventoryItems.push(inventoryItem);
            newlyCreatedByName.set(canonicalName, inventoryItem);
            createdNew = true;
          }
        } else {
          if (!submitted.inventoryItemId || !mongoose.Types.ObjectId.isValid(submitted.inventoryItemId)) {
            if (matches.length > 1) throw createHttpError(409, `Multiple inventory rows match ${orderItem.description}. Select the correct row explicitly.`);
            if (matches.length === 0) throw createHttpError(409, `No inventory row matches ${orderItem.description}. Select another row or create the product once.`);
            inventoryItem = matches[0];
          } else {
            inventoryItem = inventoryItems.find(item => String(item._id) === String(submitted.inventoryItemId));
            if (!inventoryItem) throw createHttpError(404, 'The selected inventory row no longer exists. Refresh and try again.');
          }

          const isAutomaticMatch = matches.some(match => String(match._id) === String(inventoryItem._id));
          const needsConfirmation = !isAutomaticMatch || hasInventoryContextMismatch(inventoryItem, order.fileType);
          if (needsConfirmation && submitted.confirmedSelection !== true) {
            throw createHttpError(409, `Confirm the selected inventory row for ${orderItem.description}. Its product or warehouse context does not automatically match this ${order.fileType || ''} order.`);
          }
        }

        const movement = {
          type: 'IN',
          quantity: receivedQty,
          reference: String(req.body.referenceNumber || receiptId).trim(),
          grnNumber,
          salesOrder: order._id,
          orderNumber: order.orderNumber || order.orderReference || '',
          remarks: String(req.body.remarks || 'Goods received by Support').trim(),
          performedBy: req.user._id,
          performedByName: req.user.fullName,
          timestamp: new Date()
        };
        const updatedInventory = await InventoryItem.findByIdAndUpdate(
          inventoryItem._id,
          { $inc: { quantityOnHand: receivedQty }, $push: { stockMovements: movement } },
          { new: true, runValidators: true, session }
        );
        const available = Math.max(0, (updatedInventory.quantityOnHand || 0) - (updatedInventory.reservedQuantity || 0));
        const status = available <= 0 ? 'Out of Stock' : (available <= (updatedInventory.minStockLevel || 5) ? 'Low Stock' : 'In Stock');
        if (updatedInventory.status !== status) {
          await InventoryItem.updateOne({ _id: updatedInventory._id }, { $set: { status } }, { session });
        }

        receiptQuantity += receivedQty;
        receivedTotals.set(String(orderItem._id), previouslyReceivedQty + receivedQty);
        receiptItems.push({
          orderItemId: String(orderItem._id),
          productName: orderItem.description || 'Item',
          sku: submitted.sku || '',
          orderedQty,
          receivedQty,
          inventoryItem: updatedInventory._id,
          inventoryName: updatedInventory.name,
          inventorySku: updatedInventory.sku || '',
          inventoryCategory: updatedInventory.category || '',
          inventoryLocation: updatedInventory.location || '',
          createdNew
        });
      }

      if (!receiptItems.length) throw createHttpError(400, 'Enter a received quantity greater than zero for at least one product.');

      const totalOrdered = (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
      const totalReceived = (order.items || []).reduce((sum, item) => sum + (receivedTotals.get(String(item._id)) || 0), 0);
      const allReceived = (order.items || []).length > 0 && (order.items || []).every(item =>
        (receivedTotals.get(String(item._id)) || 0) >= (Number(item.quantity) || 1)
      );
      const receivedAt = req.body.referenceDate ? new Date(req.body.referenceDate) : new Date();
      const referenceType = order.fileType === 'Blue' ? 'BL / AWB' : 'Supplier Bill';

      order.inventoryReceipts.push({
        receiptId,
        grnNumber,
        receivedAt,
        receivedBy: req.user._id,
        receivedByName: req.user.fullName,
        referenceType,
        referenceNumber: String(req.body.referenceNumber || '').trim(),
        referenceDate: req.body.referenceDate ? new Date(req.body.referenceDate) : null,
        supplierName,
        carrier: order.fileType === 'Blue' ? String(req.body.carrier || '').trim() : '',
        containerNo: order.fileType === 'Blue' ? String(req.body.containerNo || '').trim() : '',
        portOfLoading: order.fileType === 'Blue' ? String(req.body.portOfLoading || '').trim() : '',
        portOfDischarge: order.fileType === 'Blue' ? String(req.body.portOfDischarge || '').trim() : '',
        remarks: String(req.body.remarks || '').trim(),
        items: receiptItems
      });
      if (!order.inventoryGrnNumbers.includes(grnNumber)) order.inventoryGrnNumbers.push(grnNumber);
      order.inventoryReceived = allReceived;
      order.goodsReceivedInOffice = {
        received: allReceived,
        receivedAt,
        receivedBy: req.user._id,
        receivedByName: req.user.fullName,
        receivedQuantity: totalReceived,
        orderedQuantity: totalOrdered,
        remarks: String(req.body.remarks || (allReceived ? 'All ordered goods received into inventory.' : 'Partial goods receipt recorded.')).trim()
      };

      if (order.fileType === 'Blue' && req.body.referenceNumber) {
        order.blNumber = String(req.body.referenceNumber).trim();
        order.blInput = {
          blNumber: order.blNumber,
          blDate: req.body.referenceDate ? new Date(req.body.referenceDate) : null,
          carrier: String(req.body.carrier || '').trim(),
          containerNo: String(req.body.containerNo || '').trim(),
          portOfLoading: String(req.body.portOfLoading || '').trim(),
          portOfDischarge: String(req.body.portOfDischarge || '').trim(),
          enteredBy: req.user._id,
          enteredByName: req.user.fullName,
          enteredAt: new Date()
        };
      }

      const prevStatus = order.workflowStatus;
      order.workflowStatus = 'Goods Received in Office';
      order.status = 'Goods Received in Office';
      order.departmentResponsible = 'Support';
      order.currentDepartment = 'Support';
      order.currentStatus = allReceived ? 'GOODS_RECEIVED_IN_OFFICE' : 'PARTIAL_INVENTORY_RECEIPT';
      order.previousStatus = prevStatus;
      order.lastAction = allReceived ? 'Inventory IN Completed' : 'Partial Inventory IN Recorded';
      order.lastActionBy = req.user._id;
      order.lastActionByName = req.user.fullName;
      order.lastActionAt = new Date();
      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Support',
        action: allReceived ? 'Inventory IN Completed' : 'Partial Inventory IN Recorded',
        previousStatus: prevStatus,
        newStatus: 'Goods Received in Office',
        timestamp: new Date(),
        notes: `${receiptQuantity} unit(s) received in this entry; ${totalReceived} of ${totalOrdered} total units received.`
      });

      const createdGrns = await PurchaserGRN.create([{
        grnNumber,
        grnType: order.fileType === 'Green' ? 'Supplier' : 'Support Inventory IN',
        supplier: supplierPO?.supplier || null,
        supplierName: supplierName || '-',
        supplierPO: supplierPO?._id || null,
        supplierPOId: supplierPO?._id || null,
        poNumber: supplierPO?.poNumber || order.supplierPO?.poNumber || '',
        salesOrder: order._id,
        salesOrderId: order._id,
        salesOrderNumber: order.orderNumber || order.orderReference || '',
        supplierBillNumber: order.fileType === 'Green' ? String(req.body.referenceNumber || '').trim() : '',
        supplierBillDate: order.fileType === 'Green' && req.body.referenceDate ? new Date(req.body.referenceDate) : null,
        grnDate: receivedAt,
        items: receiptItems.map(item => ({
          productId: String(item.inventoryItem || ''),
          productName: item.productName,
          orderedQty: item.orderedQty,
          receivedQty: item.receivedQty,
          quantity: item.receivedQty,
          quantityReceived: item.receivedQty,
          remainingQty: Math.max(0, item.orderedQty - (receivedTotals.get(String(item.orderItemId)) || 0)),
          condition: 'Good'
        })),
        status: allReceived ? 'Completed' : 'Partial',
        remarks: String(req.body.remarks || `${referenceType} inventory receipt`).trim(),
        createdBy: req.user._id,
        createdByName: req.user.fullName
      }], { session });

      if (order.fileType === 'Green' && supplierPO) {
        const payable = await LocalPayable.findOne({
          $or: [{ supplierPO: supplierPO._id }, { salesOrderId: order._id }]
        }).session(session);
        if (payable) {
          if (!payable.grn) payable.grn = createdGrns[0]._id;
          if (!payable.grns.some(id => String(id) === String(createdGrns[0]._id))) payable.grns.push(createdGrns[0]._id);
          await payable.save({ session });
        }
      }

      await order.save({ session });
      savedOrder = order;
    });

    await logSalesActivity({
      type: 'Inventory IN',
      description: `Support recorded Inventory IN for Sales Order ${savedOrder.orderNumber || savedOrder.orderReference}.`,
      relatedModel: 'SalesOrder',
      relatedId: savedOrder._id,
      performedBy: req.user._id
    });

    if (savedOrder.inventoryReceived && savedOrder.salesPerson) {
      try {
        await createNotificationHelper({
          recipient: savedOrder.salesPerson,
          sender: req.user._id,
          title: 'Inventory IN Completed',
          message: `All goods for Sales Order ${savedOrder.orderNumber || savedOrder.orderReference} have been received into inventory by Support.`,
          type: 'order',
          link: '/employee/sales/orders'
        });
      } catch (notificationError) {
        console.error('[Inventory IN Notification Error]:', notificationError.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: savedOrder.inventoryReceived
        ? `Inventory IN completed for Sales Order ${savedOrder.orderNumber || savedOrder.orderReference}. GRN ${savedOrder.inventoryGrnNumbers[savedOrder.inventoryGrnNumbers.length - 1]} created.`
        : `Partial Inventory IN recorded for Sales Order ${savedOrder.orderNumber || savedOrder.orderReference}. GRN ${savedOrder.inventoryGrnNumbers[savedOrder.inventoryGrnNumbers.length - 1]} created.`,
      data: savedOrder
    });
  } catch (err) {
    console.error('[Record Goods Received Error]:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : 'Server error recording goods received.' });
  } finally {
    await session.endSession();
  }
};

/**
 * @desc    Record Bill of Lading (BL) / receiving reference metadata (Support Department Action)
 * @route   POST /api/sales-employee/orders/:id/bl-input
 */
const recordBLInput = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    if (order.isOverdueBlocked) {
      return res.status(400).json({
        success: false,
        message: 'Cannot record BL input: Order is on Finance HOLD.'
      });
    }

    const { blNumber, blDate, carrier, containerNo, portOfLoading, portOfDischarge } = req.body;

    const finalBlNumber = (blNumber || order.blNumber || '').trim();
    order.blNumber = finalBlNumber;
    order.blInput = {
      blNumber: finalBlNumber,
      blDate: blDate ? new Date(blDate) : new Date(),
      carrier: carrier || '',
      containerNo: containerNo || '',
      portOfLoading: portOfLoading || '',
      portOfDischarge: portOfDischarge || '',
      enteredBy: req.user._id,
      enteredByName: req.user.fullName,
      enteredAt: new Date()
    };

    const currentWorkflowStatus = order.workflowStatus;
    order.lastAction = 'BL / Reference Details Recorded';
    order.lastActionBy = req.user._id;
    order.lastActionByName = req.user.fullName;
    order.lastActionAt = new Date();

    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: 'Support',
      action: 'BL / Reference Details Recorded',
      previousStatus: currentWorkflowStatus,
      newStatus: currentWorkflowStatus,
      timestamp: new Date(),
      notes: finalBlNumber ? `BL / reference #${finalBlNumber} recorded as metadata.` : 'BL / reference metadata updated.'
    });

    await order.save();

    await logSalesActivity({
      type: 'BL / Reference Details Recorded',
      description: `Support (${req.user.fullName}) updated BL / reference metadata for Sales Order ${order.orderNumber || order.orderReference}`,
      relatedModel: 'SalesOrder',
      relatedId: order._id,
      performedBy: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: 'BL / reference details recorded. Inventory quantities were not changed.',
      data: order
    });
  } catch (err) {
    console.error('[Record BL Input Error]:', err);
    return res.status(500).json({ success: false, message: 'Server error saving BL details.' });
  }
};

/**
 * @desc    Issue Supplier PO (Local or International)
 * @route   POST /api/sales-employee/orders/:id/issue-supplier-po
 */
const issueSupplierPO = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found.' });

    if (order.isOverdueBlocked) {
      return res.status(400).json({ success: false, message: 'Cannot issue Supplier PO: Order is on Finance HOLD.' });
    }

    const {
      poType,
      supplierName,
      supplierCountry,
      supplierEmail,
      supplierPhone,
      notes,
      items,
      totalAmount
    } = req.body;

    const type = poType || (order.fileType === 'Blue' ? 'International' : 'Local');
    const isBlue = type === 'International' || order.fileType === 'Blue';
    const poNum = req.body.poNumber || `${isBlue ? 'IPO' : 'LPO'}-${Date.now().toString().slice(-6)}`;

    order.fileType = isBlue ? 'Blue' : 'Green';
    order.supplierPO = {
      poNumber: poNum,
      poType: type,
      supplierName: supplierName || (isBlue ? 'International Supplier' : 'Local Supplier'),
      supplierCountry: supplierCountry || (isBlue ? 'China' : 'Pakistan'),
      supplierEmail: supplierEmail || '',
      supplierPhone: supplierPhone || '',
      issueDate: new Date(),
      status: 'Issued',
      items: items && items.length > 0 ? items : (order.items || []),
      totalAmount: Number(totalAmount) || order.netAmount || order.totalAmount || 0,
      currency: 'PKR',
      notes: notes || '',
      issuedBy: req.user._id,
      issuedByName: req.user.fullName,
      issuedAt: new Date()
    };

    if (isBlue) {
      order.workflowStatus = 'International Supplier PO Issued';
      order.departmentResponsible = 'Logistics';

      // Ensure Shipment exists in Logistics
      let shipment = await Shipment.findOne({ salesOrder: order._id });
      if (!shipment) {
        shipment = await Shipment.create({
          salesOrder: order._id,
          salesOrderNumber: order.orderNumber || order.orderReference,
          salesPerson: order.salesPerson || req.user._id,
          salePerson: order.salePerson || req.user.fullName,
          clientName: order.clientName,
          clientEmail: order.clientEmail || '',
          clientPhone: order.clientPhone || '',
          supplierName: order.supplierPO.supplierName,
          supplierCountry: order.supplierPO.supplierCountry,
          supplierPoNumber: order.supplierPO.poNumber,
          supplierPoDate: new Date(),
          fileType: 'Blue',
          status: 'PO Issued',
          description: order.productSummary || 'Imported Goods',
          items: order.items || [],
          createdBy: req.user._id
        });
      }
      order.shipmentId = shipment._id;
      order.shipmentNumber = shipment.shipmentId;
    } else {
      order.workflowStatus = 'Local Supplier PO Issued';
      order.departmentResponsible = 'Support';
    }

    order.workflowHistory.push({
      user: req.user._id,
      userName: req.user.fullName,
      department: req.user.department || 'Sales',
      action: `Supplier PO Issued (${type})`,
      previousStatus: order.workflowStatus,
      newStatus: order.workflowStatus,
      timestamp: new Date(),
      notes: `PO #${poNum} issued to ${order.supplierPO.supplierName}.`
    });

    await order.save();

    return res.status(200).json({
      success: true,
      message: `${type} Supplier PO ${poNum} successfully issued!`,
      data: order
    });
  } catch (err) {
    console.error('[Issue Supplier PO Error]:', err);
    return res.status(500).json({ success: false, message: 'Server error issuing supplier PO.' });
  }
};

const getSupportStats = async (req, res) => {
  try {
    const { filter, startDate, endDate } = req.query;
    const dateFilter = getDateRangeFilter(filter, startDate, endDate, 'createdAt');

    // Total orders sent to Support (in period if filtered)
    const orderQuery = {
      isOverdueBlocked: { $ne: true },
      $or: [
        { departmentResponsible: 'Support' },
        {
          workflowStatus: {
            $in: [
              'Finance Approved',
              'Local Supplier PO Issued',
              'Shipment Received in Office',
              'Goods Received in Office',
              'Inventory & BL Verified',
              'Sent to Support',
              'Support Reviewing',
              'Delivery Note Created',
              'Delivery Note Confirmed',
              'Sent to Accounts',
              'Draft Invoice Created',
              'Sent to Finance',
              'Pending Finance Finalization',
              'Completed'
            ]
          }
        }
      ]
    };
    if (dateFilter) {
      orderQuery.$and = [{ $or: orderQuery.$or }, dateFilter];
      delete orderQuery.$or;
    }
    const ordersReceived = await SalesOrder.countDocuments(orderQuery);

    // Total delivery notes created (in period if filtered)
    const dnQuery = {};
    if (dateFilter) Object.assign(dnQuery, dateFilter);
    const deliveryNotesCount = await DeliveryNote.countDocuments(dnQuery);

    // Active pending queue: Sales Orders in Support that DO NOT have a Delivery Note yet
    const ordersPendingDelivery = await SalesOrder.countDocuments({
      isOverdueBlocked: { $ne: true },
      $or: [
        { departmentResponsible: 'Support' },
        {
          workflowStatus: {
            $in: [
              'Finance Approved',
              'Local Supplier PO Issued',
              'Shipment Received in Office',
              'Goods Received in Office',
              'Inventory & BL Verified',
              'Sent to Support',
              'Support Reviewing'
            ]
          }
        }
      ],
      deliveryNoteId: null
    });

    const deliveryNotesPending = await DeliveryNote.countDocuments({ status: { $nin: ['Done', 'Delivered', 'Cancelled'] } });
    const completedDeliveries = await DeliveryNote.countDocuments({ status: { $in: ['Done', 'Delivered'] } });

    const totalInventoryItems = await InventoryItem.countDocuments();
    const lowStockCount = await InventoryItem.countDocuments({ status: 'Low Stock' });
    const outOfStockCount = await InventoryItem.countDocuments({ status: 'Out of Stock' });

    return res.status(200).json({
      success: true,
      data: {
        ordersReceived,
        ordersPendingDelivery,
        deliveryNotesCount,
        deliveryNotesPending,
        completedDeliveries,
        totalInventoryItems,
        lowStockCount,
        outOfStockCount
      }
    });
  } catch (error) {
    console.error('[Get Support Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching support stats.' });
  }
};

const getInventoryItems = async (req, res) => {
  try {
    const { search, status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: regex }, { sku: regex }, { category: regex }, { location: regex }];
    }
    const items = await InventoryItem.find(query).sort({ updatedAt: -1 });
    return res.status(200).json({ success: true, count: items.length, data: items });
  } catch (error) {
    console.error('[Get Inventory Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching inventory.' });
  }
};

const createOrUpdateInventoryItem = async (req, res) => {
  try {
    const { id, name, sku, category, unit, quantityOnHand, minStockLevel, unitPrice, location, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Product name is required.' });

    const inventoryItems = await InventoryItem.find(id ? { _id: { $ne: id } } : {});
    const normalizedName = normalizeInventoryName(name);
    const normalizedSku = String(sku || '').trim().toLowerCase();
    const duplicate = inventoryItems.find(existing =>
      normalizeInventoryName(existing.name) === normalizedName ||
      (normalizedSku && String(existing.sku || '').trim().toLowerCase() === normalizedSku)
    );
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: `Inventory already contains ${duplicate.name}${duplicate.sku ? ` (${duplicate.sku})` : ''}. Use Inventory IN on the existing row.`
      });
    }

    let item;
    if (id) {
      item = await InventoryItem.findByIdAndUpdate(
        id,
        { name, sku, category, unit, quantityOnHand: Number(quantityOnHand) || 0, minStockLevel: Number(minStockLevel) || 5, unitPrice: Number(unitPrice) || 0, location, description },
        { new: true, runValidators: true }
      );
    } else {
      item = await InventoryItem.create({
        name, sku, category, unit, quantityOnHand: Number(quantityOnHand) || 0, minStockLevel: Number(minStockLevel) || 5, unitPrice: Number(unitPrice) || 0, location, description
      });
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    console.error('[Save Inventory Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error saving inventory item.' });
  }
};

const addInventoryStock = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const quantity = Number(req.body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Inventory IN quantity must be greater than zero.' });
    }
    let savedItem = null;
    let grnNumber = '';
    await session.withTransaction(async () => {
      const existingItem = await InventoryItem.findById(req.params.id).session(session);
      if (!existingItem) throw createHttpError(404, 'Inventory item not found.');

      let order = null;
      if (req.body.salesOrderId) {
        if (!mongoose.Types.ObjectId.isValid(req.body.salesOrderId)) throw createHttpError(400, 'The selected Sales Order is invalid.');
        order = await SalesOrder.findById(req.body.salesOrderId).session(session);
        if (!order) throw createHttpError(404, 'The selected Sales Order was not found.');
      }

      grnNumber = await allocateGrnNumber(session);
      const orderNumber = order ? (order.orderNumber || order.orderReference || '') : '';
      const movement = {
        type: 'IN',
        quantity,
        reference: String(req.body.reference || grnNumber).trim(),
        grnNumber,
        salesOrder: order?._id || null,
        orderNumber,
        remarks: String(req.body.remarks || 'Manual Inventory IN by Support').trim(),
        performedBy: req.user._id,
        performedByName: req.user.fullName,
        timestamp: new Date()
      };
      savedItem = await InventoryItem.findByIdAndUpdate(
        existingItem._id,
        { $inc: { quantityOnHand: quantity }, $push: { stockMovements: movement } },
        { new: true, runValidators: true, session }
      );
      const available = Math.max(0, (savedItem.quantityOnHand || 0) - (savedItem.reservedQuantity || 0));
      savedItem.status = available <= 0 ? 'Out of Stock' : (available <= (savedItem.minStockLevel || 5) ? 'Low Stock' : 'In Stock');
      await savedItem.save({ session });

      const supplierPO = order ? await getSupplierPOForOrder(order, session) : null;
      const createdGrns = await PurchaserGRN.create([{
        grnNumber,
        grnType: order?.fileType === 'Green' ? 'Supplier' : 'Manual Inventory IN',
        supplier: supplierPO?.supplier || null,
        supplierName: supplierPO?.supplierName || order?.supplierPO?.supplierName || '-',
        supplierPO: supplierPO?._id || null,
        supplierPOId: supplierPO?._id || null,
        poNumber: supplierPO?.poNumber || order?.supplierPO?.poNumber || '',
        salesOrder: order?._id || null,
        salesOrderId: order?._id || null,
        salesOrderNumber: orderNumber,
        supplierBillNumber: order?.fileType === 'Green' ? String(req.body.reference || '').trim() : '',
        supplierBillDate: order?.fileType === 'Green' ? new Date() : null,
        grnDate: new Date(),
        items: [{
          productId: String(savedItem._id),
          productName: savedItem.name,
          orderedQty: 0,
          receivedQty: quantity,
          quantity,
          quantityReceived: quantity,
          remainingQty: 0,
          condition: 'Good'
        }],
        status: 'Completed',
        remarks: String(req.body.remarks || 'Manual Inventory IN by Support').trim(),
        createdBy: req.user._id,
        createdByName: req.user.fullName
      }], { session });

      if (order) {
        if (!order.inventoryGrnNumbers.includes(grnNumber)) order.inventoryGrnNumbers.push(grnNumber);
        order.inventoryReceipts.push({
          receiptId: `MANUAL-${grnNumber}`,
          grnNumber,
          receivedAt: new Date(),
          receivedBy: req.user._id,
          receivedByName: req.user.fullName,
          referenceType: 'Manual Inventory IN',
          referenceNumber: String(req.body.reference || '').trim(),
          supplierName: supplierPO?.supplierName || order.supplierPO?.supplierName || '',
          remarks: String(req.body.remarks || 'Manual Inventory IN by Support').trim(),
          items: [{
            orderItemId: '',
            productName: savedItem.name,
            sku: savedItem.sku || '',
            orderedQty: 0,
            receivedQty: quantity,
            inventoryItem: savedItem._id,
            inventoryName: savedItem.name,
            inventorySku: savedItem.sku || '',
            inventoryCategory: savedItem.category || '',
            inventoryLocation: savedItem.location || '',
            createdNew: false
          }]
        });
        await order.save({ session });
        if (order.fileType === 'Green' && supplierPO) {
          const payable = await LocalPayable.findOne({
            $or: [{ supplierPO: supplierPO._id }, { salesOrderId: order._id }]
          }).session(session);
          if (payable) {
            if (!payable.grn) payable.grn = createdGrns[0]._id;
            if (!payable.grns.some(id => String(id) === String(createdGrns[0]._id))) payable.grns.push(createdGrns[0]._id);
            await payable.save({ session });
          }
        }
      }
    });

    return res.status(200).json({ success: true, message: `${quantity} ${savedItem.unit || 'pcs'} added to ${savedItem.name}. GRN ${grnNumber} created.`, data: savedItem, grnNumber });
  } catch (error) {
    console.error('[Inventory IN Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error adding inventory stock.' });
  } finally {
    await session.endSession();
  }
};

const confirmDeliveryNoteWithInventory = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) {
      return res.status(404).json({ success: false, message: 'Delivery Note not found.' });
    }

    if (deliveryNote.status === 'Done' || deliveryNote.status === 'Delivered' || deliveryNote.status === 'Confirmed') {
      return res.status(400).json({ success: false, message: 'Delivery Note is already confirmed.' });
    }

    const signedDocument = req.body.signedDeliveryNoteDocument;
    const signedDocumentName = req.body.signedDeliveryNoteDocumentName;
    if (!hasValidSignedDeliveryNoteAttachment(signedDocument, signedDocumentName)) {
      return res.status(400).json({ success: false, message: SIGNED_DN_ATTACHMENT_MESSAGE });
    }

    if (!deliveryNote.salesOrder) {
      return res.status(400).json({ success: false, message: 'A linked Sales Order is required before this Delivery Note can be confirmed.' });
    }

    const order = await SalesOrder.findById(deliveryNote.salesOrder).session(session);
    if (!order) return res.status(404).json({ success: false, message: 'The Sales Order linked to this Delivery Note was not found.' });

    if (!deliveryNote.isStockDeducted) {
      const stock = await getDeliveryStockRequirements(order, { session, excludeDeliveryNoteId: deliveryNote._id });
      if (!stock.isFullyInStock) {
        const shortages = stock.shortages.length
          ? stock.shortages
          : [{ item: order.productSummary || 'Order items', required: 1, available: 0 }];
        return res.status(409).json({ success: false, message: formatStockShortageMessage(shortages), shortages });
      }

      await session.withTransaction(async () => {
        for (const deduction of stock.deductions) {
          const quantity = Number(deduction.quantity) || 0;
          if (quantity <= 0) continue;
          const updated = await InventoryItem.findOneAndUpdate(
            {
              _id: deduction.inventoryItemId,
              $expr: {
                $gte: [
                  { $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, { $ifNull: ['$reservedQuantity', 0] }] },
                  quantity
                ]
              }
            },
            [
              {
                $set: {
                  quantityOnHand: { $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, quantity] },
                  reservedQuantity: { $max: [0, { $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] }] },
                  stockMovements: {
                    $concatArrays: [
                      { $ifNull: ['$stockMovements', []] },
                      [{
                        type: 'OUT',
                        quantity,
                        reference: deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber || '',
                        salesOrder: order._id,
                        orderNumber: order.orderNumber || order.orderReference || '',
                        remarks: 'Stock deducted on Delivery Note confirmation.',
                        performedBy: req.user._id,
                        performedByName: req.user.fullName || '',
                        timestamp: new Date()
                      }]
                    ]
                  }
                }
              },
              {
                $set: {
                  status: {
                    $cond: [
                      { $lte: [{ $subtract: ['$quantityOnHand', '$reservedQuantity'] }, 0] },
                      'Out of Stock',
                      { $cond: [{ $lte: [{ $subtract: ['$quantityOnHand', '$reservedQuantity'] }, { $ifNull: ['$minStockLevel', 5] }] }, 'Low Stock', 'In Stock'] }
                    ]
                  }
                }
              }
            ],
            { new: true, session }
          );
          if (!updated) {
            const latest = await InventoryItem.findById(deduction.inventoryItemId).session(session);
            const available = Math.max(0, (Number(latest?.quantityOnHand) || 0) - (Number(latest?.reservedQuantity) || 0));
            throw createHttpError(409, `Add inventory first. Insufficient stock: ${deduction.item} (required ${quantity}, available ${available}).`);
          }
        }
        deliveryNote.isStockDeducted = true;

        deliveryNote.status = 'Done';
        deliveryNote.deliveryDate = new Date();
        deliveryNote.receivedBy = req.body.receivedBy || req.user.fullName;
        deliveryNote.signedDeliveryNoteDocument = signedDocument;
        deliveryNote.signedDeliveryNoteDocumentName = signedDocumentName.trim();
        deliveryNote.signedDeliveryNoteUploadedAt = new Date();
        deliveryNote.signedDeliveryNoteUploadedBy = req.user._id;
        deliveryNote.signedDeliveryNoteUploadedByName = req.user.fullName || '';
        await deliveryNote.save({ session });

        const prevStatus = order.workflowStatus || 'Sent to Support';
        order.deliveryStatus = 'Fully Delivered';
        order.workflowStatus = 'Sent to Accounts';
        order.status = 'Delivery Note Confirmed';
        order.departmentResponsible = 'Accounts';
        order.currentDepartment = 'Accounts';
        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Support',
          action: 'Delivery Note Confirmed',
          previousStatus: prevStatus,
          newStatus: 'Sent to Accounts',
          timestamp: new Date(),
          notes: `Delivery Note ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber} confirmed.`
        });
        await order.save({ session });
      });
    }

    const soRef = (deliveryNote.salesOrderNumber || deliveryNote.salesOrder?.orderReference || deliveryNote.salesOrder?.orderNumber || 'SO-—');
    const dnRef = (deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber || 'DN-—');
    await notifyRoleHelper(['accountant', 'accounts', 'finance', 'admin', 'ceo'], {
      type: 'invoice',
      title: 'Delivery Note Ready for Accounts',
      message: `Delivery Note ${dnRef} for Sales Order ${soRef} is ready for Accounts.`,
      link: '/accounts/orders-ready',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Delivery Note ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber} confirmed and stock updated.`,
      data: deliveryNote
    });
  } catch (error) {
    console.error('[Confirm Delivery Note Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error confirming delivery note.' });
  } finally {
    await session.endSession();
  }
};

/**
 * @desc    Get pending Delivery Notes awaiting Draft Invoice in Accounts
 * @route   GET /api/sales-employee/accounts/pending-delivery-notes
 */
const getAccountsPendingDeliveryNotes = async (req, res) => {
  try {
    const deliveryNotes = await DeliveryNote.find({
      invoiced: { $ne: true },
      status: { $nin: ['Cancelled', 'Draft'] }
    }).populate('salesOrder').sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: deliveryNotes.length,
      data: deliveryNotes
    });
  } catch (error) {
    console.error('[Get Accounts Pending Delivery Notes Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching pending delivery notes.' });
  }
};

const getAccountsStats = async (req, res) => {
  try {
    const { filter, startDate, endDate } = req.query;
    const dateFilter = getDateRangeFilter(filter, startDate, endDate, 'createdAt');

    // Confirmed DNs received from Support (in period if filtered)
    const dnReceivedQuery = { status: { $in: ['Done', 'Confirmed', 'Delivered', 'Ready'] } };
    if (dateFilter) Object.assign(dnReceivedQuery, dateFilter);
    const dnsReceived = await DeliveryNote.countDocuments(dnReceivedQuery);

    // Draft invoices created in period
    const invCreatedQuery = {};
    if (dateFilter) Object.assign(invCreatedQuery, dateFilter);
    const draftsCreated = await Invoice.countDocuments(invCreatedQuery);

    // Active pending queue: Delivery Notes not yet invoiced
    const pendingDns = await DeliveryNote.find({
      invoiced: { $ne: true },
      status: { $nin: ['Cancelled', 'Draft'] }
    }).populate('salesOrder');

    const pendingDraftsCount = pendingDns.length;
    let pendingAmount = 0;
    pendingDns.forEach(dn => {
      if (dn.salesOrder && (dn.salesOrder.netAmount || dn.salesOrder.totalAmount)) {
        pendingAmount += Number(dn.salesOrder.netAmount || dn.salesOrder.totalAmount || 0);
      } else if (dn.items && dn.items.length > 0) {
        dn.items.forEach(it => {
          pendingAmount += (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0);
        });
      }
    });

    // Draft invoices
    const draftInvoicesList = await Invoice.find({
      $or: [{ isDraft: true }, { status: { $in: ['Draft', 'Pending Finance Finalization'] } }]
    });
    const draftInvoicesCount = draftInvoicesList.length;
    const draftAmount = draftInvoicesList.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    const totalInvoices = await Invoice.countDocuments();
    const approvedInvoices = await Invoice.countDocuments({
      status: { $in: ['Finalized', 'Approved', 'Sent', 'Paid', 'Partially Paid'] }
    });

    const finalizedInvoices = await Invoice.find({ status: { $nin: ['Draft', 'Cancelled'] }, isDraft: { $ne: true } });
    let outstandingAmount = 0;
    let paidAmount = 0;
    let overdueAmount = 0;
    const now = new Date();

    finalizedInvoices.forEach(inv => {
      const amt = Number(inv.amount) || 0;
      const pd = Number(inv.paidAmount) || 0;
      const rem = Math.max(0, amt - pd);
      paidAmount += pd;
      outstandingAmount += rem;
      if (rem > 0 && inv.dueDate && new Date(inv.dueDate) < now) {
        overdueAmount += rem;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        dnsReceived,
        draftsCreated,
        pendingDrafts: pendingDraftsCount,
        pendingAmount,
        draftAmount,
        ordersAwaitingInvoice: pendingDraftsCount,
        confirmedDeliveryNotes: dnsReceived,
        totalInvoices,
        draftInvoices: draftInvoicesCount,
        approvedInvoices,
        outstandingAmount,
        paidAmount,
        overdueAmount
      }
    });
  } catch (error) {
    console.error('[Get Accounts Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching accounts stats.' });
  }
};

const sendInvoiceToFinance = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    const prevStatus = invoice.status;
    const wasReturned = !!invoice.rejectionReason;
    invoice.status = 'Pending Finance Finalization';
    invoice.isDraft = true;
    invoice.departmentResponsible = 'Finance';
    invoice.reviewedBy = req.user._id;
    invoice.reviewedAt = new Date();
    invoice.rejectionReason = ''; // Clear previous rejection reason upon resubmission
    await invoice.save();

    if (invoice.salesOrderId) {
      const order = await SalesOrder.findById(invoice.salesOrderId);
      if (order) {
        const orderPrev = order.workflowStatus || 'Sent to Accounts';
        order.workflowStatus = 'Pending Finance Finalization';
        order.invoiceStatus = 'Fully Invoiced';
        order.invoiceNumber = invoice.invoiceNumber;
        order.departmentResponsible = 'Finance';
        order.currentDepartment = 'Finance';
        order.currentStatus = 'PENDING_FINANCE_FINALIZATION';
        order.previousDepartment = 'Accounts';
        order.previousStatus = orderPrev;
        order.lastAction = wasReturned ? 'Resubmitted to Finance after revision' : 'Sent to Finance for Finalization';
        order.lastActionBy = req.user._id;
        order.lastActionByName = req.user.fullName;
        order.lastActionAt = new Date();
        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Accounts',
          action: wasReturned ? 'Resubmitted to Finance after revision' : 'Sent to Finance',
          previousStatus: orderPrev,
          newStatus: 'Pending Finance Finalization',
          timestamp: new Date(),
          notes: req.body.notes || (wasReturned ? `Draft Invoice ${invoice.invoiceNumber} revised and resubmitted to Finance.` : `Draft Invoice ${invoice.invoiceNumber} submitted to Finance for finalization.`)
        });
        await order.save();
      }
    }

    await notifyRoleHelper(['finance', 'accountant', 'admin', 'ceo'], {
      type: 'finance',
      title: wasReturned ? 'Revised Draft Invoice Resubmitted' : 'Draft Invoice Submitted to Finance',
      message: `Accounts submitted Draft Invoice ${invoice.invoiceNumber} to Finance for finalization.`,
      link: '/finance/invoices',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Draft Invoice ${invoice.invoiceNumber} successfully ${wasReturned ? 'resubmitted' : 'sent'} to Finance!`,
      data: invoice
    });
  } catch (error) {
    console.error('[Send Invoice to Finance Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error sending invoice to finance.' });
  }
};

/**
 * @desc    Finance returns a draft invoice back to Accounts with comments/corrections
 * @route   POST /api/sales-employee/invoices/:id/return-to-accounts
 */
const returnInvoiceToAccounts = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const reason = req.body.reason || req.body.comment || req.body.notes || 'Revision requested by Finance.';
    invoice.status = 'Draft';
    invoice.isDraft = true;
    invoice.departmentResponsible = 'Accounts';
    invoice.rejectionReason = reason;
    await invoice.save();

    if (invoice.salesOrderId) {
      const order = await SalesOrder.findById(invoice.salesOrderId);
      if (order) {
        const orderPrev = order.workflowStatus || 'Pending Finance Finalization';
        order.workflowStatus = 'Draft Invoice Revision Required';
        order.departmentResponsible = 'Accounts';
        order.currentDepartment = 'Accounts';
        order.currentStatus = 'DRAFT_INVOICE_REVISION_REQUIRED';
        order.previousDepartment = 'Finance';
        order.previousStatus = orderPrev;
        order.lastAction = 'Draft Invoice Returned to Accounts for Revision';
        order.lastActionBy = req.user._id;
        order.lastActionByName = req.user.fullName;
        order.lastActionAt = new Date();
        order.workflowHistory.push({
          user: req.user._id,
          userName: req.user.fullName,
          department: 'Finance',
          action: 'Draft Invoice Returned to Accounts for Revision',
          previousStatus: orderPrev,
          newStatus: 'Draft Invoice Revision Required',
          timestamp: new Date(),
          notes: reason
        });
        await order.save();
      }
    }

    await logSalesActivity({
      type: 'Invoice Returned to Accounts',
      description: `Draft Invoice ${invoice.invoiceNumber} returned to Accounts by Finance (${req.user.fullName}) for revision. Reason: ${reason}`,
      relatedModel: 'Invoice',
      relatedId: invoice._id,
      performedBy: req.user._id
    });

    await notifyRoleHelper(['accountant', 'accounts', 'admin'], {
      type: 'invoice',
      title: `Draft Invoice ${invoice.invoiceNumber} Returned for Revision`,
      message: `Finance (${req.user.fullName}) returned Invoice ${invoice.invoiceNumber} for ${invoice.clientName} to Accounts. Comment: "${reason}". Please review, edit, and resubmit.`,
      link: '/accounts/invoices',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Draft Invoice ${invoice.invoiceNumber} returned back to Accounts with comment: "${reason}".`,
      data: invoice
    });
  } catch (error) {
    console.error('[Return Invoice to Accounts Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error returning invoice to Accounts.' });
  }
};

/**
 * @desc    Finalize a draft invoice into GST Invoice or Cash Invoice
 * @route   POST /api/sales-employee/invoices/:id/finalize
 */
const finalizeInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const { invoiceType } = req.body; // 'GST Invoice' | 'Cash Invoice'
    invoice.status = 'Finalized';
    invoice.isDraft = false;
    invoice.invoiceType = invoiceType || 'GST Invoice';
    invoice.finalizedBy = req.user._id;
    invoice.finalizedByName = req.user.fullName;
    invoice.finalizedAt = new Date();
    invoice.departmentResponsible = 'Finance';
    await invoice.save();

    if (invoice.salesOrderId) {
      await SalesOrder.findByIdAndUpdate(invoice.salesOrderId, {
        workflowStatus: 'Completed',
        status: 'Completed',
        invoiceStatus: 'Fully Invoiced',
        departmentResponsible: 'Accounts',
        currentDepartment: 'Accounts',
        currentStatus: 'INVOICE_FINALIZED',
        previousDepartment: 'Finance',
        previousStatus: 'PENDING_FINANCE_FINALIZATION',
        lastAction: `Invoice Finalized as ${invoice.invoiceType} by Finance`,
        lastActionBy: req.user._id,
        lastActionByName: req.user.fullName,
        lastActionAt: new Date()
      });
    }

    await logSalesActivity({
      type: 'Invoice Finalized',
      description: `Invoice ${invoice.invoiceNumber} finalized as ${invoice.invoiceType} by ${req.user.fullName}.`,
      relatedModel: 'Invoice',
      relatedId: invoice._id,
      performedBy: req.user._id
    });

    await notifyRoleHelper(['accountant', 'accounts', 'sales_manager', 'sales_member', 'sales_person', 'sales_rep', 'admin', 'ceo'], {
      type: 'invoice',
      title: 'Invoice Finalized',
      message: `Finance finalized Invoice ${invoice.invoiceNumber}.`,
      link: '/finance/invoices',
      sender: req.user._id
    });

    return res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} finalized successfully as ${invoice.invoiceType}.`,
      data: invoice
    });
  } catch (error) {
    console.error('[Finalize Invoice Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error finalizing invoice.' });
  }
};

const getFinanceStats = async (req, res) => {
  try {
    const { filter, startDate, endDate } = req.query;
    const [salesOrdersList, deliveryNotesCount, invoicesList, paymentsList] = await Promise.all([
      SalesOrder.find({ status: { $ne: 'Cancelled' } }),
      DeliveryNote.countDocuments({ status: { $ne: 'Cancelled' } }),
      Invoice.find({ status: { $nin: ['Draft', 'Cancelled'] } }),
      Payment.find({ status: { $ne: 'Cancelled' } })
    ]);

    const salesOrdersCount = salesOrdersList.length;
    const salesOrdersAmount = salesOrdersList.reduce((sum, o) => sum + (Number(o.netAmount || o.totalAmount) || 0), 0);

    const invoicesCount = invoicesList.length;
    const invoicesAmount = invoicesList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

    const totalPayments = paymentsList.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const receivablesAmount = Math.max(0, invoicesAmount - totalPayments);

    const now = new Date();
    let overdueAmount = 0;
    invoicesList.forEach(inv => {
      const rem = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paidAmount) || 0));
      if (rem > 0 && inv.dueDate && new Date(inv.dueDate) < now) {
        overdueAmount += rem;
      }
    });

    const pendingDrafts = invoicesList.filter(i => ['Pending Finance Finalization', 'Submitted'].includes(i.status));
    const pendingDraftsCount = pendingDrafts.length;
    const pendingAmount = pendingDrafts.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        salesOrdersCount,
        salesOrdersAmount,
        deliveryNotesCount,
        invoicesCount,
        invoicesAmount,
        receivablesAmount,
        overdueAmount,
        pendingDrafts: pendingDraftsCount,
        pendingAmount,
        totalPaid: totalPayments,
        totalInvoices: invoicesCount,
        approvedInvoices: invoicesCount,
        totalInvoicedAmount: invoicesAmount,
        outstandingReceivables: receivablesAmount
      }
    });
  } catch (error) {
    console.error('[Get Finance Stats Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching finance stats.' });
  }
};

const getFinanceReceivables = async (req, res) => {
  try {
    const invoices = await Invoice.find({
      status: { $nin: ['Cancelled'] }
    }).sort({ dueDate: 1 });

    const now = new Date();
    const receivables = invoices.map(inv => {
      const totalCents = toMoneyCents(inv.amount) || 0;
      const paidCents = toMoneyCents(inv.paidAmount) || 0;
      const remainingCents = Math.max(0, totalCents - paidCents);
      const total = fromMoneyCents(totalCents);
      const paid = fromMoneyCents(paidCents);
      const remaining = fromMoneyCents(remainingCents);
      const isOverdue = remainingCents > 0 && inv.dueDate && new Date(inv.dueDate) < now;
      return {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.clientName,
        customerEmail: inv.customerEmail,
        salesOrderNumber: inv.salesOrderNumber || inv.saleReference || '',
        deliveryNoteNumber: inv.deliveryNoteNumber || '',
        amount: total,
        paidAmount: paid,
        remainingReceivable: remaining,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: remainingCents === 0 ? 'Paid' : (paidCents > 0 ? 'Partially Paid' : (isOverdue ? 'Overdue' : (inv.status || 'Pending'))),
        isOverdue
      };
    });

    return res.status(200).json({
      success: true,
      count: receivables.length,
      data: receivables
    });
  } catch (error) {
    console.error('[Get Finance Receivables Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching receivables.' });
  }
};

const getOrderDocumentPackage = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await SalesOrder.findById(id).populate('salesPerson', 'fullName email phone');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Sales Order not found.' });
    }

    const [invoice, deliveryNote] = await Promise.all([
      Invoice.findOne({ salesOrderId: order._id, status: { $ne: 'Cancelled' } }).sort({ createdAt: -1 }),
      DeliveryNote.findOne({ salesOrder: order._id }).sort({ createdAt: -1 })
    ]);

    // Construct Undertaking if not set
    const undertaking = {
      undertakingNumber: order.undertakingDetails?.undertakingNumber || `UT-${(order.orderNumber || order.orderReference).replace(/[^0-9]/g, '') || Date.now().toString().slice(-5)}`,
      issuedDate: order.undertakingDetails?.issuedDate || order.createdAt || new Date(),
      companyName: 'Fortline CRM & Commercial Solutions',
      clientName: order.clientName,
      salesOrderNumber: order.orderNumber || order.orderReference,
      termsAccepted: true,
      declarationText: `We hereby undertake that the products supplied under Sales Order #${order.orderNumber || order.orderReference} conform to international quality standards, full technical specifications, and warranty compliance as agreed in contract.`
    };

    // Construct Goods Declaration Form if not set
    const goodsDeclaration = {
      gdNumber: order.goodsDeclarationDetails?.gdNumber || `GD-${(order.orderNumber || order.orderReference).replace(/[^0-9]/g, '') || Date.now().toString().slice(-5)}`,
      gdDate: order.goodsDeclarationDetails?.gdDate || order.createdAt || new Date(),
      portName: order.goodsDeclarationDetails?.portName || 'Karachi Customs Port',
      declarationType: order.goodsDeclarationDetails?.declarationType || 'Commercial Import & Customs Clearance',
      consignee: order.clientName,
      consignor: order.supplierPO?.supplierName || 'Fortline Approved Global Vendor',
      fileType: order.fileType || 'Green',
      totalValuePKR: order.netAmount || order.totalAmount || 0
    };

    // Validation
    const missingDocuments = [];
    if (!invoice || (invoice.status !== 'Finalized' && !invoice.isFinalized && invoice.status !== 'Approved')) {
      missingDocuments.push('Finalized Invoice');
    }
    if (!deliveryNote) {
      missingDocuments.push('Delivery Note');
    }
    if (!undertaking.undertakingNumber) {
      missingDocuments.push('Undertaking');
    }
    if (!goodsDeclaration.gdNumber) {
      missingDocuments.push('Goods Declaration Form');
    }

    const isComplete = missingDocuments.length === 0;

    return res.status(200).json({
      success: true,
      data: {
        order,
        invoice,
        deliveryNote,
        undertaking,
        goodsDeclaration,
        validation: {
          isComplete,
          missingDocuments
        }
      }
    });
  } catch (error) {
    console.error('Get Order Document Package Error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving document package.' });
  }
};

module.exports = {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  updateMyLead,
  deleteMyLead,
  convertLeadToDeal,
  getMyDeals,
  createMyDeal,
  updateMyDeal,
  deleteMyDeal,
  getMyQuotations,
  createMyQuotation,
  updateMyQuotation,
  deleteMyQuotation,
  convertQuotationToSalesOrder,
  convertQuotationToCustomerPO,
  convertCustomerPOToProductFile,
  convertProductFileToSalesOrder,
  calculateCustomerOverdue,
  checkCustomerOverdueApi,
  getMyOrders,
  createMyOrder,
  updateMyOrder,
  deleteMyOrder,
  financeReviewSalesOrder,
  checkOrderStock,
  getGoodsReceivingPreview,
  getAvailableOrdersForDelivery,
  getMyProformaInvoices,
  createMyProformaInvoice,
  updateMyProformaInvoice,
  deleteMyProformaInvoice,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  updateMyDeliveryNote,
  deleteMyDeliveryNote,
  getMyInvoices,
  createMyInvoice,
  updateMyInvoice,
  deleteMyInvoice,
  getMyFollowUps,
  createMyFollowUp,
  updateMyFollowUp,
  deleteMyFollowUp,
  getMyTargets,
  getMyActivities,
  getMyCustomerPOs,
  createMyCustomerPO,
  updateMyCustomerPO,
  deleteMyCustomerPO,
  getMyProductFiles,
  createMyProductFile,
  updateMyProductFile,
  deleteMyProductFile,
  getMyPayments,
  createMyPayment,
  updateMyPayment,
  deleteMyPayment,
  getSalesTeamMembers,
  getSalesTeamMemberProfile,
  sendOrderToSupport,
  sendSalesOrderToFinance,
  getSupportStats,
  getInventoryItems,
  createOrUpdateInventoryItem,
  addInventoryStock,
  confirmDeliveryNoteWithInventory,
  getAccountsStats,
  getAccountsPendingDeliveryNotes,
  sendInvoiceToFinance,
  returnInvoiceToAccounts,
  finalizeInvoice,
  getFinanceStats,
  getFinanceReceivables,
  recordGoodsReceivedInOffice,
  recordBLInput,
  issueSupplierPO,
  getOrderDocumentPackage
};
