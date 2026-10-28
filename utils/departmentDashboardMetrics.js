const DeliveryNote = require('../models/DeliveryNote');
const PurchaserGRN = require('../models/PurchaserGRN');
const SalesOrder = require('../models/SalesOrder');
const Shipment = require('../models/Shipment');
const SupplierPO = require('../models/SupplierPO');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { monthRange } = require('./targetPerformance');
const { getSalesDashboardMetrics } = require('./salesDashboardMetrics');

const SUPPORT_EXPIRY_WINDOW_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORT_WORKFLOW_STATUSES = [
  'Finance Approved',
  'Local Supplier PO Issued',
  'Goods Arrived / Awaiting Support Verification',
  'Shipment Received in Office',
  'Goods Received in Office',
  'Inventory & BL Verified',
  'Sent to Support',
  'Support Reviewing',
  'Delivery Note Created',
  'DN Created',
  'Delivery Note Confirmed',
  'Sent to Accounts',
  'Draft Invoice Created',
  'Sent to Finance',
  'Pending Finance Finalization',
  'Completed'
];

const moneyToCents = value => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const orderAmountCents = order => moneyToCents(order?.netAmount || order?.totalAmount);
const dateRangeQuery = (range, field = 'createdAt') => ({ [field]: { $gte: range.start, $lt: range.end } });
const inRange = (value, range) => {
  if (!value) return false;
  const date = new Date(value);
  return date >= range.start && date < range.end;
};
const isOrderCompleted = order => {
  if (!order) return false;
  if (['Fully Delivered', 'Delivered', 'Done'].includes(order.deliveryStatus)) return true;
  return [order.status, order.workflowStatus].some(value =>
    /delivery note confirmed|fully delivered|delivered|done|completed|cancelled|canceled|rejected/i.test(String(value || ''))
  );
};
const historyDate = (order, predicate) => {
  const match = (order?.workflowHistory || []).find(predicate);
  return match?.timestamp || null;
};
const includeEventForMonth = ({ eventDate, order, range, carryOver }) => {
  if (inRange(eventDate, range)) return true;
  return Boolean(carryOver && eventDate && new Date(eventDate) < range.start && !isOrderCompleted(order));
};
const purchaserReceivedDate = order => order.financeApprovedAt || historyDate(order, entry =>
  /finance approved/i.test(String(entry.action || entry.newStatus || ''))
) || order.createdAt;
const stockFulfilledDate = order => historyDate(order, entry =>
  /inventory available|existing warehouse stock|moved to support/i.test(String(entry.action || entry.notes || ''))
) || order.createdAt;
const sentToLogisticsDate = order => historyDate(order, entry => entry.newStatus === 'In Logistics') ||
  order.lastActionAt || order.createdAt;
const financeReceivedDate = order => historyDate(order, entry =>
  /sent to finance for overdue verification/i.test(String(entry.action || entry.notes || '')) ||
  /pending finance overdue check|pending finance approval/i.test(String(entry.newStatus || ''))
) || order.financeApprovedAt || order.createdAt;

const buildPurchaserOrderQueueQuery = subDept => {
  const isGlobal = subDept === 'Global';
  const fileType = isGlobal ? 'Blue' : 'Green';
  const department = isGlobal ? 'Global Purchaser' : 'Local Purchaser';
  const workflowStatus = isGlobal ? 'Pending Global Procurement' : 'Pending Local Procurement';
  const fallback = isGlobal
    ? {
        fileType,
        financeApprovedBy: { $ne: null },
        currentDepartment: { $nin: ['Logistics', 'Support', 'Accounts', 'Completed'] },
        workflowStatus: { $nin: ['In Logistics', 'Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'] }
      }
    : {
        fileType,
        financeApprovedBy: { $ne: null },
        currentDepartment: { $nin: ['Support', 'Accounts', 'Completed'] },
        workflowStatus: { $nin: ['Pending Delivery Note', 'Draft Invoice Created', 'Invoice Finalized', 'Completed'] }
      };

  return {
    fileType,
    $or: [
      { departmentResponsible: department },
      { currentDepartment: department },
      { workflowStatus },
      { status: workflowStatus },
      fallback
    ]
  };
};

