// routes/home.ts
import { Router } from 'express';
import { logger } from '../utils/logger';
import DatabaseConnection from '../database/db.connection';
import { authenticate } from '../middleware/auth.middleware';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import { Request, Response } from 'express';
import axios from 'axios';

// Configure Smartflo API credentials
const SMARTFLO_API_URL = process.env.SMARTFLO_API_URL || 'https://api.smartflo.tatatelebusiness.com/v1';
const SMARTFLO_API_KEY = process.env.SMARTFLO_API_KEY;
const SMARTFLO_FROM_NUMBER = process.env.SMARTFLO_FROM_NUMBER; // Your registered business number

const router = Router();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'text/csv') {
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  }
});

// Route to upload CSV file
router.post('/upload-csv', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const results: { name: string; phone: string }[] = [];
    
    // Process CSV file
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => {
        // Validate data - ensure name and phone fields exist
        if (data.name && data.phone) {
          results.push({
            name: data.name,
            phone: data.phone
          });
        }
      })
      .on('end', async () => {
        try {
          // Clean up the uploaded file
          fs.unlinkSync(req.file!.path);
          
          if (results.length === 0) {
            return res.status(400).json({ 
              message: 'CSV file must contain name and phone columns with valid data' 
            });
          }
          
          // Get database connection
          const db = await DatabaseConnection.getConnection();
          
          // Begin a transaction
          await db.exec('BEGIN TRANSACTION');
          
          try {
            // Prepare statement once
            const stmt = await db.prepare('INSERT INTO contacts (name, phone) VALUES (?, ?)');
            
            // Insert each contact
            for (const contact of results) {
              await stmt.run(contact.name, contact.phone);
            }
            
            // Finalize the statement
            await stmt.finalize();
            
            // Commit transaction
            await db.exec('COMMIT');
            
            logger.info(`Imported ${results.length} contacts from CSV`);
            return res.status(200).json({ 
              message: `Successfully imported ${results.length} contacts` 
            });
          } catch (error) {
            // Rollback on error
            await db.exec('ROLLBACK');
            throw error;
          }
        } catch (error) {
          logger.error('Error saving CSV data:', error);
          return res.status(500).json({ message: 'Error saving CSV data' });
        }
      })
      .on('error', (error) => {
        logger.error('Error parsing CSV:', error);
        return res.status(500).json({ message: 'Error parsing CSV file' });
      });
  } catch (error) {
    logger.error('CSV upload error:', error);
    return res.status(500).json({ message: 'Failed to process CSV file' });
  }
});

// Route to get contacts with pagination
router.get('/contacts', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    
    // Get database connection
    const db = await DatabaseConnection.getConnection();
    
    // Get total count for pagination
    const countStmt = await db.prepare('SELECT COUNT(*) as total FROM contacts');
    const totalResult = await countStmt.get();
    await countStmt.finalize();
    
    const total = totalResult.total;
    
    // Get paginated results
    const contactsStmt = await db.prepare(
      'SELECT id, name, phone, created_at FROM contacts ORDER BY created_at DESC LIMIT ? OFFSET ?'
    );
    const contacts = await contactsStmt.all(limit, offset);
    await contactsStmt.finalize();
    
    return res.status(200).json({
      data: contacts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching contacts:', error);
    return res.status(500).json({ message: 'Failed to retrieve contacts' });
  }
});



// Route to make a call
router.post('/make-call', authenticate, async (req: Request, res: Response) => {
  try {
    const { phoneNumber, contactId } = req.body;
    
    if (!phoneNumber && !contactId) {
      return res.status(400).json({ message: 'Either phoneNumber or contactId is required' });
    }
    
    let numberToCall = phoneNumber;
    
    // If contactId is provided, get the phone number from the database
    if (contactId) {
      const db = await DatabaseConnection.getConnection();
      const contactStmt = await db.prepare('SELECT phone FROM contacts WHERE id = ?');
      const contact = await contactStmt.get(contactId);
      await contactStmt.finalize();
      
      if (!contact) {
        return res.status(404).json({ message: 'Contact not found' });
      }
      
      numberToCall = contact.phone;
    }
    
    // Validate phone number format (simple validation)
    if (!numberToCall || !/^\d{10,15}$/.test(numberToCall.replace(/[^0-9]/g, ''))) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }
    
    // Format the phone number (remove non-numeric characters)
    const formattedNumber = numberToCall.replace(/[^0-9]/g, '');
    
    // Call the Smartflo API to initiate the call
    const response = await axios.post(
      `${SMARTFLO_API_URL}/call`, 
      {
        from: SMARTFLO_FROM_NUMBER,
        to: formattedNumber,
        callerId: SMARTFLO_FROM_NUMBER,
        callRecording: true // Optional - enable call recording
      },
      {
        headers: {
          'Authorization': `Bearer ${SMARTFLO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Log the call attempt
    logger.info(`Call initiated to ${formattedNumber}`, { response: response.data });
    
    // Insert call record into the database is commented out
    // const db = await DatabaseConnection.getConnection();
    // const insertStmt = await db.prepare(
    //   'INSERT INTO call_logs (phone_number, contact_id, call_id, status) VALUES (?, ?, ?, ?)'
    // );
    
    // await insertStmt.run(
    //   formattedNumber,
    //   contactId || null,
    //   response.data.call_id || null,
    //   'initiated'
    // );
    
    // await insertStmt.finalize();
    
    return res.status(200).json({
      message: 'Call initiated successfully',
      callId: response.data.call_id,
      status: response.data.status
    });
    
  } catch (error: unknown) {
    logger.error('Error initiating call:', error);
    
    // Handle API-specific errors - fix TypeScript errors by checking if error is an AxiosError
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status || 500).json({
        message: 'Failed to initiate call',
        error: error.response.data
      });
    }
    
    // Generic error handling
    return res.status(500).json({ 
      message: 'Failed to initiate call',
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Route to get call history
// router.get('/call-history', authenticate, async (req: Request, res: Response) => {
//   try {
//     const page = parseInt(req.query.page as string) || 1;
//     const limit = parseInt(req.query.limit as string) || 10;
//     const offset = (page - 1) * limit;
    
//     // Get database connection
//     const db = await DatabaseConnection.getConnection();
    
//     // Get total count for pagination
//     const countStmt = await db.prepare('SELECT COUNT(*) as total FROM call_logs');
//     const totalResult = await countStmt.get();
//     await countStmt.finalize();
    
//     const total = totalResult.total;
    
//     // Get paginated results with contact information if available
//     const callsStmt = await db.prepare(`
//       SELECT 
//         cl.id, 
//         cl.phone_number, 
//         cl.contact_id,
//         cl.call_id,
//         cl.status,
//         cl.created_at,
//         c.name as contact_name
//       FROM call_logs cl
//       LEFT JOIN contacts c ON cl.contact_id = c.id
//       ORDER BY cl.created_at DESC
//       LIMIT ? OFFSET ?
//     `);
    
//     const calls = await callsStmt.all(limit, offset);
//     await callsStmt.finalize();
    
//     return res.status(200).json({
//       data: calls,
//       pagination: {
//         total,
//         page,
//         limit,
//         totalPages: Math.ceil(total / limit)
//       }
//     });
//   } catch (error) {
//     logger.error('Error fetching call history:', error);
//     return res.status(500).json({ message: 'Failed to retrieve call history' });
//   }
// });


export default router;