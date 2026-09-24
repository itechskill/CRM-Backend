const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://itechskill6_db_user:itechskill6@cluster0.sxeideq.mongodb.net/fortlinecrm?retryWrites=true&w=majority').then(async () => {
  const EditPermissionRequest = require('./models/EditPermissionRequest');
  const count = await EditPermissionRequest.countDocuments();
  console.log('Total Edit Requests:', count);
  const requests = await EditPermissionRequest.find().sort({createdAt: -1}).limit(5);
  console.log('Latest 5 requests:', JSON.stringify(requests, null, 2));
  process.exit(0);
}).catch(console.error);
