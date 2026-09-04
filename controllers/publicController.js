const ContactMessage = require('../models/ContactMessage');
const JobPosting = require('../models/JobPosting');
const JobApplication = require('../models/JobApplication');
const sendEmail = require('../utils/sendEmail');

// Helper validation functions
const validateFormInput = ({ fullName, email, phone }) => {
  const nameRegex = /^[A-Za-z\s]+$/;
  if (fullName && !nameRegex.test(fullName.trim())) {
    return 'Name must contain only alphabetic letters and spaces.';
  }

  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
  if (email && !emailRegex.test(email.trim())) {
    return 'Please provide a valid email address.';
  }

  if (phone && phone.trim() !== '') {
    const phoneRegex = /^[0-9+\-\s]+$/;
    if (!phoneRegex.test(phone.trim())) {
      return 'Phone number can only contain numbers, +, - and spaces.';
    }
  }

  return null;
};

// POST /api/public/contact
const submitContact = async (req, res) => {
  try {
    const { fullName, email, company, phone, subject, message } = req.body;
    if (!fullName || !email || !message) {
      return res.status(400).json({ success: false, message: 'Full name, email, and message are required.' });
    }

    const validationError = validateFormInput({ fullName, email, phone });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const contact = await ContactMessage.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      company: company ? company.trim() : '',
      phone: phone ? phone.trim() : '',
      subject: subject ? subject.trim() : 'General Inquiry',
      message: message.trim()
    });
    return res.status(201).json({ success: true, message: 'Thank you! Your message has been received.', data: contact });
  } catch (error) {
    console.error('[Public Contact Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting contact form.' });
  }
};

// POST /api/public/demo-request
const submitDemoRequest = async (req, res) => {
  try {
    const { fullName, email, company, phone, numEmployees, message } = req.body;
    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: 'Full name and email are required.' });
    }

    const validationError = validateFormInput({ fullName, email, phone });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const demoNotes = `[DEMO REQUEST] Employees: ${numEmployees || 'Not specified'}. Details: ${message || 'Personalized CRM Demo'}`;
    const contact = await ContactMessage.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      company: company ? company.trim() : '',
      phone: phone ? phone.trim() : '',
      subject: 'Request a Demo',
      message: demoNotes
    });
    return res.status(201).json({ success: true, message: 'Demo request received! Our team will reach out within 24 hours.', data: contact });
  } catch (error) {
    console.error('[Demo Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting demo request.' });
  }
};


// GET /api/public/jobs — Public: only published Open jobs
const getJobs = async (req, res) => {
  try {
    const jobs = await JobPosting.find({ isPublished: true, status: 'Open' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    console.error('[Get Jobs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving job postings.' });
  }
};

// GET /api/public/jobs/all — HR/Admin: ALL jobs including drafts
const getAllJobs = async (req, res) => {
  try {
    const jobs = await JobPosting.find()
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    console.error('[Get All Jobs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving job postings.' });
  }
};

// POST /api/public/jobs — HR: Create a job posting
const createJob = async (req, res) => {
  try {
    const { title, department, location, employmentType, experience, description, requirements, skills, salary, status, deadline, isPublished } = req.body;
    if (!title || !department) {
      return res.status(400).json({ success: false, message: 'Title and department are required.' });
    }
    const job = await JobPosting.create({
      title: title.trim(),
      department: department.trim(),
      location: location || 'Lahore, Pakistan',
      employmentType: employmentType || 'Full-Time',
      experience: experience || '',
      description: description || '',
      requirements: Array.isArray(requirements) ? requirements.filter(r => r.trim()) : [],
      skills: Array.isArray(skills) ? skills.filter(s => s.trim()) : [],
      salary: salary || '',
      status: status || 'Draft',
      isPublished: isPublished === true || isPublished === 'true',
      deadline: deadline || null,
      createdBy: req.user?._id || null
    });
    return res.status(201).json({ success: true, message: 'Job posting created.', data: job });
  } catch (error) {
    console.error('[Create Job Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating job posting.' });
  }
};

