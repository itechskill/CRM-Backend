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
  getLogisticsDeliveryNotes
} = require('../controllers/logisticsController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/stats', getLogisticsDashboardStats);
router.get('/incoming-orders', getIncomingOrders);
router.get('/delivery-notes', getLogisticsDeliveryNotes);

router.route('/shipments')
  .get(getShipments)
  .post(createShipment);

router.route('/shipments/:id')
  .get(getShipmentById);

router.patch('/shipments/:id/tracking', updateShipmentTracking);
router.post('/shipments/:id/receive-in-office', receiveShipmentInOffice);

module.exports = router;
