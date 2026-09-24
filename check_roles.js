const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://fortlinecrm:R8K5rGqH6vN2yP9b@cluster0.sxeideq.mongodb.net/fortlinecrm?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  const ceos = await User.find({ role: 'ceo' });
  const admins = await User.find({ role: 'admin' });
  console.log('CEOs:', ceos.map(c => ({ email: c.email, role: c.role })));
  console.log('Admins:', admins.map(a => ({ email: a.email, role: a.role })));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
