import fs from "fs";
import path from "path";
import { transcribeAudio } from "./speechToText";
import { muLawToLinear, createWavFromPCM } from "./audioProcessor";
import { logger } from "../utils/logger";

const TRANSCRIPTS_DIR = path.join(__dirname, "../transcripts");
const AUDIO_DIR = path.join(__dirname, "../audio_samples");

if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function processAudioBuffer(audioBuffer: Buffer): Buffer {
  logger.media("Processing audio buffer for transcription...");

  const pcmData = new Int16Array(audioBuffer.length);
  for (let i = 0; i < audioBuffer.length; i++) {
    pcmData[i] = muLawToLinear(audioBuffer[i]);
  }

  const wavBuffer = createWavFromPCM(pcmData, 8000);
  logger.media(`Processed audio: ${audioBuffer.length} bytes → ${wavBuffer.length} bytes`);

  return wavBuffer;
}

export async function transcribeAndSave(
  audioBuffer: Buffer,
  phoneNumber: string
): Promise<string> {
  try {
    logger.info(`Transcribing audio for ${phoneNumber}...`);
    const processedBuffer = processAudioBuffer(audioBuffer);
    
    // Use a phone-number based jobId for easier tracking
    const jobId = `${phoneNumber.replace(/\D/g, '')}_${Date.now()}`;
    
    // Store audio in a dedicated directory organized by phone number
    const phoneDir = path.join(AUDIO_DIR, phoneNumber.replace(/\D/g, ''));
    
    const result = await transcribeAudio(processedBuffer, {
      saveAudio: true,
      outputDir: phoneDir,
      jobId: jobId
    });
    
    // Extract the transcription text from the result object
    const transcriptionText = result.transcription;

    if (transcriptionText) {
      logger.info(`Transcript for ${phoneNumber}: "${transcriptionText}"`);
      const transcriptPath = path.join(TRANSCRIPTS_DIR, phoneNumber);
      if (!fs.existsSync(transcriptPath)) {
        fs.mkdirSync(transcriptPath, { recursive: true });
      }
      
      const timestamp = Date.now();
      const transcriptFile = path.join(transcriptPath, `${timestamp}.txt`);
      fs.writeFileSync(transcriptFile, transcriptionText);
      logger.info(`Transcript saved to ${transcriptFile}`);
      
      // If we have audio files, log their locations
      if (result.audioFiles) {
        if (result.audioFiles.original) {
          logger.info(`Original audio saved to: ${result.audioFiles.original}`);
        }
        if (result.audioFiles.processed) {
          logger.info(`Processed audio saved to: ${result.audioFiles.processed}`);
        }
      }
    }

    return transcriptionText;
  } catch (error) {
    logger.error(`Error during transcription for ${phoneNumber}:`, error);
    return "";
  }
}