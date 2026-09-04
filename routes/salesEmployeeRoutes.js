const express = require('express');
const router = express.Router();
const { protect, authorize, requireDepartment } = require('../middleware/authMiddleware');

const {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  updateMyLead,
  getMyDeals,
  createMyDeal,
  updateMyDeal,
  getMyInvoices,
  createMyInvoice,
  getMyQuotations,
  createMyQuotation,
  updateMyQuotation,
  getMyOrders,
  createMyOrder,
  updateMyOrder,
  getMyDeliveryNotes,
  createMyDeliveryNote,
  getMyFollowUps,
  createMyFollowUp,
  updateMyFollowUp,
  getMyTargets,
  getMyActivities
} = require('../controllers/salesEmployeeController');

// All routes: must be authenticated, role=employee, department=Sales
const salesEmployeeGuard = [protect, authorize('employee'), requireDepartment('Sales')];

// Dashboard stats
router.get('/stats', salesEmployeeGuard, getMySalesStats);

// Leads
router.get('/leads', salesEmployeeGuard, getMyLeads);
router.post('/leads', salesEmployeeGuard, createMyLead);
router.patch('/leads/:id', salesEmployeeGuard, updateMyLead);

// Deals (Sales Pipeline)
router.get('/deals', salesEmployeeGuard, getMyDeals);
router.post('/deals', salesEmployeeGuard, createMyDeal);
router.patch('/deals/:id', salesEmployeeGuard, updateMyDeal);

// Invoices
router.get('/invoices', salesEmployeeGuard, getMyInvoices);
router.post('/invoices', salesEmployeeGuard, createMyInvoice);

// Quotations
router.get('/quotations', salesEmployeeGuard, getMyQuotations);
router.post('/quotations', salesEmployeeGuard, createMyQuotation);
router.patch('/quotations/:id', salesEmployeeGuard, updateMyQuotation);

// Sales Orders
router.get('/orders', salesEmployeeGuard, getMyOrders);
router.post('/orders', salesEmployeeGuard, createMyOrder);
router.patch('/orders/:id', salesEmployeeGuard, updateMyOrder);

// Delivery Notes
router.get('/delivery-notes', salesEmployeeGuard, getMyDeliveryNotes);
router.post('/delivery-notes', salesEmployeeGuard, createMyDeliveryNote);

// Follow-ups
router.get('/followups', salesEmployeeGuard, getMyFollowUps);
router.post('/followups', salesEmployeeGuard, createMyFollowUp);
router.patch('/followups/:id', salesEmployeeGuard, updateMyFollowUp);

// Targets (read-only for employees; assigned by manager/admin)
router.get('/targets', salesEmployeeGuard, getMyTargets);

// Activities
router.get('/activities', salesEmployeeGuard, getMyActivities);

module.exports = router;
