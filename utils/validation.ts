// utils/validation.ts
import { MediaMessage } from "../types";

/**
 * Validates the media format according to specification
 */
export function validateMediaFormat(data: MediaMessage): {
  valid: boolean;
  error?: string;
} {
  if (!data.media?.payload) {
    return { valid: false, error: "Missing media payload" };
  }

  // Check if it's a valid base64 string
  try {
    const buffer = Buffer.from(data.media.payload, "base64");
    if (buffer.toString("base64") !== data.media.payload) {
      return { valid: false, error: "Invalid base64 encoding" };
    }
  } catch (e) {
    return { valid: false, error: "Invalid base64 encoding" };
  }

  return { valid: true };
}

/**
 * Validates the sequence number existence and format
 */
export function validateSequenceNumber(sequenceNumber: string | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!sequenceNumber) {
    return { valid: false, error: "Missing sequence number" };
  }

  if (!/^\d+$/.test(sequenceNumber)) {
    return { valid: false, error: "Sequence number must be numeric" };
  }

  return { valid: true };
}
