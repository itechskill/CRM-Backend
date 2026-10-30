const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { getInventoryCosting, setInventoryBatchCost } = require('../controllers/inventoryCostingController');

const router = express.Router();
router.get('/', protect, authorize('finance', 'admin', 'ceo', 'accountant'), getInventoryCosting);
router.patch('/items/:itemId/batches/:batchId/cost', protect, authorize('finance', 'admin'), setInventoryBatchCost);

module.exports = router;
