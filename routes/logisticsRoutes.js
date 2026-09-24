const express = require('express');
const router = express.Router();
const {
  getLogisticsDashboardStats,
  getShipments,
  getShipmentById,
  createShipment,
  updateShipmentTracking,
  receiveShipmentInOffice,
  getIncomingOrders,
  getLogisticsDeliveryNotes,
  createLogisticsGRN,
  getPendingGRNs,
  getLogisticsGRNs,
  getImportInventory,
  createImportInventoryItem,
  updateImportInventoryItem
} = require('../controllers/logisticsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/stats', getLogisticsDashboardStats);
router.get('/incoming-orders', getIncomingOrders);
router.get('/delivery-notes', getLogisticsDeliveryNotes);
router.get('/pending-grns', getPendingGRNs);
router.get('/grns', getLogisticsGRNs);
router.post('/grn', createLogisticsGRN);

router.get('/import-inventory', getImportInventory);
router.post('/import-inventory', createImportInventoryItem);
router.patch('/import-inventory/:id', updateImportInventoryItem);

router.route('/shipments')
  .get(getShipments)
  .post(createShipment);

router.route('/shipments/:id')
  .get(getShipmentById);

router.patch('/shipments/:id/tracking', updateShipmentTracking);
router.post('/shipments/:id/receive-in-office', receiveShipmentInOffice);

module.exports = router;
