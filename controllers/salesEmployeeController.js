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
const Notification = require('../models/Notification');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const PurchaserGRN = require('../models/PurchaserGRN');
const LocalPayable = require('../models/LocalPayable');
const Counter = require('../models/Counter');
const { getCounterKey } = require('../utils/counterKey');
const { allocateGrnNumber, withGrnDuplicateRecovery } = require('../utils/grnNumber');
const { allocateGlobalPoNumber } = require('../utils/globalPoNumber');
const { notifyRoleHelper, createNotificationHelper } = require('./notificationController');
const { getSupportDashboardMetrics } = require('../utils/departmentDashboardMetrics');
const { verifyAndConsumeCEOPermission, logCategoryAEdit, hasFieldValueChanged } = require('../utils/editPermissionHelper');
const {
  isGlobalSalesUser,
  isSalesUser,
  effectiveOwnerId,
  ownsSalesRecord,
  ownerScope,
  applyOwnerScope
} = require('../utils/salesOwnership');
const { getSalesManagerScope } = require('../utils/salesManagerScope');
const { DOCUMENT_TYPES, getCompanySnapshot, inheritCompanySnapshot, resolvePOCompany } = require('../config/companies');
const { normalizeInventoryName, getInventoryMatches } = require('../utils/inventoryMatching');
const {
  reservationRemaining,
  activeReservations,
  inventoryStatusStage,
  releaseOrderReservations,
  releaseDeliveryNoteReservations
} = require('../utils/inventoryReservations');
const { appendExpenseLines } = require('../utils/purchaseExpenses');
const { ensureCategoryAvailable, canAccessPO } = require('./purchaseExpenseController');
const { getSalesDashboardMetrics } = require('../utils/salesDashboardMetrics');

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

const notifySalesOwner = async ({ record, recipient, ...notification }) => {
  const ownerId = recipient || effectiveOwnerId(record);
  if (!ownerId) return null;
  return createNotificationHelper({ ...notification, recipient: ownerId });
};

const checkOwnership = (record, fields, userId, reqUser) => ownsSalesRecord(record, reqUser || { _id: userId });

const ownershipDenied = (res, resource) => res.status(403).json({
  success: false,
  message: `Access denied. You can only access your own ${resource}.`
});

