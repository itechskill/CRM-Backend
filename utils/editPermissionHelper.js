const EditPermissionRequest = require('../models/EditPermissionRequest');
const EditAuditLog = require('../models/EditAuditLog');
const { isDirectEditAllowed } = require('../config/documentTypes');

/**
 * Checks if user is authorized to edit a controlled document.
 * 1. Checks direct-edit exceptions (Quotation for Sales Person, Supplier PO for Purchasers, CEO/Admin).
 * 2. Checks active, non-expired, non-used CEO approval belonging specifically to this user and document.
 * 3. Enforces field-level scope if CEO granted SpecificFields access.
 * 4. Marks permission as used (consumed) upon saving and logs complete audit trail.
 */
const isFieldAllowed = (changeField, allowedFields, permissionScope) => {
  if (!changeField) return true;
  if (permissionScope === 'FullDocument' || !allowedFields || allowedFields.length === 0) return true;

  const normalize = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const tokenize = (str) => {
    if (!str) return [];
    const words = String(str)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return Array.from(new Set(words));
  };

  const STOP_WORDS = new Set(['to', 'from', 'and', 'for', 'of', 'in', 'is', 'a', 'the', 'by', 'on', 'with', 'at', 'or', 'so', 'it']);

  const normChange = normalize(changeField);
  const cfTokens = tokenize(changeField);

  // Wildcard check
  for (const af of allowedFields) {
    const normAf = normalize(af);
    if (['all', 'general', 'fulldocument', '*', 'full'].includes(normAf)) return true;
  }

  // Define semantic family mappings for document fields
  const FIELD_FAMILIES = [
    {
      name: 'customer',
      schemaKeys: ['clientname', 'customername', 'client', 'customer', 'contactperson', 'contactname', 'name', 'company'],
      keywords: ['client', 'customer', 'buyer', 'purchaser', 'party', 'name', 'company', 'contact']
    },
    {
      name: 'order',
      schemaKeys: ['ordernumber', 'orderreference', 'fileno', 'filenumber', 'saleordernumber', 'saleorderchangingnumber', 'invoicenumber', 'deliverynumber', 'deliverynotenumber', 'grnnumber', 'ponumber', 'receiptnumber', 'paymentnumber', 'quotationnumber', 'customerponumber'],
      keywords: ['order', 'number', 'no', 'ref', 'reference', 'file', 'fileno', 'so', 'po', 'grn', 'invoice', 'delivery', 'receipt']
    },
    {
      name: 'amount',
      schemaKeys: ['amount', 'totalamount', 'netamount', 'subtotal', 'unitprice', 'price', 'total', 'grandtotal', 'paidamount', 'totalpaid', 'outstandingamount', 'outstandingbalance', 'tax', 'taxrate', 'discount', 'targetamount', 'achievedamount', 'value'],
      keywords: ['amount', 'total', 'net', 'subtotal', 'price', 'unitprice', 'cost', 'val', 'value', 'grand', 'paid', 'outstanding', 'balance', 'tax', 'discount', 'rate']
    },
    {
      name: 'items',
      schemaKeys: ['items', 'productsummary', 'products', 'quantity', 'description', 'notes', 'requirements'],
      keywords: ['item', 'items', 'product', 'products', 'summary', 'quantity', 'qty', 'description', 'detail', 'details']
    },
    {
      name: 'dates',
      schemaKeys: ['duedate', 'issuedate', 'orderdate', 'podate', 'creationdate', 'deliverydate', 'closingdate', 'scheduledat', 'nextfollowupdate'],
      keywords: ['date', 'due', 'issue', 'created', 'creation', 'orderdate', 'podate', 'time', 'scheduled']
    },
    {
      name: 'address',
      schemaKeys: ['clientaddress', 'customeraddress', 'address', 'shippingaddress', 'billingaddress'],
      keywords: ['address', 'location', 'street', 'city', 'shipping', 'billing']
    },
    {
      name: 'contact',
      schemaKeys: ['clientphone', 'customerphone', 'phone', 'clientemail', 'customeremail', 'email', 'contactphone', 'contactemail'],
      keywords: ['phone', 'mobile', 'email', 'mail', 'contact']
    }
  ];

  // Identify matching families for changeField
  const matchingFamilies = FIELD_FAMILIES.filter(family =>
    family.schemaKeys.includes(normChange) ||
    family.keywords.some(kw => cfTokens.includes(kw))
  );

  for (const af of allowedFields) {
    const normAf = normalize(af);
    if (!normAf) continue;

    // 1. Direct exact match
    if (normAf === normChange) return true;

    // 2. Substring inclusion check
    if (normAf.includes(normChange) || normChange.includes(normAf)) return true;

    // 3. Token-level overlap match
    const afTokens = tokenize(af);
    const meaningfulCfTokens = cfTokens.filter(t => !STOP_WORDS.has(t));
    const meaningfulAfTokens = afTokens.filter(t => !STOP_WORDS.has(t));

    const hasCommonToken = meaningfulCfTokens.some(t => meaningfulAfTokens.includes(t));
    if (hasCommonToken) return true;

    // 4. Family Keyword Association match
    for (const family of matchingFamilies) {
      const afHasFamilyKeyword = family.keywords.some(kw => meaningfulAfTokens.includes(kw) || normAf.includes(kw));
      if (afHasFamilyKeyword) return true;
    }
  }

  return false;
};