// PATCH /api/public/jobs/:id — HR: Edit / Publish / Unpublish a job
const updateJob = async (req, res) => {
  try {
    const { title, department, location, employmentType, experience, description, requirements, skills, salary, status, deadline, isPublished } = req.body;
    const job = await JobPosting.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job posting not found.' });
    }

    if (title !== undefined) job.title = title.trim();
    if (department !== undefined) job.department = department.trim();
    if (location !== undefined) job.location = location;
    if (employmentType !== undefined) job.employmentType = employmentType;
    if (experience !== undefined) job.experience = experience;
    if (description !== undefined) job.description = description;
    if (requirements !== undefined) job.requirements = Array.isArray(requirements) ? requirements.filter(r => r.trim()) : [];
    if (skills !== undefined) job.skills = Array.isArray(skills) ? skills.filter(s => s.trim()) : [];
    if (salary !== undefined) job.salary = salary;
    if (status !== undefined) job.status = status;
    if (deadline !== undefined) job.deadline = deadline || null;
    if (isPublished !== undefined) job.isPublished = isPublished === true || isPublished === 'true';

    await job.save();
    return res.status(200).json({ success: true, message: 'Job posting updated.', data: job });
  } catch (error) {
    console.error('[Update Job Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating job posting.' });
  }
};

// DELETE /api/public/jobs/:id — HR: Delete a job posting
const deleteJob = async (req, res) => {
  try {
    const job = await JobPosting.findByIdAndDelete(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job posting not found.' });
    }
    return res.status(200).json({ success: true, message: 'Job posting deleted.' });
  } catch (error) {
    console.error('[Delete Job Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting job posting.' });
  }
};

// POST /api/public/applications — Public: Submit job application
const submitJobApplication = async (req, res) => {
  try {
    const { jobId, jobTitle, fullName, email, phone, resumeData, resumeFileName, resumeUrl, coverLetter } = req.body;

    if (!fullName || !email || !jobTitle) {
      return res.status(400).json({ success: false, message: 'Full name, email, and job title are required.' });
    }

    if (!resumeData && !resumeUrl) {
      return res.status(400).json({ success: false, message: 'Please upload your resume or provide a resume link.' });
    }

    const application = await JobApplication.create({
      jobId: jobId || null,
      jobTitle: jobTitle.trim(),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      resumeData: resumeData || '',
      resumeFileName: resumeFileName || '',
      resumeUrl: resumeUrl || '',
      coverLetter: coverLetter ? coverLetter.trim() : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Application submitted! Our HR team will review and contact you soon.',
      data: { _id: application._id, fullName: application.fullName, jobTitle: application.jobTitle }
    });
  } catch (error) {
    console.error('[Submit Application Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting application.' });
  }
};

