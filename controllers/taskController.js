const Task = require('../models/Task');

// GET /api/tasks
const getTasks = async (req, res) => {
  try {
    // Employees only see their assigned tasks or tasks created by them, management sees all
    let query = {};
    if (['employee'].includes(req.user.role)) {
      query = { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] };
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'fullName email department')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: tasks.length, data: tasks });
  } catch (error) {
    console.error('[Get Tasks Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving tasks.' });
  }
};

// POST /api/tasks
const createTask = async (req, res) => {
  try {
    const { title, project, assignedTo, status, priority, dueDate, category, description } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ success: false, message: 'Task title is required.' });
    }

    const newTask = await Task.create({
      title: title.trim(),
      project: project ? project.trim() : 'General',
      assignedTo: assignedTo || req.user._id,
      assignedToName: req.body.assignedToName || '',
      status: status || 'Pending',
      priority: priority || 'Medium',
      dueDate: dueDate || null,
      category: category || 'General',
      description: description ? description.trim() : '',
      createdBy: req.user._id
    });

    return res.status(201).json({ success: true, message: 'Task created successfully.', data: newTask });
  } catch (error) {
    console.error('[Create Task Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating task.' });
  }
};

// PATCH /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    return res.status(200).json({ success: true, message: 'Task updated successfully.', data: task });
  } catch (error) {
    console.error('[Update Task Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error updating task.' });
  }
};

// DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    return res.status(200).json({ success: true, message: 'Task deleted successfully.' });
  } catch (error) {
    console.error('[Delete Task Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting task.' });
  }
};

module.exports = {
  getTasks,
  createTask,
  updateTask,
  deleteTask
};