/**
 * Accurately determines if a document field value has actually changed between old and new state.
 * Prevents false positive changes due to string vs number, Date vs string format, array reference inequality, or empty strings vs null.
 */
const hasFieldValueChanged = (oldVal, newVal) => {
  if (oldVal === newVal) return false;

  // Both falsey or empty (null, undefined, '', empty array/object)
  if (!oldVal && !newVal) return false;

  // Date objects or date ISO strings comparison
  const isOldDate = oldVal instanceof Date || (typeof oldVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(oldVal));
  const isNewDate = newVal instanceof Date || (typeof newVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(newVal));
  if (isOldDate && isNewDate) {
    const d1 = oldVal ? new Date(oldVal).toISOString().substring(0, 10) : '';
    const d2 = newVal ? new Date(newVal).toISOString().substring(0, 10) : '';
    if (d1 && d2 && d1 === d2) return false;
  }

  // Object / Array deep equivalence (e.g., items, productSummary)
  if ((typeof oldVal === 'object' && oldVal !== null) || (typeof newVal === 'object' && newVal !== null)) {
    try {
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return false;
    } catch (e) {}
  }

  // Number vs string numeric equality (e.g., 500 vs "500")
  if ((typeof oldVal === 'number' || (!isNaN(Number(oldVal)) && oldVal !== '')) && (typeof newVal === 'number' || (!isNaN(Number(newVal)) && newVal !== ''))) {
    if (Number(oldVal) === Number(newVal)) return false;
  }

  // String trimming equality
  if (String(oldVal || '').trim() === String(newVal || '').trim()) return false;

  return true;
};

