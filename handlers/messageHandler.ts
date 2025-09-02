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
} from "../types";
import { getNextSequenceNumber, resetCounters } from "../utils/sequencing";
import { validateMediaFormat } from "../utils/validation";
import { handleAudioProcessing } from "./audioHandler";
import { MarkHandler } from "./markHandler";
import { logger } from "../utils/logger";

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
    if (data.event !== "media") {
      logger.info(`Received event: ${data.event}`);
    } else {
      logger.media(`Received media chunk`);
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
        logger.warn(`Unknown event type: ${data.event}`);
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
    logger.info("Sent connected response");
  }

  /**
   * Handle the start event
   */
  private static handleStart(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): void {
    state.streamSid = data.streamSid || null;
    state.activeStreamStartTime = Date.now();
    state.phoneNumber = data.start?.to || null;

    logger.info(`Stream started with SID: ${state.streamSid}`);

    // Send response to start message
    const startResponse: StartMessage = {
      event: "start",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid as string,
      start: {
        accountSid: "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        callSid: "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        streamSid: state.streamSid as string,
        from: data.start?.from || "XXXXXXXXXX",
        to: data.start?.to || "XXXXXXXXXX",
        tracks: ["inbound", "outbound"],
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
        customParameters: data.start?.customParameters || {},
      },
    };

    socket.send(JSON.stringify(startResponse));
  }

  // First, make sure your ConnectionState type includes mediaChunks
  // In types.ts, add:
  // mediaChunks?: Array<{payload: string, chunk: string, timestamp?: number}>;

  // Update the handleMedia method
  private static async handleMedia(
    socket: WebSocket,
    state: ConnectionState,
    data: MediaMessage
  ): Promise<void> {
    // Validate media format
    const validation = validateMediaFormat(data);
    if (!validation.valid) {
      MessageHandler.sendError(
        socket,
        state,
        validation.error || "Invalid media format",
        1001
      );
      return;
    }

    // Initialize the media chunks array if it doesn't exist
    if (!state.mediaChunks) {
      state.mediaChunks = [];
    }

    state.mediaChunks.push({
      payload: data.media.payload,
      chunk: data.media.chunk || 0,
      timestamp: data.media.timestamp 
    });

    logger.media(`Stored media chunk ${data.media.chunk}, total chunks: ${state.mediaChunks.length}`);

    // For immediate feedback, you can still send a response without processing audio
    // This acknowledges receipt without full processing
    const mediaResponse: MediaMessage = {
      event: "media",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid as string,
      media: {
        track: "outbound", // Acknowledging receipt
        chunk: data.media.chunk,
        payload: "" // Empty payload for acknowledgment
      }
    };

    socket.send(JSON.stringify(mediaResponse));
  }

  /**
   * Handle the stop event
   */
  private static handleStop(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): void {
    logger.info(
      "Stream stopped:",
      data.stop ? data.stop.reason : "No reason provided"
    );

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

    logger.info("Received clear event, sending all pending marks");

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
    logger.info(`Received DTMF: ${data.dtmf?.digit}`);

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

    logger.error(`Sending error: ${message} (code: ${code})`);
    socket.send(JSON.stringify(errorMessage));
  }
}