const supplierPoAmountPKRCents = po => {
  const total = Number(po?.total || po?.totalAmount || 0);
  const currency = String(po?.currency || 'PKR').trim().toUpperCase();
  if (!Number.isFinite(total)) return { amountCents: 0, missingRate: false };
  if (!currency || currency === 'PKR') return { amountCents: moneyToCents(total), missingRate: false };
  const rate = Number(po?.exchangeRateToPKR);
  if (!Number.isFinite(rate) || rate <= 0) return { amountCents: 0, missingRate: true };
  return { amountCents: moneyToCents(total * rate), missingRate: false };
};

const getPurchaserDashboardMetrics = async ({ subDept, month }) => {
  const range = monthRange(month);
  const carryOver = range.key === monthRange().key;
  const isGlobal = subDept === 'Global';
  const fileType = isGlobal ? 'Blue' : 'Green';

  const [receivedCandidates, stockCandidates, poCandidates, sentCandidates] = await Promise.all([
    SalesOrder.find({ fileType, createdAt: { $lt: range.end } })
      .select('totalAmount netAmount status workflowStatus deliveryStatus financeApprovedAt createdAt workflowHistory')
      .lean(),
    isGlobal
      ? []
      : SalesOrder.find({
          fileType: 'Green',
          inventoryFulfilledFromExistingStock: true,
          createdAt: { $lt: range.end }
        }).select('totalAmount netAmount status workflowStatus deliveryStatus createdAt workflowHistory').lean(),
    SupplierPO.find({
      poType: subDept,
      status: { $nin: ['Draft', 'Cancelled'] },
      createdAt: { $lt: range.end }
    }).select('total totalAmount currency exchangeRateToPKR salesOrderId poDate createdAt').lean(),
    isGlobal
      ? SalesOrder.find({
          fileType: 'Blue',
          $or: [
            {
              workflowHistory: {
                $elemMatch: {
                  department: 'Global Purchaser',
                  newStatus: 'In Logistics',
                  timestamp: { $lt: range.end }
                }
              }
            },
            {
              $and: [
                { $or: [{ currentDepartment: 'Logistics' }, { workflowStatus: 'In Logistics' }] },
                { lastActionAt: { $lt: range.end } }
              ]
            }
          ]
        }).select('totalAmount netAmount status workflowStatus deliveryStatus createdAt lastActionAt workflowHistory').lean()
      : []
  ]);

  const poOrderIds = poCandidates.map(po => po.salesOrderId).filter(Boolean);
  const poOrders = await SalesOrder.find({ _id: { $in: poOrderIds } })
    .select('status workflowStatus deliveryStatus')
    .lean();
  const poOrderMap = new Map(poOrders.map(order => [String(order._id), order]));

  const receivedOrders = receivedCandidates.filter(order => includeEventForMonth({
    eventDate: purchaserReceivedDate(order), order, range, carryOver
  }));
  const stockOrders = stockCandidates.filter(order => includeEventForMonth({
    eventDate: stockFulfilledDate(order), order, range, carryOver
  }));
  const issuedPOs = poCandidates.filter(po => includeEventForMonth({
    eventDate: po.poDate || po.createdAt,
    order: poOrderMap.get(String(po.salesOrderId || '')),
    range,
    carryOver
  }));
  const sentToLogistics = sentCandidates.filter(order => includeEventForMonth({
    eventDate: sentToLogisticsDate(order), order, range, carryOver
  }));

  const poTotals = issuedPOs.reduce((result, po) => {
    const converted = supplierPoAmountPKRCents(po);
    result.amountCents += converted.amountCents;
    if (converted.missingRate) result.missingExchangeRateCount += 1;
    return result;
  }, { amountCents: 0, missingExchangeRateCount: 0 });

  const sumOrders = orders => orders.reduce((sum, order) => sum + orderAmountCents(order), 0);
  return {
    month: range.key,
    subDept,
    tiles: {
      saleOrderReceived: { count: receivedOrders.length, amountCents: sumOrders(receivedOrders) },
      ...(isGlobal
        ? {
            poIssued: { count: issuedPOs.length, ...poTotals },
            sentToLogistic: { count: sentToLogistics.length, amountCents: sumOrders(sentToLogistics) }
          }
        : {
            soStock: { count: stockOrders.length, amountCents: sumOrders(stockOrders) },
            poIssued: { count: issuedPOs.length, ...poTotals }
          })
    }
  };
};

