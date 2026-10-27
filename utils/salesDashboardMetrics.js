const PriceRequest = require('../models/PriceRequest');
const Quotation = require('../models/Quotation');
const SalesOrder = require('../models/SalesOrder');
const Invoice = require('../models/Invoice');
const { ownerScope } = require('./salesOwnership');
const { calendarDaysBetween, monthRange } = require('./targetPerformance');

const finalizedLifecycleStatuses = new Set(['Finalized', 'Sent', 'Partially Paid', 'Overdue', 'Paid']);

const recordAmount = record => Number(record?.netAmount || record?.totalAmount || 0);
const invoiceRemaining = invoice => Math.max(0, invoice?.outstandingAmount != null
  ? Number(invoice.outstandingAmount || 0)
  : Number(invoice?.amount || 0) - Number(invoice?.paidAmount || 0));
const inRange = (value, range) => {
  if (!value) return false;
  const date = new Date(value);
  return date >= range.start && date < range.end;
};
const invoiceDate = invoice => invoice?.finalizedAt || invoice?.issueDate || invoice?.createdAt;
const invoiceAgeDays = (invoice, now) => Math.max(0, calendarDaysBetween(invoiceDate(invoice), now));
const isFinalizedInvoice = invoice => (
  invoice?.isDraft !== true
  && !['Draft', 'Cancelled'].includes(invoice?.status)
  && (Boolean(invoice?.finalizedAt) || finalizedLifecycleStatuses.has(invoice?.status))
);

const getSalesDashboardMetrics = async ({ userId, isGlobal = false, month, now = new Date() }) => {
  const range = monthRange(month);
  const scope = isGlobal ? {} : ownerScope(userId);
  const monthScope = isGlobal
    ? { createdAt: { $gte: range.start, $lt: range.end } }
    : { $and: [scope, { createdAt: { $gte: range.start, $lt: range.end } }] };
  const priceRequestScope = {
    ...(isGlobal ? {} : { requestedBy: userId }),
    createdAt: { $gte: range.start, $lt: range.end }
  };

  const [priceRequests, quotations, orders, allOwnedOrders] = await Promise.all([
    PriceRequest.find(priceRequestScope).select('_id status createdAt').lean(),
    Quotation.find(monthScope).select('_id status totalAmount netAmount createdAt').lean(),
    SalesOrder.find(monthScope).select('_id status totalAmount netAmount createdAt').lean(),
    SalesOrder.find(scope).select('_id').lean()
  ]);

  const ownedOrderIds = allOwnedOrders.map(order => order._id);
  const invoiceScope = isGlobal ? {} : { salesOrderId: { $in: ownedOrderIds } };
  const invoices = await Invoice.find(invoiceScope)
    .select('_id invoiceNumber clientName salesOrderId amount paidAmount outstandingAmount status isDraft dueDate issueDate finalizedAt createdAt')
    .lean();

  const sentQuotations = quotations.filter(quotation => !/draft|cancel/i.test(String(quotation.status || '')));
  const acceptedOrders = orders.filter(order => !/reject/i.test(String(order.status || '')));
  const finalizedInvoices = invoices.filter(isFinalizedInvoice);
  const monthFinalizedInvoices = finalizedInvoices.filter(invoice => inRange(invoiceDate(invoice), range));
  const receivableInvoices = finalizedInvoices.filter(invoice => invoice.status !== 'Paid' && invoiceRemaining(invoice) > 0);
  const overdueInvoices = receivableInvoices.filter(invoice => invoice.dueDate && new Date(invoice.dueDate) < now);
  const safeReceivables = receivableInvoices.filter(invoice => invoiceAgeDays(invoice, now) <= 30);
  const dueReceivables = receivableInvoices.filter(invoice => {
    const age = invoiceAgeDays(invoice, now);
    return age >= 31 && age <= 45;
  });
  const above45Days = receivableInvoices.filter(invoice => invoiceAgeDays(invoice, now) > 45);

  const serializeInvoice = invoice => ({
    _id: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.clientName || 'Client',
    dueDate: invoice.dueDate,
    issueDate: invoice.issueDate,
    amount: Number(invoice.amount || 0),
    paidAmount: Number(invoice.paidAmount || 0),
    remainingBalance: invoiceRemaining(invoice),
    ageDays: invoiceAgeDays(invoice, now),
    status: invoice.status,
    type: 'Invoice'
  });

  return {
    month: range.key,
    tiles: {
      priceRequested: { count: priceRequests.length },
      priceReceived: { count: priceRequests.filter(request => request.status === 'Priced').length },
      quotationSent: {
        count: sentQuotations.length,
        amount: sentQuotations.reduce((sum, quotation) => sum + recordAmount(quotation), 0)
      },
      saleOrder: {
        count: acceptedOrders.length,
        amount: acceptedOrders.reduce((sum, order) => sum + recordAmount(order), 0)
      },
      invoiced: {
        count: monthFinalizedInvoices.length,
        amount: monthFinalizedInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
      },
      safeReceivable: {
        count: safeReceivables.length,
        amount: safeReceivables.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0),
        records: safeReceivables.map(serializeInvoice)
      },
      dueReceivable: {
        count: dueReceivables.length,
        amount: dueReceivables.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0),
        records: dueReceivables.map(serializeInvoice)
      },
      above45Days: {
        count: above45Days.length,
        amount: above45Days.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0),
        records: above45Days.map(serializeInvoice)
      },
      receivable: {
        count: receivableInvoices.length,
        amount: receivableInvoices.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0),
        records: receivableInvoices.map(serializeInvoice)
      },
      overdue: {
        count: overdueInvoices.length,
        amount: overdueInvoices.reduce((sum, invoice) => sum + invoiceRemaining(invoice), 0),
        records: overdueInvoices.map(serializeInvoice)
      }
    }
  };
};

module.exports = {
  getSalesDashboardMetrics,
  invoiceAgeDays,
  invoiceDate,
  invoiceRemaining,
  isFinalizedInvoice
};
