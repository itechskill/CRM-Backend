const roundMoney = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizePartNumber = item => String(
  item?.partNumber || item?.sku || item?.productCode || ''
).trim();

const normalizeCommercialItems = (items = []) => (Array.isArray(items) ? items : []).map(item => {
  const source = typeof item?.toObject === 'function' ? item.toObject() : (item || {});
  const quantity = Math.max(1, Number(source.quantity) || 1);
  const unitPrice = Math.max(0, Number(source.unitPrice) || 0);
  return {
    ...source,
    partNumber: normalizePartNumber(source),
    quantity,
    unitPrice,
    total: roundMoney(quantity * unitPrice)
  };
});

const calculateDocumentFinancials = ({ items = [], discount = 0, taxRate = 0 }) => {
  const normalizedItems = normalizeCommercialItems(items);
  const subtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + item.total, 0));
  const normalizedDiscount = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const normalizedTaxRate = Math.max(0, Math.min(100, Number(taxRate) || 0));
  const taxableAmount = roundMoney(Math.max(0, subtotal - normalizedDiscount));
  const tax = roundMoney(taxableAmount * normalizedTaxRate / 100);
  const grandTotal = roundMoney(taxableAmount + tax);
  return {
    items: normalizedItems,
    subtotal,
    discount: normalizedDiscount,
    taxableAmount,
    taxRate: normalizedTaxRate,
    tax,
    grandTotal
  };
};

module.exports = {
  roundMoney,
  normalizePartNumber,
  normalizeCommercialItems,
  calculateDocumentFinancials
};
