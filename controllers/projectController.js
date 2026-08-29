const Project = require('../models/Project');

// GET /api/projects
const getProjects = async (req, res) => {
  try {
    const projects = await Project.find()
      .populate('team', 'fullName email role')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: projects.length, data: projects });
  } catch (error) {
    console.error('[Get Projects Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving projects.' });
  }
};

// POST /api/projects
const createProject = async (req, res) => {
  try {
    const { name, code, client, status, priority, budget, startDate, endDate, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Project name is required.' });
    }

    const newProject = await Project.create({
      name: name.trim(),
      code: code ? code.trim() : '',
      client: client ? client.trim() : 'Internal',
      status: status || 'In Progress',
      priority: priority || 'Medium',
      budget: budget ? Number(budget) : 0,
      startDate: startDate || new Date(),
      endDate: endDate || null,
      description: description ? description.trim() : '',
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Project created successfully.', data: newProject });
  } catch (error) {
    console.error('[Create Project Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating project.' });
  }
};

// PATCH /api/projects/:id
const updateProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    return res.status(200).json({ success: true, message: 'Project updated successfully.', data: project });
  } catch (error) {
    console.error('[Update Project Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating project.' });
  }
};

// DELETE /api/projects/:id
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    return res.status(200).json({ success: true, message: 'Project deleted successfully.' });
  } catch (error) {
    console.error('[Delete Project Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting project.' });
  }
};

module.exports = {
  getProjects,
  createProject,
  updateProject,
  deleteProject
};