const getSupportDashboardMetrics = async ({ month, now = new Date() }) => {
  const range = monthRange(month);
  const carryOver = range.key === monthRange().key;
  const monthQuery = dateRangeQuery(range);
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryCutoffExclusive = new Date(todayStart + (SUPPORT_EXPIRY_WINDOW_DAYS + 1) * DAY_MS);
  const orderQuery = {
    isOverdueBlocked: { $ne: true },
    $or: [
      { departmentResponsible: 'Support' },
      { currentDepartment: 'Support' },
      { workflowStatus: { $in: SUPPORT_WORKFLOW_STATUSES } }
    ]
  };
  const supportUsers = await User.find({ role: 'support' }).select('_id').lean();
  const supportIds = supportUsers.map(user => user._id);

  const ticketReceivedQuery = carryOver
    ? {
        deliveryNoteNumber: { $ne: '' },
        $or: [
          monthQuery,
          { createdAt: { $lt: range.start }, status: 'Received' }
        ]
      }
    : { deliveryNoteNumber: { $ne: '' }, ...monthQuery };

  const [ordersReceived, deliveryNotesCount, expiryDateCount, grns, ticketReceivedCount, ticketResolvedCount] = await Promise.all([
    SalesOrder.countDocuments({ $and: [orderQuery, monthQuery] }),
    DeliveryNote.countDocuments(monthQuery),
    DeliveryNote.countDocuments({ expiryDate: { $ne: null, $lt: expiryCutoffExclusive } }),
    PurchaserGRN.find({ createdBy: { $in: supportIds }, ...monthQuery })
      .select('supplierPO supplierPOId salesOrder salesOrderId')
      .lean(),
    SupportTicket.countDocuments(ticketReceivedQuery),
    SupportTicket.countDocuments({
      deliveryNoteNumber: { $ne: '' },
      status: 'Solved',
      solvedAt: { $gte: range.start, $lt: range.end }
    })
  ]);

  const poIds = grns.map(grn => grn.supplierPO || grn.supplierPOId).filter(Boolean);
  const orderIds = grns.map(grn => grn.salesOrder || grn.salesOrderId).filter(Boolean);
  const [pos, orders] = await Promise.all([
    SupplierPO.find({ _id: { $in: poIds } }).select('poType').lean(),
    SalesOrder.find({ _id: { $in: orderIds } }).select('fileType').lean()
  ]);
  const poTypes = new Map(pos.map(po => [String(po._id), po.poType]));
  const orderTypes = new Map(orders.map(order => [String(order._id), order.fileType]));
  const grnCounts = grns.reduce((counts, grn) => {
    const poType = poTypes.get(String(grn.supplierPO || grn.supplierPOId || ''));
    const fileType = orderTypes.get(String(grn.salesOrder || grn.salesOrderId || ''));
    if (poType === 'Global' || fileType === 'Blue') counts.global += 1;
    else counts.local += 1;
    return counts;
  }, { local: 0, global: 0 });

  return {
    month: range.key,
    expiryWindowDays: SUPPORT_EXPIRY_WINDOW_DAYS,
    expirySupported: true,
    tiles: {
      saleOrderReceived: { count: ordersReceived },
      dnCreated: { count: deliveryNotesCount },
      grnInput: { total: grnCounts.local + grnCounts.global, ...grnCounts },
      expiryDateNotification: { count: expiryDateCount },
      ticketReceived: { count: ticketReceivedCount },
      ticketResolved: { count: ticketResolvedCount }
    }
  };
};

