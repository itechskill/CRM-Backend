const mongoose = require('mongoose');
const SupplierPO = require('../models/SupplierPO');
const User = require('../models/User');
const Notification = require('../models/Notification');

const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  'Freight', 'GST', 'Miscellaneous', 'Delivery', 'Other',
  'TCS', 'Customs Clearance', 'Customs Duty'
]);
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_LINE = 3;

const normalizeCategoryKey = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const moneyToCents = value => Math.round((Number(value) || 0) * 100);
const centsToMoney = value => (Number(value) || 0) / 100;
const firstMeaningfulMoney = (...values) => {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.find(value => value !== 0) ?? numbers[0] ?? 0;
};
const poSubtotalCents = po => moneyToCents(firstMeaningfulMoney(po?.subtotal, po?.totalAmount, po?.total));
const poTotalCents = po => moneyToCents(firstMeaningfulMoney(po?.total, po?.totalAmount, po?.subtotal));

const attachmentBytes = attachment => {
  const data = String(attachment?.data || '');
  if (!/^data:[^;,]+;base64,/i.test(data)) return Number.POSITIVE_INFINITY;
  const encoded = data.slice(data.indexOf(',') + 1);
  return Buffer.byteLength(encoded, 'base64');
};

const sanitizeAttachments = attachments => {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENTS_PER_LINE) {
    const error = new Error(`Each expense may have at most ${MAX_ATTACHMENTS_PER_LINE} attachments.`);
    error.statusCode = 400;
    throw error;
  }
  return list.map(attachment => {
    const size = attachmentBytes(attachment);
    if (!attachment?.name || !attachment?.data || size > MAX_ATTACHMENT_BYTES) {
      const error = new Error('Every attachment needs a name and file data and must be no larger than 3 MB.');
      error.statusCode = 400;
      throw error;
    }
    return {
      name: String(attachment.name).trim(),
      mimeType: String(attachment.mimeType || 'application/octet-stream').trim(),
      size,
      data: String(attachment.data)
    };
  });
};

const buildExpenseValues = (input, po) => {
  const category = String(input?.category || '').trim();
  if (!category) {
    const error = new Error('Expense category is required.');
    error.statusCode = 400;
    throw error;
  }
  const calculationType = input?.calculationType === 'Percentage' ? 'Percentage' : 'Fixed';
  const percentage = calculationType === 'Percentage' ? Number(input?.percentage) : 0;
  let amountCents = calculationType === 'Fixed'
    ? (input?.amount !== undefined ? moneyToCents(input.amount) : (Number.isInteger(input?.amountCents) ? input.amountCents : 0))
    : 0;
  if (calculationType === 'Percentage') {
    if (!Number.isFinite(percentage) || percentage < 0) {
      const error = new Error('Expense percentage must be zero or greater.');
      error.statusCode = 400;
      throw error;
    }
    amountCents = Math.round(poSubtotalCents(po) * percentage / 100);
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    const error = new Error('Expense amount must be a valid non-negative monetary value.');
    error.statusCode = 400;
    throw error;
  }
  const currency = calculationType === 'Percentage' ? 'PKR' : String(input?.currency || 'PKR').trim().toUpperCase();
  const exchangeRateToPKR = currency === 'PKR' || calculationType === 'Percentage' ? 1 : Number(input?.exchangeRateToPKR);
  if (!currency || !Number.isFinite(exchangeRateToPKR) || exchangeRateToPKR <= 0) {
    const error = new Error('A positive exchange rate to PKR is required for non-PKR expenses.');
    error.statusCode = 400;
    throw error;
  }
  return {
    category,
    description: String(input?.description || '').trim(),
    calculationType,
    amountCents,
    percentage,
    taxable: input?.taxable === true,
    currency,
    exchangeRateToPKR,
    amountPKRCents: Math.round(amountCents * exchangeRateToPKR),
    remarks: String(input?.remarks || '').trim(),
    attachments: sanitizeAttachments(input?.attachments)
  };
};

const summarizeExpenses = po => {
  const active = (po?.expenses || []).filter(expense => !expense.isDeleted);
  const totalExpensesPKRCents = active.reduce((sum, expense) => sum + (Number(expense.amountPKRCents) || 0), 0);
  const taxableExpensesPKRCents = active.filter(expense => expense.taxable)
    .reduce((sum, expense) => sum + (Number(expense.amountPKRCents) || 0), 0);
  const purchaseTotalPKRCents = poTotalCents(po);
  return {
    subtotalPKRCents: poSubtotalCents(po),
    taxableExpensesPKRCents,
    totalExpensesPKRCents,
    purchaseTotalPKRCents,
    landedCostPKRCents: purchaseTotalPKRCents + totalExpensesPKRCents
  };
};

