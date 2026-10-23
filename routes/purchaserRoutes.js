const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const Supplier = require('../models/Supplier');
const SupplierPO = require('../models/SupplierPO');
const {
  getSuppliers,
  createSupplier,
  getSupplierPOs,
  createSupplierPO,
  updateSupplierPO,
  deleteSupplierPO,
  getPurchaserGRNs,
  createPurchaserGRN,
  getLocalPayables,
  createLocalPayable,
  recordLocalPayablePayment,
  getFinancialCharges,
  createFinancialCharge,
  getPurchaserDashboardStats,
  getPendingPurchaserOrders,
  performInventoryCheck,
  linkOrderLineToInventory,
  completeProcurementAndSendToSupport,
  globalProcurementSendToLogistics,
  updateGlobalProcurementCheckpoint,
  sendGlobalOrderToLogistics,
  getPurchaserInventory,
  createOrUpdatePurchaserInventory,
  deletePurchaserInventoryItem
} = require('../controllers/purchaserController');
const {
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  getSupplierPOExpenses,
  addSupplierPOExpense,
  updateSupplierPOExpense,
  removeSupplierPOExpense
} = require('../controllers/purchaseExpenseController');

// All endpoints require authentication
router.use(protect);

const purchaserAccess = authorize('purchaser', 'admin', 'ceo');
const inventoryManagementAccess = authorize('admin', 'ceo');
const financialChargesAccess = authorize('finance', 'accountant', 'admin', 'ceo');
const expenseReadAccess = authorize('support', 'finance', 'purchaser', 'admin', 'ceo');
const expenseWriteAccess = authorize('support', 'finance', 'purchaser', 'admin');

const requirePurchaserSubDept = (requiredSubDept) => (req, res, next) => {
  if (req.user.role === 'admin' || req.user.role === 'ceo') {
    return next();
  }

  const actualSubDept = req.user.purchaserSubDept === 'Global' ? 'Global' : 'Local';
  if (actualSubDept !== requiredSubDept) {
    return res.status(403).json({
      success: false,
      message: `Access denied. This route is for the ${requiredSubDept} Purchaser.`
    });
  }

  return next();
};

const localPurchaserAccess = [purchaserAccess, requirePurchaserSubDept('Local')];
const globalPurchaserAccess = [purchaserAccess, requirePurchaserSubDept('Global')];
const localPayablesReadAccess = [
  authorize('purchaser', 'finance', 'accountant', 'admin', 'ceo'),
  (req, res, next) => {
    if (req.user.role !== 'purchaser') return next();
    return requirePurchaserSubDept('Local')(req, res, next);
  }
];
const localPayablePaymentAccess = [
  authorize('purchaser', 'finance', 'admin', 'ceo'),
  (req, res, next) => {
    if (req.user.role !== 'purchaser') return next();
    return requirePurchaserSubDept('Local')(req, res, next);
  }
];

const normalizePurchaserType = (value) => {
  if (value === 'Global' || value === 'International') return 'Global';
  if (value === 'Local') return 'Local';
  return null;
};

// App.jsx selects Global only for the exact value "Global" and otherwise
// displays the Local portal. Keep backend scoping identical for older users.
const getUserPurchaserSubDept = (user) => user.purchaserSubDept === 'Global' ? 'Global' : 'Local';

const resolvePurchaserRequestType = (req, requestedType) => {
  const normalizedRequestedType = normalizePurchaserType(requestedType);
  if (requestedType && !normalizedRequestedType) {
    return { invalid: true };
  }
  if (req.user.role !== 'purchaser') {
    return { type: normalizedRequestedType };
  }

  const userType = getUserPurchaserSubDept(req.user);
  if (normalizedRequestedType && normalizedRequestedType !== userType) {
    return { forbidden: true };
  }
  return { type: userType };
};

const sendTypeScopeError = (result, res) => {
  if (result.invalid) {
    res.status(400).json({ success: false, message: 'Purchaser type must be Local or Global.' });
    return true;
  }
  if (result.forbidden) {
    res.status(403).json({
      success: false,
      message: 'Access denied. Local and Global Purchasers may only access their own purchasing records.'
    });
    return true;
  }
  return false;
};

const getSupplierRecordType = (supplier) => {
  const record = supplier?._doc || supplier;
  if (
    normalizePurchaserType(record?.supplierType) === 'Global' ||
    normalizePurchaserType(record?.type) === 'Global'
  ) {
    return 'Global';
  }
  return 'Local';
};

const getSupplierPORecordType = (po) => {
  const record = po?._doc || po;
  if (
    normalizePurchaserType(record?.poType) === 'Global' ||
    normalizePurchaserType(record?.supplierType) === 'Global' ||
    record?.fileType === 'Blue' ||
    /^(GPO|IPO)-/i.test(record?.poNumber || '')
  ) {
    return 'Global';
  }
  return 'Local';
};

const scopePurchaserQuery = (queryFields) => (req, res, next) => {
  const requestedType = queryFields.map(field => req.query[field]).find(Boolean);
  const result = resolvePurchaserRequestType(req, requestedType);
  if (sendTypeScopeError(result, res)) return;
  if (result.type) {
    req.query.subDept = result.type;
    req.query.type = result.type;
  }
  next();
};

const scopePurchaserBody = (bodyFields, targetField) => (req, res, next) => {
  const requestedType = bodyFields.map(field => req.body[field]).find(Boolean);
  const result = resolvePurchaserRequestType(req, requestedType);
  if (sendTypeScopeError(result, res)) return;
  if (result.type) {
    req.body[targetField] = result.type;
  }
  next();
};

