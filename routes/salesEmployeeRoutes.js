const express = require('express');
const router = express.Router();
const { protect, authorize, requireDepartment } = require('../middleware/authMiddleware');

const {
  getMySalesStats,
  getMyLeads,
  createMyLead,
  convertLeadToDeal,
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
  convertQuotationToSalesOrder,
  convertQuotationToCustomerPO,
  convertCustomerPOToProductFile,
  convertProductFileToSalesOrder,
  checkCustomerOverdueApi,
  getMyOrders,
  getAvailableOrdersForDelivery,
  checkOrderStock,
  createMyOrder,
  updateMyOrder,
  deleteMyOrder,
  financeReviewSalesOrder,
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
  sendOrderToSupport,
  sendSalesOrderToFinance,
  getSupportStats,
  getInventoryItems,
  createOrUpdateInventoryItem,
  confirmDeliveryNoteWithInventory,
  getAccountsStats,
  getAccountsPendingDeliveryNotes,
  sendInvoiceToFinance,
  returnInvoiceToAccounts,
  finalizeInvoice,
  getFinanceStats,
  getFinanceReceivables,
  recordGoodsReceivedInOffice,
  recordBLInput,
  issueSupplierPO,
  getOrderDocumentPackage
} = require('../controllers/salesEmployeeController');

// All Departmental Roles, Admin & CEO access departmental CRM endpoints
const salesEmployeeGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'support', 'logistics', 'purchaser', 'accountant', 'finance', 'sales_manager', 'admin', 'ceo')];

// Dashboard stats
router.get('/stats', salesEmployeeGuard, getMySalesStats);

// Master Document Package
router.get('/orders/:id/document-package', salesEmployeeGuard, getOrderDocumentPackage);

// Customer Overdue Check
router.get('/check-overdue', salesEmployeeGuard, checkCustomerOverdueApi);

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

// Invoices & Finance Handoff
router.get('/invoices', salesEmployeeGuard, getMyInvoices);
router.post('/invoices', salesEmployeeGuard, createMyInvoice);
router.patch('/invoices/:id', salesEmployeeGuard, updateMyInvoice);
router.delete('/invoices/:id', salesEmployeeGuard, deleteMyInvoice);
router.post('/invoices/:id/send-to-finance', salesEmployeeGuard, sendInvoiceToFinance);
router.post('/invoices/:id/return-to-accounts', salesEmployeeGuard, returnInvoiceToAccounts);
router.post('/invoices/:id/finalize', salesEmployeeGuard, finalizeInvoice);

// Quotations
router.get('/quotations', salesEmployeeGuard, getMyQuotations);
router.post('/quotations', salesEmployeeGuard, createMyQuotation);
router.post('/quotations/:id/convert-to-order', salesEmployeeGuard, convertQuotationToSalesOrder);
router.post('/quotations/:id/convert-to-po', salesEmployeeGuard, convertQuotationToCustomerPO);
router.patch('/quotations/:id', salesEmployeeGuard, updateMyQuotation);
router.delete('/quotations/:id', salesEmployeeGuard, deleteMyQuotation);

// Sales Orders & Support Handoff
router.get('/orders', salesEmployeeGuard, getMyOrders);
router.get('/orders/available-for-delivery', salesEmployeeGuard, getAvailableOrdersForDelivery);
router.get('/orders/:id/stock-check', salesEmployeeGuard, checkOrderStock);
router.post('/orders', salesEmployeeGuard, createMyOrder);
router.post('/orders/:id/send-to-support', salesEmployeeGuard, sendOrderToSupport);
router.post('/orders/:id/send-to-finance', salesEmployeeGuard, sendSalesOrderToFinance);
router.post('/orders/:id/finance-review', salesEmployeeGuard, financeReviewSalesOrder);
router.post('/orders/:id/goods-received', salesEmployeeGuard, recordGoodsReceivedInOffice);
router.post('/orders/:id/bl-input', salesEmployeeGuard, recordBLInput);
router.post('/orders/:id/issue-supplier-po', salesEmployeeGuard, issueSupplierPO);
router.patch('/orders/:id', salesEmployeeGuard, updateMyOrder);
router.delete('/orders/:id', salesEmployeeGuard, deleteMyOrder);

// Support & Inventory Department Routes
router.get('/support/stats', salesEmployeeGuard, getSupportStats);
router.get('/inventory', salesEmployeeGuard, getInventoryItems);
router.post('/inventory', salesEmployeeGuard, createOrUpdateInventoryItem);

// Proforma Invoices
router.get('/proforma-invoices', salesEmployeeGuard, getMyProformaInvoices);
router.post('/proforma-invoices', salesEmployeeGuard, createMyProformaInvoice);
router.patch('/proforma-invoices/:id', salesEmployeeGuard, updateMyProformaInvoice);
router.delete('/proforma-invoices/:id', salesEmployeeGuard, deleteMyProformaInvoice);

// Delivery Notes & Accounts Handoff
router.get('/delivery-notes', salesEmployeeGuard, getMyDeliveryNotes);
router.post('/delivery-notes', salesEmployeeGuard, createMyDeliveryNote);
router.post('/delivery-notes/:id/confirm', salesEmployeeGuard, confirmDeliveryNoteWithInventory);
router.patch('/delivery-notes/:id', salesEmployeeGuard, updateMyDeliveryNote);
router.delete('/delivery-notes/:id', salesEmployeeGuard, deleteMyDeliveryNote);

// Accounts Department Stats & Pending Delivery Notes
router.get('/accounts/stats', salesEmployeeGuard, getAccountsStats);
router.get('/accounts/pending-delivery-notes', salesEmployeeGuard, getAccountsPendingDeliveryNotes);

// Finance Department Stats & Receivables
router.get('/finance/stats', salesEmployeeGuard, getFinanceStats);
router.get('/finance/receivables', salesEmployeeGuard, getFinanceReceivables);

// Follow-ups
router.get('/followups', salesEmployeeGuard, getMyFollowUps);
router.post('/followups', salesEmployeeGuard, createMyFollowUp);
router.patch('/followups/:id', salesEmployeeGuard, updateMyFollowUp);
router.delete('/followups/:id', salesEmployeeGuard, deleteMyFollowUp);

// Customer Purchase Orders
router.get('/customer-pos', salesEmployeeGuard, getMyCustomerPOs);
router.post('/customer-pos', salesEmployeeGuard, createMyCustomerPO);
router.post('/customer-pos/:id/convert-to-file', salesEmployeeGuard, convertCustomerPOToProductFile);
router.patch('/customer-pos/:id', salesEmployeeGuard, updateMyCustomerPO);
router.delete('/customer-pos/:id', salesEmployeeGuard, deleteMyCustomerPO);

// Product Files (Blue/Green)
router.get('/product-files', salesEmployeeGuard, getMyProductFiles);
router.post('/product-files', salesEmployeeGuard, createMyProductFile);
router.post('/product-files/:id/convert-to-order', salesEmployeeGuard, convertProductFileToSalesOrder);
router.patch('/product-files/:id', salesEmployeeGuard, updateMyProductFile);
router.delete('/product-files/:id', salesEmployeeGuard, deleteMyProductFile);

// Payments
router.get('/payments', salesEmployeeGuard, getMyPayments);
router.post('/payments', salesEmployeeGuard, createMyPayment);
router.patch('/payments/:id', salesEmployeeGuard, updateMyPayment);
router.delete('/payments/:id', salesEmployeeGuard, deleteMyPayment);

// Targets
router.get('/targets', salesEmployeeGuard, getMyTargets);

// Activities
router.get('/activities', salesEmployeeGuard, getMyActivities);

module.exports = router;
