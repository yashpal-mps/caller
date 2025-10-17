// handlers/messageHandler.ts
import WebSocket from "ws";
import {
  ConnectionState,
  WebSocketMessage,
  ConnectedMessage,
  StartMessage,
  MediaMessage,
  StopMessage,
  ClearMessage,
  DtmfMessage,
  ErrorMessage,
  MarkMessage,
  ConnectionType,
} from "../types";
import { getNextSequenceNumber, resetCounters } from "../utils/sequencing";
import { validateMediaFormat } from "../utils/validation";
import { MarkHandler } from "./markHandler";
import { convertWavToMuLaw } from "../helpers/audioProcessor";
import path from "path";
import { readFileSync } from "fs";
import DatabaseConnection from "../database/db.connection";

export class MessageHandler {
  /**
   * Process incoming WebSocket messages
   */
  static async handleMessage(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): Promise<void> {
    // Log non-media events to avoid flooding the console
    // if (data.event !== "media") {
    // }

    // Check if any browser connection is handling communications
    const browserConnections = (global as any).browserConnections;
    let browserHandlingCommunications = false;

    if (browserConnections) {
      browserConnections.forEach((browserState: ConnectionState) => {
        if (browserState.isHandlingCommunications) {
          browserHandlingCommunications = true;
        }
      });
    }

    // If a browser is handling communications and this is a media, start, or stop event, just broadcast it
    if (browserHandlingCommunications &&
      (data.event === 'media' || data.event === 'start' || data.event === 'stop') &&
      state.type === ConnectionType.SERVICE) {
      console.log(`Browser is handling communications, forwarding ${data.event} event`);
      if (data.event === 'media') {
        this.broadcastToBrowsers(data as MediaMessage);
      } else if (data.event === 'start') {
        this.broadcastStartToBrowsers(data as StartMessage);
      } else if (data.event === 'stop') {
        this.broadcastStopToBrowsers(data as StopMessage);
      }
      return;
    }

    switch (data.event) {
      case "connected":
        MessageHandler.handleConnected(socket, state);
        break;

      case "start":
        MessageHandler.handleStart(socket, state, data);
        break;

      case "media":
        await MessageHandler.handleMedia(socket, state, data as MediaMessage);
        break;

      case "mark":
        console.log("Received mark event: ---------------------------------", data);
        if (data.mark?.name) {
          MarkHandler.processMarkEvent(socket, state, data.mark.name);
        }
        break;

      case "stop":
        MessageHandler.handleStop(socket, state, data);
        break;

      case "clear":
        MessageHandler.handleClear(socket, state);
        break;

      case "dtmf":
        MessageHandler.handleDtmf(socket, state, data);
        break;

      default:
        console.log(`Unknown event type: ${data.event}`);
        MessageHandler.sendError(
          socket,
          state,
          `Unknown event type: ${data.event}`,
          1000
        );
    }
  }

  /**
   * Handle the connected event
   */
  private static handleConnected(
    socket: WebSocket,
    state: ConnectionState
  ): void {
    const connectedResponse: ConnectedMessage = {
      event: "connected",
      sequenceNumber: getNextSequenceNumber(state),
    };

    socket.send(JSON.stringify(connectedResponse));
    console.log("Sent connected response");
  }

  /**
   * Handle the start event
   */
  private static async handleStart(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): Promise<void> {
    state.streamSid = data.streamSid || null;
    state.activeStreamStartTime = Date.now();
    state.phoneNumber = data.start?.to || null;

    console.log("Phone number : ", state.phoneNumber);
    this.broadcastStartToBrowsers(data as StartMessage);

    // Broadcast start event to browser connections
    this.broadcastToBrowsers({
      event: "media",
      streamSid: state.streamSid || "",
      media: {
        payload: data.start,
      },
      sequenceNumber: getNextSequenceNumber(state)
    });
    console.log("Broadcasted start event to browser connections");

    let audioPayload = "";

    try {

      // Get the database connection
      const db = await DatabaseConnection.getConnection()

      if (state.phoneNumber) {
        let formattedNumber = state.phoneNumber.replace(/\D/g, '');

        // Remove country code '91' if number is greater than 10 digits
        if (formattedNumber.length > 10 && formattedNumber.startsWith('91')) {
          formattedNumber = formattedNumber.substring(2);
          console.log(`Removed country code, new number: ${formattedNumber}`);
        }

        // Query the database for the contact with this phone number
        console.log(`Searching for contact with phone number: ${formattedNumber}`);
        const contactStmt = await db.prepare('SELECT name, initial_audio FROM contacts WHERE phone LIKE ?');
        const contact = await contactStmt.get(`%${formattedNumber}%`);
        await contactStmt.finalize();

        if (contact && contact.initial_audio) {
          console.log(`Found contact: ${contact.name}, using personalized greeting audio`);
          audioPayload = contact.initial_audio;
        } else {
          console.log("No matching contact found or no initial audio available, using fallback audio");
          // Fallback to default audio file
          const base64 = path.resolve("./output.b64");
          audioPayload = readFileSync(base64, "utf8");
        }
      } else {
        console.log("No phone number provided, using fallback audio");
        // Fallback to default audio file
        const base64 = path.resolve("./output.b64");
        audioPayload = readFileSync(base64, "utf8");
      }
    } catch (error) {
      console.error("Error fetching audio from database:", error);
      // Fallback to default audio file
      const base64 = path.resolve("./output.b64");
      audioPayload = readFileSync(base64, "utf8");
    }

    const mediaMessage: MediaMessage = {
      event: "media",
      streamSid: state.streamSid as string,
      sequenceNumber: getNextSequenceNumber(state),
      media: {
        payload: audioPayload,
      },
    };
    console.log("Sent media message");
    const markMessage: MarkMessage = {
      event: "mark",
      streamSid: state.streamSid as string,
      mark: {
        name: "start",
      },
    }

    // --- 4. Send over socket ---
    socket.send(JSON.stringify(mediaMessage));
    socket.send(JSON.stringify(markMessage));
  }


