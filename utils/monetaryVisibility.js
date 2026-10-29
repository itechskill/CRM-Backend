const QUANTITY_ONLY_ROLES = new Set(['support', 'logistics']);
const SALARY_RESTRICTED_ROLES = new Set(['hr_manager', 'hr', 'administration']);
const FINANCE_COSTING_ROLES = new Set(['finance', 'admin', 'ceo']);

const plain = value => {
  if (value == null) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
};

const clone = value => {
  const source = plain(value);
  if (Array.isArray(source)) return source.map(clone);
  if (!source || typeof source !== 'object' || source instanceof Date || Buffer.isBuffer(source)) return source;
  if (source._bsontype || source.constructor?.name === 'ObjectId') return source;
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, clone(item)]));
};

const omit = (source, fields) => {
  const result = clone(source) || {};
  fields.forEach(field => delete result[field]);
  return result;
};

const stripLineMoney = line => omit(line, [
  'unitPrice', 'price', 'lineTotal', 'total', 'totalAmount', 'amount', 'amountCents', 'amountPKRCents',
  'cost', 'costPrice', 'purchasePrice', 'sellingPrice'
]);

const stripDeal = deal => omit(deal, ['value', 'amount', 'totalAmount', 'netAmount', 'estimatedValue']);

const stripInvoice = invoice => {
  if (!invoice || typeof invoice !== 'object') return invoice;
  const result = omit(invoice, [
    'subtotal', 'tax', 'taxRate', 'discount', 'amount', 'paidAmount', 'outstandingAmount',
    'totalAmount', 'netAmount', 'grandTotal', 'remaining', 'lateChargeAmount', 'lateChargePercentage'
  ]);
  if (Array.isArray(result.items)) result.items = result.items.map(stripLineMoney);
  if (result.dealId && typeof result.dealId === 'object') result.dealId = stripDeal(result.dealId);
  if (result.salesOrderId && typeof result.salesOrderId === 'object') result.salesOrderId = stripSalesOrder(result.salesOrderId);
  return result;
};

const stripSupplierPO = po => {
  if (!po || typeof po !== 'object') return po;
  const result = omit(po, [
    'subtotal', 'gstRate', 'gstAmount', 'vatRate', 'vatAmount', 'total', 'totalAmount',
    'currency', 'exchangeRate', 'exchangeRateToPKR', 'expenses', 'costingStatus', 'costingHistory'
  ]);
  if (Array.isArray(result.items)) result.items = result.items.map(stripLineMoney);
  return result;
};

function stripSalesOrder(order) {
  if (!order || typeof order !== 'object') return order;
  const result = omit(order, [
    'totalAmount', 'discount', 'tax', 'taxRate', 'netAmount', 'totalPaid', 'outstandingBalance',
    'customerOverdueAtCreation', 'shortageAmount', 'advancePercentage', 'advanceRequiredAmount',
    'advanceReceivedAmount', 'orderTotalAmount'
  ]);
  if (Array.isArray(result.items)) result.items = result.items.map(stripLineMoney);
  if (Array.isArray(result.deliveryRemainingItems)) result.deliveryRemainingItems = result.deliveryRemainingItems.map(stripLineMoney);
  if (result.supplierPO) result.supplierPO = stripSupplierPO(result.supplierPO);
  if (result.invoiceId && typeof result.invoiceId === 'object') result.invoiceId = stripInvoice(result.invoiceId);
  if (result.deliveryNoteId && typeof result.deliveryNoteId === 'object') result.deliveryNoteId = stripDeliveryNote(result.deliveryNoteId);
  return result;
}

function stripDeliveryNote(note) {
  if (!note || typeof note !== 'object') return note;
  const result = omit(note, ['subtotal', 'discount', 'tax', 'taxRate', 'grandTotal', 'totalAmount', 'netAmount']);
  if (Array.isArray(result.items)) result.items = result.items.map(stripLineMoney);
  if (result.salesOrder && typeof result.salesOrder === 'object') result.salesOrder = stripSalesOrder(result.salesOrder);
  if (result.shipmentId && typeof result.shipmentId === 'object') result.shipmentId = stripShipment(result.shipmentId);
  return result;
}

