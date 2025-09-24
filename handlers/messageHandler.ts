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
} from "../types";
import { getNextSequenceNumber, resetCounters } from "../utils/sequencing";
import { validateMediaFormat } from "../utils/validation";
import { MarkHandler } from "./markHandler";
import { convertWavToMuLaw } from "../helpers/audioProcessor";
import path from "path";

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
      console.log(`Received event: ${data.event}`);
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
  private static handleStart(
    socket: WebSocket,
    state: ConnectionState,
    data: WebSocketMessage
  ): void {
    state.streamSid = data.streamSid || null;
    state.activeStreamStartTime = Date.now();
    state.phoneNumber = data.start?.to || null;

    const wavFilePath = path.resolve("./sample.wav"); // root dir
    const muLawBuffer = convertWavToMuLaw(wavFilePath);

    const base64Payload = muLawBuffer.toString("base64");

    const mediaMessage: MediaMessage = {
      event: "media",
      streamSid: state.streamSid as string,
      sequenceNumber: getNextSequenceNumber(state),
      media: {
        payload: base64Payload,
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
}
