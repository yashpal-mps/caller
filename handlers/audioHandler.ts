// handlers/audioHandler.ts
import WebSocket from "ws";
import {
  ConnectionState,
  MediaMessage,
  MarkMessage,
  AudioProcessResult,
  WebSocketMessage,
} from "../types";
import { getNextSequenceNumber, getNextMediaChunk } from "../utils/sequencing";
import { MarkHandler } from "./markHandler";
import { transcribeAndSave } from "../helpers/transcriptHelper";
import { processWithAI } from "../helpers/aiChat";
import { speak } from "../helpers/textToSpeech";
import { convertToStreamCompatibleAudio } from "../helpers/audioProcessor";

/**
 * Detects if audio is blank or contains only background noise
 * @param audioBuffer The audio buffer to analyze
 * @returns True if the audio is blank or contains only noise, false otherwise
 */
export function isBlankOrNoiseAudio(audioBuffer: Buffer): boolean {
  // Skip processing if buffer is too small
  if (!audioBuffer || audioBuffer.length < 100) {
    console.log("Audio buffer too small, treating as blank");
    return true;
  }

  // Calculate audio energy and zero-crossing rate
  let totalEnergy = 0;
  let zeroCrossings = 0;
  let prevSample = 0;

  // Sample a portion of the buffer for efficiency
  const sampleStep = Math.max(1, Math.floor(audioBuffer.length / 1000));
  const samples = [];

  for (let i = 0; i < audioBuffer.length; i += sampleStep) {
    // Simple amplitude calculation (assuming 8-bit audio)
    const sample = audioBuffer[i] - 128;
    samples.push(Math.abs(sample));

    // Energy calculation
    totalEnergy += sample * sample;

    // Zero crossing detection
    if ((prevSample >= 0 && sample < 0) || (prevSample < 0 && sample >= 0)) {
      zeroCrossings++;
    }

    prevSample = sample;
  }

  // Calculate metrics
  const avgEnergy = totalEnergy / (audioBuffer.length / sampleStep);
  const normalizedCrossings = zeroCrossings / (audioBuffer.length / sampleStep);

  // Calculate percentile for peak detection
  samples.sort((a, b) => a - b);
  const p95index = Math.floor(samples.length * 0.95);
  const p95value = samples[p95index];

  // Thresholds for blank/noise detection
  const energyThreshold = 100;  // Adjust based on your audio characteristics
  const crossingThresholdLow = 0.01;  // Low crossing rate suggests silence
  const crossingThresholdHigh = 0.45; // High crossing rate suggests noise
  const peakThreshold = 30;     // Adjust based on your audio characteristics

  console.log(`Audio metrics - Energy: ${avgEnergy.toFixed(2)}, Crossings: ${normalizedCrossings.toFixed(3)}, P95: ${p95value}`);

  // Decision logic
  const isLowEnergy = avgEnergy < energyThreshold;
  const isAbnormalCrossing = normalizedCrossings < crossingThresholdLow || normalizedCrossings > crossingThresholdHigh;
  const isLowPeak = p95value < peakThreshold;

  // Combined decision
  const isBlankOrNoise = isLowEnergy || (isAbnormalCrossing && isLowPeak);

  if (isBlankOrNoise) {
    console.log("Audio detected as blank or noise-only");
  }

  return isBlankOrNoise;
}

/**
 * Advanced audio processing with AI
 */
export async function processAudioWithAI(
  audioBuffer: Buffer,
  state: ConnectionState,
  socket: WebSocket
): Promise<AudioProcessResult> {
  try {
    // Check if audio is blank or noise-only before processing
    // if (isBlankOrNoiseAudio(audioBuffer)) {
    //   console.log("Skipping processing for blank or noise-only audio (detected from audio analysis)");

    //   // Send a media event with small blank audio (8 bytes of silence)
    //   const blankMediaMessage: MediaMessage = {
    //     event: "media",
    //     sequenceNumber: getNextSequenceNumber(state),
    //     streamSid: state.streamSid as string,
    //     media: {
    //       payload: Buffer.alloc(8, 128).toString("base64"),  // 8 bytes of silence (128 is the zero level in 8-bit audio)
    //       chunk: getNextMediaChunk(state),
    //       track: "outbound",
    //     },
    //   };
    //   socket.send(JSON.stringify(blankMediaMessage));

    //   // Send a mark event after the media event
    //   const blankMarkMessage: MarkMessage = {
    //     event: "mark",
    //     streamSid: state.streamSid as string,
    //     mark: {
    //       name: "blank-audio-detected",
    //     },
    //   };
    //   socket.send(JSON.stringify(blankMarkMessage));

    //   // Also broadcast to browser connections
    //   broadcastToBrowsers(blankMediaMessage);
    //   broadcastToBrowsers(blankMarkMessage);

    //   // Return small blank audio to stop further processing
    //   return {
    //     audio: Buffer.alloc(8, 128),  // 8 bytes of silence (128 is the zero level in 8-bit audio)
    //     marks: ["blank-audio-detected"],
    //   };
    // }

    // 1. Decode mu-law to PCM (simulated) and transcribe
    const transcript = await transcribeAndSave(audioBuffer, state.phoneNumber as string, state.streamSid as string);

    // Check if the transcription indicates blank audio
    // if (!isValidTranscript(transcript)) {
    //   console.log("Skipping processing for blank audio (detected from transcription)");

    //   // Send a media event with small blank audio (8 bytes of silence)
    //   const blankMediaMessage: MediaMessage = {
    //     event: "media",
    //     sequenceNumber: getNextSequenceNumber(state),
    //     streamSid: state.streamSid as string,
    //     media: {
    //       payload: Buffer.alloc(8, 128).toString("base64"),  // 8 bytes of silence (128 is the zero level in 8-bit audio)
    //       chunk: getNextMediaChunk(state),
    //       track: "outbound",
    //     },
    //   };
    //   console.log("Media event ----- ", blankMediaMessage)
    //   // socket.send(JSON.stringify(blankMediaMessage));

    //   // Send a mark event after the media event
    //   const blankMarkMessage: MarkMessage = {
    //     event: "mark",
    //     streamSid: state.streamSid as string,
    //     mark: {
    //       name: "blank-transcription-detected",
    //     },
    //   };
    //   // socket.send(JSON.stringify(blankMarkMessage));

    //   // Also broadcast to browser connections
    //   broadcastToBrowsers(blankMediaMessage);
    //   broadcastToBrowsers(blankMarkMessage);

    //   // Return small blank audio to stop further processing
    //   return {
    //     audio: Buffer.alloc(8, 128),  // 8 bytes of silence (128 is the zero level in 8-bit audio)
    //     marks: ["blank-transcription-detected"],
    //   };
    // }

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

/**
 * Broadcasts a message to all browser connections
 */
function broadcastToBrowsers(message: WebSocketMessage): void {
  // Access the browserConnections from the global scope
  const browserConnections = (global as any).browserConnections;

  if (!browserConnections) {
    console.log("No browser connections map available");
    return;
  }

  browserConnections.forEach((state: ConnectionState) => {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(message));
      console.log(`Broadcasted ${message.event} event to browser connection from audioHandler`);
    }
  });
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
    const result = await processAudioWithAI(audioBuffer, state, socket);

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

    // Also broadcast the AI response to browser connections
    broadcastToBrowsers(mediaResponse);

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

        // Also broadcast the mark to browser connections
        broadcastToBrowsers(markMessage);
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