  private static async handleMedia(
    socket: WebSocket,
    state: ConnectionState,
    data: MediaMessage
  ): Promise<void> {
    const validation = validateMediaFormat(data);
    if (!validation.valid) {
      return;
    }
    if (!state.mediaChunks) {
      state.mediaChunks = [];
    }

    state.mediaChunks.push({
      payload: data.media.payload,
      chunk: data.media.chunk || 0,
      timestamp: data.media.timestamp
    });
  }

  /**
   * Handle the stop event
   */
  private static handleStop(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): void {
    console.log(
      "Stream stopped:",
      data.stop ? data.stop.reason : "No reason provided"
    );
    this.broadcastStartToBrowsers(data as StopMessage);

    // Acknowledge the stop event
    const stopResponse: StopMessage = {
      event: "stop",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid as string,
      stop: {
        accountSid: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        callSid: "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        reason: "Call acknowledged",
      },
    };

    socket.send(JSON.stringify(stopResponse));

    // Reset call state
    state.streamSid = null;
    state.pendingMarks = [];
    resetCounters(state);
  }

  /**
   * Handle the clear event
   */
  private static handleClear(socket: WebSocket, state: ConnectionState): void {
    if (!state.streamSid) return;

    console.log("Received clear event, sending all pending marks");

    // Send all pending marks
    MarkHandler.sendAllPendingMarks(socket, state);

    // Acknowledge the clear event
    const clearResponse: ClearMessage = {
      event: "clear",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid,
    };

    socket.send(JSON.stringify(clearResponse));
  }

  /**
   * Handle the DTMF event
   */
  private static handleDtmf(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): void {
    console.log(`Received DTMF: ${data.dtmf?.digit}`);

    // Echo back the DTMF if needed
    const dtmfResponse: DtmfMessage = {
      event: "dtmf",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid as string,
      dtmf: {
        digit: data.dtmf?.digit || "",
      },
    };

    socket.send(JSON.stringify(dtmfResponse));
  }

  /**
   * Send error message to client
   */
  static sendError(
    socket: WebSocket,
    state: ConnectionState,
    message: string,
    code: number = 1000
  ): void {
    const errorMessage: ErrorMessage = {
      event: "error",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid || undefined,
      message,
      code,
    };

    console.log(`Sending error: ${message} (code: ${code})`);
  }

  /**
   * Broadcasts a message to all browser connections
   */
  private static broadcastToBrowsers(message: MediaMessage | MarkMessage): void {
    // Access the browserConnections from the global scope
    const browserConnections = (global as any).browserConnections;

    if (!browserConnections) {
      console.log("No browser connections map available");
      return;
    }

    browserConnections.forEach((state: ConnectionState) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify(message));
        console.log(`Broadcasted ${message.event} event to browser connection`);
      }
    });
  }

  /**
   * Broadcasts a start event to all browser connections
   */
  private static broadcastStartToBrowsers(message: StartMessage | StopMessage): void {
    // Access the browserConnections from the global scope
    const browserConnections = (global as any).browserConnections;

    if (!browserConnections) {
      console.log("No browser connections map available");
      return;
    }

    browserConnections.forEach((state: ConnectionState) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify(message));
        console.log(`Broadcasted start event to browser connection`);
      }
    });
  }

  /**
   * Broadcasts a stop event to all browser connections
   */
  private static broadcastStopToBrowsers(message: StopMessage): void {
    // Access the browserConnections from the global scope
    const browserConnections = (global as any).browserConnections;

    if (!browserConnections) {
      console.log("No browser connections map available");
      return;
    }

    browserConnections.forEach((state: ConnectionState) => {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify(message));
        console.log(`Broadcasted stop event to browser connection`);
      }
    });
  }
}
