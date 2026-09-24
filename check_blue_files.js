const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/fortCRM', {useNewUrlParser: true, useUnifiedTopology: true}).then(async () => {
  const SalesOrder = require('./models/SalesOrder');
  const count = await SalesOrder.countDocuments({
      fileType: 'Blue',
      status: { $nin: ['Delivered', 'Cancelled', 'Closed'] },
      $or: [
        { departmentResponsible: 'Logistics' },
        { currentDepartment: 'Logistics' },
        { workflowStatus: { $in: ['Shipment In Transit', 'Customs Clearance', 'Pending Logistics GRN', 'Shipment Received in Office', 'Order Placed with Supplier'] } }
      ]
  });
  console.log('Pending Blue files count:', count);
  
  const allBlue = await SalesOrder.countDocuments({ fileType: 'Blue' });
  console.log('Total Blue files:', allBlue);
  
  const allOrders = await SalesOrder.find({ fileType: 'Blue' }).select('orderNumber workflowStatus currentDepartment departmentResponsible status');
  console.log('Blue files details:', allOrders);
  
  process.exit(0);
}).catch(console.error);
