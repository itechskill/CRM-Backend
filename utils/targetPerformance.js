const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const SalesOrder = require('../models/SalesOrder');
const SupplierPO = require('../models/SupplierPO');
const { moneyToCents, summarizeExpenses, totalCostPKR } = require('./purchaseExpenses');
const { resolveStockInvoiceCost, resolveStockInvoiceCosts } = require('./inventoryCosting');

const SALES_ROLES = ['employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager'];
const DAY_MS = 24 * 60 * 60 * 1000;
const PERFORMANCE_CACHE_TTL_MS = 45 * 1000;
const performanceCache = new Map();

const invalidateTargetPerformanceCache = () => performanceCache.clear();

const idString = value => String(value?._id || value || '');
const safeCents = value => Number.isSafeInteger(value) ? value : 0;
const utcDay = value => {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};
const addCalendarDays = (value, days) => new Date(utcDay(value) + days * DAY_MS);
const calendarDaysBetween = (from, to) => Math.floor((utcDay(to) - utcDay(from)) / DAY_MS);
const creditPercentForDays = days => days <= 30 ? 100 : (days <= 40 ? 20 : 0);
const performancePercent = (achievedCents, targetCents) => targetCents > 0
  ? Math.round((safeCents(achievedCents) * 10000) / targetCents) / 100
  : 0;

const supplierPOCostCents = supplierPO => {
  if (!supplierPO) return null;
  const summary = summarizeExpenses(supplierPO);
  const currency = String(supplierPO.currency || 'PKR').trim().toUpperCase();
  const exchangeRateToPKR = currency === 'PKR' ? 1 : Number(supplierPO.exchangeRateToPKR);
  if (!Number.isFinite(exchangeRateToPKR) || exchangeRateToPKR <= 0) return null;
  return Math.round(summary.purchaseTotalPKRCents * exchangeRateToPKR) + summary.totalExpensesPKRCents;
};

const monthRange = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) - 1 : now.getUTCMonth();
  if (month < 0 || month > 11) throw Object.assign(new Error('Month must use YYYY-MM format.'), { statusCode: 400 });
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1))
  };
};

const invoiceRevenueExcludingTaxCents = invoice => {
  const amountLessTax = moneyToCents(invoice?.amount) - moneyToCents(invoice?.tax);
  if (amountLessTax > 0) return amountLessTax;
  return Math.max(0, moneyToCents(invoice?.subtotal) - moneyToCents(invoice?.discount));
};

const paymentAmountForInvoiceCents = (payment, invoiceId) => {
  if (Array.isArray(payment?.allocations) && payment.allocations.length) {
    return payment.allocations.reduce((sum, allocation) => (
      idString(allocation.invoiceId) === idString(invoiceId) ? sum + moneyToCents(allocation.amount) : sum
    ), 0);
  }
  return idString(payment?.invoiceId) === idString(invoiceId) ? moneyToCents(payment.amount) : 0;
};

const latestCostChangeAt = supplierPO => {
  const dates = [supplierPO?.updatedAt];
  for (const expense of supplierPO?.expenses || []) {
    dates.push(expense.addedAt, expense.deletedAt);
    for (const history of expense.editHistory || []) dates.push(history.changedAt);
  }
  const times = dates.filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : null;
};

