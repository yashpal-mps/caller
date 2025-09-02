// config/db.config.ts
import path from 'path';

const dbConfig = {
  dbPath: process.env.DB_PATH || path.join(__dirname, '../data/database.sqlite'),
  options: {
    verbose: process.env.NODE_ENV === 'development',
    fileMustExist: false,
    timeout: 5000
  }
};

export default dbConfig;