const getLogisticsDashboardMetrics = async ({ month }) => {
  const range = monthRange(month);
  const carryOver = range.key === monthRange().key;

  const [orderCandidates, poCandidates, grnCandidates, pickupCount, inTransitCount] = await Promise.all([
    SalesOrder.find({
      fileType: 'Blue',
      createdAt: { $lt: range.end },
      $or: [
        {
          workflowHistory: {
            $elemMatch: {
              department: 'Global Purchaser',
              newStatus: 'In Logistics',
              timestamp: { $lt: range.end }
            }
          }
        },
        {
          $and: [
            { $or: [{ currentDepartment: 'Logistics' }, { workflowStatus: 'In Logistics' }] },
            { lastActionAt: { $lt: range.end } }
          ]
        }
      ]
    }).select('status workflowStatus deliveryStatus createdAt lastActionAt workflowHistory').lean(),
    SupplierPO.find({
      poType: 'Global',
      status: { $nin: ['Draft', 'Cancelled'] },
      createdAt: { $lt: range.end }
    }).select('salesOrderId poDate createdAt').lean(),
    PurchaserGRN.find({ createdAt: { $lt: range.end } })
      .select('grnType supplierPO supplierPOId salesOrder salesOrderId grnDate createdAt')
      .lean(),
    Shipment.countDocuments({ status: 'Picked Up' }),
    Shipment.countDocuments({ status: 'In Transit' })
  ]);

  const linkedOrderIds = [
    ...poCandidates.map(po => po.salesOrderId),
    ...grnCandidates.flatMap(grn => [grn.salesOrder, grn.salesOrderId])
  ].filter(Boolean);
  const linkedPoIds = grnCandidates.flatMap(grn => [grn.supplierPO, grn.supplierPOId]).filter(Boolean);
  const [linkedOrders, linkedPOs] = await Promise.all([
    SalesOrder.find({ _id: { $in: linkedOrderIds } })
      .select('fileType status workflowStatus deliveryStatus createdAt lastActionAt workflowHistory')
      .lean(),
    SupplierPO.find({ _id: { $in: linkedPoIds } }).select('poType salesOrderId').lean()
  ]);
  const orderMap = new Map(linkedOrders.map(order => [String(order._id), order]));
  const poMap = new Map(linkedPOs.map(po => [String(po._id), po]));

  const arrivedOrders = orderCandidates.filter(order => includeEventForMonth({
    eventDate: sentToLogisticsDate(order), order, range, carryOver
  }));

  const issuedPOs = poCandidates.filter(po => {
    const order = orderMap.get(String(po.salesOrderId || ''));
    const arrivalDate = sentToLogisticsDate(order);
    if (!order || !arrivalDate || new Date(arrivalDate) >= range.end) return false;
    return includeEventForMonth({
      eventDate: po.poDate || po.createdAt,
      order,
      range,
      carryOver
    });
  });

  const globalGRNs = grnCandidates.filter(grn => {
    const po = poMap.get(String(grn.supplierPO || grn.supplierPOId || ''));
    const orderId = grn.salesOrder || grn.salesOrderId || po?.salesOrderId;
    const order = orderMap.get(String(orderId || ''));
    const isGlobal = grn.grnType === 'Logistics' || po?.poType === 'Global' || order?.fileType === 'Blue';
    if (!isGlobal) return false;
    const arrivalDate = sentToLogisticsDate(order);
    if (order && (!arrivalDate || new Date(arrivalDate) >= range.end)) return false;
    return includeEventForMonth({
      eventDate: grn.grnDate || grn.createdAt,
      order,
      range,
      carryOver
    });
  });

  return {
    month: range.key,
    tiles: {
      soReceived: { count: arrivedOrders.length },
      poIssued: { count: issuedPOs.length },
      globalGrnInput: { count: globalGRNs.length },
      pickup: { count: pickupCount },
      inTransit: { count: inTransitCount }
    }
  };
};