const analyzeInvoicePerformance = ({ invoice, order, supplierPO, payments = [], purchaseCostCents, asOf = new Date() }) => {
  const invoiceDate = invoice.issueDate || invoice.createdAt;
  const invoiceTotalCents = moneyToCents(invoice.amount);
  const revenueExcludingTaxCents = invoiceRevenueExcludingTaxCents(invoice);
  const foreignCurrency = supplierPO && String(supplierPO.currency || 'PKR').toUpperCase() !== 'PKR';
  const missingExchangeRate = Boolean(foreignCurrency && !(Number(supplierPO.exchangeRateToPKR) > 0));
  const costUnavailable = purchaseCostCents === null || purchaseCostCents === undefined || missingExchangeRate;
  const grossProfitCents = costUnavailable ? null : revenueExcludingTaxCents - safeCents(purchaseCostCents);
  let remainingInvoiceCents = Math.max(0, invoiceTotalCents);
  const paymentRows = [];

  const orderedPayments = [...payments].sort((a, b) => (
    new Date(a.paymentDate || a.createdAt) - new Date(b.paymentDate || b.createdAt)
  ));
  for (const payment of orderedPayments) {
    const requestedCents = paymentAmountForInvoiceCents(payment, invoice._id);
    const appliedCents = Math.min(Math.max(0, requestedCents), remainingInvoiceCents);
    if (!appliedCents) continue;
    remainingInvoiceCents -= appliedCents;
    const clearedAt = payment.paymentDate || payment.createdAt;
    const daysAfterInvoice = Math.max(0, calendarDaysBetween(invoiceDate, clearedAt));
    const creditPercent = creditPercentForDays(daysAfterInvoice);
    const grossProfitShareCents = grossProfitCents === null || invoiceTotalCents <= 0
      ? 0
      : Math.round(grossProfitCents * appliedCents / invoiceTotalCents);
    paymentRows.push({
      paymentId: payment._id,
      paymentReference: payment.paymentRefNumber || '',
      clearedAt,
      amountCents: appliedCents,
      daysAfterInvoice,
      creditPercent,
      grossProfitShareCents,
      creditedGrossProfitCents: Math.round(grossProfitShareCents * creditPercent / 100)
    });
  }

  const fullyPaid = remainingInvoiceCents === 0 && invoiceTotalCents > 0;
  const effectiveDays = fullyPaid && paymentRows.length
    ? Math.max(...paymentRows.map(payment => payment.daysAfterInvoice))
    : Math.max(0, calendarDaysBetween(invoiceDate, asOf));
  const needsFinance = paymentRows.some(payment => payment.daysAfterInvoice > 40) || (!fullyPaid && effectiveDays > 40);
  const status = needsFinance
    ? 'Overdue / Needs Finance'
    : (effectiveDays <= 30 ? 'Within 30 days' : '31-40 days');
  const costChangedAt = latestCostChangeAt(supplierPO);
  const costChangedAfterCredit = Boolean(costChangedAt && paymentRows.some(payment => (
    new Date(payment.clearedAt).getTime() < costChangedAt.getTime()
  )));

  return {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber || '',
    salesOrderId: order?._id || invoice.salesOrderId || null,
    salesOrderNumber: order?.orderNumber || order?.orderReference || invoice.salesOrderNumber || '',
    customerName: invoice.clientName || '',
    invoiceDate,
    invoiceAmountCents: invoiceTotalCents,
    revenueExcludingTaxCents,
    purchaseCostCents: costUnavailable ? null : safeCents(purchaseCostCents),
    grossProfitCents,
    paidCents: invoiceTotalCents - remainingInvoiceCents,
    outstandingCents: remainingInvoiceCents,
    deadline30: addCalendarDays(invoiceDate, 30),
    deadline40: addCalendarDays(invoiceDate, 40),
    status,
    needsFinance,
    costChangedAfterCredit,
    costChangedAt,
    costGap: missingExchangeRate
      ? `Supplier PO ${supplierPO.poNumber || ''} uses ${supplierPO.currency} but has no exchange rate to PKR.`
      : (!supplierPO && costUnavailable ? 'One or more allocated stock batches have no recorded cost.' : ''),
    payments: paymentRows
  };
};

