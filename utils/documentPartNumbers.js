const mongoose = require('mongoose');

const plain = value => (typeof value?.toObject === 'function' ? value.toObject() : (value || {}));
const text = value => String(value || '').trim();
const ownPartNumber = line => text(line?.partNumber);
const idText = value => text(value?._id || value);

const lineIds = line => [
  line?._id,
  line?.orderItemId,
  line?.sourceItemId,
  line?.productId,
  line?.inventoryItem,
  line?.inventoryItemId
].map(idText).filter(Boolean);

const matchingSourceLine = (line, index, sourceLines) => {
  const rows = Array.isArray(sourceLines) ? sourceLines : [];
  const targetIds = new Set(lineIds(line));
  if (targetIds.size) {
    const match = rows.find(candidate => lineIds(candidate).some(value => targetIds.has(value)));
    if (match) return match;
  }
  const description = text(line?.description || line?.product || line?.productName || line?.name).toLowerCase();
  if (description) {
    const matches = rows.filter(candidate => text(candidate?.description || candidate?.product || candidate?.productName || candidate?.name).toLowerCase() === description);
    if (matches.length === 1) return matches[0];
  }
  return rows[index] || null;
};

const resolveLinePartNumber = (line, index, sourceCollections = [], inventoryById = new Map()) => {
  const direct = ownPartNumber(line);
  if (direct) return direct;
  for (const sourceLines of sourceCollections) {
    const source = matchingSourceLine(line, index, sourceLines);
    const inherited = ownPartNumber(source);
    if (inherited) return inherited;
  }
  for (const id of lineIds(line)) {
    const inventoryPartNumber = ownPartNumber(inventoryById.get(id));
    if (inventoryPartNumber) return inventoryPartNumber;
  }
  for (const sourceLines of sourceCollections) {
    const source = matchingSourceLine(line, index, sourceLines);
    for (const id of lineIds(source)) {
      const inventoryPartNumber = ownPartNumber(inventoryById.get(id));
      if (inventoryPartNumber) return inventoryPartNumber;
    }
  }
  return '';
};

const validId = value => {
  const id = value?._id || value;
  return id && mongoose.Types.ObjectId.isValid(id) ? id : null;
};

const loadLean = async (Model, value, session) => {
  if (value && typeof value === 'object' && Array.isArray(value.items)) return plain(value);
  const id = validId(value);
  if (!id) return null;
  return Model.findById(id).session(session || null).lean();
};

const resolveDocumentPartNumbers = async (document, documentType, { session = null } = {}) => {
  if (!document) return document;
  const result = plain(document);
  const type = String(documentType || '').toLowerCase();
  const SalesOrder = require('../models/SalesOrder');
  const Quotation = require('../models/Quotation');
  const CustomerPO = require('../models/CustomerPO');
  const ProductFile = require('../models/ProductFile');
  const SupplierPO = require('../models/SupplierPO');
  const DeliveryNote = require('../models/DeliveryNote');
  const InventoryItem = require('../models/InventoryItem');

  let order = type === 'sales-order' ? result : await loadLean(SalesOrder, result.salesOrder || result.salesOrderId, session);
  let supplierPO = type === 'supplier-po' ? result : await loadLean(SupplierPO, result.supplierPO || result.supplierPOId || order?.supplierPoId, session);
  let deliveryNote = type === 'delivery-note' ? result : await loadLean(DeliveryNote, result.deliveryNote || result.deliveryNoteId, session);
  if (!order && deliveryNote) order = await loadLean(SalesOrder, deliveryNote.salesOrder || deliveryNote.salesOrderId, session);
  if (!order && supplierPO) order = await loadLean(SalesOrder, supplierPO.salesOrderId, session);

  const [quotation, customerPO, productFile] = order ? await Promise.all([
    loadLean(Quotation, order.quotationId, session),
    loadLean(CustomerPO, order.customerPOId, session),
    loadLean(ProductFile, order.productFileId, session)
  ]) : [null, null, null];

  if (!supplierPO && order?.supplierPoId) supplierPO = await loadLean(SupplierPO, order.supplierPoId, session);
  const lineKey = type === 'product-file' ? 'products' : 'items';
  const lines = Array.isArray(result[lineKey]) ? result[lineKey] : [];
  const sourceCollections = [];
  const add = rows => {
    if (Array.isArray(rows) && rows.length && rows !== lines) sourceCollections.push(rows);
  };
  if (type === 'invoice') add(deliveryNote?.items);
  if (type === 'grn') add(supplierPO?.items);
  add(order?.items);
  add(productFile?.products);
  add(customerPO?.items);
  add(quotation?.items);

  const inventoryIds = new Set();
  for (const rows of [lines, ...sourceCollections]) {
    for (const line of rows) {
      for (const candidate of [line?.inventoryItem, line?.inventoryItemId, line?.productId]) {
        const id = validId(candidate);
        if (id) inventoryIds.add(String(id));
      }
    }
  }
  const inventory = inventoryIds.size
    ? await InventoryItem.find({ _id: { $in: [...inventoryIds] } }).session(session || null).lean()
    : [];
  const inventoryById = new Map(inventory.map(item => [String(item._id), item]));
  result[lineKey] = lines.map((line, index) => ({
    ...plain(line),
    partNumber: resolveLinePartNumber(line, index, sourceCollections, inventoryById)
  }));
  return result;
};

const resolveDocumentsPartNumbers = (documents, documentType, options) => Promise.all(
  (Array.isArray(documents) ? documents : []).map(document => resolveDocumentPartNumbers(document, documentType, options))
);

module.exports = {
  ownPartNumber,
  matchingSourceLine,
  resolveLinePartNumber,
  resolveDocumentPartNumbers,
  resolveDocumentsPartNumbers
};
