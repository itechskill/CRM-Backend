const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Helper to create a single or multiple notifications
 */
const createNotificationHelper = async ({ recipient, sender, title, message, type = 'system', link = '' }) => {
  try {
    if (!recipient) return null;
    return await Notification.create({
      recipient,
      sender: sender || null,
      title,
      message,
      type,
      link,
      isRead: false
    });
  } catch (err) {
    console.error('[Create Notification Helper Error]:', err);
    return null;
  }
};

/**
 * Helper to create notifications for all users matching given roles or departments
 */
const notifyRoleHelper = async (rolesOrOptions, optionsParam = {}) => {
  try {
    let targetRoles = [];
    let payload = {};

    if (Array.isArray(rolesOrOptions)) {
      targetRoles = rolesOrOptions;
      payload = optionsParam || {};
    } else if (typeof rolesOrOptions === 'string') {
      targetRoles = [rolesOrOptions];
      payload = optionsParam || {};
    } else if (rolesOrOptions && typeof rolesOrOptions === 'object') {
      if (rolesOrOptions.role) {
        targetRoles = Array.isArray(rolesOrOptions.role) ? rolesOrOptions.role : [rolesOrOptions.role];
      }
      payload = rolesOrOptions;
    }

    const roleMap = {
      hr_manager: ['hr_manager', 'hr', 'human_resources'],
      hr: ['hr_manager', 'hr', 'human_resources'],
      accountant: ['accountant', 'accounts', 'accounting', 'finance'],
      accounts: ['accountant', 'accounts', 'accounting'],
      finance: ['finance', 'accountant', 'accounting'],
      sales_manager: ['sales_manager', 'sales'],
      sales: ['sales_manager', 'sales_member', 'sales_rep', 'sales_person'],
      sales_person: ['sales_person', 'sales_member', 'sales_rep'],
      sales_rep: ['sales_rep', 'sales_person', 'sales_member'],
      sales_member: ['sales_member', 'sales_rep', 'sales_person'],
      support: ['support', 'operations'],
      project_manager: ['project_manager', 'project'],
      marketing: ['marketing'],
      administration: ['administration', 'admin'],
      admin: ['admin', 'ceo'],
      ceo: ['ceo', 'admin'],
      employee: ['employee']
    };

    const expandedRoles = new Set();
    const deptKeywords = [];

    targetRoles.forEach(r => {
      const key = String(r).toLowerCase();
      if (roleMap[key]) {
        roleMap[key].forEach(mapped => expandedRoles.add(mapped));
      } else {
        expandedRoles.add(key);
      }
      const kw = key.replace('_manager', '').replace('_dept', '').replace('_', ' ');
      if (kw) deptKeywords.push(kw);
    });

    const roleList = Array.from(expandedRoles);

    const query = {
      $or: [
        { role: { $in: roleList } },
        { department: { $in: roleList.map(r => new RegExp(r, 'i')) } }
      ],
      status: 'active'
    };

    const users = await User.find(query).select('_id fullName email role department');

    const notifications = users.map(u => ({
      recipient: u._id,
      sender: payload.sender || null,
      title: payload.title || 'System Notification',
      message: payload.message || '',
      type: payload.type || 'system',
      link: payload.link || '',
      isRead: false
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }
  } catch (err) {
    console.error('[Notify Role Helper Error]:', err);
  }
};

// GET /api/notifications
const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'fullName profileImage')
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });

    return res.status(200).json({
      success: true,
      unreadCount,
      count: notifications.length,
      data: notifications
    });
  } catch (error) {
    console.error('[Get My Notifications Error]:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving notifications.' });
  }
};

// PATCH /api/notifications/:id/read
const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating notification.' });
  }
};

// PATCH /api/notifications/read-all
const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true }
    );
    return res.status(200).json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error updating notifications.' });
  }
};

// DELETE /api/notifications/:id
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id
    });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    return res.status(200).json({ success: true, message: 'Notification deleted.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error deleting notification.' });
  }
};

module.exports = {
  createNotificationHelper,
  notifyRoleHelper,
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification
};