const loadPerformanceForUsersLegacy = async ({ users, month, asOf = new Date() }) => {
  const range = monthRange(month);
  const userIds = users.map(user => user._id);
  const orders = await SalesOrder.find({
    $or: [{ owner: { $in: userIds } }, { owner: null, createdBy: { $in: userIds } }, { owner: { $exists: false }, createdBy: { $in: userIds } }]
  }).select('_id owner createdBy orderNumber orderReference').lean();
  const orderIds = orders.map(order => order._id);
  const invoices = orderIds.length ? await Invoice.find({
    salesOrderId: { $in: orderIds },
    status: { $nin: ['Draft', 'Cancelled', 'Rejected'] },
    isDraft: { $ne: true }
  }).lean() : [];
  const invoiceIds = invoices.map(invoice => invoice._id);
  const payments = invoiceIds.length ? await Payment.find({
    $or: [{ invoiceId: { $in: invoiceIds } }, { 'allocations.invoiceId': { $in: invoiceIds } }]
  }).lean() : [];
  const supplierPOs = orderIds.length ? await SupplierPO.find({ salesOrderId: { $in: orderIds } }).sort({ createdAt: -1 }).lean() : [];
  const orderMap = new Map(orders.map(order => [idString(order._id), order]));
  const poMap = new Map();
  for (const po of supplierPOs) if (!poMap.has(idString(po.salesOrderId))) poMap.set(idString(po.salesOrderId), po);
  const rowsByOwner = new Map(users.map(user => [idString(user._id), []]));

  for (const invoice of invoices) {
    const order = orderMap.get(idString(invoice.salesOrderId));
    const ownerId = idString(order?.owner || order?.createdBy);
    if (!rowsByOwner.has(ownerId)) continue;
    const supplierPO = poMap.get(idString(order._id)) || null;
    const stockCost = supplierPO ? null : await resolveStockInvoiceCost({ invoice, order });
    const poCost = supplierPO ? await totalCostPKR(supplierPO) : null;
    const invoicePayments = payments.filter(payment => paymentAmountForInvoiceCents(payment, invoice._id) > 0);
    rowsByOwner.get(ownerId).push(analyzeInvoicePerformance({
      invoice,
      order,
      supplierPO,
      payments: invoicePayments,
      purchaseCostCents: supplierPO ? (poCost === null ? null : moneyToCents(poCost)) : stockCost.cogsCents,
      asOf
    }));
  }

  return users.map(user => {
    const salaryCents = safeCents(user.monthlySalesSalaryCents);
    const targetCents = salaryCents * 5;
    const invoicesForUser = rowsByOwner.get(idString(user._id)) || [];
    const achievedGrossProfitCents = invoicesForUser.reduce((total, invoice) => total + invoice.payments.reduce((sum, payment) => {
      const clearedAt = new Date(payment.clearedAt);
      return clearedAt >= range.start && clearedAt < range.end ? sum + payment.creditedGrossProfitCents : sum;
    }, 0), 0);
    return {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      month: range.key,
      salaryCents,
      targetCents,
      achievedGrossProfitCents,
      performancePercent: performancePercent(achievedGrossProfitCents, targetCents),
      targetStatus: targetCents > 0 && achievedGrossProfitCents >= targetCents ? 'Target met' : 'Target not met',
      overdueDeals: invoicesForUser.filter(invoice => invoice.needsFinance).length,
      costRecalculationFlags: invoicesForUser.filter(invoice => invoice.costChangedAfterCredit).length,
      invoices: invoicesForUser
    };
  });
};

