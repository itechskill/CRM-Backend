const express = require('express');
const router = express.Router();
const {
  submitContact,
  submitDemoRequest,
  getJobs,
  getAllJobs,
  createJob,
  updateJob,
  deleteJob,
  submitJobApplication,
  updateApplication,
  deleteApplication,
  getContactMessages,
  getJobApplications,
  getJobApplicationById
} = require('../controllers/publicController');
const { protect } = require('../middleware/authMiddleware');

// ─── Public routes (NO authentication required) ───────────────────────────────
router.post('/contact', submitContact);
router.post('/demo-request', submitDemoRequest);
router.get('/jobs', getJobs);                        // Only published Open jobs
router.post('/applications', submitJobApplication);  // Applicants submit

// ─── Protected routes (HR / Admin authentication required) ───────────────────
router.get('/jobs/all', protect, getAllJobs);                             // All jobs (including drafts)
router.post('/jobs', protect, createJob);                                 // Create job posting
router.patch('/jobs/:id', protect, updateJob);                            // Edit / Publish / Unpublish
router.delete('/jobs/:id', protect, deleteJob);                           // Delete job posting

router.get('/applications', protect, getJobApplications);                 // All applications (list, no resumeData)
router.get('/applications/:id', protect, getJobApplicationById);          // Single application (with resumeData)
router.patch('/applications/:id', protect, updateApplication);            // Review / Schedule interview
router.delete('/applications/:id', protect, deleteApplication);           // Delete application

router.get('/contact-messages', protect, getContactMessages);             // Contact form submissions

module.exports = router;
