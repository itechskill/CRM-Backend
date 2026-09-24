const mongoose = require('mongoose');

const fieldChangeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  oldValue: { type: mongoose.Schema.Types.Mixed },
  newValue: { type: mongoose.Schema.Types.Mixed }
});

const editAuditLogSchema = new mongoose.Schema(
  {
    documentType: {
      type: String,
      required: true
    },
    documentId: {
      type: String,
      required: true
    },
    documentNumber: {
      type: String,
      required: true
    },
    editedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    editedByName: {
      type: String,
      required: true
    },
    editedByRole: {
      type: String,
      default: ''
    },
    editedByDepartment: {
      type: String,
      default: ''
    },
    permissionType: {
      type: String,
      enum: ['DIRECT_EDIT', 'CEO_APPROVED'],
      default: 'CEO_APPROVED'
    },
    editPermissionRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EditPermissionRequest',
      default: null
    },
    changes: [fieldChangeSchema],
    reason: {
      type: String,
      default: ''
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EditAuditLog', editAuditLogSchema);
