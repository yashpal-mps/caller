// utils/sequencing.ts
import { ConnectionState } from "../types";

/**
 * Gets the next sequence number and increments the counter
 */
export function getNextSequenceNumber(state: ConnectionState): string {
  const current = state.sequenceNumber;
  state.sequenceNumber++;
  return current.toString();
}

/**
 * Gets the next media chunk number and increments the counter
 */
export function getNextMediaChunk(state: ConnectionState): number {
  const current = state.mediaChunkCounter;
  state.mediaChunkCounter++;
  return current;
}

/**
 * Resets sequence and chunk counters to initial values
 */
export function resetCounters(state: ConnectionState): void {
  state.sequenceNumber = 1;
  state.mediaChunkCounter = 1;
}
