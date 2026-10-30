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
  getQuotationForwardTargets,
  forwardQuotation,
  convertQuotationToSalesOrder,
  convertQuotationToCustomerPO,
  convertCustomerPOToProductFile,
  convertProductFileToSalesOrder,
  checkCustomerOverdueApi,
  getMyOrders,
  getMyOrderActivity,
  getAvailableOrdersForDelivery,
  checkOrderStock,
  checkDeliveryNoteStock,
  getGoodsReceivingPreview,
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
  updateDeliveryNoteExpiry,
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
  getReceiptVoucher,
  createMyPayment,
  updateMyPayment,
  deleteMyPayment,
  sendOrderToSupport,
  sendSalesOrderToFinance,
  getSupportStats,
  getInventoryItems,
  createOrUpdateInventoryItem,
  addInventoryStock,
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

const salesGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'admin', 'ceo')];
const departmentReadGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'support', 'logistics', 'purchaser', 'accountant', 'finance', 'sales_manager', 'admin', 'ceo')];
const salesAndSupportGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'support', 'admin', 'ceo')];
const salesAccountsGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'accountant', 'admin', 'ceo')];
const paymentGuard = [protect, authorize('employee', 'sales_member', 'sales_rep', 'sales_person', 'sales_manager', 'accountant', 'finance', 'admin', 'ceo')];
const receiptVoucherGuard = [protect, authorize('accountant', 'finance', 'admin', 'ceo')];
const accountsGuard = [protect, authorize('accountant', 'admin', 'ceo')];
const supportInventoryReadGuard = [protect, authorize('support', 'admin', 'ceo')];
const supportInventoryWriteGuard = [protect, authorize('support', 'admin')];
const inventoryStockWriteGuard = [protect, authorize('support', 'finance', 'admin')];
const financeReviewGuard = [protect, authorize('finance', 'admin', 'ceo')];

// Dashboard stats
router.get('/stats', salesGuard, getMySalesStats);

// Master Document Package
router.get('/orders/:id/document-package', departmentReadGuard, getOrderDocumentPackage);

// Customer Overdue Check
router.get('/check-overdue', departmentReadGuard, checkCustomerOverdueApi);

// Leads
router.get('/leads', salesGuard, getMyLeads);
router.post('/leads', salesGuard, createMyLead);
router.post('/leads/:id/convert-to-deal', salesGuard, convertLeadToDeal);
router.patch('/leads/:id', salesGuard, updateMyLead);
router.delete('/leads/:id', salesGuard, deleteMyLead);

// Deals (Sales Pipeline)
router.get('/deals', salesGuard, getMyDeals);
router.post('/deals', salesGuard, createMyDeal);
router.patch('/deals/:id', salesGuard, updateMyDeal);
router.delete('/deals/:id', salesGuard, deleteMyDeal);

// Invoices & Finance Handoff
router.get('/invoices', departmentReadGuard, getMyInvoices);
router.post('/invoices', salesAccountsGuard, createMyInvoice);
router.patch('/invoices/:id', salesAccountsGuard, updateMyInvoice);
router.delete('/invoices/:id', salesAccountsGuard, deleteMyInvoice);
router.post('/invoices/:id/send-to-finance', accountsGuard, sendInvoiceToFinance);
router.post('/invoices/:id/return-to-accounts', financeReviewGuard, returnInvoiceToAccounts);
router.post('/invoices/:id/finalize', financeReviewGuard, finalizeInvoice);

// Quotations
router.get('/quotations', salesGuard, getMyQuotations);
router.get('/quotations/forward-targets', salesGuard, getQuotationForwardTargets);
router.post('/quotations', salesGuard, createMyQuotation);
router.post('/quotations/:id/forward', salesGuard, forwardQuotation);
router.post('/quotations/:id/convert-to-order', salesGuard, convertQuotationToSalesOrder);
router.post('/quotations/:id/convert-to-po', salesGuard, convertQuotationToCustomerPO);
router.patch('/quotations/:id', salesGuard, updateMyQuotation);
router.delete('/quotations/:id', salesGuard, deleteMyQuotation);

