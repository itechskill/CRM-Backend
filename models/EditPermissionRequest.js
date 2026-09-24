const mongoose = require('mongoose');

const editPermissionRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    documentType: {
      type: String,
      required: true,
      trim: true
    },
    documentId: {
      type: String,
      required: true,
      trim: true
    },
    documentNumber: {
      type: String,
      required: true,
      trim: true
    },
    currentDocumentStatus: {
      type: String,
      default: ''
    },
    // Requester Metadata (Immutable)
    requestedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requestedByName: {
      type: String,
      required: true,
      trim: true
    },
    requestedByRole: {
      type: String,
      required: true,
      trim: true
    },
    requestedByDepartment: {
      type: String,
      required: true,
      trim: true
    },
    // Request Details
    requestType: {
      type: String,
      enum: ['SpecificField', 'General'],
      default: 'General'
    },
    requestedFields: [
      {
        fieldName: { type: String, required: true },
        label: { type: String, default: '' },
        currentValue: { type: mongoose.Schema.Types.Mixed, default: '' },
        requestedValue: { type: mongoose.Schema.Types.Mixed, default: '' }
      }
    ],
    reason: {
      type: String,
      required: true,
      trim: true
    },
    // CEO Approval Configuration & Scope
    permissionScope: {
      type: String,
      enum: ['SpecificFields', 'FullDocument'],
      default: 'FullDocument'
    },
    allowedFields: [
      { type: String }
    ],
    // Request Lifecycle Status
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Completed', 'Expired'],
      default: 'Pending'
    },
    expiresAt: {
      type: Date,
      default: null
    },
    permissionUsed: {
      type: Boolean,
      default: false
    },
    usedAt: {
      type: Date,
      default: null
    },
    // CEO Decision Metadata
    approvedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedByName: {
      type: String,
      default: ''
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedByName: {
      type: String,
      default: ''
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: ''
    },
    ceoResponseNote: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('EditPermissionRequest', editPermissionRequestSchema);
