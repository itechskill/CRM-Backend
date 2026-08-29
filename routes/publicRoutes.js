const express = require('express');
const router = express.Router();
const {
  submitContact,
  submitDemoRequest,
  getJobs,
  submitJobApplication,
  createJob,
  getContactMessages,
  getJobApplications
} = require('../controllers/publicController');
const { protect } = require('../middleware/authMiddleware');

// Public routes — NO authentication required
router.post('/contact', submitContact);
router.post('/demo-request', submitDemoRequest);
router.get('/jobs', getJobs);
router.post('/applications', submitJobApplication);

// Protected routes — HR/Admin authentication required
router.post('/jobs', protect, createJob);
router.get('/contact-messages', protect, getContactMessages);
router.get('/applications', protect, getJobApplications);

module.exports = router;
