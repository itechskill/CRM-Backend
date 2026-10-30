const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { listOrders, getOrderDetail, listRecords } = require('../controllers/orderTrackerController');

const router = express.Router();
router.use(protect, authorize('order_tracker'));
router.get('/orders', listOrders);
router.get('/orders/:id', getOrderDetail);
router.get('/records/:type', listRecords);

module.exports = router;
