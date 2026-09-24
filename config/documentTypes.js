/**
 * Centralized Document Type Configuration for Fortline CRM
 */
const DOCUMENT_TYPES = {
  QUOTATION: 'Quotation',
  SUPPLIER_PO: 'Supplier PO',
  SALES_ORDER: 'Sales Order',
  DELIVERY_NOTE: 'Delivery Note',
  GRN: 'GRN',
  DRAFT_INVOICE: 'Draft Invoice',
  FINAL_INVOICE: 'Final Invoice',
  CUSTOMER_PAYMENT: 'Customer Payment',
  LOCAL_PAYABLE: 'Local Payable'
};

const DIRECT_EDIT_EXCEPTIONS = [
  { documentType: DOCUMENT_TYPES.QUOTATION, allowedRoles: ['employee', 'sales_person', 'sales_member', 'sales_manager', 'admin', 'ceo'] },
  { documentType: DOCUMENT_TYPES.SUPPLIER_PO, allowedRoles: ['purchaser', 'local_purchaser', 'global_purchaser', 'admin', 'ceo'] }
];

/**
 * Checks whether a document type and user role combo qualifies for direct editing
 */
const isDirectEditAllowed = (documentType, userRole) => {
  if (!userRole) return false;
  if (['ceo', 'admin'].includes(userRole)) return true;
  
  const exception = DIRECT_EDIT_EXCEPTIONS.find(
    e => e.documentType.toLowerCase() === (documentType || '').toLowerCase()
  );
  
  return exception ? exception.allowedRoles.includes(userRole) : false;
};

module.exports = {
  DOCUMENT_TYPES,
  DIRECT_EDIT_EXCEPTIONS,
  isDirectEditAllowed
};
