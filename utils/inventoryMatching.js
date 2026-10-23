const normalizeInventoryName = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  const duplicatedSuffix = raw.match(/^(.*?)\s*\((.*?)\)$/);
  const withoutDuplicate = duplicatedSuffix && duplicatedSuffix[1].trim() === duplicatedSuffix[2].trim()
    ? duplicatedSuffix[1]
    : raw;

  // Matching deliberately ignores case, whitespace and punctuation only.
  // This makes "512GB SSD" and "512 GB SSD" equal without fuzzy matching.
  return withoutDuplicate.replace(/[^a-z0-9]+/g, '');
};

const normalizeSku = (value) => String(value || '').trim().toLowerCase();

const getInventoryMatches = (orderItem, inventoryItems) => {
  const productName = normalizeInventoryName(
    orderItem?.description || orderItem?.productName || orderItem?.name
  );
  const sku = normalizeSku(orderItem?.productCode || orderItem?.sku);

  return (inventoryItems || []).filter((item) => {
    const nameMatches = productName && normalizeInventoryName(item.name) === productName;
    const skuMatches = sku && normalizeSku(item.sku) === sku;
    return Boolean(nameMatches || skuMatches);
  });
};

module.exports = { normalizeInventoryName, getInventoryMatches };
