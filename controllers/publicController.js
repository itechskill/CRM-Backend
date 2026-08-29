const ContactMessage = require('../models/ContactMessage');
const JobPosting = require('../models/JobPosting');
const JobApplication = require('../models/JobApplication');

// Initial default jobs for auto-seeding MongoDB if collection is empty
const INITIAL_JOBS = [
  {
    title: 'Frontend Developer',
    department: 'Engineering',
    location: 'Lahore, Pakistan',
    employmentType: 'Full-Time',
    experience: '2-4 Years',
    description: 'We are seeking a skilled Frontend Developer proficient in React, Next.js, and TypeScript to build scalable enterprise CRM interfaces.',
    requirements: ['2+ years React experience', 'State management & REST APIs', 'Responsive CSS & UI design'],
    skills: ['React', 'Next.js', 'TypeScript', 'Tailwind/CSS'],
    status: 'Open'
  },
  {
    title: 'Backend Developer',
    department: 'Engineering',
    location: 'Lahore, Pakistan',
    employmentType: 'Full-Time',
    experience: '3-5 Years',
    description: 'Looking for a Senior Backend Engineer to architect Node.js, Express, and MongoDB microservices for real-time CRM workflows.',
    requirements: ['Strong Node.js & Express mastery', 'MongoDB schema design & indexing', 'JWT auth & security'],
    skills: ['Node.js', 'Express', 'MongoDB', 'REST APIs'],
    status: 'Open'
  },
  {
    title: 'UI/UX Designer',
    department: 'Design',
    location: 'Lahore, Pakistan',
    employmentType: 'Full-Time',
    experience: '2-3 Years',
    description: 'Join our design team to craft sleek SaaS user experiences, design tokens, interactive prototypes, and modern component systems.',
    requirements: ['Proficiency in Figma & Adobe XD', 'SaaS application design portfolio', 'Design system maintenance'],
    skills: ['Figma', 'Adobe XD', 'UI Design', 'Wireframing'],
    status: 'Open'
  },
  {
    title: 'HR Executive',
    department: 'Human Resources',
    location: 'Lahore, Pakistan',
    employmentType: 'Full-Time',
    experience: '1-3 Years',
    description: 'Manage recruitment pipelines, employee onboarding, attendance tracking, and internal team engagement at NexusCRM.',
    requirements: ['Degree in HR or business', 'Excellent verbal & written communication', 'Recruitment pipeline tracking'],
    skills: ['HR Management', 'Communication', 'Recruitment', 'Onboarding'],
    status: 'Open'
  }
];

// POST /api/public/contact — Save contact form submission to MongoDB
const submitContact = async (req, res) => {
  try {
    const { fullName, email, company, phone, subject, message } = req.body;
    if (!fullName || !email || !message) {
      return res.status(400).json({ success: false, message: 'Full name, email, and message are required.' });
    }

    const contact = await ContactMessage.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      company: company ? company.trim() : '',
      phone: phone ? phone.trim() : '',
      subject: subject ? subject.trim() : 'General Inquiry',
      message: message.trim()
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been received and saved.',
      data: contact
    });
  } catch (error) {
    console.error('[Public Contact Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting contact form.' });
  }
};

// POST /api/public/demo-request — Save demo request form to MongoDB
const submitDemoRequest = async (req, res) => {
  try {
    const { fullName, email, company, phone, numEmployees, message } = req.body;
    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: 'Full name and email are required for demo requests.' });
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

    return res.status(201).json({
      success: true,
      message: 'Demo request received successfully! Our sales team will reach out within 24 hours to schedule your demo.',
      data: contact
    });
  } catch (error) {
    console.error('[Demo Request Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting demo request.' });
  }
};

// GET /api/public/jobs — Fetch open job postings from MongoDB (auto-seeds defaults if empty)
const getJobs = async (req, res) => {
  try {
    let count = await JobPosting.countDocuments({ status: 'Open' });
    if (count === 0) {
      await JobPosting.insertMany(INITIAL_JOBS);
    }

    const jobs = await JobPosting.find({ status: 'Open' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    console.error('[Get Jobs Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving job postings.' });
  }
};

// POST /api/public/applications — Save job application to MongoDB
const submitJobApplication = async (req, res) => {
  try {
    const { jobId, jobTitle, fullName, email, phone, resumeUrl, coverLetter } = req.body;
    if (!fullName || !email || !resumeUrl || !jobTitle) {
      return res.status(400).json({ success: false, message: 'Full name, email, resume link, and job title are required.' });
    }

    const application = await JobApplication.create({
      jobId: jobId || null,
      jobTitle: jobTitle.trim(),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      resumeUrl: resumeUrl.trim(),
      coverLetter: coverLetter ? coverLetter.trim() : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully! Our HR team will review your application shortly.',
      data: application
    });
  } catch (error) {
    console.error('[Submit Job Application Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error submitting job application.' });
  }
};

// POST /api/public/jobs — Create a job posting (HR use)
const createJob = async (req, res) => {
  try {
    const { title, department, location, employmentType, experience, description, requirements, skills, status } = req.body;
    if (!title || !department) {
      return res.status(400).json({ success: false, message: 'Title and department are required.' });
    }

    const job = await JobPosting.create({
      title: title.trim(),
      department: department.trim(),
      location: location || 'Remote',
      employmentType: employmentType || 'Full-Time',
      experience: experience || '',
      description: description || '',
      requirements: Array.isArray(requirements) ? requirements : [],
      skills: Array.isArray(skills) ? skills : [],
      status: status || 'Open',
      createdBy: req.user?._id || null
    });

    return res.status(201).json({ success: true, message: 'Job posting created.', data: job });
  } catch (error) {
    console.error('[Create Job Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating job posting.' });
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

// GET /api/public/applications — HR view all job applications
const getJobApplications = async (req, res) => {
  try {
    const apps = await JobApplication.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: apps.length, data: apps });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error retrieving job applications.' });
  }
};

module.exports = {
  submitContact,
  submitDemoRequest,
  getJobs,
  submitJobApplication,
  createJob,
  getContactMessages,
  getJobApplications
};
