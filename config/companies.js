const DOCUMENT_TYPES = Object.freeze({
  QUOTATION: 'Quotation',
  LOCAL_PO: 'LocalPO',
  GLOBAL_PO: 'GlobalPO'
});

const COMPANIES = Object.freeze([
  Object.freeze({
    code: 'FORTLINE_ENTERPRISES',
    legalName: 'Fortline Enterprises',
    address: '',
    taxId: '',
    phone: '',
    allowedDocumentTypes: Object.freeze([DOCUMENT_TYPES.QUOTATION, DOCUMENT_TYPES.LOCAL_PO, DOCUMENT_TYPES.GLOBAL_PO])
  }),
  Object.freeze({
    code: 'FORTLINE_PRIVATE_LIMITED',
    legalName: 'Fortline Private Limited',
    address: '',
    taxId: '',
    phone: '',
    allowedDocumentTypes: Object.freeze([DOCUMENT_TYPES.QUOTATION, DOCUMENT_TYPES.LOCAL_PO, DOCUMENT_TYPES.GLOBAL_PO])
  }),
  Object.freeze({
    code: 'HIGH_CLOUD_TRADING_LLC',
    legalName: 'High Cloud Trading LLC',
    address: '',
    taxId: '',
    phone: '',
    allowedDocumentTypes: Object.freeze([DOCUMENT_TYPES.QUOTATION, DOCUMENT_TYPES.GLOBAL_PO])
  }),
  Object.freeze({
    code: 'WWTS',
    legalName: 'Worldwide Techsolutions (WWTS)',
    address: '',
    taxId: '',
    phone: '',
    allowedDocumentTypes: Object.freeze([DOCUMENT_TYPES.QUOTATION, DOCUMENT_TYPES.LOCAL_PO, DOCUMENT_TYPES.GLOBAL_PO])
  })
]);

const cloneCompany = (company) => company ? {
  code: company.code,
  legalName: company.legalName,
  address: company.address || '',
  taxId: company.taxId || '',
  phone: company.phone || '',
  allowedDocumentTypes: [...company.allowedDocumentTypes]
} : null;

const getCompanyByCode = (code) => COMPANIES.find(company => company.code === String(code || '').trim()) || null;

const companyValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const getCompanySnapshot = (code, documentType) => {
  const company = getCompanyByCode(code);
  if (!company) throw companyValidationError('Select a valid issuing company.');
  if (!company.allowedDocumentTypes.includes(documentType)) {
    throw companyValidationError(`${company.legalName} is not allowed for this document type.`);
  }
  return cloneCompany(company);
};

const inheritCompanySnapshot = (document) => document?.issuingCompany?.code
  ? cloneCompany(document.issuingCompany)
  : null;

const resolvePOCompany = ({ poType, requestedCompanyCode, order }) => {
  const documentType = poType === 'Global' ? DOCUMENT_TYPES.GLOBAL_PO : DOCUMENT_TYPES.LOCAL_PO;
  const inherited = inheritCompanySnapshot(order);
  const requestedCode = String(requestedCompanyCode || '').trim();
  const selectedCode = requestedCode || inherited?.code || '';

  if (!selectedCode) throw companyValidationError('Issuing company is required for a new purchase order.');

  try {
    return getCompanySnapshot(selectedCode, documentType);
  } catch (error) {
    if (!requestedCode && inherited) {
      throw companyValidationError(`${inherited.legalName} is not allowed for a ${poType} purchase order. Select an allowed issuing company.`);
    }
    throw error;
  }
};

module.exports = {
  COMPANIES,
  DOCUMENT_TYPES,
  getCompanySnapshot,
  inheritCompanySnapshot,
  resolvePOCompany
};
