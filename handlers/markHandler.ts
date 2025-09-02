// handlers/markHandler.ts
import WebSocket from "ws";
import { ConnectionState, MarkMessage, MediaMessage } from "../types";
import { getNextSequenceNumber } from "../utils/sequencing";
import { logger } from "../utils/logger";
import { handleAudioProcessing } from "./audioHandler";

/**
 * Tracks and manages pending marks for synchronization
 */
export class MarkHandler {
  /**
   * Adds a mark to the pending list
   */
  static addPendingMark(state: ConnectionState, markName: string): void {
    state.pendingMarks.push(markName);
    logger.debug(
      `Added pending mark: ${markName}. Total pending: ${state.pendingMarks.length}`
    );
  }

  /**
   * Acknowledges a mark received from the client
   */
  static acknowledgeClientMark(
    socket: WebSocket,
    state: ConnectionState,
    markName: string
  ): void {
    if (!state.streamSid) return;

    const markResponse: MarkMessage = {
      event: "mark",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid,
      mark: {
        name: markName,
      },
    };

    socket.send(JSON.stringify(markResponse));
    logger.debug(`Acknowledged client mark: ${markName}`);
  }

  /**
   * Sends all pending marks and clears the list
   */
  static sendAllPendingMarks(socket: WebSocket, state: ConnectionState): void {
    if (!state.streamSid || !state.pendingMarks.length) return;

    logger.info(`Sending ${state.pendingMarks.length} pending marks`);

    for (const markName of state.pendingMarks) {
      const markMessage: MarkMessage = {
        event: "mark",
        sequenceNumber: getNextSequenceNumber(state),
        streamSid: state.streamSid,
        mark: {
          name: markName,
        },
      };

      socket.send(JSON.stringify(markMessage));
      logger.debug(`Sent pending mark: ${markName}`);
    }

    // Clear pending marks after sending
    state.pendingMarks = [];
  }

  static processMarkEvent(socket: WebSocket, state: ConnectionState, markName: string): void {
    logger.info(`Processing mark event: ${markName}`);

    // Process all collected chunks if any
    if (state.mediaChunks && state.mediaChunks.length > 0) {
      logger.info(`Processing ${state.mediaChunks.length} collected audio chunks`);

      // Create a consolidated media message with all chunks
      const consolidatedMedia: MediaMessage = {
        event: "media",
        sequenceNumber: getNextSequenceNumber(state),
        streamSid: state.streamSid as string,
        media: {
          track: "inbound",
          chunk: 0, // Indicating this is a complete audio segment
          payload: this.combineAudioChunks(state.mediaChunks)
        }
      };

      // Process the complete audio
      handleAudioProcessing(socket, state, consolidatedMedia, false);

      // Clear the buffer after processing
      state.mediaChunks = [];
      logger.info("Audio chunks processed and buffer cleared");
    }

    // Add mark to pending marks
    state.pendingMarks.push(markName);
    logger.info(`Added mark '${markName}' to pending marks`);
  }

  private static combineAudioChunks(chunks: Array<{ payload: string, chunk: number, timestamp?: number }>): string {
    try {
      // Sort chunks by chunk number
      chunks.sort((a, b) => a.chunk - b.chunk);

      // For base64 encoded audio, concatenate the decoded data and re-encode
      const decodedChunks = chunks.map(chunk => Buffer.from(chunk.payload, 'base64'));
      const combinedBuffer = Buffer.concat(decodedChunks);
      return combinedBuffer.toString('base64');
    } catch (error) {
      logger.error(`Error combining audio chunks: ${error}`);
      return "";
    }
  }
}