// PATCH /api/public/applications/:id — HR: Update application status / schedule interview
const updateApplication = async (req, res) => {
  try {
    const { status, interviewDate, interviewTime, interviewNotes, interviewType } = req.body;
    const app = await JobApplication.findById(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    if (status !== undefined) app.status = status;
    if (interviewDate !== undefined) app.interviewDate = interviewDate || null;
    if (interviewTime !== undefined) app.interviewTime = interviewTime || '';
    if (interviewNotes !== undefined) app.interviewNotes = interviewNotes || '';
    if (interviewType !== undefined) app.interviewType = interviewType || '';

    if (interviewDate && req.user?._id) {
      app.interviewScheduledBy = req.user._id;
      app.status = 'Interview Scheduled';
    }

    await app.save();

    // Send interview notification email to applicant
    if (interviewDate && app.email) {
      const formattedDate = new Date(interviewDate).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      const timeStr = interviewTime ? ` at ${interviewTime}` : '';
      const typeStr = interviewType ? ` (${interviewType})` : '';

      await sendEmail({
        to: app.email,
        subject: `Interview Scheduled — ${app.jobTitle} at NexusCRM`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E2E8F0; border-radius: 8px; background-color: #FFFFFF;">
            <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #F1F5F9;">
              <h2 style="color: #2563EB; margin: 0;">NexusCRM — Interview Invitation</h2>
              <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Human Resources Department</p>
            </div>
            <div style="padding: 24px 0;">
              <p style="color: #475569; font-size: 15px; line-height: 1.6;">Dear <strong>${app.fullName}</strong>,</p>
              <p style="color: #475569; font-size: 15px; line-height: 1.6;">
                We are pleased to invite you for an interview for the position of <strong>${app.jobTitle}</strong>.
              </p>
              <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
                <div style="font-size: 13px; font-weight: 700; color: #1D4ED8; margin-bottom: 10px;">INTERVIEW DETAILS</div>
                <p style="margin: 4px 0; color: #1E40AF; font-size: 14px;">📅 <strong>Date:</strong> ${formattedDate}</p>
                ${timeStr ? `<p style="margin: 4px 0; color: #1E40AF; font-size: 14px;">🕐 <strong>Time:</strong> ${interviewTime}</p>` : ''}
                ${typeStr ? `<p style="margin: 4px 0; color: #1E40AF; font-size: 14px;">📍 <strong>Format:</strong> ${interviewType}</p>` : ''}
                ${interviewNotes ? `<p style="margin: 8px 0 0; color: #3B82F6; font-size: 13px;">📝 ${interviewNotes}</p>` : ''}
              </div>
              <p style="color: #475569; font-size: 14px; line-height: 1.6;">
                Please reply to this email or contact us if you have any questions. We look forward to speaking with you.
              </p>
            </div>
            <div style="text-align: center; padding-top: 16px; border-top: 1px solid #F1F5F9; color: #94A3B8; font-size: 12px;">
              &copy; ${new Date().getFullYear()} NexusCRM HR Team. All rights reserved.
            </div>
          </div>
        `
      });

      console.log(`[Interview Email] Sent to ${app.email} for ${app.jobTitle} on ${formattedDate}${timeStr}`);
    }

    return res.status(200).json({ success: true, message: 'Application updated.', data: app });
  } catch (error) {
    console.error('[Update Application Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating application.' });
  }
};

// DELETE /api/public/applications/:id — HR: Delete application
const deleteApplication = async (req, res) => {
  try {
    const app = await JobApplication.findByIdAndDelete(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    return res.status(200).json({ success: true, message: 'Application deleted.' });
  } catch (error) {
    console.error('[Delete Application Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting application.' });
  }
};

// GET /api/public/contact-messages — Admin/HR view all messages
const getContactMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: messages.length, data: messages });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving contact messages.' });
  }
};

// GET /api/public/applications — HR view all applications (without resumeData for performance)
const getJobApplications = async (req, res) => {
  try {
    const { search, status, jobId } = req.query;
    let query = {};
    if (status && status !== 'All') query.status = status;
    if (jobId) query.jobId = jobId;

    let apps = await JobApplication.find(query)
      .select('-resumeData')   // Exclude large Base64 from list view
      .sort({ createdAt: -1 });

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      apps = apps.filter(a =>
        (a.fullName || '').toLowerCase().includes(term) ||
        (a.email || '').toLowerCase().includes(term) ||
        (a.jobTitle || '').toLowerCase().includes(term)
      );
    }

    return res.status(200).json({ success: true, count: apps.length, data: apps });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving applications.' });
  }
};

// GET /api/public/applications/:id — HR view single application (WITH resumeData)
const getJobApplicationById = async (req, res) => {
  try {
    const app = await JobApplication.findById(req.params.id);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    return res.status(200).json({ success: true, data: app });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving application.' });
  }
};

module.exports = {
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
};
