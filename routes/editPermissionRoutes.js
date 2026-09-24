const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  requestEditPermission,
  getEditPermissionRequests,
  respondToEditPermissionRequest,
  checkActiveEditPermission,
  getDocumentPreview,
  getAllAuditLogs
} = require('../controllers/editPermissionController');

router.use(protect);

router.post('/request', requestEditPermission);
router.get('/requests', getEditPermissionRequests);
router.post('/requests/:id/respond', respondToEditPermissionRequest);
router.patch('/requests/:id/respond', respondToEditPermissionRequest);
router.get('/check/:documentType/:documentId', checkActiveEditPermission);
router.get('/preview/:documentType/:documentId', getDocumentPreview);
router.get('/audit-logs', getAllAuditLogs);

module.exports = router;