// Sales Orders & Support Handoff
router.get('/orders', departmentReadGuard, getMyOrders);
router.get('/orders/:id/activity', salesGuard, getMyOrderActivity);
router.get('/orders/available-for-delivery', salesAndSupportGuard, getAvailableOrdersForDelivery);
router.get('/orders/:id/stock-check', salesAndSupportGuard, checkOrderStock);
router.get('/orders/:id/receiving-preview', supportInventoryReadGuard, getGoodsReceivingPreview);
router.post('/orders', salesGuard, createMyOrder);
router.post('/orders/:id/send-to-support', salesGuard, sendOrderToSupport);
router.post('/orders/:id/send-to-finance', salesGuard, sendSalesOrderToFinance);
router.post('/orders/:id/finance-review', financeReviewGuard, financeReviewSalesOrder);
router.post('/orders/:id/goods-received', supportInventoryWriteGuard, recordGoodsReceivedInOffice);
router.post('/orders/:id/bl-input', supportInventoryWriteGuard, recordBLInput);
router.post('/orders/:id/issue-supplier-po', salesGuard, issueSupplierPO);
router.patch('/orders/:id', salesGuard, updateMyOrder);
router.delete('/orders/:id', salesGuard, deleteMyOrder);

// Support & Inventory Department Routes
router.get('/support/stats', supportInventoryReadGuard, getSupportStats);
router.get('/inventory', departmentReadGuard, getInventoryItems);
router.post('/inventory', inventoryStockWriteGuard, createOrUpdateInventoryItem);
router.post('/inventory/:id/in', inventoryStockWriteGuard, addInventoryStock);

// Proforma Invoices
router.get('/proforma-invoices', salesGuard, getMyProformaInvoices);
router.post('/proforma-invoices', salesGuard, createMyProformaInvoice);
router.patch('/proforma-invoices/:id', salesGuard, updateMyProformaInvoice);
router.delete('/proforma-invoices/:id', salesGuard, deleteMyProformaInvoice);

// Delivery Notes & Accounts Handoff
router.get('/delivery-notes', departmentReadGuard, getMyDeliveryNotes);
router.post('/delivery-notes', salesAndSupportGuard, createMyDeliveryNote);
router.get('/delivery-notes/:id/stock-check', supportInventoryReadGuard, checkDeliveryNoteStock);
router.post('/delivery-notes/:id/confirm', supportInventoryWriteGuard, confirmDeliveryNoteWithInventory);
router.patch('/delivery-notes/:id/expiry', supportInventoryWriteGuard, updateDeliveryNoteExpiry);
router.patch('/delivery-notes/:id', salesAndSupportGuard, updateMyDeliveryNote);
router.delete('/delivery-notes/:id', salesAndSupportGuard, deleteMyDeliveryNote);

// Accounts Department Stats & Pending Delivery Notes
router.get('/accounts/stats', accountsGuard, getAccountsStats);
router.get('/accounts/pending-delivery-notes', accountsGuard, getAccountsPendingDeliveryNotes);

// Finance Department Stats & Receivables
router.get('/finance/stats', financeReviewGuard, getFinanceStats);
router.get('/finance/receivables', financeReviewGuard, getFinanceReceivables);

// Follow-ups
router.get('/followups', salesGuard, getMyFollowUps);
router.post('/followups', salesGuard, createMyFollowUp);
router.patch('/followups/:id', salesGuard, updateMyFollowUp);
router.delete('/followups/:id', salesGuard, deleteMyFollowUp);

// Customer Purchase Orders
router.get('/customer-pos', salesGuard, getMyCustomerPOs);
router.post('/customer-pos', salesGuard, createMyCustomerPO);
router.post('/customer-pos/:id/convert-to-file', salesGuard, convertCustomerPOToProductFile);
router.patch('/customer-pos/:id', salesGuard, updateMyCustomerPO);
router.delete('/customer-pos/:id', salesGuard, deleteMyCustomerPO);

// Product Files (Blue/Green)
router.get('/product-files', salesGuard, getMyProductFiles);
router.post('/product-files', salesGuard, createMyProductFile);
router.post('/product-files/:id/convert-to-order', salesGuard, convertProductFileToSalesOrder);
router.patch('/product-files/:id', salesGuard, updateMyProductFile);
router.delete('/product-files/:id', salesGuard, deleteMyProductFile);

// Payments
router.get('/payments', paymentGuard, getMyPayments);
router.get('/payments/:id/receipt-voucher', receiptVoucherGuard, getReceiptVoucher);
router.post('/payments', paymentGuard, createMyPayment);
router.patch('/payments/:id', paymentGuard, updateMyPayment);
router.delete('/payments/:id', paymentGuard, deleteMyPayment);

// Targets
router.get('/targets', salesGuard, getMyTargets);

// Activities
router.get('/activities', salesGuard, getMyActivities);

module.exports = router;
