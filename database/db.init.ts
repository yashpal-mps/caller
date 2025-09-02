// database/db.init.ts
import DatabaseConnection from './db.connection';
import { logger } from '../utils/logger';

async function initializeDatabase() {
    const db = await DatabaseConnection.getConnection();

    try {
        logger.info('Initializing database schema...');

        // First, check if the users table exists
        const userTableExists = await db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        );

        if (userTableExists) {
            // Check if table has all required columns
            const tableInfo = await db.all("PRAGMA table_info(users)");
            const columnNames = tableInfo.map(col => col.name);
            
            // If table exists but missing required columns, drop and recreate
            if (!columnNames.includes('name') || !columnNames.includes('phone')) {
                logger.info('Updating users table schema...');
                
                // Backup existing data if needed
                // ...
                
                // Drop the existing table
                await db.exec("DROP TABLE users");
                
                // Table will be recreated below
                logger.info('Dropped outdated users table');
            } else {
                logger.info('Users table schema is up to date');
            }
        }

        // Create or recreate users table with correct schema
        await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        `);

        // Check if the contacts table exists
        const contactsTableExists = await db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'"
        );

        if (contactsTableExists) {
            // Check if table has the correct schema
            const tableInfo = await db.all("PRAGMA table_info(contacts)");
            const columnNames = tableInfo.map(col => col.name);
            
            // If contacts table exists but has a different schema than expected, recreate it
            if (!columnNames.includes('name') || !columnNames.includes('phone')) {
                logger.info('Updating contacts table schema...');
                
                // Drop the existing table
                await db.exec("DROP TABLE contacts");
                
                // Table will be recreated below
                logger.info('Dropped outdated contacts table');
            } else {
                logger.info('Contacts table schema is up to date');
            }
        }

        // Create or recreate contacts table with correct schema
        await db.exec(`
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        `);

        logger.info('Database schema initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize database schema:', error);
        throw error;
    }
}

export default initializeDatabase;