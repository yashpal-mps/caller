// routes/index.ts
import { Router } from 'express';
import authRoutes from './authRoutes';
import homeRoutes from './homeRoutes'
// Import other route modules here as they are created
// import userRoutes from './user';
// import apiRoutes from './api';

const router = Router();
router.use('/auth', authRoutes);
router.use('', homeRoutes)

// Health check route at the root of all routes
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'API is running',
    version: '1.0.0',
  });
});

export default router;