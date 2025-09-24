// server.ts
import express from 'express';
import * as http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import cors from 'cors';
import { ConnectionState, WebSocketMessage } from './types';
import { MessageHandler } from './handlers/messageHandler';
import { resetCounters } from './utils/sequencing';
import { logger } from './utils/logger';
import Routes from './routes';
import initializeDatabase from './database/db.init';
import DatabaseConnection from './database/db.connection';

// Initialize database
(async () => {
  try {
    await initializeDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
  }
})();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', Routes);

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Bi-directional Audio WebSocket Server',
    version: '1.0.0',
    status: 'running',
  });
});

// Create HTTP server with Express
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Connection tracking
const clientState: ConnectionState = {
  socket: null,
  streamSid: null,
  sequenceNumber: 1,
  mediaChunkCounter: 1,
  pendingMarks: [],
  phoneNumber: '1234567890'
};

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  // Only allow one client at a time
  if (clientState.socket && clientState.socket.readyState === WebSocket.OPEN) {
    const errorMessage = {
      event: 'error',
      message: 'Another call is in progress',
      code: 1003,
    };
    ws.send(JSON.stringify(errorMessage));
    ws.close();
    return;
  }

  // Initialize connection state
  clientState.socket = ws;
  resetCounters(clientState);
  clientState.pendingMarks = [];

  // Message handler
  ws.on(
    'message',
    async (message: Buffer | ArrayBuffer | Buffer[] | string) => {
      try {
        const data = JSON.parse(message.toString()) as WebSocketMessage;
        await MessageHandler.handleMessage(ws, clientState, data);
      } catch (error) {
        logger.error('Error processing message:', error);
        MessageHandler.sendError(
          ws,
          clientState,
          `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'
          }`,
          1004
        );
      }
    }
  );

  // Close handler
  ws.on('close', () => {
    console.log('Client disconnected');
    clientState.socket = null;
    clientState.streamSid = null;
    clientState.pendingMarks = [];
  });

  // Error handler
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });
});

// 🔑 Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  console.log("🔗 Upgrade request:", req.url, req.headers);

  if (req.url === '/voicebot') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}`);
  console.log(`Auth endpoints available at http://localhost:${PORT}/auth`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {  // Note: Added async here
  console.log('SIGTERM received, shutting down...');

  // Close database connection - this is missing in your code
  try {
    await DatabaseConnection.closeConnection();
    console.log('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }

  wss.close();
  server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
});

export { server };