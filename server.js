const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const projectRoutes = require('./routes/projectRoutes');
const taskRoutes = require('./routes/taskRoutes');
const workUpdateRoutes = require('./routes/workUpdateRoutes');
const crmRoutes = require('./routes/crmRoutes');
const hrRoutes = require('./routes/hrRoutes');
const financeRoutes = require('./routes/financeRoutes');
const marketingRoutes = require('./routes/marketingRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const publicRoutes = require('./routes/publicRoutes');

// Load environment variables
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// Configure CORS for React frontend communication
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174'
  ],
  credentials: true
}));

// Body Parser Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/work-updates', workUpdateRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/administration', resourceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/public', publicRoutes);

// Root Fallback Route
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to NexusCRM Backend API Server'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[Express] CRM Backend Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