const loadPerformanceForUsers = async ({ users, month, asOf = new Date(), profile = null }) => {
  const startedAt = Date.now();
  const mark = name => {
    if (profile) profile[name] = Date.now() - startedAt;
  };
  const range = monthRange(month);
  const userIds = users.map(user => user._id);
  const cacheKey = `${range.key}:${users.map(user => `${idString(user._id)}:${safeCents(user.monthlySalesSalaryCents)}`).sort().join('|')}`;
  const cached = performanceCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PERFORMANCE_CACHE_TTL_MS) {
    if (profile) profile.cacheHit = true;
    return cached.rows;
  }
  const orders = await SalesOrder.find({
    $or: [{ owner: { $in: userIds } }, { owner: null, createdBy: { $in: userIds } }, { owner: { $exists: false }, createdBy: { $in: userIds } }]
  }).select('_id owner createdBy orderNumber orderReference').lean();
  mark('ordersMs');
  const orderIds = orders.map(order => order._id);
  const [invoices, supplierPOs, orderLinkedPayments] = orderIds.length ? await Promise.all([
    Invoice.find({ salesOrderId: { $in: orderIds }, status: { $nin: ['Draft', 'Cancelled', 'Rejected'] }, isDraft: { $ne: true } })
      .select('_id invoiceNumber clientName salesOrderId issueDate createdAt amount tax subtotal discount status isDraft deliveryNoteId').lean(),
    SupplierPO.find({ salesOrderId: { $in: orderIds } }).sort({ createdAt: -1 })
      .select('_id salesOrderId poNumber poType currency exchangeRateToPKR subtotal totalAmount total costingStatus updatedAt expenses.amountPKRCents expenses.isDeleted expenses.addedAt expenses.deletedAt expenses.editHistory.changedAt createdAt').lean(),
    Payment.find({ $or: [{ salesOrderId: { $in: orderIds } }, { 'allocations.salesOrderId': { $in: orderIds } }] })
      .select('_id invoiceId allocations.invoiceId allocations.amount paymentDate createdAt amount paymentRefNumber').lean()
  ]) : [[], [], []];
  mark('invoicesPOsAndOrderPaymentsMs');
  const invoiceIds = invoices.map(invoice => invoice._id);
  const foundPaymentInvoiceIds = new Set(orderLinkedPayments.flatMap(payment => (
    Array.isArray(payment.allocations) && payment.allocations.length
      ? payment.allocations.map(allocation => idString(allocation.invoiceId))
      : [idString(payment.invoiceId)]
  )).filter(Boolean));
  const fallbackInvoiceIds = invoiceIds.filter(invoiceId => !foundPaymentInvoiceIds.has(idString(invoiceId)));
  const legacyPayments = fallbackInvoiceIds.length ? await Payment.find({
    $or: [{ invoiceId: { $in: fallbackInvoiceIds } }, { 'allocations.invoiceId': { $in: fallbackInvoiceIds } }]
  }).select('_id invoiceId allocations.invoiceId allocations.amount paymentDate createdAt amount paymentRefNumber').lean() : [];
  const payments = [...orderLinkedPayments, ...legacyPayments];
  mark('paymentsMs');
  const paymentsByInvoice = new Map(invoiceIds.map(invoiceId => [idString(invoiceId), []]));
  for (const payment of payments) {
    const targetIds = Array.isArray(payment.allocations) && payment.allocations.length
      ? payment.allocations.map(allocation => idString(allocation.invoiceId))
      : [idString(payment.invoiceId)];
    for (const invoiceId of new Set(targetIds.filter(Boolean))) {
      if (paymentsByInvoice.has(invoiceId) && paymentAmountForInvoiceCents(payment, invoiceId) > 0) {
        paymentsByInvoice.get(invoiceId).push(payment);
      }
    }
  }

  const orderMap = new Map(orders.map(order => [idString(order._id), order]));
  const poMap = new Map();
  for (const po of supplierPOs) if (!poMap.has(idString(po.salesOrderId))) poMap.set(idString(po.salesOrderId), po);
  const stockInvoices = invoices.filter(invoice => !poMap.has(idString(invoice.salesOrderId)));
  const stockCosts = stockInvoices.length
    ? await resolveStockInvoiceCosts({ invoices: stockInvoices, orders })
    : new Map();
  mark('stockCostsMs');
  const rowsByOwner = new Map(users.map(user => [idString(user._id), []]));

  for (const invoice of invoices) {
    const order = orderMap.get(idString(invoice.salesOrderId));
    const ownerId = idString(order?.owner || order?.createdBy);
    if (!rowsByOwner.has(ownerId)) continue;
    const supplierPO = poMap.get(idString(order._id)) || null;
    const poCostCents = supplierPO ? supplierPOCostCents(supplierPO) : null;
    const stockCost = supplierPO ? null : stockCosts.get(idString(invoice._id));
    rowsByOwner.get(ownerId).push(analyzeInvoicePerformance({
      invoice,
      order,
      supplierPO,
      payments: paymentsByInvoice.get(idString(invoice._id)) || [],
      purchaseCostCents: supplierPO ? poCostCents : stockCost?.cogsCents,
      asOf
    }));
  }

  const rows = users.map(user => {
    const salaryCents = safeCents(user.monthlySalesSalaryCents);
    const targetCents = salaryCents * 5;
    const invoicesForUser = rowsByOwner.get(idString(user._id)) || [];
    const achievedGrossProfitCents = invoicesForUser.reduce((total, invoice) => total + invoice.payments.reduce((sum, payment) => {
      const clearedAt = new Date(payment.clearedAt);
      return clearedAt >= range.start && clearedAt < range.end ? sum + payment.creditedGrossProfitCents : sum;
    }, 0), 0);
    return {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      month: range.key,
      salaryCents,
      targetCents,
      achievedGrossProfitCents,
      performancePercent: performancePercent(achievedGrossProfitCents, targetCents),
      targetStatus: targetCents > 0 && achievedGrossProfitCents >= targetCents ? 'Target met' : 'Target not met',
      overdueDeals: invoicesForUser.filter(invoice => invoice.needsFinance).length,
      costRecalculationFlags: invoicesForUser.filter(invoice => invoice.costChangedAfterCredit).length,
      invoices: invoicesForUser
    };
  });
  mark('totalMs');
  performanceCache.set(cacheKey, { createdAt: Date.now(), rows });
  return rows;
};