const canAccessDepartmentOrder = (order, user, department) => {
  if (isGlobalSalesUser(user)) return true;
  const userRole = String(user?.role || '').toLowerCase();
  const userDepartment = String(user?.department || '').toLowerCase();
  const required = String(department || '').toLowerCase();
  const aliases = {
    accounts: ['accountant', 'accounts', 'accounting'],
    finance: ['finance'],
    support: ['support'],
    logistics: ['logistics'],
    purchaser: ['purchaser', 'procurement']
  }[required] || [required];
  const isDepartmentUser = aliases.some(alias => userRole === alias || userDepartment.includes(alias));
  const orderDepartment = `${order?.currentDepartment || ''} ${order?.departmentResponsible || ''}`.toLowerCase();
  return isDepartmentUser && orderDepartment.includes(required);
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
const releasesReservation = (value) => /cancel|reject|return/i.test(String(value || ''));

const availableInventoryQuantity = inventoryItem => Math.max(
  0,
  (Number(inventoryItem?.quantityOnHand) || 0) - (Number(inventoryItem?.reservedQuantity) || 0)
);

const resolveInventoryForLine = ({ orderItem, requiredQty, inventoryItems, reservation = null, storedInventoryIds = [] }) => {
  const byId = id => id && inventoryItems.find(candidate => String(candidate._id) === String(id));
  if (reservation?.inventoryItem) {
    return { inventoryItem: byId(reservation.inventoryItem) || null, reservation, ambiguous: false, usedFallback: false };
  }

  const storedInventoryId = storedInventoryIds.find(Boolean);
  const storedInventoryItem = byId(storedInventoryId);
  const matches = getInventoryMatches(orderItem, inventoryItems);
  if (storedInventoryItem && availableInventoryQuantity(storedInventoryItem) >= requiredQty) {
    return { inventoryItem: storedInventoryItem, reservation: null, ambiguous: false, usedFallback: false };
  }

  const sufficientlyStockedMatches = matches.filter(candidate => availableInventoryQuantity(candidate) >= requiredQty);
  if (sufficientlyStockedMatches.length === 1) {
    return {
      inventoryItem: sufficientlyStockedMatches[0],
      reservation: null,
      ambiguous: false,
      usedFallback: Boolean(storedInventoryId && String(sufficientlyStockedMatches[0]._id) !== String(storedInventoryId))
    };
  }
  if (matches.length === 1) {
    return { inventoryItem: matches[0], reservation: null, ambiguous: false, usedFallback: false };
  }
  if (storedInventoryItem) {
    return { inventoryItem: storedInventoryItem, reservation: null, ambiguous: matches.length > 1, usedFallback: false };
  }
  return { inventoryItem: null, reservation: null, ambiguous: matches.length > 1, usedFallback: false };
};

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
  const deliveredByOrderItem = new Map();
  earlierDeliveryNotes.forEach(note => {
    (note.items || []).forEach(item => {
      const orderItemKey = String(item.orderItemId || '');
      if (orderItemKey) {
        deliveredByOrderItem.set(orderItemKey, (deliveredByOrderItem.get(orderItemKey) || 0) + (Number(item.quantity) || Number(item.demand) || 1));
      }
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
    const orderItemKey = String(item._id || 'product-summary');
    const deliveredAvailable = deliveredByOrderItem.has(orderItemKey)
      ? deliveredByOrderItem.get(orderItemKey)
      : (deliveredByName.get(normalizedItemName) || 0);
    const deliveredQty = Math.min(orderedQty, deliveredAvailable);
    if (deliveredByOrderItem.has(orderItemKey)) deliveredByOrderItem.set(orderItemKey, Math.max(0, deliveredAvailable - deliveredQty));
    deliveredByName.set(normalizedItemName, Math.max(0, deliveredAvailable - deliveredQty));
    const requiredQty = Math.max(0, orderedQty - deliveredQty);
    const reservation = activeReservations(order).find(candidate =>
      (candidate.orderItemId && String(candidate.orderItemId) === orderItemKey) || Number(candidate.itemIndex) === index
    );
    const receiptInventoryId = receiptInventoryByOrderItem.get(orderItemKey);
    const checkedInventoryId = order.inventoryAnalysis?.[index]?.productId;
    const resolved = resolveInventoryForLine({
      orderItem: item,
      requiredQty,
      inventoryItems,
      reservation,
      storedInventoryIds: [receiptInventoryId, checkedInventoryId]
    });

    return {
      item: itemName,
      quantityAssumed: item.quantityAssumed === true || !(order.items && order.items.length),
      orderedQty,
      deliveredQty,
      requiredQty,
      inventoryItem: resolved.inventoryItem,
      reservation: resolved.reservation,
      orderItemId: orderItemKey,
      itemIndex: index,
      ambiguous: resolved.ambiguous,
      usedFallback: resolved.usedFallback
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
    if (line.reservation) {
      line.availableQty = reservationRemaining(line.reservation);
      if (line.availableQty < line.requiredQty) {
        shortages.push({ item: line.item, required: line.requiredQty, available: line.availableQty, reason: 'Order reservation is insufficient' });
      }
      return;
    }
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

const getDeliveryNoteStockRequirements = async (deliveryNote, order, { session = null } = {}) => {
  const inventoryItems = await InventoryItem.find({}).session(session || null);
  const reservations = activeReservations(order);
  const requirements = (deliveryNote.items || []).map((dnItem, itemIndex) => {
    const orderItemIndex = Number.isInteger(Number(dnItem.orderItemIndex)) ? Number(dnItem.orderItemIndex) : itemIndex;
    const orderItem = (order.items || []).find(item => dnItem.orderItemId && String(item._id) === String(dnItem.orderItemId)) ||
      order.items?.[orderItemIndex] ||
      { description: dnItem.product || dnItem.description, sku: dnItem.sku || '' };
    const itemName = String(dnItem.product || dnItem.description || orderItem.description || 'Item').trim();
    const requiredQty = Number(dnItem.quantity) || Number(dnItem.demand) || 0;
    const boundInventoryId = dnItem.inventoryItem;
    const matchingReservation = reservations.find(candidate => {
      const matchesLine = (dnItem.orderItemId && String(candidate.orderItemId) === String(dnItem.orderItemId)) ||
        Number(candidate.itemIndex) === orderItemIndex;
      return matchesLine && (!boundInventoryId || String(candidate.inventoryItem) === String(boundInventoryId));
    });
    const resolved = resolveInventoryForLine({
      orderItem: { ...orderItem.toObject?.(), description: itemName },
      requiredQty,
      inventoryItems,
      reservation: matchingReservation,
      storedInventoryIds: [boundInventoryId]
    });
    return {
      item: itemName,
      requiredQty,
      inventoryItem: resolved.inventoryItem,
      reservation: resolved.reservation,
      orderItemId: String(dnItem.orderItemId || ''),
      itemIndex: orderItemIndex,
      ambiguous: resolved.ambiguous,
      usedFallback: resolved.usedFallback
    };
  });

  const availableByInventoryId = new Map();
  const onHandByInventoryId = new Map();
  const reservedByInventoryId = new Map();
  const reservationBalance = new Map();
  const shortages = [];
  requirements.forEach(line => {
    const inventoryItem = line.inventoryItem;
    const inventoryItemId = inventoryItem ? String(inventoryItem._id) : '';
    let available = 0;
    if (inventoryItemId && line.reservation) {
      if (!onHandByInventoryId.has(inventoryItemId)) {
        onHandByInventoryId.set(inventoryItemId, Math.max(0, Number(inventoryItem.quantityOnHand) || 0));
        reservedByInventoryId.set(inventoryItemId, Math.max(0, Number(inventoryItem.reservedQuantity) || 0));
      }
      const reservationId = String(line.reservation._id || `${line.orderItemId}:${line.itemIndex}`);
      if (!reservationBalance.has(reservationId)) reservationBalance.set(reservationId, reservationRemaining(line.reservation));
      available = Math.min(
        reservationBalance.get(reservationId),
        onHandByInventoryId.get(inventoryItemId),
        reservedByInventoryId.get(inventoryItemId)
      );
      const consumed = Math.min(available, line.requiredQty);
      reservationBalance.set(reservationId, Math.max(0, reservationBalance.get(reservationId) - consumed));
      onHandByInventoryId.set(inventoryItemId, Math.max(0, onHandByInventoryId.get(inventoryItemId) - consumed));
      reservedByInventoryId.set(inventoryItemId, Math.max(0, reservedByInventoryId.get(inventoryItemId) - consumed));
    } else if (inventoryItemId) {
      if (!availableByInventoryId.has(inventoryItemId)) {
        availableByInventoryId.set(inventoryItemId, availableInventoryQuantity(inventoryItem));
      }
      available = availableByInventoryId.get(inventoryItemId);
      availableByInventoryId.set(inventoryItemId, Math.max(0, available - line.requiredQty));
    }
    line.availableQty = available;
    if (!inventoryItem || line.requiredQty <= 0 || available < line.requiredQty) {
      shortages.push({
        item: line.item,
        required: line.requiredQty,
        available,
        reason: line.requiredQty <= 0
          ? 'Invalid Delivery Note quantity'
          : (line.ambiguous ? 'Multiple normalized inventory matches' : (!inventoryItem ? 'Not linked to inventory' : 'Insufficient stock'))
      });
    }
  });

  return {
    requirements,
    shortages,
    isFullyInStock: requirements.length > 0 && shortages.length === 0,
    message: shortages.length
      ? shortages.map(shortage => `${shortage.item}: need ${shortage.required}, available ${shortage.available}${shortage.reason ? ` (${shortage.reason})` : ''}`).join('; ')
      : 'All Delivery Note items have sufficient stock.'
  };
};

const formatStockShortageMessage = (shortages) => {
  const details = shortages.map(item => `${item.item} (required ${item.required}, available ${item.available})`).join('; ');
  return `Add inventory first. Insufficient stock: ${details}.`;
};

const allocateFileNumber = async () => {
  const counterKey = getCounterKey('file-number');
  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { sequence: 1 } },
    { new: true }
  );
  if (!counter) {
    throw createHttpError(503, 'The file-number counter has not been initialized. Run the approved one-time seed before creating files.');
  }
  return String(counter.sequence);
};

const withFileColour = (fileNumber, fileType) => {
  const raw = String(fileNumber || '').trim();
  if (!raw) return raw;
  const core = raw.replace(/\s+(?:Green|Blue)$/i, '').trim();
  return `${core} ${fileType}`;
};

const updateLinkedFileColour = async (order, fileType, session) => {
  const linkedRecords = [
    [Quotation, order.quotationId, 'fileNo', 'Quotation'],
    [CustomerPO, order.customerPOId, 'fileNumber', 'Customer PO'],
    [ProductFile, order.productFileId, 'fileNumber', 'Product File']
  ];
  const warnings = [];

  for (const [Model, recordId, numberField, label] of linkedRecords) {
    if (!recordId) {
      warnings.push(`${label} link is missing.`);
      continue;
    }
    const record = await Model.findById(recordId).session(session || null);
    if (!record) {
      warnings.push(`${label} link points to a record that no longer exists.`);
      continue;
    }
    record[numberField] = withFileColour(record[numberField], fileType);
    record.fileType = fileType;
    await record.save({ session });
  }
  return warnings;
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeQuotationItems = ({ items, productSummary, totalAmount, netAmount }) => {
  const sourceItems = Array.isArray(items) && items.length
    ? items
    : (productSummary ? [{ description: productSummary, quantity: 1, unitPrice: Number(totalAmount || netAmount || 0) }] : []);

  return sourceItems.map(item => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    const inventoryItem = item.inventoryItem && mongoose.Types.ObjectId.isValid(item.inventoryItem)
      ? item.inventoryItem
      : null;
    return {
      inventoryItem,
      sku: String(item.sku || '').trim(),
      description: String(item.description || item.productName || '').trim(),
      quantity,
      unitPrice,
      total: Math.round(quantity * unitPrice * 100) / 100
    };
  });
};

const quotationFinancials = ({ items, discount, discountPercentage, taxPercentage }) => {
  const subtotal = Math.round(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0) * 100) / 100;
  const discountPct = Math.max(0, Math.min(100, Number(discountPercentage) || 0));
  const requestedDiscount = Math.max(0, Number(discount) || 0);
  const discountAmount = Math.min(subtotal, requestedDiscount || Math.round(subtotal * discountPct) / 100);
  const gstPercentage = Math.max(0, Math.min(100, Number(taxPercentage) || 0));
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const tax = Math.round(taxableBase * gstPercentage) / 100;
  return {
    totalAmount: subtotal,
    discount: discountAmount,
    discountPercentage: discountPct,
    tax,
    taxPercentage: gstPercentage,
    netAmount: Math.round((taxableBase + tax) * 100) / 100
  };
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
    const salesStatsScope = isGlobalSalesUser(req.user) ? {} : ownerScope(userId);

    const [leads, quotations, orders, deals, followUps, targets, user, invoices, payroll, attendances, leaves, tasks, projects] = await Promise.all([
      Lead.find(salesStatsScope),
      Quotation.find(salesStatsScope),
      SalesOrder.find(salesStatsScope),
      Deal.find(salesStatsScope),
      FollowUp.find(isGlobalSalesUser(req.user) ? {} : { createdBy: userId }),
      SalesTarget.find(isGlobalSalesUser(req.user) ? {} : { employee: userId }).sort({ createdAt: -1 }),
      User.findById(userId),
      Invoice.find(isGlobalSalesUser(req.user) ? {} : { $or: [{ salesPerson: userId }, { createdBy: userId }] }),
      Payroll.findOne({ user: userId, month: now.getMonth() + 1, year: now.getFullYear() }),
      Attendance.find({ user: userId, date: { $gte: startOfMonth } }),
      Leave.find({ user: userId, createdAt: { $gte: startOfMonth } }),
      Task.find({ assignedTo: userId }),
      Project.find({ $or: [{ team: userId }, { createdBy: userId }, { projectManager: userId }] })
    ]);

    const dashboardMetrics = await getSalesDashboardMetrics({
      userId,
      isGlobal: isGlobalSalesUser(req.user),
      month: req.query.month,
      now
    });

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
          overdueAmount: dashboardMetrics.tiles.overdue.amount,
          overdueInvoiceAmount: dashboardMetrics.tiles.overdue.amount,
          overdueOrderAmount,
          salaryTarget,
          liability,
          netRevenue,
          totalInvoicesCount,
          approvedInvoicesCount,
          paidInvoicesAmount,
          paidInvoicesCount: paidInvoices.length,
          unpaidInvoicesCount: receivableInvoices.length,
          overdueInvoicesCount: dashboardMetrics.tiles.overdue.count
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
        overdueAmount: dashboardMetrics.tiles.overdue.amount,
        overdueList: dashboardMetrics.tiles.overdue.records,
        dashboardMonth: dashboardMetrics.month,
        dashboardTiles: dashboardMetrics.tiles,
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

    const conditions = [];

    if (status && status !== 'all') {
      conditions.push({ status });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }] });
    }

    const query = applyOwnerScope(conditions, req.user);

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
      owner: req.user._id,
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

    await notifySalesOwner({
      record: lead,
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

    if (!ownsSalesRecord(lead, req.user)) {
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
    if (!ownsSalesRecord(lead, req.user)) return ownershipDenied(res, 'leads');

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
      assignedTo: effectiveOwnerId(lead) || req.user._id,
      owner: effectiveOwnerId(lead) || req.user._id,
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

    await notifySalesOwner({
      record: deal,
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

    const conditions = [];

    if (stage && stage !== 'all') {
      conditions.push({ stage });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [{ title: regex }, { clientName: regex }] });
    }

    const query = applyOwnerScope(conditions, req.user);

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
      owner: req.user._id,
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

    await notifySalesOwner({
      record: deal,
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

    if (!ownsSalesRecord(deal, req.user)) {
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

    const isGlobal = ['admin', 'ceo', 'accountant', 'finance'].includes(req.user.role) ||
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

    await notifySalesOwner({
      record: invoice,
      recipient: invoice.salesPerson || invoice.createdBy,
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
    if (!ownsSalesRecord(quotation, req.user)) return ownershipDenied(res, 'quotations');

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
      owner: effectiveOwnerId(quotation),
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
    if (!ownsSalesRecord(po, req.user)) return ownershipDenied(res, 'customer POs');
    if (!hasValidCustomerPOAttachment(po)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }

    const { products, notes } = req.body;

    let quoteItems = [];
    let quotationNumber = po.quotationNumber || '';
    let linkedQuotation = null;
    if (po.quotationId) {
      linkedQuotation = await Quotation.findById(po.quotationId);
      if (linkedQuotation) {
        if (!ownsSalesRecord(linkedQuotation, req.user)) return ownershipDenied(res, 'quotations');
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

    const resolvedFileType = po.fileType || linkedQuotation?.fileType || '';
    const resolvedFileNumber = po.fileNumber || linkedQuotation?.fileNo || await allocateFileNumber();

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
      owner: effectiveOwnerId(po),
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
    if (!ownsSalesRecord(file, req.user)) return ownershipDenied(res, 'product files');

    if (!file.customerPOId) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    const customerPO = await CustomerPO.findById(file.customerPOId);
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    if (!ownsSalesRecord(customerPO, req.user)) return ownershipDenied(res, 'customer POs');

    const { orderReference, clientAddress, clientEmail, clientPhone, items, totalAmount, discount, tax, netAmount, deliveryDate, notes, stockStatus, suggestedFileType } = req.body;

    // Check overdue balance of customer
    const overdueInfo = await calculateCustomerOverdue(file.customerName);
    const requiresApproval = overdueInfo.isOverdue;

    let quoteRef = null;
    let netAmt = Number(netAmount) || Number(totalAmount) || 0;
    let orderItems = Array.isArray(items) && items.length > 0 ? items : [];

    if (file.quotationId) {
      quoteRef = await Quotation.findById(file.quotationId);
      if (quoteRef && !ownsSalesRecord(quoteRef, req.user)) return ownershipDenied(res, 'quotations');
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
      suggestedFileType: ['Green', 'Blue'].includes(suggestedFileType) ? suggestedFileType : '',
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
      issuingCompany: inheritCompanySnapshot(quoteRef) || undefined,
      quotationId: file.quotationId || (quoteRef ? quoteRef._id : null),
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || file.customerPONumber || '',
      productFileId: file._id,
      salesPerson: effectiveOwnerId(file),
      owner: effectiveOwnerId(file),
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
    if (!ownsSalesRecord(quotation, req.user)) return ownershipDenied(res, 'quotations');

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
    if (!ownsSalesRecord(customerPO, req.user)) return ownershipDenied(res, 'customer POs');

    const { deliveryDate, notes, stockStatus, suggestedFileType } = req.body;

    // Check overdue balance of customer using finalized invoices only
    const overdueInfo = await calculateCustomerOverdue(quotation.clientName);
    const requiresApproval = overdueInfo.isOverdue;
    const netAmt = Number(quotation.netAmount) || Number(quotation.totalAmount) || 0;

    const order = await SalesOrder.create({
      orderReference: req.body.orderReference || quotation.orderReference || '',
      clientName: quotation.clientName,
      clientAddress: quotation.clientAddress || '',
      salePerson: req.user.fullName,
      fileNo: quotation.fileNo || '',
      fileType: quotation.fileType || '',
      suggestedFileType: ['Green', 'Blue'].includes(suggestedFileType) ? suggestedFileType : '',
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
      issuingCompany: inheritCompanySnapshot(quotation) || undefined,
      quotationId: quotation._id,
      leadId: quotation.leadId || null,
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || '',
      salesPerson: effectiveOwnerId(quotation),
      owner: effectiveOwnerId(quotation),
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
    const conditions = [];

    if (isGlobalSalesUser(req.user)) {
      if (employeeId && employeeId !== 'all') conditions.push(ownerScope(employeeId));
    } else {
      conditions.push({ $or: [ownerScope(req.user._id), { originalOwner: req.user._id }] });
    }

    // Pending workflow: 'active' filter excludes converted quotations
    if (status === 'active' || !status) {
      conditions.push({ status: { $nin: ['Converted to Customer PO', 'Converted to Sales Order', 'Converted', 'Rejected', 'Expired'] } });
    } else if (status === 'converted') {
      conditions.push({ status: { $in: ['Converted to Customer PO', 'Converted to Sales Order', 'Converted'] } });
    } else if (status && status !== 'all') {
      conditions.push({ status });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [
        { orderReference: regex },
        { quotationNumber: regex },
        { clientName: regex },
        { salePerson: regex },
        { productSummary: regex },
        { fileNo: regex }
      ] });
    }

    const query = conditions.length ? { $and: conditions } : {};
    const quotations = await Quotation.find(query)
      .populate('owner originalOwner', 'fullName email')
      .populate('forwardHistory.from forwardHistory.to forwardHistory.forwardedBy', 'fullName email')
      .sort({ creationDate: -1, createdAt: -1 })
      .lean();
    const data = quotations.map(quotation => ({
      ...quotation,
      isForwardedReadOnly: !isGlobalSalesUser(req.user) &&
        effectiveOwnerId(quotation)?.toString() !== req.user._id.toString()
    }));
    return res.status(200).json({ success: true, count: data.length, data });
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
      quotationCode,
      clientName,
      productSummary,
      clientEmail,
      clientPhone,
      clientAddress,
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
      leadId,
      dealId,
      issuingCompanyCode,
      currency,
      reference,
      availability,
      paymentTerms,
      priceValidity,
      commercialNote
    } = req.body;

    if (!clientName) return res.status(400).json({ success: false, message: 'Customer/Client name is required.' });
    const issuingCompany = getCompanySnapshot(issuingCompanyCode, DOCUMENT_TYPES.QUOTATION);
    const assignedFileNumber = await allocateFileNumber();
    const normalizedItems = normalizeQuotationItems({ items, productSummary, totalAmount, netAmount });
    const financials = quotationFinancials({
      items: normalizedItems,
      discount,
      discountPercentage,
      taxPercentage: taxPercentage === undefined ? 18 : taxPercentage
    });

    const quotation = await Quotation.create({
      quotationCode,
      clientName: clientName.trim(),
      salePerson: req.user.fullName || '',
      fileNo: assignedFileNumber,
      fileType: '',
      productSummary: productSummary?.trim() || '',
      clientEmail: clientEmail?.trim() || '',
      clientPhone: clientPhone?.trim() || '',
      clientAddress: clientAddress?.trim() || '',
      items: normalizedItems,
      ...financials,
      currency: String(currency || 'Pakistani Rupee').trim(),
      reference: String(reference || '').trim(),
      availability: String(availability || 'Ex-stock (Limited)').trim(),
      paymentTerms: String(paymentTerms || '100% Advance').trim(),
      priceValidity: String(priceValidity || '5 calendar days').trim(),
      commercialNote: String(commercialNote || 'In case the Govt. imposes any additional duties/taxes/any change in Pak Rs. customer has to pay the difference.').trim(),
      status: status || 'Quotation',
      validUntil: validUntil || null,
      creationDate: creationDate ? new Date(creationDate) : new Date(),
      notes: notes || '',
      issuingCompany,
      leadId: leadId || null,
      dealId: dealId || null,
      owner: req.user._id,
      originalOwner: req.user._id,
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
    if (!ownsSalesRecord(quotation, req.user)) return ownershipDenied(res, 'quotations');

    if (req.body.issuingCompanyCode !== undefined) {
      quotation.issuingCompany = getCompanySnapshot(req.body.issuingCompanyCode, DOCUMENT_TYPES.QUOTATION);
    }

    const allowedFields = [
      'clientName',
      'productSummary',
      'clientEmail',
      'clientPhone',
      'clientAddress',
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
      'notes',
      'currency',
      'reference',
      'availability',
      'paymentTerms',
      'priceValidity',
      'commercialNote'
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

    const financialFields = ['items', 'discount', 'discountPercentage', 'taxPercentage'];
    if (financialFields.some(field => req.body[field] !== undefined)) {
      const normalizedItems = normalizeQuotationItems({
        items: req.body.items !== undefined ? req.body.items : quotation.items,
        productSummary: quotation.productSummary,
        totalAmount: quotation.totalAmount,
        netAmount: quotation.netAmount
      });
      const financials = quotationFinancials({
        items: normalizedItems,
        discount: req.body.discount !== undefined ? req.body.discount : quotation.discount,
        discountPercentage: req.body.discountPercentage !== undefined ? req.body.discountPercentage : quotation.discountPercentage,
        taxPercentage: req.body.taxPercentage !== undefined ? req.body.taxPercentage : quotation.taxPercentage
      });
      quotation.items = normalizedItems;
      Object.assign(quotation, financials);
      quotation.productSummary = normalizedItems.map(item => item.description).filter(Boolean).join(', ');
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
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error updating quotation.' });
  }
};

// ══════════════════════════════════════════════
const getQuotationForwardTargets = async (req, res) => {
  try {
    if (!req.user.canForwardQuotations) {
      return res.status(403).json({ success: false, message: 'Quotation forwarding permission is required.' });
    }
    const targets = await User.find({
      _id: { $ne: req.user._id }, status: 'active', isApproved: true,
      $or: [
        { role: { $in: ['sales_member', 'sales_rep', 'sales_person', 'sales_manager'] } },
        { role: 'employee', department: { $regex: /sales/i } }
      ]
    }).select('_id fullName email role').sort({ fullName: 1 }).lean();
    return res.status(200).json({ success: true, count: targets.length, data: targets });
  } catch (error) {
    console.error('[Quotation Forward Targets Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching quotation forwarding targets.' });
  }
};

const forwardQuotation = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (!req.user.canForwardQuotations) {
      return res.status(403).json({ success: false, message: 'Quotation forwarding permission is required.' });
    }
    const { targetUserId, note = '' } = req.body;
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Select a valid Sales account.' });
    }
    if (req.user._id.toString() === targetUserId.toString()) {
      return res.status(400).json({ success: false, message: 'A quotation cannot be forwarded to its current owner.' });
    }
    const target = await User.findOne({
      _id: targetUserId, status: 'active', isApproved: true,
      $or: [
        { role: { $in: ['sales_member', 'sales_rep', 'sales_person', 'sales_manager'] } },
        { role: 'employee', department: { $regex: /sales/i } }
      ]
    }).select('_id fullName email role');
    if (!target) {
      return res.status(400).json({ success: false, message: 'The forwarding target must be an active Sales account.' });
    }

    let forwardedQuotation;
    await session.withTransaction(async () => {
      const ownershipCondition = { $or: [
        { owner: req.user._id },
        { owner: { $exists: false }, createdBy: req.user._id },
        { owner: null, createdBy: req.user._id }
      ] };
      const current = await Quotation.findOne({ _id: req.params.id, ...ownershipCondition }).session(session);
      if (!current) {
        const exists = await Quotation.exists({ _id: req.params.id }).session(session);
        const error = new Error(exists ? 'The quotation owner changed before forwarding. Refresh and try again.' : 'Quotation not found.');
        error.statusCode = exists ? 409 : 404;
        throw error;
      }
      if (current.customerPOId || ['Converted to Customer PO', 'Converted to Sales Order', 'Converted'].includes(current.status)) {
        const error = new Error('This quotation can no longer be forwarded because its Customer PO has been confirmed or it has already been converted.');
        error.statusCode = 409;
        throw error;
      }
      const originalOwner = current.originalOwner || effectiveOwnerId(current);
      forwardedQuotation = await Quotation.findOneAndUpdate(
        { _id: current._id, ...ownershipCondition },
        {
          $set: { owner: target._id, originalOwner },
          $push: { forwardHistory: { from: req.user._id, to: target._id, forwardedBy: req.user._id, time: new Date(), note: String(note || '').trim() } }
        },
        { new: true, session, runValidators: true }
      );
      if (!forwardedQuotation) {
        const error = new Error('The quotation owner changed before forwarding. Refresh and try again.');
        error.statusCode = 409;
        throw error;
      }
      await Promise.all([
        CustomerPO.updateMany({ quotationId: current._id }, { $set: { owner: target._id } }, { session }),
        ProductFile.updateMany({ quotationId: current._id }, { $set: { owner: target._id } }, { session })
      ]);
      const firstItem = current.items?.[0];
      const product = current.productSummary || firstItem?.description || 'Not specified';
      const quantity = (current.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 1;
      const issuingCompany = current.issuingCompany?.name || current.issuingCompany?.legalName || current.issuingCompany?.code || 'Not specified';
      const linkedLead = current.leadId ? await Lead.findById(current.leadId).select('contactPerson name').session(session) : null;
      const contactPerson = linkedLead?.contactPerson || linkedLead?.name || current.clientEmail || current.clientPhone || 'Not specified';
      await Notification.create([{
        recipient: target._id,
        sender: req.user._id,
        title: 'Quotation Forwarded to You',
        message: `${req.user.fullName} forwarded quotation ${current.orderReference || current.quotationNumber || current.fileNo}. Customer: ${current.clientName}; contact: ${contactPerson}; product: ${product}; quantity: ${quantity}; issuing company: ${issuingCompany}.`,
        type: 'sales',
        link: `/sales/quotations?quotationId=${current._id}`,
        data: {
          quotationId: current._id,
          customerCompany: current.clientName || '',
          contactPerson,
          product,
          quantity,
          issuingCompany
        },
        isRead: false
      }], { session });
    });
    await forwardedQuotation.populate('owner originalOwner', 'fullName email');
    return res.status(200).json({ success: true, message: `Quotation forwarded to ${target.fullName}.`, data: forwardedQuotation });
  } catch (error) {
    console.error('[Forward Quotation Error]:', error);
    const isRace = error?.errorLabels?.includes?.('TransientTransactionError') || error?.code === 112;
    return res.status(error.statusCode || (isRace ? 409 : 500)).json({
      success: false,
      message: (error.statusCode || isRace) ? error.message : 'Server error forwarding quotation.'
    });
  } finally {
    await session.endSession();
  }
};

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

    if (isGlobalAccess) {
      if (employeeId && ['admin', 'ceo'].includes(req.user.role)) conditions.push(ownerScope(employeeId));
    } else {
      conditions.push(ownerScope(req.user._id));
    }

    // Pending workflow: 'active' filter shows orders pending action by Sales (including rejected ones awaiting salesperson action)
    if (status === 'active' || status === 'pending') {
      conditions.push({
        workflowStatus: { $nin: ['Sent to Support', 'DN Created', 'Delivery Note Created', 'Delivery Note Confirmed', 'Sent to Accounts', 'Draft Invoice Created', 'Sent to Finance', 'Pending Finance Finalization', 'Completed'] }
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
        workflowStatus: { $in: ['Sent to Support', 'DN Created', 'Delivery Note Created', 'Delivery Note Confirmed', 'Sent to Accounts', 'Draft Invoice Created', 'Sent to Finance', 'Pending Finance Finalization', 'Completed'] }
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
      suggestedFileType,
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
    if (!ownsSalesRecord(customerPO, req.user)) return ownershipDenied(res, 'customer POs');

    const linkedProductFile = productFileId && mongoose.Types.ObjectId.isValid(productFileId)
      ? await ProductFile.findById(productFileId)
      : null;
    if (linkedProductFile && !ownsSalesRecord(linkedProductFile, req.user)) return ownershipDenied(res, 'product files');
    const linkedQuotationId = quotationId && mongoose.Types.ObjectId.isValid(quotationId)
      ? quotationId
      : (linkedProductFile?.quotationId || customerPO.quotationId || null);
    const linkedQuotation = linkedQuotationId ? await Quotation.findById(linkedQuotationId) : null;
    if (linkedQuotation && !ownsSalesRecord(linkedQuotation, req.user)) return ownershipDenied(res, 'quotations');
    const orderOwner = effectiveOwnerId(linkedProductFile) || effectiveOwnerId(linkedQuotation) || effectiveOwnerId(customerPO) || req.user._id;
    const resolvedFileType = linkedProductFile?.fileType || linkedQuotation?.fileType || customerPO.fileType || '';
    const resolvedFileNumber = linkedProductFile?.fileNumber || linkedQuotation?.fileNo || customerPO.fileNumber || await allocateFileNumber();

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
      suggestedFileType: ['Green', 'Blue'].includes(suggestedFileType) ? suggestedFileType : (['Green', 'Blue'].includes(fileType) ? fileType : ''),
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
      issuingCompany: inheritCompanySnapshot(linkedQuotation) || undefined,
      quotationId: linkedQuotationId || null,
      customerPOId: customerPO._id,
      customerPONumber: customerPO.poNumber || customerPONumber || '',
      productFileId: productFileId && mongoose.Types.ObjectId.isValid(productFileId) ? productFileId : null,
      leadId: leadId && mongoose.Types.ObjectId.isValid(leadId) ? leadId : null,
      salesPerson: orderOwner,
      owner: orderOwner,
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

    await notifySalesOwner({
      record: order,
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
    if (!canAccessDepartmentOrder(order, req.user, 'finance')) return ownershipDenied(res, 'Finance queue sales orders');

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
      if (!['Green', 'Blue'].includes(fileTypeChoice)) {
        return res.status(400).json({
          success: false,
          message: 'Finance must explicitly select Green or Blue before approving the Sales Order.'
        });
      }

      const resolvedFileType = fileTypeChoice;
      const isBlue = resolvedFileType === 'Blue';
      const session = await mongoose.startSession();
      let approvedOrder;
      let linkWarnings = [];
      try {
        await session.withTransaction(async () => {
          const transactionalOrder = await SalesOrder.findById(req.params.id).session(session);
          if (!transactionalOrder) throw createHttpError(404, 'Sales order not found.');

          transactionalOrder.isOverdueBlocked = false;
          transactionalOrder.overdueBlockReason = '';
          transactionalOrder.requiresFinanceApproval = false;
          transactionalOrder.financeApprovedBy = req.user._id;
          transactionalOrder.financeApprovedByName = req.user.fullName;
          transactionalOrder.financeApprovedAt = new Date();
          transactionalOrder.fileType = resolvedFileType;
          transactionalOrder.fileNo = withFileColour(transactionalOrder.fileNo, resolvedFileType);
          transactionalOrder.workflowStatus = isBlue ? 'Pending Global Procurement' : 'Pending Local Procurement';
          transactionalOrder.status = transactionalOrder.workflowStatus;
          transactionalOrder.departmentResponsible = isBlue ? 'Global Purchaser' : 'Local Purchaser';
          transactionalOrder.currentDepartment = transactionalOrder.departmentResponsible;
          transactionalOrder.currentStatus = isBlue ? 'BLUE_FILE_GLOBAL_PURCHASER' : 'GREEN_FILE_LOCAL_PURCHASER';
          transactionalOrder.previousDepartment = 'Finance';
          transactionalOrder.previousStatus = 'Pending Finance Overdue Check';
          transactionalOrder.lastAction = `Finance Approved — ${resolvedFileType} File (Routed to ${transactionalOrder.departmentResponsible})`;
          transactionalOrder.lastActionBy = req.user._id;
          transactionalOrder.lastActionByName = req.user.fullName;
          transactionalOrder.lastActionAt = new Date();
          if (!isBlue) transactionalOrder.inventoryCheckStatus = 'Not Checked';

          transactionalOrder.workflowHistory.push({
            user: req.user._id,
            userName: req.user.fullName,
            department: 'Finance',
            action: transactionalOrder.lastAction,
            previousStatus: 'Pending Finance Overdue Check',
            newStatus: transactionalOrder.workflowStatus,
            timestamp: new Date(),
            notes: `Finance explicitly approved ${resolvedFileType} File order ${transactionalOrder.orderNumber || transactionalOrder.orderReference} and routed it to ${transactionalOrder.departmentResponsible}.`
          });

          await transactionalOrder.save({ session });
          linkWarnings = await updateLinkedFileColour(transactionalOrder, resolvedFileType, session);
          approvedOrder = transactionalOrder;
        });
      } finally {
        await session.endSession();
      }

      const finalizedOrder = approvedOrder;

      await notifyRoleHelper(['purchaser', 'admin', 'ceo'], {
        type: 'order',
        title: `New ${resolvedFileType} File Order for ${isBlue ? 'Global' : 'Local'} Purchaser`,
        message: `${resolvedFileType} File Sales Order ${finalizedOrder.orderNumber || finalizedOrder.orderReference} is ready for ${isBlue ? 'Global Procurement & Supplier PO creation' : 'Local Procurement Inventory Check'}.`,
        link: isBlue ? '/purchaser/supplier_pos' : '/purchaser/dashboard',
        sender: req.user._id
      });

      await logSalesActivity({
        type: 'Sales Order Updated',
        description: `Sales Order ${finalizedOrder.orderNumber || finalizedOrder.orderReference} verified All Clear by Finance (${req.user.fullName}) - ${resolvedFileType} File routed to ${isBlue ? 'Global Purchaser' : 'Local Purchaser'}`,
        relatedModel: 'SalesOrder',
        relatedId: finalizedOrder._id,
        performedBy: req.user._id
      });

      if (finalizedOrder.salesPerson || finalizedOrder.createdBy) {
        await createNotificationHelper({
          recipient: finalizedOrder.salesPerson || finalizedOrder.createdBy,
          sender: req.user._id,
          title: `Sales Order Approved: ${resolvedFileType} File`,
          message: `Finance approved Sales Order ${finalizedOrder.orderNumber || finalizedOrder.orderReference} (${resolvedFileType} File). Routed to ${isBlue ? 'Global Purchaser' : 'Local Purchaser'} for Supplier PO creation.`,
          type: 'finance',
          link: '/employee/sales/orders'
        });
      }

      return res.status(200).json({
        success: true,
        message: `Sales Order approved as ${resolvedFileType} File! Routed to ${isBlue ? 'Global Purchaser Portal' : 'Local Purchaser Portal'}.${linkWarnings.length ? ` Linked-record warnings: ${linkWarnings.join(' ')}` : ''}`,
        data: finalizedOrder,
        linkWarnings
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

      if (activeReservations(order).length) {
        await releaseOrderReservations({ order, user: req.user, reason: reason || 'Order rejected by Finance.' });
      }
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
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error reviewing sales order.' });
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
    if (!ownsSalesRecord(order, req.user)) return ownershipDenied(res, 'sales orders');

    if (req.body.orderNumber && !req.body.orderReference) req.body.orderReference = req.body.orderNumber;
    if (req.body.orderReference && !req.body.orderNumber) req.body.orderNumber = req.body.orderReference;

    const changes = {};
    const allowedFields = [
      'orderReference', 'orderNumber', 'clientName', 'clientAddress', 'salePerson', 'suggestedFileType',
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

    if (releasesReservation(req.body.status) || releasesReservation(req.body.workflowStatus)) {
      await releaseOrderReservations({
        order,
        user: req.user,
        reason: `Order status changed to ${req.body.status || req.body.workflowStatus}.`
      });
    }

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
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error updating order.'
    });
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
    if (!ownsSalesRecord(order, req.user) && !canAccessDepartmentOrder(order, req.user, 'support')) {
      return ownershipDenied(res, 'sales orders');
    }
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

    const newStockStatus = stock.isFullyInStock ? 'Available' : 'Purchase Required';

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
 * @desc    Read-only stock preflight for one pending Delivery Note
 * @route   GET /api/sales-employee/delivery-notes/:id/stock-check
 */
const checkDeliveryNoteStock = async (req, res) => {
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery Note not found.' });
    if (!deliveryNote.salesOrder) {
      return res.status(409).json({ success: false, message: 'This Delivery Note is not linked to a Sales Order.' });
    }
    const order = await SalesOrder.findById(deliveryNote.salesOrder);
    if (!order) return res.status(404).json({ success: false, message: 'The linked Sales Order was not found.' });

    const stock = await getDeliveryNoteStockRequirements(deliveryNote, order);
    return res.status(200).json({
      success: true,
      data: {
        deliveryNoteId: deliveryNote._id,
        salesOrderId: order._id,
        isFullyInStock: stock.isFullyInStock,
        message: stock.message,
        items: stock.requirements.map(line => ({
          productName: line.item,
          requiredQty: line.requiredQty,
          availableQty: Number(line.availableQty) || 0,
          status: line.ambiguous
            ? 'Ambiguous Inventory Match'
            : (!line.inventoryItem ? 'Missing from Inventory' : (line.availableQty >= line.requiredQty ? 'In Stock' : 'Insufficient Stock')),
          inventoryItemId: line.inventoryItem?._id || null,
          inventoryName: line.inventoryItem?.name || '',
          inventorySku: line.inventoryItem?.sku || '',
          usedFallback: line.usedFallback === true
        })),
        shortages: stock.shortages
      }
    });
  } catch (error) {
    console.error('[Check Delivery Note Stock Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error checking Delivery Note inventory stock.' });
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
    if (!canAccessDepartmentOrder(order, req.user, 'support')) return ownershipDenied(res, 'Support queue sales orders');

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
    const conditions = [{
      goodsReceivedInOffice: { $ne: null },
      'goodsReceivedInOffice.received': true,
      $or: [{ currentDepartment: 'Support' }, { departmentResponsible: 'Support' }],
      deliveryStatus: { $nin: ['Delivered', 'Fully Delivered', 'Done'] }
    }];
    const isSupportQueueUser = req.user.role === 'support' || String(req.user.department || '').toLowerCase().includes('support');
    if (!isSupportQueueUser && !isGlobalSalesUser(req.user)) conditions.unshift(ownerScope(req.user._id));
    const candidates = await SalesOrder.find({ $and: conditions }).sort({ createdAt: -1 });
    const eligible = await Promise.all(candidates.map(async order => {
      const activeDeliveryNote = await DeliveryNote.exists({
        salesOrder: order._id,
        status: { $nin: ['Done', 'Delivered', 'Confirmed', 'Fully Delivered', 'Cancelled', 'Returned'] }
      });
      if (activeDeliveryNote) return null;
      const stock = await getDeliveryStockRequirements(order);
      if (!stock.requirements.some(line => line.requiredQty > 0)) return null;
      const responseOrder = order.toObject();
      responseOrder.deliveryRemainingItems = stock.requirements
        .filter(line => line.requiredQty > 0)
        .map(line => ({
          _id: line.orderItemId,
          description: line.item,
          quantity: line.requiredQty,
          originalOrderedQuantity: line.orderedQty,
          unitPrice: Number(order.items?.[line.itemIndex]?.unitPrice) || 0
        }));
      return responseOrder;
    }));
    const orders = eligible.filter(Boolean);

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
      filter = { $or: [{ createdBy: req.user._id }, { salesPerson: req.user._id }] };
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
  const session = await mongoose.startSession();
  let deliveryNote;
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
      operationType,
      sourceLocation,
      scheduledDate,
      deadline,
      expiryDate,
      productAvailability,
      sourceDocument,
      starred
    } = req.body;

    // A newly created DN is never proof of delivery. Only signed confirmation can deliver it.
    const dnStatus = 'Created';

    if (!salesOrderId || !mongoose.Types.ObjectId.isValid(salesOrderId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Sales Order in the Support stage is required to create a Delivery Note.'
      });
    }
    await session.withTransaction(async () => {
      const parentSo = await SalesOrder.findById(salesOrderId).populate('salesPerson').session(session);
      if (!parentSo) throw createHttpError(404, 'Sales Order not found.');
      if (isSalesUser(req.user) && !ownsSalesRecord(parentSo, req.user)) {
        throw createHttpError(403, 'Access denied. You can only create delivery notes for your own sales orders.');
      }
      if (parentSo.isOverdueBlocked) {
        throw createHttpError(400, `Cannot create Delivery Note: Sales Order ${parentSo.orderNumber || parentSo.orderReference} is on Finance HOLD due to overdue customer balance.`);
      }
      const isInSupport = parentSo.currentDepartment === 'Support' || parentSo.departmentResponsible === 'Support';
      if (!isInSupport || parentSo.goodsReceivedInOffice?.received !== true) {
        throw createHttpError(400, 'Delivery Notes can only be created after the Sales Order reaches Support and goods are received in office.');
      }
      const activeDeliveryNote = await DeliveryNote.findOne({
        salesOrder: parentSo._id,
        status: { $nin: ['Done', 'Delivered', 'Confirmed', 'Fully Delivered', 'Cancelled', 'Returned'] }
      }).session(session);
      if (activeDeliveryNote) {
        throw createHttpError(409, `Delivery Note ${activeDeliveryNote.deliveryNumber || activeDeliveryNote.deliveryNoteNumber} is still awaiting confirmation for this Sales Order.`);
      }

      const stock = await getDeliveryStockRequirements(parentSo, { session });
      const requestedItems = Array.isArray(items) ? items : [];
      const dnItems = stock.requirements.filter(line => line.requiredQty > 0).map(line => {
        const sourceItem = parentSo.items?.[line.itemIndex] || {};
        const requested = requestedItems.find((candidate, candidateIndex) =>
          (candidate.orderItemId && String(candidate.orderItemId) === line.orderItemId) || candidateIndex === line.itemIndex
        );
        const submittedQuantity = Number(requested?.quantity);
        if (Number.isFinite(submittedQuantity) && (submittedQuantity <= 0 || submittedQuantity > line.requiredQty)) {
          throw createHttpError(400, `${line.item}: delivery quantity must be between 1 and ${line.requiredQty}.`);
        }
        const quantity = Number.isFinite(submittedQuantity) ? submittedQuantity : line.requiredQty;
        if (!line.inventoryItem || line.ambiguous) {
          throw createHttpError(409, `${line.item}: ${line.ambiguous ? 'multiple normalized inventory matches exist' : 'no usable inventory item is linked'}.`);
        }
        const unitPrice = Number(sourceItem.unitPrice) || 0;
        return {
          product: line.item || 'Delivered Product', description: line.item || '', demand: line.requiredQty,
          quantity, unit: line.inventoryItem.unit || 'Units', availability: 'Available',
          totalOrderedQty: line.orderedQty, orderItemId: line.orderItemId, orderItemIndex: line.itemIndex,
          inventoryItem: line.inventoryItem._id, unitPrice, lineTotal: quantity * unitPrice,
          reservation: line.reservation
        };
      });
      if (!dnItems.length) throw createHttpError(409, 'All quantities on this Sales Order have already been delivered.');

      const deliveryNoteId = new mongoose.Types.ObjectId();
      for (const line of dnItems) {
        if (line.reservation) {
          const remaining = reservationRemaining(line.reservation);
          const inventoryItem = await InventoryItem.findById(line.inventoryItem).session(session);
          const usableReserved = Math.min(
            remaining,
            Number(inventoryItem?.quantityOnHand) || 0,
            Number(inventoryItem?.reservedQuantity) || 0
          );
          if (usableReserved < line.quantity) {
            throw createHttpError(409, `${line.product}: need ${line.quantity}, available ${usableReserved} in this order's active reservation.`);
          }
          continue;
        }
        const reservedInventory = await InventoryItem.findOneAndUpdate(
          {
            _id: line.inventoryItem,
            $expr: { $gte: [{ $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, { $ifNull: ['$reservedQuantity', 0] }] }, line.quantity] }
          },
          [
            { $set: { reservedQuantity: { $add: [{ $ifNull: ['$reservedQuantity', 0] }, line.quantity] } } },
            inventoryStatusStage
          ],
          { new: true, session }
        );
        if (!reservedInventory) {
          const currentInventory = await InventoryItem.findById(line.inventoryItem).session(session);
          throw createHttpError(409, `${line.product}: need ${line.quantity}, available ${availableInventoryQuantity(currentInventory)}.`);
        }
        parentSo.inventoryReservations.push({
          orderItemId: line.orderItemId,
          itemIndex: line.orderItemIndex,
          inventoryItem: line.inventoryItem,
          inventoryName: reservedInventory.name,
          deliveryNote: deliveryNoteId,
          quantity: line.quantity,
          remainingQuantity: line.quantity,
          deliveredQuantity: 0,
          releasedQuantity: 0,
          status: 'Reserved',
          reservedAt: new Date(),
          reservedBy: req.user._id,
          reservedByName: req.user.fullName || ''
        });
      }

      const cleanDnItems = dnItems.map(({ reservation, ...line }) => line);
      const remainingQuantity = stock.requirements.reduce((sum, line) => sum + line.requiredQty, 0);
      const deliveryQuantity = cleanDnItems.reduce((sum, line) => sum + line.quantity, 0);
      const subtotal = cleanDnItems.reduce((sum, line) => sum + line.lineTotal, 0);
      const orderSubtotal = (parentSo.items || []).reduce((sum, line) => sum + (Number(line.total) || ((Number(line.quantity) || 1) * (Number(line.unitPrice) || 0))), 0);
      const priceRatio = orderSubtotal > 0 ? Math.min(1, subtotal / orderSubtotal) : (remainingQuantity > 0 ? deliveryQuantity / remainingQuantity : 1);
      const created = await DeliveryNote.create([{
        _id: deliveryNoteId,
        salesOrder: parentSo._id,
        salesOrderNumber: parentSo.orderReference || parentSo.orderNumber || salesOrderNumber || '',
        sourceDocument: sourceDocument || parentSo.orderReference || parentSo.orderNumber || salesOrderNumber || '',
        clientName: parentSo.clientName || clientName || recipientName || '',
        recipientName: recipientName || clientName || '', recipientPhone: recipientPhone || '',
        deliveryAddress: deliveryAddress || '', trackingNumber: trackingNumber || '', carrier: carrier || '',
        operationType: operationType || 'Fortline: Delivery Orders', sourceLocation: sourceLocation || 'WH/Stock',
        scheduledDate: scheduledDate || deliveryDate || new Date(), deadline: deadline || scheduledDate || deliveryDate || new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        productAvailability: productAvailability || 'Available', starred: !!starred,
        deliveryDate: deliveryDate || scheduledDate || new Date(), items: cleanDnItems, subtotal,
        discount: Math.round((Number(parentSo.discount) || 0) * priceRatio * 100) / 100,
        tax: Math.round((Number(parentSo.tax) || 0) * priceRatio * 100) / 100,
        notes: notes || '', status: dnStatus, isPartial: deliveryQuantity < remainingQuantity, invoiced: false,
        fileType: parentSo.fileType || req.body.fileType || '',
        supplierPoNumber: parentSo.supplierPO?.poNumber || req.body.supplierPoNumber || '',
        blNumber: parentSo.blNumber || req.body.blNumber || '', shipmentId: parentSo.shipmentId || null,
        shipmentNumber: parentSo.shipmentNumber || '',
        salesPerson: parentSo.salesPerson?._id || parentSo.salesPerson || parentSo.createdBy || (req.user.department === 'Sales' ? req.user._id : null),
        salePerson: req.body.salePerson || parentSo.salePerson || parentSo.salesPerson?.fullName || (req.user.department === 'Sales' ? req.user.fullName : ''),
        createdBy: req.user._id
      }], { session });
      [deliveryNote] = created;

      parentSo.status = 'DN Created';
      parentSo.deliveryNoteId = deliveryNote._id;
      parentSo.deliveryNoteNumber = deliveryNote.deliveryNoteNumber || deliveryNote.deliveryNumber;
      parentSo.workflowStatus = 'DN Created';
      parentSo.departmentResponsible = 'Accounts';
      parentSo.currentDepartment = 'Accounts';
      parentSo.currentStatus = 'DELIVERY_NOTE_CREATED_IN_ACCOUNTS';
      parentSo.previousDepartment = 'Support';
      parentSo.previousStatus = 'Pending Delivery Note';
      parentSo.lastAction = `Delivery Note ${deliveryNote.deliveryNoteNumber || deliveryNote.deliveryNumber} Created by Support`;
      parentSo.lastActionBy = req.user._id;
      parentSo.lastActionByName = req.user.fullName;
      parentSo.lastActionAt = new Date();
      await parentSo.save({ session });
    });

    await logSalesActivity({
      type: 'Delivery Note Created',
      description: `Created delivery note ${deliveryNote.deliveryNoteNumber} — ${dnStatus}`,
      relatedModel: 'DeliveryNote',
      relatedId: deliveryNote._id,
      relatedCustomer: clientName || '',
      salesMemberName: req.user.fullName,
      performedBy: req.user._id
    });

    await notifySalesOwner({
      record: deliveryNote,
      recipient: deliveryNote.salesPerson || deliveryNote.createdBy,
      sender: req.user._id,
      title: 'Delivery Note Created',
      message: `${req.user.fullName} created delivery note ${deliveryNote.deliveryNoteNumber} — Status: ${dnStatus}.`,
      type: 'sales'
    });

    await notifyRoleHelper(['accountant', 'accounts', 'admin', 'ceo'], {
      type: 'invoice',
      title: 'Delivery Note Created — Order Ready for Accounts',
      message: `Delivery Note ${deliveryNote.deliveryNoteNumber} for Sales Order ${deliveryNote.salesOrderNumber} was created. Signed delivery confirmation may follow later.`,
      link: '/accounts/orders-ready',
      sender: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Delivery note created successfully.', data: deliveryNote });
  } catch (error) {
    console.error('[Create Delivery Note Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error creating delivery note.' });
  } finally {
    await session.endSession();
  }
};

// ══════════════════════════════════════════════
// FOLLOW-UPS
// ══════════════════════════════════════════════
const getMyFollowUps = async (req, res) => {
  try {
    const followUps = await FollowUp.find(isGlobalSalesUser(req.user) ? {} : { createdBy: req.user._id })
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
    if (isGlobalSalesUser(req.user)) {
      const allTargets = await SalesTarget.find({})
        .populate('employee', 'fullName email role')
        .populate('assignedBy', 'fullName')
        .sort({ createdAt: -1 });
      return res.status(200).json({ success: true, count: allTargets.length, data: allTargets });
    }
    let targets = await SalesTarget.find({ employee: userId })
      .populate('assignedBy', 'fullName')
      .sort({ createdAt: -1 });

    // Calculate actual achieved amount from deals, orders, and invoices
    const [deals, orders, invoices] = await Promise.all([
      Deal.find({ $and: [ownerScope(userId), { stage: { $in: ['Won', 'Closed Won'] } }] }),
      SalesOrder.find({ $and: [ownerScope(userId), { status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Sales Order'] } }] }),
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
    const activities = await SalesActivity.find(isGlobalSalesUser(req.user) ? {} : { performedBy: req.user._id })
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
        const [leads, quotations, orders, deals, followUps, activeTarget, invoices, payroll] = await Promise.all([
          Lead.find(ownerScope(empId)),
          Quotation.find(ownerScope(empId)),
          SalesOrder.find(ownerScope(empId)),
          Deal.find(ownerScope(empId)),
          FollowUp.find({ createdBy: empId }),
          SalesTarget.findOne({ employee: empId, status: { $in: ['Active', 'Ongoing'] } }).sort({ createdAt: -1 }),
          Invoice.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }),
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
    const [leads, quotations, orders, deliveryNotes, followUps, targets, activities, invoices, deals, customerPOs, productFiles, payments, payroll] = await Promise.all([
      Lead.find(ownerScope(empId)).sort({ createdAt: -1 }),
      Quotation.find(ownerScope(empId)).sort({ creationDate: -1, createdAt: -1 }),
      SalesOrder.find(ownerScope(empId)).sort({ creationDate: -1, createdAt: -1 }),
      DeliveryNote.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }).populate('salesOrder', 'orderNumber orderReference').sort({ createdAt: -1 }),
      FollowUp.find({ createdBy: empId }).populate('lead', 'name company').sort({ scheduledAt: 1 }),
      SalesTarget.find({ employee: empId }).populate('assignedBy', 'fullName').sort({ createdAt: -1 }),
      SalesActivity.find({ performedBy: empId }).sort({ createdAt: -1 }).limit(50),
      Invoice.find({ $or: [{ createdBy: empId }, { salesPerson: empId }] }).sort({ createdAt: -1 }),
      Deal.find(ownerScope(empId)).sort({ createdAt: -1 }),
      CustomerPO.find(ownerScope(empId)).sort({ createdAt: -1 }),
      ProductFile.find(ownerScope(empId)).sort({ createdAt: -1 }),
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
    if (isSalesUser(req.user) && !ownsSalesRecord(invoice, req.user)) {
      return ownershipDenied(res, 'invoices');
    }

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
    const linkedDN = await DeliveryNote.findOne({ salesOrder: order._id });
    if (linkedDN) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Delivery Note (${linkedDN.deliveryNumber || linkedDN.deliveryNoteNumber}) is linked to it.`
      });
    }

    const linkedInv = await Invoice.findOne({ salesOrderId: order._id });
    if (linkedInv) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Sales Order because Invoice (${linkedInv.invoiceNumber}) is linked to it.`
      });
    }

    if (activeReservations(order).length) {
      await releaseOrderReservations({ order, user: req.user, reason: 'Sales Order deleted.' });
      await order.save();
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
  const session = await mongoose.startSession();
  try {
    const deliveryNote = await DeliveryNote.findById(req.params.id);
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    if (isSalesUser(req.user) && !ownsSalesRecord(deliveryNote, req.user)) {
      return ownershipDenied(res, 'delivery notes');
    }

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

    let savedDeliveryNote;
    await session.withTransaction(async () => {
      const currentDeliveryNote = await DeliveryNote.findById(req.params.id).session(session);
      if (!currentDeliveryNote) throw createHttpError(404, 'Delivery Note not found.');
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) currentDeliveryNote[field] = req.body[field];
      });
      if (releasesReservation(req.body.status) && currentDeliveryNote.salesOrder) {
        const order = await SalesOrder.findById(currentDeliveryNote.salesOrder).session(session);
        if (order) {
          await releaseDeliveryNoteReservations({
            order,
            deliveryNoteId: currentDeliveryNote._id,
            user: req.user,
            reason: `Delivery Note marked ${req.body.status}.`,
            session
          });
          order.status = req.body.status;
          order.workflowStatus = req.body.status;
          order.currentDepartment = 'Support';
          order.departmentResponsible = 'Support';
          await order.save({ session });
        }
      }
      savedDeliveryNote = await currentDeliveryNote.save({ session });
    });
    return res.status(200).json({ success: true, message: 'Delivery note updated.', data: savedDeliveryNote });
  } catch (error) {
    console.error('[Update Delivery Note Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error updating delivery note.' });
  } finally {
    await session.endSession();
  }
};

const updateDeliveryNoteExpiry = async (req, res) => {
  try {
    const rawExpiryDate = req.body.expiryDate;
    let expiryDate = null;
    if (rawExpiryDate) {
      expiryDate = new Date(rawExpiryDate);
      if (Number.isNaN(expiryDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Expiry date must be a valid calendar date.' });
      }
    }
    const deliveryNote = await DeliveryNote.findByIdAndUpdate(
      req.params.id,
      { $set: { expiryDate } },
      { new: true, runValidators: true }
    );
    if (!deliveryNote) return res.status(404).json({ success: false, message: 'Delivery note not found.' });
    return res.status(200).json({ success: true, message: 'Delivery Note expiry date updated.', data: deliveryNote });
  } catch (error) {
    console.error('[Update Delivery Note Expiry Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating Delivery Note expiry date.' });
  }
};

const deleteMyDeliveryNote = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const deliveryNote = await DeliveryNote.findById(req.params.id).session(session);
      if (!deliveryNote) throw createHttpError(404, 'Delivery Note not found.');
      if (!checkOwnership(deliveryNote, 'createdBy', req.user._id, req.user)) {
        throw createHttpError(403, 'Access denied. You can only delete your own delivery notes.');
      }
      if (deliveryNote.salesOrder) {
        const order = await SalesOrder.findById(deliveryNote.salesOrder).session(session);
        if (order) {
          await releaseDeliveryNoteReservations({
            order,
            deliveryNoteId: deliveryNote._id,
            user: req.user,
            reason: `Delivery Note ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber} deleted.`,
            session
          });
          order.status = 'Pending Delivery Note';
          order.workflowStatus = 'Pending Delivery Note';
          order.currentDepartment = 'Support';
          order.departmentResponsible = 'Support';
          await order.save({ session });
        }
      }
      await DeliveryNote.deleteOne({ _id: deliveryNote._id }).session(session);
    });
    return res.status(200).json({ success: true, message: 'Delivery note deleted successfully.' });
  } catch (error) {
    console.error('[Delete Delivery Note Error]:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Server error deleting delivery note.' });
  } finally {
    await session.endSession();
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
    const conditions = [];
    if (isGlobalSalesUser(req.user) && employeeId) conditions.push(ownerScope(employeeId));

    if (status === 'active' || !status) {
      conditions.push({ status: { $nin: ['Processed'] } });
    } else if (status === 'processed') {
      conditions.push({ status: 'Processed' });
    } else if (status && status !== 'all') {
      conditions.push({ status });
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [{ poNumber: regex }, { customerName: regex }, { quotationNumber: regex }] });
    }
    const query = applyOwnerScope(conditions, req.user);
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
    if (linkedQuotation && !ownsSalesRecord(linkedQuotation, req.user)) return ownershipDenied(res, 'quotations');

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
      owner: linkedQuotation ? effectiveOwnerId(linkedQuotation) : req.user._id,
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

    await notifySalesOwner({
      record: po,
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
    const conditions = [];
    if (isGlobalSalesUser(req.user) && employeeId) conditions.push(ownerScope(employeeId));

    if (status === 'active' || !status) {
      conditions.push({ status: { $nin: ['Completed', 'Cancelled'] } });
    } else if (status === 'completed') {
      conditions.push({ status: 'Completed' });
    } else if (status && status !== 'all') {
      conditions.push({ status });
    }

    if (fileType && fileType !== 'all') conditions.push({ fileType });
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [{ fileNumber: regex }, { customerName: regex }] });
    }
    const query = applyOwnerScope(conditions, req.user);
    const files = await ProductFile.find(query).populate('createdBy', 'fullName email').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: files.length, data: files });
  } catch (error) {
    console.error('[Get ProductFiles Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching product files.' });
  }
};

const createMyProductFile = async (req, res) => {
  try {
    const { customerName, quotationId, quotationNumber, customerPOId, customerPONumber, salesOrderId, salesOrderNumber, products, notes } = req.body;
    if (!customerName) return res.status(400).json({ success: false, message: 'Customer name is required.' });

    const safeQuotationId = quotationId && mongoose.Types.ObjectId.isValid(quotationId) ? quotationId : null;
    const safeCustomerPOId = customerPOId && mongoose.Types.ObjectId.isValid(customerPOId) ? customerPOId : null;
    const safeSalesOrderId = salesOrderId && mongoose.Types.ObjectId.isValid(salesOrderId) ? salesOrderId : null;

    const customerPO = safeCustomerPOId ? await CustomerPO.findById(safeCustomerPOId) : null;
    if (!customerPO || !hasValidCustomerPOAttachment(customerPO)) {
      return res.status(400).json({ success: false, message: CUSTOMER_PO_ATTACHMENT_MESSAGE });
    }
    if (!ownsSalesRecord(customerPO, req.user)) return ownershipDenied(res, 'customer POs');
    const linkedQuotationId = safeQuotationId || customerPO.quotationId || null;
    const linkedQuotation = linkedQuotationId ? await Quotation.findById(linkedQuotationId) : null;
    if (linkedQuotation && !ownsSalesRecord(linkedQuotation, req.user)) return ownershipDenied(res, 'quotations');
    const resolvedFileType = customerPO.fileType || linkedQuotation?.fileType || '';
    const resolvedFileNumber = customerPO.fileNumber || linkedQuotation?.fileNo || await allocateFileNumber();

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
      owner: effectiveOwnerId(customerPO),
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

    await notifySalesOwner({
      record: pf,
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

    const allowedFields = ['customerName', 'quotationNumber', 'customerPONumber', 'salesOrderNumber', 'products', 'notes', 'status'];
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

    await notifySalesOwner({
      record: pf,
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
    const isManagerOrAdmin = ['admin', 'ceo', 'finance', 'accountant'].includes(req.user.role) ||
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

    await notifyRoleHelper(['finance', 'accountant', 'admin', 'ceo'], {
      role: 'finance',
      sender: req.user._id,
      title: 'Payment Recorded',
      message: `Payment of PKR ${Number(amount).toFixed(2)} recorded for Invoice ${payment.invoiceNumber || 'Direct'}.`,
      type: 'finance',
      link: '/finance/payments'
    });
    await notifySalesOwner({
      record: payment,
      recipient: payment.salesPerson || payment.createdBy,
      sender: req.user._id,
      title: 'Payment Recorded',
      message: `Payment of PKR ${Number(amount).toFixed(2)} recorded for Invoice ${payment.invoiceNumber || 'Direct'}.`,
      type: 'finance',
      link: '/sales/payments'
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
      query = { createdBy: req.user._id };
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

    await notifySalesOwner({
      record: salesOrder,
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
    if (!ownsSalesRecord(order, req.user)) return ownershipDenied(res, 'sales orders');

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
    if (!ownsSalesRecord(order, req.user)) return ownershipDenied(res, 'sales orders');

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
    await withGrnDuplicateRecovery(session, async () => {
      const order = await SalesOrder.findById(req.params.id).session(session);
      if (!order) throw createHttpError(404, 'Sales order not found.');
      if (!canAccessDepartmentOrder(order, req.user, 'support')) throw createHttpError(403, 'Access denied. This order is not in the Support queue.');
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

      const submittedExpenses = Array.isArray(req.body.expenses) ? req.body.expenses : [];
      if (submittedExpenses.length && !supplierPO) {
        throw createHttpError(409, 'Expenses cannot be recorded because this order is not linked to a Supplier PO.');
      }
      if (submittedExpenses.length) {
        if (!canAccessPO(req.user, supplierPO, 'add')) {
          throw createHttpError(403, 'You cannot add costs to this Supplier PO.');
        }
        for (const expense of submittedExpenses) {
          expense.category = await ensureCategoryAvailable(expense.category, req.user, session);
        }
        await appendExpenseLines({
          po: supplierPO,
          inputs: submittedExpenses,
          user: req.user,
          grn: createdGrns[0],
          session
        });
      }

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
    if (!canAccessDepartmentOrder(order, req.user, 'support')) return ownershipDenied(res, 'Support queue sales orders');

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
    if (!ownsSalesRecord(order, req.user)) return ownershipDenied(res, 'sales orders');

    if (order.isOverdueBlocked) {
      return res.status(400).json({ success: false, message: 'Cannot issue Supplier PO: Order is on Finance HOLD.' });
    }
    if (!['Green', 'Blue'].includes(order.fileType)) {
      return res.status(409).json({ success: false, message: 'Finance must assign Green or Blue before a Supplier PO can be issued.' });
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
    const issuingCompany = resolvePOCompany({
      poType: isBlue ? 'Global' : 'Local',
      requestedCompanyCode: req.body.issuingCompanyCode,
      order
    });
    const poNum = isBlue
      ? await allocateGlobalPoNumber()
      : (req.body.poNumber || `LPO-${Date.now().toString().slice(-6)}`);
    const poItems = (items && items.length > 0 ? items : (order.items || [])).map(item => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || 0;
      return {
        productName: item.productName || item.description || 'Product Item',
        description: item.description || '',
        quantity,
        unitPrice,
        totalAmount: Number(item.totalAmount ?? item.total) || quantity * unitPrice
      };
    });
    const itemSubtotal = poItems.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    const subtotal = isBlue
      ? (itemSubtotal || Number(totalAmount) || order.netAmount || order.totalAmount || 0)
      : (Number(totalAmount) || order.netAmount || order.totalAmount || 0);
    const requestedVatRate = Number(req.body.vatRate || 0);
    if (isBlue && (!Number.isFinite(requestedVatRate) || requestedVatRate < 0 || requestedVatRate > 100)) {
      return res.status(400).json({ success: false, message: 'VAT percentage must be between 0 and 100.' });
    }
    const vatRate = isBlue ? requestedVatRate : 0;
    const vatAmount = Math.round((subtotal * vatRate / 100 + Number.EPSILON) * 100) / 100;
    const poTotal = Math.round((subtotal + vatAmount + Number.EPSILON) * 100) / 100;

    const supplierPODocument = await SupplierPO.create({
      poNumber: poNum,
      supplierName: supplierName || (isBlue ? 'International Supplier' : 'Local Supplier'),
      supplierCountry: supplierCountry || (isBlue ? 'China' : 'Pakistan'),
      supplierEmail: supplierEmail || '',
      supplierPhone: supplierPhone || '',
      poType: isBlue ? 'Global' : 'Local',
      items: poItems,
      subtotal,
      vatRate,
      vatAmount,
      totalAmount: poTotal,
      total: poTotal,
      salesOrderId: order._id,
      salesOrderNumber: order.orderNumber || order.orderReference || '',
      status: 'Issued',
      notes: notes || '',
      issuingCompany,
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });

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
      items: poItems.map(item => ({
        description: item.description || item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.totalAmount
      })),
      subtotal,
      vatRate,
      vatAmount,
      total: poTotal,
      totalAmount: poTotal,
      currency: 'PKR',
      notes: notes || '',
      issuingCompany,
      issuedBy: req.user._id,
      issuedByName: req.user.fullName,
      issuedAt: new Date()
    };
    order.supplierPoId = supplierPODocument._id;
    order.supplierPoNumber = poNum;

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
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : 'Server error issuing supplier PO.' });
  }
};

const getSupportStats = async (req, res) => {
  try {
    const data = await getSupportDashboardMetrics({ month: req.query.month });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[Get Support Stats Error]:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Server error fetching support stats.'
    });
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
    await withGrnDuplicateRecovery(session, async () => {
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

const confirmDeliveryNoteWithInventoryR7 = async (req, res) => {
  const session = await mongoose.startSession();
  let confirmedDeliveryNote;
  try {
    const signedDocument = req.body.signedDeliveryNoteDocument;
    const signedDocumentName = req.body.signedDeliveryNoteDocumentName;
    if (!hasValidSignedDeliveryNoteAttachment(signedDocument, signedDocumentName)) {
      return res.status(400).json({ success: false, message: SIGNED_DN_ATTACHMENT_MESSAGE });
    }

    await session.withTransaction(async () => {
      const deliveryNote = await DeliveryNote.findOneAndUpdate(
        {
          _id: req.params.id,
          isStockDeducted: { $ne: true },
          status: { $nin: ['Done', 'Delivered', 'Confirmed', 'Fully Delivered'] }
        },
        { $set: { isStockDeducted: true, stockDeductionClaimedAt: new Date() } },
        { new: true, session }
      );
      if (!deliveryNote) {
        const exists = await DeliveryNote.exists({ _id: req.params.id }).session(session);
        throw createHttpError(exists ? 409 : 404, exists ? 'Delivery Note is already confirmed or its stock deduction was already claimed.' : 'Delivery Note not found.');
      }
      if (!deliveryNote.salesOrder) throw createHttpError(400, 'A linked Sales Order is required before this Delivery Note can be confirmed.');

      const order = await SalesOrder.findById(deliveryNote.salesOrder).session(session);
      if (!order) throw createHttpError(404, 'The Sales Order linked to this Delivery Note was not found.');

      const dnStock = await getDeliveryNoteStockRequirements(deliveryNote, order, { session });
      if (!dnStock.isFullyInStock) throw createHttpError(409, dnStock.message);
      const deductions = (deliveryNote.items || []).map((item, itemIndex) => {
        const requirement = dnStock.requirements[itemIndex];
        return {
          item,
          itemIndex,
          requirement,
          inventoryItemId: requirement?.inventoryItem?._id,
          quantity: Number(item.quantity) || Number(item.demand) || 0,
          reservation: requirement?.reservation || null
        };
      });

      if (!deductions.length || deductions.some(entry => !entry.inventoryItemId || entry.quantity <= 0)) {
        throw createHttpError(409, 'The Delivery Note contains an unlinked inventory line. Link or receive the item before confirming delivery.');
      }

      for (const deduction of deductions) {
        const { inventoryItemId, quantity, reservation, item } = deduction;
        const usesReservation = Boolean(reservation && reservationRemaining(reservation) > 0);
        if (usesReservation && quantity > reservationRemaining(reservation)) {
          throw createHttpError(409, `${item.product || item.description}: delivery quantity exceeds this order's remaining reservation.`);
        }

        const inventoryCondition = usesReservation
          ? { _id: inventoryItemId, quantityOnHand: { $gte: quantity }, reservedQuantity: { $gte: quantity } }
          : {
              _id: inventoryItemId,
              $expr: { $gte: [{ $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, { $ifNull: ['$reservedQuantity', 0] }] }, quantity] }
            };
        const stockUpdate = usesReservation
          ? {
              quantityOnHand: { $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, quantity] },
              reservedQuantity: { $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, quantity] }
            }
          : {
              quantityOnHand: { $subtract: [{ $ifNull: ['$quantityOnHand', 0] }, quantity] }
            };
        const updated = await InventoryItem.findOneAndUpdate(
          inventoryCondition,
          [
            {
              $set: {
                ...stockUpdate,
                stockMovements: {
                  $concatArrays: [
                    { $ifNull: ['$stockMovements', []] },
                    [{
                      type: 'OUT',
                      quantity,
                      reference: deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber || '',
                      salesOrder: order._id,
                      orderNumber: order.orderNumber || order.orderReference || '',
                      remarks: usesReservation
                        ? 'Delivered from stock reserved for this Sales Order.'
                        : 'Stock deducted on signed Delivery Note confirmation.',
                      performedBy: req.user._id,
                      performedByName: req.user.fullName || '',
                      timestamp: new Date()
                    }]
                  ]
                }
              }
            },
            inventoryStatusStage
          ],
          { new: true, session }
        );
        if (!updated) {
          throw createHttpError(409, `${item.product || item.description}: stock or reservation changed before confirmation. Refresh and try again.`);
        }

        if (usesReservation) {
          reservation.remainingQuantity = reservationRemaining(reservation) - quantity;
          reservation.deliveredQuantity = (Number(reservation.deliveredQuantity) || 0) + quantity;
          reservation.status = reservation.remainingQuantity > 0 ? 'Partially Fulfilled' : 'Fulfilled';
        }
      }

      deliveryNote.status = 'Done';
      deliveryNote.deliveryDate = new Date();
      deliveryNote.receivedBy = req.body.receivedBy || req.user.fullName;
      deliveryNote.signedDeliveryNoteDocument = signedDocument;
      deliveryNote.signedDeliveryNoteDocumentName = signedDocumentName.trim();
      deliveryNote.signedDeliveryNoteUploadedAt = new Date();
      deliveryNote.signedDeliveryNoteUploadedBy = req.user._id;
      deliveryNote.signedDeliveryNoteUploadedByName = req.user.fullName || '';
      await deliveryNote.save({ session });

      const remainingRequirements = await getDeliveryStockRequirements(order, { session });
      const fullyDelivered = remainingRequirements.requirements.every(line => line.requiredQty <= 0);

      const previousStatus = order.workflowStatus || 'Delivery Note Created';
      order.deliveryStatus = fullyDelivered ? 'Delivered' : 'Partially Delivered';
      order.workflowStatus = fullyDelivered ? 'Delivered' : 'Partially Delivered';
      order.status = fullyDelivered ? 'Delivered' : 'Partially Delivered';
      order.departmentResponsible = fullyDelivered ? 'Accounts' : 'Support';
      order.currentDepartment = fullyDelivered ? 'Accounts' : 'Support';
      order.currentStatus = fullyDelivered ? 'DELIVERED_SIGNED_DN' : 'PARTIAL_DELIVERY_AWAITING_NEXT_DN';
      order.lastAction = fullyDelivered
        ? `Delivery confirmed with signed Delivery Note ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber}`
        : `Partial delivery confirmed with ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber}; remaining stock stays reserved`;
      order.lastActionBy = req.user._id;
      order.lastActionByName = req.user.fullName || '';
      order.lastActionAt = new Date();
      order.workflowHistory.push({
        user: req.user._id,
        userName: req.user.fullName,
        department: 'Support',
        action: fullyDelivered ? 'Delivery Confirmed' : 'Partial Delivery Confirmed',
        previousStatus,
        newStatus: order.workflowStatus,
        timestamp: new Date(),
        notes: fullyDelivered
          ? `Signed Delivery Note ${deliveryNote.deliveryNumber || deliveryNote.deliveryNoteNumber} confirmed.`
          : 'Only the delivered quantity was deducted; the remaining order quantity stays reserved.'
      });
      await order.save({ session });
      confirmedDeliveryNote = deliveryNote;
    });

    return res.status(200).json({
      success: true,
      message: `Delivery Note ${confirmedDeliveryNote.deliveryNumber || confirmedDeliveryNote.deliveryNoteNumber} confirmed and stock updated.`,
      data: confirmedDeliveryNote
    });
  } catch (error) {
    console.error('[Confirm Delivery Note R7 Error]:', error);
    return res.status(error.statusCode || (error.code === 112 ? 409 : 500)).json({
      success: false,
      message: error.statusCode ? error.message : (error.code === 112 ? 'Delivery confirmation conflicted with another request. Refresh and try again.' : 'Server error confirming delivery note.')
    });
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

    // Accounts receives the DN at creation; signed confirmation can follow later.
    const dnReceivedQuery = { status: { $in: ['Created', 'Done', 'Confirmed', 'Delivered', 'Ready'] } };
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

    await notifyRoleHelper(['accountant', 'accounts', 'admin', 'ceo'], {
      type: 'invoice',
      title: 'Invoice Finalized',
      message: `Finance finalized Invoice ${invoice.invoiceNumber}.`,
      link: '/finance/invoices',
      sender: req.user._id
    });
    await notifySalesOwner({
      record: invoice,
      recipient: invoice.salesPerson || invoice.createdBy,
      type: 'invoice',
      title: 'Invoice Finalized',
      message: `Finance finalized Invoice ${invoice.invoiceNumber}.`,
      link: '/sales/invoices',
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
    const departmentAccess = ['accounts', 'finance', 'support', 'logistics', 'purchaser']
      .some(department => canAccessDepartmentOrder(order, req.user, department));
    if (!ownsSalesRecord(order, req.user) && !departmentAccess) return ownershipDenied(res, 'sales orders');

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
      fileType: order.fileType || '',
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
  getQuotationForwardTargets,
  forwardQuotation,
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
  checkDeliveryNoteStock,
  getGoodsReceivingPreview,
  getAvailableOrdersForDelivery,
  getMyProformaInvoices,
  createMyProformaInvoice,
  updateMyProformaInvoice,
  deleteMyProformaInvoice,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  updateMyDeliveryNote,
  updateDeliveryNoteExpiry,
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
  confirmDeliveryNoteWithInventory: confirmDeliveryNoteWithInventoryR7,
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
