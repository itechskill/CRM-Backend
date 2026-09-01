const Task = require('../models/Task');
const User = require('../models/User');
const { createNotificationHelper, notifyRoleHelper } = require('./notificationController');

const getRoleAliases = (userRole, userDepartment) => {
  const aliases = new Set();
  const r = (userRole || '').toLowerCase().trim();
  const d = (userDepartment || '').toLowerCase().trim();

  if (r === 'hr_manager' || r === 'hr' || d.includes('hr') || d.includes('human')) {
    aliases.add('hr_manager'); aliases.add('hr'); aliases.add('human_resources');
  }
  if (r === 'accountant' || r === 'finance' || d.includes('account') || d.includes('finance')) {
    aliases.add('accountant'); aliases.add('finance'); aliases.add('accounting');
  }
  if (r === 'sales_manager' || r === 'sales' || d.includes('sale')) {
    aliases.add('sales_manager'); aliases.add('sales');
  }
  if (r === 'project_manager' || r === 'project' || d.includes('project')) {
    aliases.add('project_manager'); aliases.add('project');
  }
  if (r === 'marketing' || d.includes('market')) {
    aliases.add('marketing');
  }
  if (r === 'administration' || r === 'admin' || d.includes('admin')) {
    aliases.add('administration'); aliases.add('admin');
  }
  aliases.add('employee');
  if (r) aliases.add(r);
  return Array.from(aliases);
};

// GET /api/tasks
const getTasks = async (req, res) => {
  try {
    const { role, _id } = req.user;
    let query = {};

    if (role === 'admin' || role === 'ceo') {
      query = {};
    } else {
      const roleAliases = getRoleAliases(role, req.user.department);
      query = {
        $or: [
          { assignedTo: _id },
          { assignedToRole: { $in: roleAliases } },
          { createdBy: _id }
        ]
      };
    }


    const { search, status, priority } = req.query;
    if (status && status !== 'All') query.status = status;
    if (priority && priority !== 'All') query.priority = priority;

    const tasks = await Task.find(query)
      .populate('assignedTo', 'fullName email department role')
      .populate('createdBy', 'fullName email role')
      .sort({ createdAt: -1 });

    let result = tasks;
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      result = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(term) ||
        (t.project || '').toLowerCase().includes(term) ||
        (t.category || '').toLowerCase().includes(term) ||
        (t.description || '').toLowerCase().includes(term) ||
        (t.assignedToName || '').toLowerCase().includes(term)
      );
    }

    return res.status(200).json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error('[Get Tasks Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving tasks.' });
  }
};

// POST /api/tasks
const createTask = async (req, res) => {
  try {
    const {
      title, project, assignedTo, assignedToName, assignedToRole,
      status, priority, dueDate, category, description
    } = req.body;

    if (!title || title.trim() === '') {
      return res.status(400).json({ success: false, message: 'Task title is required.' });
    }

    // Resolve assignedToRole from the assigned user if not explicitly passed
    let resolvedRole = assignedToRole || '';
    if (assignedTo && !resolvedRole) {
      try {
        const targetUser = await User.findById(assignedTo).select('role');
        if (targetUser) resolvedRole = targetUser.role;
      } catch (e) { /* ignore */ }
    }

    const newTask = await Task.create({
      title: title.trim(),
      project: project ? project.trim() : 'General',
      assignedTo: assignedTo || null,
      assignedToName: assignedToName || '',
      assignedToRole: resolvedRole,
      assignedByName: req.user.fullName ? (req.user.role === 'ceo' ? `${req.user.fullName} (CEO)` : req.user.fullName) : 'CEO',
      status: status || 'Pending',
      priority: priority || 'Medium',
      dueDate: dueDate || null,
      category: category || 'General',
      description: description ? description.trim() : '',
      createdBy: req.user._id
    });

    const populated = await Task.findById(newTask._id)
      .populate('assignedTo', 'fullName email department role')
      .populate('createdBy', 'fullName email role');

    // Create live notification for assigned user / department role
    const notificationMsg = req.user.role === 'ceo'
      ? `New task assigned by CEO: ${newTask.title}`
      : `New task assigned: ${newTask.title}`;

    if (assignedTo) {
      await createNotificationHelper({
        recipient: assignedTo,
        sender: req.user._id,
        title: 'New Task Assigned',
        message: notificationMsg,
        type: 'task',
        link: 'tasks'
      });
    }

    if (resolvedRole) {
      const roleAliases = getRoleAliases(resolvedRole);
      for (const rAlias of roleAliases) {
        await notifyRoleHelper({
          role: rAlias,
          sender: req.user._id,
          title: 'New Task Assigned',
          message: notificationMsg,
          type: 'task',
          link: 'tasks'
        });
      }
    }

    return res.status(201).json({ success: true, message: 'Task created successfully.', data: populated });

  } catch (error) {
    console.error('[Create Task Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error creating task.' });
  }
};

// PATCH /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const updates = { ...req.body };

    // If assignedTo changed, resolve the role
    if (updates.assignedTo && !updates.assignedToRole) {
      try {
        const targetUser = await User.findById(updates.assignedTo).select('role');
        if (targetUser) updates.assignedToRole = targetUser.role;
      } catch (e) { /* ignore */ }
    }

    const task = await Task.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('assignedTo', 'fullName email department role')
      .populate('createdBy', 'fullName email role');

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
