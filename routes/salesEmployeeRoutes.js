const express = require('express');
const router = express.Router();
const { protect, authorize, requireDepartment } = require('../middleware/authMiddleware');

const {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  updateMyLead,
  deleteMyLead,
  getMyDeals,
  createMyDeal,
  updateMyDeal,
  deleteMyDeal,
  getMyInvoices,
  createMyInvoice,
  updateMyInvoice,
  deleteMyInvoice,
  getMyQuotations,
  createMyQuotation,
  updateMyQuotation,
  deleteMyQuotation,
  getMyOrders,
  createMyOrder,
  updateMyOrder,
  deleteMyOrder,
  getMyProformaInvoices,
  createMyProformaInvoice,
  updateMyProformaInvoice,
  deleteMyProformaInvoice,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  updateMyDeliveryNote,
  deleteMyDeliveryNote,
  getMyFollowUps,
  createMyFollowUp,
  updateMyFollowUp,
  deleteMyFollowUp,
  getMyTargets,
  getMyActivities,
  getMyCustomerPOs,
  createMyCustomerPO,
  updateMyCustomerPO,
  deleteMyCustomerPO,
  getMyProductFiles,
  createMyProductFile,
  updateMyProductFile,
  deleteMyProductFile,
  getMyPayments,
  createMyPayment,
  updateMyPayment,
  deleteMyPayment,
  convertLeadToDeal,
  checkOrderStock,
  getAvailableOrdersForDelivery
} = require('../controllers/salesEmployeeController');

// Sales Employee, Sales Manager, Admin, CEO can access and manage sales records
const salesEmployeeGuard = [protect, authorize('employee', 'sales_manager', 'admin', 'ceo')];

// Dashboard stats
router.get('/stats', salesEmployeeGuard, getMySalesStats);

// Leads
router.get('/leads', salesEmployeeGuard, getMyLeads);
router.post('/leads', salesEmployeeGuard, createMyLead);
router.post('/leads/:id/convert-to-deal', salesEmployeeGuard, convertLeadToDeal);
router.patch('/leads/:id', salesEmployeeGuard, updateMyLead);
router.delete('/leads/:id', salesEmployeeGuard, deleteMyLead);

// Deals (Sales Pipeline)
router.get('/deals', salesEmployeeGuard, getMyDeals);
router.post('/deals', salesEmployeeGuard, createMyDeal);
router.patch('/deals/:id', salesEmployeeGuard, updateMyDeal);
router.delete('/deals/:id', salesEmployeeGuard, deleteMyDeal);

// Invoices
router.get('/invoices', salesEmployeeGuard, getMyInvoices);
router.post('/invoices', salesEmployeeGuard, createMyInvoice);
router.patch('/invoices/:id', salesEmployeeGuard, updateMyInvoice);
router.delete('/invoices/:id', salesEmployeeGuard, deleteMyInvoice);

// Quotations
router.get('/quotations', salesEmployeeGuard, getMyQuotations);
router.post('/quotations', salesEmployeeGuard, createMyQuotation);
router.patch('/quotations/:id', salesEmployeeGuard, updateMyQuotation);
router.delete('/quotations/:id', salesEmployeeGuard, deleteMyQuotation);

// Sales Orders & Inventory Stock Check
router.get('/orders', salesEmployeeGuard, getMyOrders);
router.get('/orders/available-for-delivery', salesEmployeeGuard, getAvailableOrdersForDelivery);
router.get('/orders/:id/stock-check', salesEmployeeGuard, checkOrderStock);
router.post('/orders', salesEmployeeGuard, createMyOrder);
router.patch('/orders/:id', salesEmployeeGuard, updateMyOrder);
router.delete('/orders/:id', salesEmployeeGuard, deleteMyOrder);

// Proforma Invoices (Optional stage: Sales Order -> Proforma Invoice -> Delivery Note)
router.get('/proforma-invoices', salesEmployeeGuard, getMyProformaInvoices);
router.post('/proforma-invoices', salesEmployeeGuard, createMyProformaInvoice);
router.patch('/proforma-invoices/:id', salesEmployeeGuard, updateMyProformaInvoice);
router.delete('/proforma-invoices/:id', salesEmployeeGuard, deleteMyProformaInvoice);

// Delivery Notes
router.get('/delivery-notes', salesEmployeeGuard, getMyDeliveryNotes);
router.post('/delivery-notes', salesEmployeeGuard, createMyDeliveryNote);
router.patch('/delivery-notes/:id', salesEmployeeGuard, updateMyDeliveryNote);
router.delete('/delivery-notes/:id', salesEmployeeGuard, deleteMyDeliveryNote);

// Follow-ups
router.get('/followups', salesEmployeeGuard, getMyFollowUps);
router.post('/followups', salesEmployeeGuard, createMyFollowUp);
router.patch('/followups/:id', salesEmployeeGuard, updateMyFollowUp);
router.delete('/followups/:id', salesEmployeeGuard, deleteMyFollowUp);

// Customer Purchase Orders
router.get('/customer-pos', salesEmployeeGuard, getMyCustomerPOs);
router.post('/customer-pos', salesEmployeeGuard, createMyCustomerPO);
router.patch('/customer-pos/:id', salesEmployeeGuard, updateMyCustomerPO);
router.delete('/customer-pos/:id', salesEmployeeGuard, deleteMyCustomerPO);

// Product Files (Blue/Green)
router.get('/product-files', salesEmployeeGuard, getMyProductFiles);
router.post('/product-files', salesEmployeeGuard, createMyProductFile);
router.patch('/product-files/:id', salesEmployeeGuard, updateMyProductFile);
router.delete('/product-files/:id', salesEmployeeGuard, deleteMyProductFile);

// Payments
router.get('/payments', salesEmployeeGuard, getMyPayments);
router.post('/payments', salesEmployeeGuard, createMyPayment);
router.patch('/payments/:id', salesEmployeeGuard, updateMyPayment);
router.delete('/payments/:id', salesEmployeeGuard, deleteMyPayment);

// Targets (read-only for employees; assigned by manager/admin)
router.get('/targets', salesEmployeeGuard, getMyTargets);

// Activities
router.get('/activities', salesEmployeeGuard, getMyActivities);

module.exports = router;
