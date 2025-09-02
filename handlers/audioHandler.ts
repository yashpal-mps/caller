// handlers/audioHandler.ts
import WebSocket from "ws";
import {
  ConnectionState,
  MediaMessage,
  MarkMessage,
  AudioProcessResult,
} from "../types";
import { getNextSequenceNumber, getNextMediaChunk } from "../utils/sequencing";
import { MarkHandler } from "./markHandler";
import { logger } from "../utils/logger";
import { transcribeAndSave } from "../helpers/transcriptHelper";

/**
 * Basic audio processing function that transcribes audio and echoes it back
 */
export async function processAudioBasic(
  audioBuffer: Buffer,
  phoneNumber: string | null
): Promise<AudioProcessResult> {
  logger.media(`Processing audio chunk of size ${audioBuffer.length} bytes`);

  if (phoneNumber) {
    await transcribeAndSave(audioBuffer, phoneNumber);
  } else {
    await transcribeAndSave(audioBuffer, "1234567859");
  }

  // In a basic implementation, we just echo back the same audio
  await new Promise((resolve) => setTimeout(resolve, 10));

  return {
    audio: audioBuffer,
    marks: [`processed-${Date.now()}`],
  };
}

/**
 * Advanced audio processing with AI
 */
export async function processAudioWithAI(
  audioBuffer: Buffer
): Promise<AudioProcessResult> {
  try {
    logger.media(
      `Processing audio with AI pipeline. Buffer size: ${audioBuffer.length} bytes`
    );

    // 1. Decode mu-law to PCM (simulated)
    logger.media("Decoding mu-law to PCM");

    // 2. Transcribe speech to text (simulated)
    logger.media("Transcribing audio to text");
    const transcript = "Simulated transcript from speech recognition";
    logger.info(`Transcript: "${transcript}"`);

    // 3. Process with AI (simulated)
    logger.media("Processing transcript with AI");
    const aiResponse = "This is a simulated AI response";
    logger.info(`AI Response: "${aiResponse}"`);

    // 4. Convert to speech (simulated)
    logger.media("Converting AI response to speech");

    // 5. Re-encode to mu-law (simulated)
    // In a real implementation, this would be properly encoded audio
    const responseBuffer = Buffer.from(aiResponse);

    // Return the audio with a mark to track completion
    return {
      audio: responseBuffer,
      marks: [`ai-response-${Date.now()}`],
    };
  } catch (error) {
    logger.error("AI audio processing error:", error);
    throw error;
  }
}

/**
 * Process audio from client and send response
 */
export async function handleAudioProcessing(
  socket: WebSocket,
  state: ConnectionState,
  data: MediaMessage,
  useAI: boolean = false
): Promise<void> {
  try {
    // 1. Decode base64 to Buffer
    const audioBuffer = Buffer.from(data.media.payload, "base64");

    // 2. Process audio
    const result = useAI
      ? await processAudioWithAI(audioBuffer)
      : await processAudioBasic(audioBuffer, state.phoneNumber);

    // 3. Send processed audio back to client
    const mediaResponse: MediaMessage = {
      event: "media",
      sequenceNumber: getNextSequenceNumber(state),
      streamSid: state.streamSid as string,
      media: {
        payload: result.audio.toString("base64"),
        chunk: getNextMediaChunk(state),
        track: "outbound",
      },
    };

    socket.send(JSON.stringify(mediaResponse));

    // 4. Send marks if provided
    if (result.marks && result.marks.length > 0) {
      for (const markName of result.marks) {
        const markMessage: MarkMessage = {
          event: "mark",
          sequenceNumber: getNextSequenceNumber(state),
          streamSid: state.streamSid as string,
          mark: {
            name: markName,
          },
        };

        // Add to pending marks and send
        MarkHandler.addPendingMark(state, markName);
        socket.send(JSON.stringify(markMessage));
      }
    }
  } catch (err) {
    logger.error("Error in media processing:", err);
    socket.send(
      JSON.stringify({
        event: "error",
        sequenceNumber: getNextSequenceNumber(state),
        streamSid: state.streamSid,
        message: `Failed to process audio: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
        code: 1002,
      })
    );
  }
}
