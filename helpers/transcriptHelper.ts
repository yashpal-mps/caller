import fs from "fs";
import path from "path";
import { transcribeAudio } from "./speechToText";
import { processAudioBuffer } from "./audioProcessor";
import { logger } from "../utils/logger";

const TRANSCRIPTS_DIR = path.join(__dirname, "../transcripts");
const AUDIO_DIR = path.join(__dirname, "../audio_samples");

if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

export async function transcribeAndSave(
  audioBuffer: Buffer,
  phoneNumber: string,
  streamSid: string
): Promise<string> {
  try {
    console.log(`Transcribing audio for ${phoneNumber} (Stream SID: ${streamSid})...`);
    const processedBuffer = processAudioBuffer(audioBuffer);

    // Use streamSid as the jobId for easier tracking and consistent file naming
    const jobId = streamSid;

    // Store audio in a dedicated directory organized by streamSid
    const streamSidDir = path.join(AUDIO_DIR, streamSid);

    const result = await transcribeAudio(processedBuffer, {
      saveAudio: true,
      outputDir: streamSidDir,
      jobId: jobId
    });

    // Extract the transcription text from the result object
    const transcriptionText = result.transcription;

    if (transcriptionText) {
      console.log(`Transcript for ${phoneNumber} (Stream SID: ${streamSid}): "${transcriptionText}"`);
      const transcriptPath = path.join(TRANSCRIPTS_DIR, streamSid);
      if (!fs.existsSync(transcriptPath)) {
        fs.mkdirSync(transcriptPath, { recursive: true });
      }

      // Append to a single file named after the streamSid
      const transcriptFile = path.join(transcriptPath, `${streamSid}.txt`);
      fs.appendFileSync(transcriptFile, transcriptionText + "\n"); // Append with a newline
      console.log(`Transcript appended to ${transcriptFile}`);

      if (result.audioFiles) {
        if (result.audioFiles.processed) {
          console.log(`Processed audio saved to: ${result.audioFiles.processed}`);
        }
      }
    }

    return transcriptionText;
  } catch (error) {
    logger.error(`Error during transcription for ${phoneNumber} (Stream SID: ${streamSid}):`, error);
    return "";
  }
}