const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
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
  getFinancialCharges,
  createFinancialCharge,
  getPurchaserDashboardStats,
  getPendingPurchaserOrders,
  performInventoryCheck,
  completeProcurementAndSendToSupport,
  globalProcurementSendToLogistics,
  sendGlobalOrderToLogistics,
  getPurchaserInventory,
  createOrUpdatePurchaserInventory,
  deletePurchaserInventoryItem
} = require('../controllers/purchaserController');

// All endpoints require authentication
router.use(protect);

// Master Workflow Order Routes
router.get('/pending-orders', getPendingPurchaserOrders);
router.post('/orders/:id/inventory-check', performInventoryCheck);
router.post('/orders/:id/complete-procurement', completeProcurementAndSendToSupport);
router.post('/orders/:id/global-po', globalProcurementSendToLogistics);
router.post('/orders/:id/send-to-logistics', sendGlobalOrderToLogistics);

// Inventory Management
router.get('/inventory', getPurchaserInventory);
router.post('/inventory', createOrUpdatePurchaserInventory);
router.put('/inventory/:id', createOrUpdatePurchaserInventory);
router.delete('/inventory/:id', deletePurchaserInventoryItem);

// Supplier Management
router.get('/suppliers', getSuppliers);
router.post('/suppliers', createSupplier);

// Supplier POs
router.get('/pos', getSupplierPOs);
router.post('/pos', createSupplierPO);
router.patch('/pos/:id', updateSupplierPO);
router.put('/pos/:id', updateSupplierPO);
router.delete('/pos/:id', deleteSupplierPO);

// GRNs
router.get('/grns', getPurchaserGRNs);
router.post('/grns', createPurchaserGRN);

// Local Payables
router.get('/payables', getLocalPayables);
router.post('/payables', createLocalPayable);

// Financial Charges (Accessible by Finance, Admin, CEO, Accountant)
router.get('/financial-charges', getFinancialCharges);
router.post('/financial-charges', createFinancialCharge);

// Dashboard Statistics
router.get('/stats', getPurchaserDashboardStats);

module.exports = router;