const scopePurchaserList = (recordType, queryFields) => (req, res, next) => {
  const requestedType = queryFields.map(field => req.query[field]).find(Boolean);
  const result = resolvePurchaserRequestType(req, requestedType);
  if (sendTypeScopeError(result, res)) return;

  queryFields.forEach(field => delete req.query[field]);
  if (!result.type) return next();

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (!payload?.success) return originalJson(payload);
    const aliases = recordType === 'supplier' ? ['data', 'suppliers'] : ['data', 'pos'];
    const source = aliases.map(alias => payload[alias]).find(Array.isArray) || [];
    const getRecordType = recordType === 'supplier' ? getSupplierRecordType : getSupplierPORecordType;
    const scopedRecords = source.filter(record => getRecordType(record) === result.type);
    aliases.forEach(alias => {
      if (Array.isArray(payload[alias])) payload[alias] = scopedRecords;
    });
    payload.count = scopedRecords.length;
    return originalJson(payload);
  };
  next();
};

const scopePurchaserStats = async (req, res, next) => {
  try {
    const targetType = normalizePurchaserType(req.query.subDept || req.query.type) || getUserPurchaserSubDept(req.user);
    const suppliers = await Supplier.find({}).select('supplierType type');
    const totalSuppliers = suppliers.filter(supplier => getSupplierRecordType(supplier) === targetType).length;
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      if (!payload?.success) return originalJson(payload);
      ['data', 'stats'].forEach(alias => {
        if (!payload[alias]) return;
        payload[alias].totalSuppliers = totalSuppliers;
        if (targetType === 'Global') {
          payload[alias].totalGRNs = 0;
          payload[alias].pendingGRNs = 0;
          payload[alias].totalPayablesAmount = 0;
          payload[alias].totalProducts = 0;
        }
      });
      return originalJson(payload);
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireSupplierPOOwnership = async (req, res, next) => {
  if (req.user.role === 'admin' || req.user.role === 'ceo') return next();
  try {
    const po = await SupplierPO.findById(req.params.id).select('poType supplierType fileType poNumber');
    if (!po) return next();
    if (getSupplierPORecordType(po) !== getUserPurchaserSubDept(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This Supplier PO belongs to the other purchasing department.'
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

// Master Workflow Order Routes
router.get('/pending-orders', purchaserAccess, scopePurchaserQuery(['subDept', 'type']), getPendingPurchaserOrders);
router.post('/orders/:id/inventory-check', localPurchaserAccess, performInventoryCheck);
router.post('/orders/:id/inventory-link', localPurchaserAccess, linkOrderLineToInventory);
router.post('/orders/:id/complete-procurement', localPurchaserAccess, completeProcurementAndSendToSupport);
router.post('/orders/:id/global-po', globalPurchaserAccess, globalProcurementSendToLogistics);
router.post('/orders/:id/global-checkpoint', globalPurchaserAccess, updateGlobalProcurementCheckpoint);
router.post('/orders/:id/send-to-logistics', globalPurchaserAccess, sendGlobalOrderToLogistics);

// Inventory Management
router.get('/inventory', localPurchaserAccess, getPurchaserInventory);
router.post('/inventory', inventoryManagementAccess, createOrUpdatePurchaserInventory);
router.put('/inventory/:id', inventoryManagementAccess, createOrUpdatePurchaserInventory);
router.delete('/inventory/:id', inventoryManagementAccess, deletePurchaserInventoryItem);

// Supplier Management
router.get('/suppliers', purchaserAccess, scopePurchaserList('supplier', ['supplierType', 'type']), getSuppliers);
router.post('/suppliers', purchaserAccess, scopePurchaserBody(['supplierType', 'type'], 'supplierType'), createSupplier);

// Supplier POs
router.get('/pos', expenseReadAccess, scopePurchaserList('po', ['poType', 'subType', 'type']), getSupplierPOs);
router.post('/pos', purchaserAccess, scopePurchaserBody(['poType', 'subType', 'type'], 'poType'), createSupplierPO);
router.get('/expense-categories', expenseReadAccess, listExpenseCategories);
router.post('/expense-categories', expenseWriteAccess, createExpenseCategory);
router.patch('/expense-categories/:key', authorize('admin'), updateExpenseCategory);
router.get('/pos/:id/expenses', expenseReadAccess, getSupplierPOExpenses);
router.post('/pos/:id/expenses', expenseWriteAccess, addSupplierPOExpense);
router.patch('/pos/:id/expenses/:expenseId', expenseWriteAccess, updateSupplierPOExpense);
router.delete('/pos/:id/expenses/:expenseId', expenseWriteAccess, removeSupplierPOExpense);
router.patch('/pos/:id', purchaserAccess, requireSupplierPOOwnership, updateSupplierPO);
router.put('/pos/:id', purchaserAccess, requireSupplierPOOwnership, updateSupplierPO);
router.delete('/pos/:id', purchaserAccess, requireSupplierPOOwnership, deleteSupplierPO);

// GRNs
router.get('/grns', localPurchaserAccess, getPurchaserGRNs);
router.post('/grns', localPurchaserAccess, createPurchaserGRN);

// Local Payables
router.get('/payables', localPayablesReadAccess, getLocalPayables);
router.post('/payables', localPurchaserAccess, createLocalPayable);
router.post('/payables/:id/payments', localPayablePaymentAccess, recordLocalPayablePayment);

// Financial Charges (Accessible by Finance, Admin, CEO, Accountant)
router.get('/financial-charges', financialChargesAccess, getFinancialCharges);
router.post('/financial-charges', financialChargesAccess, createFinancialCharge);

// Dashboard Statistics
router.get('/stats', purchaserAccess, scopePurchaserQuery(['subDept', 'type']), scopePurchaserStats, getPurchaserDashboardStats);

module.exports = router;
