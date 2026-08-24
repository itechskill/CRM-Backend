const WorkUpdate = require('../models/WorkUpdate');

// GET /api/work-updates
const getWorkUpdates = async (req, res) => {
  try {
    let query = {};
    if (['employee'].includes(req.user.role)) {
      query = { user: req.user._id };
    }

    const updates = await WorkUpdate.find(query)
      .populate('user', 'fullName email department')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: updates.length, data: updates });
  } catch (error) {
    console.error('[Get Work Updates Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving work updates.' });
  }
};

// POST /api/work-updates
const createWorkUpdate = async (req, res) => {
  try {
    const { project, task, hoursSpent, summary } = req.body;

    if (!hoursSpent || !summary || summary.trim() === '') {
      return res.status(400).json({ success: false, message: 'Hours spent and summary are required.' });
    }

    const newUpdate = await WorkUpdate.create({
      user: req.user._id,
      userName: req.user.fullName,
      project: project ? project.trim() : 'General',
      task: task ? task.trim() : '',
      hoursSpent: Number(hoursSpent),
      summary: summary.trim(),
      date: req.body.date || new Date(),
      status: 'Submitted'
    });

    return res.status(201).json({ success: true, message: 'Work update submitted successfully.', data: newUpdate });
  } catch (error) {
    console.error('[Create Work Update Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating work update.' });
  }
};

module.exports = {
  getWorkUpdates,
  createWorkUpdate
};