const getFinanceDashboardMetrics = async ({ month, now = new Date() }) => {
  const range = monthRange(month);
  const carryOver = range.key === monthRange().key;

  const [orderCandidates, poCandidates, grnCandidates, deliveryNotes, salesMetrics] = await Promise.all([
    SalesOrder.find({
      createdAt: { $lt: range.end },
      $or: [
        { currentDepartment: 'Finance' },
        { departmentResponsible: 'Finance' },
        { previousDepartment: 'Finance' },
        { requiresFinanceApproval: true },
        { financeApprovedAt: { $ne: null } },
        { workflowHistory: { $elemMatch: { newStatus: { $in: ['Pending Finance Overdue Check', 'Pending Finance Approval'] } } } }
      ]
    })
      .select('totalAmount netAmount status workflowStatus deliveryStatus currentDepartment departmentResponsible previousDepartment requiresFinanceApproval financeApprovedAt createdAt workflowHistory')
      .lean(),
    SupplierPO.find({
      status: { $nin: ['Draft', 'Cancelled'] },
      createdAt: { $lt: range.end }
    }).select('poType total totalAmount currency exchangeRateToPKR salesOrderId poDate createdAt').lean(),
    PurchaserGRN.find({ createdAt: { $lt: range.end } })
      .select('grnType supplierPO supplierPOId salesOrder salesOrderId grnDate createdAt')
      .lean(),
    DeliveryNote.find({ createdAt: { $gte: range.start, $lt: range.end } })
      .select('_id')
      .lean(),
    getSalesDashboardMetrics({ isGlobal: true, month: range.key, now })
  ]);

  const linkedOrderIds = [
    ...poCandidates.map(po => po.salesOrderId),
    ...grnCandidates.flatMap(grn => [grn.salesOrder, grn.salesOrderId])
  ].filter(Boolean);
  const linkedPoIds = grnCandidates.flatMap(grn => [grn.supplierPO, grn.supplierPOId]).filter(Boolean);
  const [linkedOrders, linkedPOs] = await Promise.all([
    SalesOrder.find({ _id: { $in: linkedOrderIds } })
      .select('fileType status workflowStatus deliveryStatus createdAt workflowHistory')
      .lean(),
    SupplierPO.find({ _id: { $in: linkedPoIds } }).select('poType salesOrderId').lean()
  ]);
  const orderMap = new Map(linkedOrders.map(order => [String(order._id), order]));
  const poMap = new Map(linkedPOs.map(po => [String(po._id), po]));

  const financeOrders = orderCandidates.filter(order => includeEventForMonth({
    eventDate: financeReceivedDate(order), order, range, carryOver
  }));
  const issuedPOs = poCandidates.filter(po => includeEventForMonth({
    eventDate: po.poDate || po.createdAt,
    order: orderMap.get(String(po.salesOrderId || '')),
    range,
    carryOver
  }));

  const poTiles = issuedPOs.reduce((tiles, po) => {
    const key = po.poType === 'Global' ? 'global' : 'local';
    const converted = supplierPoAmountPKRCents(po);
    tiles[key].count += 1;
    tiles[key].amountCents += converted.amountCents;
    if (converted.missingRate) tiles[key].missingExchangeRateCount += 1;
    return tiles;
  }, {
    local: { count: 0, amountCents: 0, missingExchangeRateCount: 0 },
    global: { count: 0, amountCents: 0, missingExchangeRateCount: 0 }
  });

  const grnCounts = grnCandidates.reduce((counts, grn) => {
    if (!inRange(grn.grnDate || grn.createdAt, range)) return counts;
    const po = poMap.get(String(grn.supplierPO || grn.supplierPOId || ''));
    const orderId = grn.salesOrder || grn.salesOrderId || po?.salesOrderId;
    const order = orderMap.get(String(orderId || ''));
    if (grn.grnType === 'Logistics' || po?.poType === 'Global' || order?.fileType === 'Blue') counts.global += 1;
    else counts.local += 1;
    return counts;
  }, { local: 0, global: 0 });

  const invoiceTile = tile => ({
    count: Number(tile?.count || 0),
    amountCents: moneyToCents(tile?.amount || 0)
  });

  return {
    month: range.key,
    tiles: {
      so: { count: financeOrders.length, amountCents: financeOrders.reduce((sum, order) => sum + orderAmountCents(order), 0) },
      localPoIssued: poTiles.local,
      globalPoIssued: poTiles.global,
      localGrnInput: { count: grnCounts.local },
      globalGrnInput: { count: grnCounts.global },
      deliveryNote: { count: deliveryNotes.length },
      invoiced: invoiceTile(salesMetrics.tiles.invoiced),
      receivable1To30: invoiceTile(salesMetrics.tiles.safeReceivable),
      overdueGrace31To45: invoiceTile(salesMetrics.tiles.dueReceivable),
      overdue45Plus: invoiceTile(salesMetrics.tiles.above45Days)
    }
  };
};

module.exports = {
  SUPPORT_EXPIRY_WINDOW_DAYS,
  buildPurchaserOrderQueueQuery,
  getFinanceDashboardMetrics,
  getLogisticsDashboardMetrics,
  getPurchaserDashboardMetrics,
  getSupportDashboardMetrics,
  supplierPoAmountPKRCents
};