const verifyAndConsumeCEOPermission = async ({ documentType, documentId, documentNumber, requestingUser, changes }) => {
  const userIdStr = String(requestingUser._id || requestingUser.id);
  const docIdStr = String(documentId);

  // Convert changes object/array to standard array of { field, oldValue, newValue }, filtering false positives
  let formattedChanges = [];
  if (Array.isArray(changes)) {
    formattedChanges = changes.filter(c => hasFieldValueChanged(c.oldValue ?? c.old, c.newValue ?? c.new));
  } else if (changes && typeof changes === 'object') {
    formattedChanges = Object.keys(changes)
      .filter(field => {
        const item = changes[field];
        if (item && typeof item === 'object' && ('old' in item || 'oldValue' in item || 'new' in item || 'newValue' in item)) {
          const oldV = item.old !== undefined ? item.old : item.oldValue;
          const newV = item.new !== undefined ? item.new : item.newValue;
          return hasFieldValueChanged(oldV, newV);
        }
        return hasFieldValueChanged(undefined, item);
      })
      .map(field => ({
        field,
        oldValue: changes[field]?.old ?? changes[field]?.oldValue ?? '',
        newValue: changes[field]?.new ?? changes[field]?.newValue ?? changes[field]
      }));
  }

  // 1. Check direct-edit exception
  if (isDirectEditAllowed(documentType, requestingUser.role)) {
    if (formattedChanges.length > 0) {
      await EditAuditLog.create({
        documentType,
        documentId: docIdStr,
        documentNumber: documentNumber || 'N/A',
        editedByUserId: requestingUser._id,
        editedByName: requestingUser.fullName || requestingUser.name || 'User',
        editedByRole: requestingUser.role || '',
        editedByDepartment: requestingUser.department || '',
        permissionType: 'DIRECT_EDIT',
        editPermissionRequestId: null,
        changes: formattedChanges,
        reason: 'Direct edit permitted'
      });
    }
    return { authorized: true };
  }

  // 2. Find approved permission matching document and user specifically
  let permission = await EditPermissionRequest.findOne({
    documentType: { $regex: new RegExp(`^${documentType}$`, 'i') },
    documentId: docIdStr,
    requestedByUserId: requestingUser._id,
    status: 'Approved',
    permissionUsed: false
  }).sort({ approvedAt: -1 });

  if (!permission) {
    // Flexible fallback match if documentType string varied slightly between request and save
    permission = await EditPermissionRequest.findOne({
      documentId: docIdStr,
      requestedByUserId: requestingUser._id,
      status: 'Approved',
      permissionUsed: false
    }).sort({ approvedAt: -1 });
  }

  if (!permission) {
    return {
      authorized: false,
      message: `CEO edit approval required for ${documentType} ${documentNumber || ''}. Please submit an edit permission request.`
    };
  }

  // 3. Check expiration
  if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
    permission.status = 'Expired';
    await permission.save();
    return {
      authorized: false,
      message: `Approved edit permission for ${documentType} ${documentNumber || ''} has expired. Please submit a new request.`
    };
  }

  // 4. Enforce Field Scope if SpecificFields approval
  if (permission.permissionScope === 'SpecificFields' && permission.allowedFields && permission.allowedFields.length > 0) {
    const unallowedField = formattedChanges.find(c => !isFieldAllowed(c.field, permission.allowedFields, permission.permissionScope));
    if (unallowedField) {
      return {
        authorized: false,
        message: `Editing field "${unallowedField.field}" is not allowed under the CEO approval scope for this document.`
      };
    }
  }

  // 5. Consume permission (single-use)
  permission.permissionUsed = true;
  permission.usedAt = new Date();
  permission.status = 'Completed';
  await permission.save();

  // 6. Log audit trail
  if (formattedChanges.length > 0) {
    await EditAuditLog.create({
      documentType,
      documentId: docIdStr,
      documentNumber: documentNumber || 'N/A',
      editedByUserId: requestingUser._id,
      editedByName: requestingUser.fullName || requestingUser.name || 'User',
      editedByRole: requestingUser.role || '',
      editedByDepartment: requestingUser.department || '',
      permissionType: 'CEO_APPROVED',
      editPermissionRequestId: permission._id,
      changes: formattedChanges,
      reason: permission.reason || 'CEO approved edit'
    });
  }

  return { authorized: true, permission };
};

/**
 * Direct edit audit logger for Quotations and Supplier POs
 */
const logCategoryAEdit = async ({ documentType, documentId, documentNumber, changedBy, changes, reason }) => {
  let formattedChanges = [];
  if (Array.isArray(changes)) {
    formattedChanges = changes;
  } else if (changes && typeof changes === 'object') {
    formattedChanges = Object.keys(changes).map(field => ({
      field,
      oldValue: changes[field]?.old ?? changes[field]?.oldValue ?? '',
      newValue: changes[field]?.new ?? changes[field]?.newValue ?? changes[field]
    }));
  }

  if (formattedChanges.length > 0) {
    await EditAuditLog.create({
      documentType,
      documentId: String(documentId),
      documentNumber: documentNumber || 'N/A',
      editedByUserId: changedBy._id || changedBy,
      editedByName: changedBy.fullName || changedBy.name || 'User',
      editedByRole: changedBy.role || '',
      editedByDepartment: changedBy.department || '',
      permissionType: 'DIRECT_EDIT',
      editPermissionRequestId: null,
      changes: formattedChanges,
      reason: reason || 'Direct edit'
    });
  }
};

module.exports = {
  verifyAndConsumeCEOPermission,
  logCategoryAEdit,
  isFieldAllowed,
  hasFieldValueChanged
};
