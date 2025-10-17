// server.ts
import express from 'express';
import * as http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import cors from 'cors';
import { ConnectionState, WebSocketMessage, ConnectionType } from './types';
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

// Environment variables
const AUTH_TOKEN = process.env.BROWSER_AUTH_TOKEN || 'secret-token-for-browser';

// Connection tracking
const serviceState: ConnectionState = {
  socket: null,
  streamSid: null,
  sequenceNumber: 1,
  mediaChunkCounter: 1,
  pendingMarks: [],
  phoneNumber: '1234567890',
  type: ConnectionType.SERVICE
};

// Map to store browser connections - make it globally accessible
const browserConnections = new Map<string, ConnectionState>();
// Make browserConnections available globally for other modules to access
(global as any).browserConnections = browserConnections;

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  console.log('Client connected');

  // Extract query parameters from URL
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const connectionType = url.searchParams.get('type') as ConnectionType;
  const authToken = url.searchParams.get('token');

  // Validate connection type
  if (!connectionType || !Object.values(ConnectionType).includes(connectionType)) {
    const errorMessage = {
      event: 'error',
      message: 'Invalid connection type',
      code: 1002,
    };
    ws.send(JSON.stringify(errorMessage));
    ws.close();
    return;
  }

  if (connectionType === ConnectionType.SERVICE) {
    // Only allow one service connection at a time
    if (serviceState.socket && serviceState.socket.readyState === WebSocket.OPEN) {
      const errorMessage = {
        event: 'error',
        message: 'Another service connection is already active',
        code: 1003,
      };
      ws.send(JSON.stringify(errorMessage));
      ws.close();
      return;
    }

    // Initialize service connection state
    serviceState.socket = ws;
    resetCounters(serviceState);
    serviceState.pendingMarks = [];

    console.log('Service connection established');
  } else if (connectionType === ConnectionType.BROWSER) {
    // Validate browser connection authentication
    if (!authToken || authToken !== AUTH_TOKEN) {
      const errorMessage = {
        event: 'error',
        message: 'Invalid authentication token',
        code: 1001,
      };
      ws.send(JSON.stringify(errorMessage));
      ws.close();
      return;
    }

    // Generate a unique ID for this browser connection
    const connectionId = Date.now().toString() + Math.random().toString(36).substring(2, 15);

    // Initialize browser connection state
    const browserState: ConnectionState = {
      socket: ws,
      streamSid: null,
      sequenceNumber: 1,
      mediaChunkCounter: 1,
      pendingMarks: [],
      phoneNumber: null,
      type: ConnectionType.BROWSER,
      authToken: authToken
    };

    // Add to browser connections map
    browserConnections.set(connectionId, browserState);

    // Store connection ID in the WebSocket object for reference
    (ws as any).connectionId = connectionId;

    console.log(`Browser connection established (ID: ${connectionId})`);

    // Send connection confirmation
    ws.send(JSON.stringify({
      event: 'connected',
      message: 'Browser connection established',
      connectionId: connectionId
    }));
  }

  // Message handler
  ws.on('message', (message: string) => {
    try {
      const parsedMessage = JSON.parse(message) as WebSocketMessage;

      if (connectionType === ConnectionType.SERVICE) {
        // Process messages from service connection
        MessageHandler.handleMessage(ws, serviceState, parsedMessage);

        // We no longer broadcast all events here
        // The markHandler.ts will handle broadcasting mark events and consolidated media
      } else if (connectionType === ConnectionType.BROWSER) {
        // Process messages from browser connection
        const connectionId = (ws as any).connectionId;
        console.log(`Received message from browser connection (ID: ${connectionId})`);
        console.log(message)

        // Check if the message is a notification that browser will handle communications
        if (parsedMessage.event === 'handle_communications') {
          console.log(`Browser (ID: ${connectionId}) will now handle communications`);
          // Set a flag in the browser state to indicate it's handling communications
          const browserState = browserConnections.get(connectionId);
          if (browserState) {
            browserState.isHandlingCommunications = true;
            browserConnections.set(connectionId, browserState);
          }
        }
        // Forward browser messages to service connection
        else if (serviceState.socket && serviceState.socket.readyState === WebSocket.OPEN) {
          console.log(`Forwarding message from browser to service: ${parsedMessage.event}`);
          serviceState.socket.send(JSON.stringify(parsedMessage));
        } else {
          console.log('No active service connection to forward message to');
          ws.send(JSON.stringify({
            event: 'error',
            message: 'No active service connection available',
            code: 1004
          }));
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: 'error',
          message: 'Error processing message',
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  });

  // Close handler
  ws.on('close', () => {
    if (connectionType === ConnectionType.SERVICE) {
      console.log('Service disconnected');
      serviceState.socket = null;
    } else if (connectionType === ConnectionType.BROWSER) {
      const connectionId = (ws as any).connectionId;
      console.log(`Browser disconnected (ID: ${connectionId})`);
      browserConnections.delete(connectionId);
    }
  });

  // Error handler
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (connectionType === ConnectionType.SERVICE) {
      serviceState.socket = null;
    } else if (connectionType === ConnectionType.BROWSER) {
      const connectionId = (ws as any).connectionId;
      browserConnections.delete(connectionId);
    }
  });

  // Function to broadcast messages to all browser connections
  function broadcastToBrowsers(message: WebSocketMessage) {
    browserConnections.forEach((state, connectionId) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify(message));
      }
    });
  }
});

// 🔑 Handle WebSocket upgrade
server.on('upgrade', (req, socket, head) => {
  console.log("🔗 Upgrade request:", req.url, req.headers);
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/voicebot') {
    // Set connection type to SERVICE for /voicebot path
    url.searchParams.set('type', ConnectionType.SERVICE);
    req.url = url.toString();

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (pathname === '/browser') {
    // Set connection type to BROWSER for /browser path
    url.searchParams.set('type', ConnectionType.BROWSER);
    req.url = url.toString();

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