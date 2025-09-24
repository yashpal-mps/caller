// routes/auth.ts
import { Router } from 'express';
import { logger } from '../utils/logger';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import DatabaseConnection from '../database/db.connection';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SALT_ROUNDS = 10;

// Register route
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required'
      });
    }

    const db = await DatabaseConnection.getConnection();

    // Check if user already exists
    const existingUser = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert new user
    const result = await db.run(
      'INSERT INTO users (name, email, phone, password, created_at, updated_at) VALUES (?, ?, ?, ?, datetime("now"), datetime("now"))',
      [name, email, phone || null, passwordHash]
    );

    console.log(`New user registered: ${email}`);

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.lastID, email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: result.lastID,
        name,
        email,
        phone
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during registration'
    });
  }
});

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const db = await DatabaseConnection.getConnection();

    // Find user by email
    const user = await db.get('SELECT * FROM users WHERE email = ?', email);

    if (!user) {
      logger.warn(`Login attempt for non-existent user: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      logger.warn(`Failed login attempt for user: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    console.log(`User logged in successfully: ${email}`);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    });
  }
});

// Verify token route (uses the authenticate middleware)
router.get('/verify', authenticate, (req, res) => {
  // If we get here, authentication was successful
  res.status(200).json({
    success: true,
    message: 'Token is valid',
    user: req.user
  });
});

// Example of a protected route
router.get('/profile', authenticate, async (req, res) => {
  try {
    const db = await DatabaseConnection.getConnection();
    const user = await db.get('SELECT id, name, email, phone, created_at FROM users WHERE id = ?', req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching user profile'
    });
  }
});

export default router;