const addFinanceCostingToInvoices = async invoices => {
  const plainInvoices = (invoices || []).map(invoice => (
    typeof invoice?.toObject === 'function' ? invoice.toObject() : invoice
  ));
  const orderIds = [...new Set(plainInvoices.map(invoice => idString(invoice?.salesOrderId)).filter(Boolean))];
  if (!orderIds.length) {
    return plainInvoices.map(invoice => ({
      ...invoice,
      financeCosting: {
        invoiceAmountExcludingTaxCents: invoiceRevenueExcludingTaxCents(invoice),
        cogsCents: null,
        grossProfitCents: null,
        costingStatus: 'Incomplete',
        provisional: true,
        issue: 'Cost not recorded',
        review: false,
        reviewReason: ''
      }
    }));
  }

  const [orders, supplierPOs, invoiceCounts] = await Promise.all([
    SalesOrder.find({ _id: { $in: orderIds } }).lean(),
    SupplierPO.find({ salesOrderId: { $in: orderIds } }).sort({ createdAt: -1 }).lean(),
    Invoice.aggregate([
      { $match: { salesOrderId: { $in: orderIds.map(id => require('mongoose').Types.ObjectId.createFromHexString(id)) }, status: { $nin: ['Cancelled', 'Rejected'] } } },
      { $group: { _id: '$salesOrderId', count: { $sum: 1 } } }
    ])
  ]);
  const orderMap = new Map(orders.map(order => [idString(order._id), order]));
  const poMap = new Map();
  const poCounts = new Map();
  for (const po of supplierPOs) {
    const orderId = idString(po.salesOrderId);
    poCounts.set(orderId, (poCounts.get(orderId) || 0) + 1);
    if (!poMap.has(orderId)) poMap.set(orderId, po);
  }
  const invoiceCountMap = new Map(invoiceCounts.map(row => [idString(row._id), row.count]));

  return Promise.all(plainInvoices.map(async invoice => {
    const orderId = idString(invoice.salesOrderId);
    const order = orderMap.get(orderId) || null;
    const supplierPO = poMap.get(orderId) || null;
    const invoiceAmountExcludingTaxCents = invoiceRevenueExcludingTaxCents(invoice);
    let issue = '';
    let cogsCents = null;
    if (!order) {
      issue = 'Cost not recorded';
    } else if (!supplierPO) {
      const stockCost = await resolveStockInvoiceCost({ invoice, order });
      cogsCents = stockCost.cogsCents;
      issue = stockCost.issue;
    } else if (String(supplierPO.currency || 'PKR').toUpperCase() !== 'PKR' && !(Number(supplierPO.exchangeRateToPKR) > 0)) {
      issue = 'Rate missing';
    } else {
      const cost = await totalCostPKR(supplierPO);
      cogsCents = cost === null ? null : moneyToCents(cost);
      if (cogsCents === null) issue = 'Cost not recorded';
    }
    const multiplePOs = (poCounts.get(orderId) || 0) > 1;
    const multipleInvoices = (invoiceCountMap.get(orderId) || 0) > 1;
    const review = multiplePOs || multipleInvoices;
    const reasons = [];
    if (multiplePOs) reasons.push('the newest Supplier PO is used');
    if (multipleInvoices) reasons.push('the full order cost applies to each invoice');
    return {
      ...invoice,
      financeCosting: {
        invoiceAmountExcludingTaxCents,
        cogsCents,
        grossProfitCents: cogsCents === null ? null : invoiceAmountExcludingTaxCents - cogsCents,
        costingStatus: supplierPO ? (supplierPO.costingStatus || 'Incomplete') : (cogsCents === null ? 'Incomplete' : 'Completed'),
        provisional: supplierPO ? (supplierPO.costingStatus || 'Incomplete') !== 'Completed' : cogsCents === null,
        issue,
        review,
        reviewReason: review ? `Review: ${reasons.join('; ')}.` : '',
        supplierPONumber: supplierPO?.poNumber || ''
      }
    };
  }));
};

module.exports = {
  SALES_ROLES,
  addCalendarDays,
  calendarDaysBetween,
  creditPercentForDays,
  performancePercent,
  monthRange,
  invoiceRevenueExcludingTaxCents,
  paymentAmountForInvoiceCents,
  analyzeInvoicePerformance,
  addFinanceCostingToInvoices,
  loadPerformanceForUsers,
  loadPerformanceForUsersLegacy,
  invalidateTargetPerformanceCache
};
