const mongoose = require('mongoose');

const companySnapshotDefinition = () => ({
  type: new mongoose.Schema({
    code: { type: String, trim: true, required: true },
    legalName: { type: String, trim: true, required: true },
    address: { type: String, trim: true, default: '' },
    taxId: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    allowedDocumentTypes: [{ type: String, trim: true }]
  }, { _id: false }),
  default: undefined
});

module.exports = companySnapshotDefinition;
