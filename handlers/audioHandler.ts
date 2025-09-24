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
import { transcribeAndSave } from "../helpers/transcriptHelper";
import { processWithAI } from "../helpers/aiChat";
import { speak } from "../helpers/textToSpeech";
import { convertToStreamCompatibleAudio } from "../helpers/audioProcessor";

/**
 * Advanced audio processing with AI
 */
export async function processAudioWithAI(
  audioBuffer: Buffer,
  state: ConnectionState
): Promise<AudioProcessResult> {
  try {
    // 1. Decode mu-law to PCM (simulated)
    const transcript = await transcribeAndSave(audioBuffer, state.phoneNumber as string, state.streamSid as string);

    // 3. Process with AI (simulated)
    const aiResponse = await processWithAI(transcript);

    let fullAiResponse = "";
    for await (const chunk of aiResponse) {
      fullAiResponse += chunk;
    }

    // 4. Convert to speech
    console.log("Converting AI response to speech");
    const { audio: aiAudioBuffer, sampling_rate } = await speak(fullAiResponse);

    // 5. Re-encode to mu-law (simulated)
    // In a real implementation, this would be properly encoded audio
    const responseBuffer = convertToStreamCompatibleAudio(aiAudioBuffer, sampling_rate, 8000);

    // Return the audio with a mark to track completion
    return {
      audio: responseBuffer,
      marks: [`ai-response-${Date.now()}`],
    };
  } catch (error) {
    console.log("AI audio processing error:", error);
    throw error;
  }
}

/**
 * Helper to check if transcript is valid (not blank, noise, or messy)
 * Adjust thresholds/patterns based on your Whisper outputs.
 */
function isValidTranscript(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) return false;

  // Common noise/blank patterns from Whisper (extend as needed)
  const noisePatterns = [
    '[BLANK_AUDIO]',
    '[NO_SPEECH]',
    '[INAUDIBLE]',
    '( )', // Empty or silences
    '[BACKGROUND_NOISE]',
    // Add more based on your observations, e.g., '[MESSY_AUDIO]'
  ];
  if (noisePatterns.some(pattern => trimmed.toUpperCase().includes(pattern.toUpperCase()))) {
    return false;
  }

  // Check length: Skip very short/messy transcripts (e.g., less than 2-3 words)
  // This catches background voice or single-word noise
  const words = trimmed.split(/\s+/).filter(word => word.length > 0);
  if (words.length < 2) { // Adjust threshold (e.g., < 3) as needed
    console.log("Transcript too short, treating as noise:", trimmed);
    return false;
  }

  return true;
}

export async function handleAudioProcessing(
  socket: WebSocket,
  state: ConnectionState,
  data: MediaMessage,
): Promise<void> {
  try {
    // 1. Decode base64 to Buffer
    const audioBuffer = Buffer.from(data.media.payload, "base64");

    // 2. Process audio
    const result = await processAudioWithAI(audioBuffer, state);

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

    const markMessage: MarkMessage = {
      event: "mark",
      streamSid: state.streamSid as string,
      mark: {
        name: "Media message send",
      },
    };

    socket.send(JSON.stringify(mediaResponse));

    // 4. Send marks if provided
    if (result?.marks && result.marks.length > 0) {
      for (const markName of result.marks) {
        const markMessage: MarkMessage = {
          event: "mark",
          streamSid: state.streamSid as string,
          mark: {
            name: markName,
          },
        };
        console.log(`Sending mark: ${markName}`);
        MarkHandler.addPendingMark(state, markName);
        socket.send(JSON.stringify(markMessage));
      }
    }
  } catch (err) {
    console.log("Error in media processing:", err);
    socket.send(
      JSON.stringify({
        event: "error",
        sequenceNumber: getNextSequenceNumber(state),
        streamSid: state.streamSid,
        message: `Failed to process audio: ${err instanceof Error ? err.message : "Unknown error"}`,
        code: 1002,
      })
    );
  }
}