const stripInventory = item => omit(item, ['unitPrice', 'totalValue', 'stockValue', 'inventoryValue', 'totalInventoryValue']);

const stripShipment = shipment => {
  if (!shipment || typeof shipment !== 'object') return shipment;
  const result = clone(shipment);
  if (Array.isArray(result.items)) result.items = result.items.map(stripLineMoney);
  if (result.salesOrder && typeof result.salesOrder === 'object') result.salesOrder = stripSalesOrder(result.salesOrder);
  return result;
};

const stripOverdue = overdue => {
  const result = omit(overdue, ['overdueAmount', 'overdueInvoiceAmount', 'amount', 'outstandingAmount', 'totalAmount', 'remaining']);
  if (Array.isArray(result.overdueInvoices)) result.overdueInvoices = result.overdueInvoices.map(stripInvoice);
  if (Array.isArray(result.invoices)) result.invoices = result.invoices.map(stripInvoice);
  return result;
};

const stripDocumentPackage = bundle => {
  const result = clone(bundle) || {};
  if (result.order) result.order = stripSalesOrder(result.order);
  if (result.invoice) result.invoice = stripInvoice(result.invoice);
  if (result.deliveryNote) result.deliveryNote = stripDeliveryNote(result.deliveryNote);
  if (result.goodsDeclaration) result.goodsDeclaration = omit(result.goodsDeclaration, ['totalValuePKR', 'totalValue', 'amount']);
  return result;
};

const stripSalary = user => omit(user, ['salary', 'salaryTarget', 'monthlySalary', 'baseSalary', 'netSalary', 'netPay']);

const map = (value, transform) => Array.isArray(value) ? value.map(transform) : transform(value);

const audienceRole = user => {
  const role = String(user?.role || '').toLowerCase();
  if (QUANTITY_ONLY_ROLES.has(role)) return role;
  const department = String(user?.department || '').toLowerCase();
  if (department.includes('support')) return 'support';
  if (department.includes('logistics')) return 'logistics';
  return role;
};

/**
 * The single response-boundary serializer for role-sensitive monetary visibility.
 * Contexts are deliberately explicit so similarly named non-money fields are not removed accidentally.
 */
const serializeMonetaryVisibility = (value, user, context) => {
  const role = audienceRole(user);
  if (context === 'users') {
    return SALARY_RESTRICTED_ROLES.has(role) ? map(value, stripSalary) : value;
  }
  if (context === 'invoice' || context === 'invoices') {
    const costingSafeValue = FINANCE_COSTING_ROLES.has(role)
      ? value
      : map(value, invoice => omit(invoice, ['financeCosting']));
    return QUANTITY_ONLY_ROLES.has(role) ? map(costingSafeValue, stripInvoice) : costingSafeValue;
  }
  if (!QUANTITY_ONLY_ROLES.has(role)) return value;

  switch (context) {
    case 'sales-order':
    case 'sales-orders': return map(value, stripSalesOrder);
    case 'delivery-note':
    case 'delivery-notes': return map(value, stripDeliveryNote);
    case 'deal':
    case 'deals': return map(value, stripDeal);
    case 'inventory-item':
    case 'inventory-items': return map(value, stripInventory);
    case 'supplier-po':
    case 'supplier-pos': return map(value, stripSupplierPO);
    case 'shipment':
    case 'shipments': return map(value, stripShipment);
    case 'overdue': return stripOverdue(value);
    case 'document-package': return stripDocumentPackage(value);
    case 'import-inventory': {
      const result = clone(value) || {};
      if (result.stats) result.stats = omit(result.stats, ['totalInventoryValue', 'inventoryValue', 'stockValue']);
      if (Array.isArray(result.data)) result.data = result.data.map(stripInventory);
      return result;
    }
    default:
      throw new Error(`Unknown monetary visibility context: ${context}`);
  }
};

module.exports = { serializeMonetaryVisibility };
