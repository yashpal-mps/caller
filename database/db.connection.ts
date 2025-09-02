// database/db.connection.ts
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import dbConfig from '../config/db.config';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists
const dataDir = path.dirname(dbConfig.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  logger.info(`Created database directory: ${dataDir}`);
}

// Set verbose mode if needed
if (dbConfig.options.verbose) {
  sqlite3.verbose();
}

class DatabaseConnection {
  private static instance: Database | null = null;
  private static isInitializing = false;

  public static async getConnection(): Promise<Database> {
    if (this.instance) {
      return this.instance;
    }

    if (this.isInitializing) {
      // Wait for initialization to complete
      return new Promise((resolve) => {
        const checkInstance = () => {
          if (this.instance) {
            resolve(this.instance);
          } else {
            setTimeout(checkInstance, 100);
          }
        };
        checkInstance();
      });
    }

    this.isInitializing = true;

    try {
      logger.info(`Opening database connection to ${dbConfig.dbPath}`);
      
      this.instance = await open({
        filename: dbConfig.dbPath,
        driver: sqlite3.Database,
      });
      
      // Enable foreign keys
      await this.instance.exec('PRAGMA foreign_keys = ON');
      
      logger.info('Database connection established successfully');
      return this.instance;
    } catch (error) {
      logger.error('Failed to open database connection:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  public static async closeConnection(): Promise<void> {
    if (this.instance) {
      try {
        await this.instance.close();
        this.instance = null;
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database connection:', error);
        throw error;
      }
    }
  }
}

export default DatabaseConnection;