const resolveSupplierPO = async (supplierPOOrSalesOrder, session = null) => {
  if (!supplierPOOrSalesOrder) return null;
  if (Array.isArray(supplierPOOrSalesOrder.expenses) || supplierPOOrSalesOrder.poType) return supplierPOOrSalesOrder;
  const order = supplierPOOrSalesOrder;
  let query = null;
  if (order.supplierPoId && mongoose.Types.ObjectId.isValid(order.supplierPoId)) query = SupplierPO.findById(order.supplierPoId);
  else if (order._id) query = SupplierPO.findOne({ salesOrderId: order._id }).sort({ createdAt: -1 });
  else if (order.supplierPO?.poNumber) query = SupplierPO.findOne({ poNumber: order.supplierPO.poNumber });
  return query ? query.session(session || null) : null;
};

// Returns PKR as a decimal number for reporting consumers; all persisted arithmetic remains integer cents.
const totalCostPKR = async (supplierPOOrSalesOrder, options = {}) => {
  const po = await resolveSupplierPO(supplierPOOrSalesOrder, options.session);
  if (!po) return 0;
  const summary = summarizeExpenses(po);
  const currency = String(po.currency || 'PKR').trim().toUpperCase();
  const exchangeRateToPKR = currency === 'PKR' ? 1 : Number(po.exchangeRateToPKR);
  if (!Number.isFinite(exchangeRateToPKR) || exchangeRateToPKR <= 0) return null;
  return centsToMoney(
    Math.round(summary.purchaseTotalPKRCents * exchangeRateToPKR) + summary.totalExpensesPKRCents
  );
};

const notifyAdminsOfExpense = async ({ po, expense, action, user, oldValues = null, newValues = null, session = null }) => {
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').session(session || null);
  if (!admins.length) return;
  const oldAmount = oldValues ? centsToMoney(oldValues.amountPKRCents) : null;
  const newAmount = newValues ? centsToMoney(newValues.amountPKRCents) : null;
  const valueText = action === 'Removed'
    ? `PKR ${oldAmount ?? 0} -> removed`
    : (oldAmount === null ? `new PKR ${newAmount ?? 0}` : `PKR ${oldAmount} -> PKR ${newAmount ?? 0}`);
  await Notification.insertMany(admins.map(admin => ({
    recipient: admin._id,
    sender: user._id,
    title: `Supplier PO expense ${action.toLowerCase()}`,
    message: `${po.poNumber} / ${po.salesOrderNumber || 'no order'}: ${expense.category} (${valueText}) by ${user.fullName || user.email || user.role}.`,
    type: 'system',
    link: '/admin/supplier-po-expenses',
    data: {
      supplierPOId: po._id,
      poNumber: po.poNumber,
      salesOrderNumber: po.salesOrderNumber || '',
      expenseId: expense._id,
      category: expense.category,
      action,
      oldValues,
      newValues,
      changedBy: user._id,
      changedByName: user.fullName || ''
    },
    isRead: false
  })), session ? { session } : undefined);
};

const appendExpenseLines = async ({ po, inputs, user, grn = null, session = null }) => {
  const added = [];
  for (const input of (Array.isArray(inputs) ? inputs : [])) {
    const values = buildExpenseValues(input, po);
    po.expenses.push({
      ...values,
      grn: grn?._id || null,
      grnNumber: grn?.grnNumber || '',
      addedBy: user._id,
      addedByName: user.fullName || '',
      addedAt: new Date(),
      editHistory: [{ action: 'Added', changedBy: user._id, changedByName: user.fullName || '', newValues: valuesForHistory(values) }]
    });
    added.push(po.expenses[po.expenses.length - 1]);
  }
  if (added.length) {
    await po.save({ session });
    for (const expense of added) {
      await notifyAdminsOfExpense({ po, expense, action: 'Added', user, newValues: valuesForHistory(expense), session });
    }
  }
  return added;
};

const valuesForHistory = expense => ({
  category: expense.category,
  description: expense.description,
  calculationType: expense.calculationType,
  amountCents: expense.amountCents,
  percentage: expense.percentage,
  taxable: expense.taxable,
  currency: expense.currency,
  exchangeRateToPKR: expense.exchangeRateToPKR,
  amountPKRCents: expense.amountPKRCents,
  remarks: expense.remarks,
  attachments: (expense.attachments || []).map(item => ({ name: item.name, mimeType: item.mimeType, size: item.size }))
});

module.exports = {
  DEFAULT_EXPENSE_CATEGORIES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_LINE,
  normalizeCategoryKey,
  moneyToCents,
  centsToMoney,
  buildExpenseValues,
  summarizeExpenses,
  totalCostPKR,
  notifyAdminsOfExpense,
  appendExpenseLines,
  valuesForHistory
};
