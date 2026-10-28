const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { getExchangeRates, updateExchangeRate } = require('../controllers/exchangeRateController');

const router = express.Router();
router.use(protect);
router.get('/', authorize('admin', 'ceo', 'finance', 'purchaser'), getExchangeRates);
router.patch('/:currency', authorize('admin'), updateExchangeRate);

module.exports = router;
