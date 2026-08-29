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
 * Helper to create notifications for all users matching a role
 */
const notifyRoleHelper = async ({ role, sender, title, message, type = 'system', link = '' }) => {
  try {
    const users = await User.find({ role, status: 'active' }).select('_id');
    const notifications = users.map(u => ({
      recipient: u._id,
      sender: sender || null,
      title,
      message,
      type,
      link,
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
