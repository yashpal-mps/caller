import { Buffer } from 'buffer'; // Node.js Buffer
import { WaveFile } from 'wavefile';
import * as fs from 'fs';
import { ulawToPCM } from 'g711';

// Standard ITU G.711 mu-law encoding/decoding functions
function linearToMuLaw(sample: number): number {
  const BIAS = 33;
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.abs(sample);
  sample += BIAS;
  sample = Math.min(sample, 32767);

  let segment = 0;
  let position = 0;

  if (sample > 33) {
    let tempSample = sample;
    while (tempSample > 33 * 2) {
      segment++;
      tempSample >>= 1;
      if (segment >= 7) break;
    }
    position = (sample >> (segment + 3)) & 0x0f;
  } else {
    position = (sample - 33) >> 3;
  }
  return ~(sign | (segment << 4) | position) & 0xff;
}

export function muLawToLinear(muLawByte: number): number {
  return ulawToPCM(new Uint8Array([muLawByte]))[0];
}

/**
 * Applies adaptive noise reduction to PCM audio samples
 * @param {Int16Array} pcmSamples - The PCM audio samples to process
 * @returns {Int16Array} - Noise-reduced PCM audio samples
 */
export function applyNoiseReduction(pcmSamples: Int16Array): Int16Array {
  // Check if we have enough samples to process
  if (!pcmSamples || pcmSamples.length < 100) {
    console.warn("Audio segment too short for noise reduction, returning original");
    return pcmSamples;
  }

  const result = new Int16Array(pcmSamples.length);

  // Calculate noise floor from first 500ms (if available)
  const samplesForNoiseFloor = Math.min(4000, Math.floor(pcmSamples.length / 5));

  // Get RMS and peak values for noise profile
  let noiseRMS = 0;
  let noisePeak = 0;
  for (let i = 0; i < samplesForNoiseFloor; i++) {
    const absVal = Math.abs(pcmSamples[i]);
    noiseRMS += absVal * absVal;
    noisePeak = Math.max(noisePeak, absVal);
  }
  noiseRMS = Math.sqrt(noiseRMS / samplesForNoiseFloor);

  // Adaptive threshold based on noise profile
  const baseThreshold = 150; // Minimum threshold
  const dynamicThreshold = Math.max(baseThreshold, noiseRMS * 1.8);

  console.log(`Noise stats - RMS: ${noiseRMS.toFixed(2)}, Peak: ${noisePeak}, Threshold: ${dynamicThreshold.toFixed(2)}`);

  // Apply noise gate with adaptive smoothing
  let prevSample = 0;
  const attackTime = 0.01; // 10ms attack
  const releaseTime = 0.05; // 50ms release

  // Convert times to sample counts (assuming 8kHz)
  const attackSamples = Math.ceil(8000 * attackTime);
  const releaseSamples = Math.ceil(8000 * releaseTime);

  // Track state to apply different smoothing for attack/release
  let isAboveThreshold = false;
  let transitionCounter = 0;

  for (let i = 0; i < pcmSamples.length; i++) {
    const currentSample = pcmSamples[i];
    const absSample = Math.abs(currentSample);

    // Detect threshold crossing
    const wasAboveThreshold: boolean = isAboveThreshold;
    isAboveThreshold = absSample > dynamicThreshold;

    // Handle transitions
    if (wasAboveThreshold !== isAboveThreshold) {
      transitionCounter = isAboveThreshold ? attackSamples : releaseSamples;
    }

    if (absSample < dynamicThreshold) {
      // Apply more aggressive reduction for very quiet parts
      const reductionFactor = Math.min(0.7, Math.max(0.1, absSample / dynamicThreshold));
      result[i] = Math.round(currentSample * reductionFactor);
    } else {
      // Pass through with light smoothing
      result[i] = currentSample;
    }

    // Apply smoothing during transitions
    if (transitionCounter > 0) {
      const smoothingFactor = isAboveThreshold ?
        0.3 * (transitionCounter / attackSamples) :
        0.1 * (transitionCounter / releaseSamples);

      result[i] = Math.round(result[i] * (1 - smoothingFactor) + prevSample * smoothingFactor);
      transitionCounter--;
    }

    prevSample = result[i];
  }

  return result;
}

/**
 * Converts PCM (Float32Array) audio data to 8kHz mu-law encoded Buffer with resampling.
 * @param {Float32Array} pcmData - The input PCM audio data (e.g., from TTS).
 * @param {number} originalSampleRate - The sample rate of the input PCM data.
 * @param {number} targetSampleRate - The desired output sample rate (always 8000 for vendor).
 * @returns {Buffer} The mu-law encoded audio data as a Node.js Buffer.
 */
export function convertToStreamCompatibleAudio(
  pcmData: Float32Array,
  originalSampleRate: number,
  targetSampleRate: number
): Buffer {
  // Input validation
  if (!pcmData || pcmData.length === 0) {
    console.error("Empty PCM data provided to convertToStreamCompatibleAudio");
    return Buffer.alloc(0);
  }

  let resampledData: Float32Array;

  if (originalSampleRate !== targetSampleRate) {
    const ratio = originalSampleRate / targetSampleRate;
    const newLength = Math.floor(pcmData.length / ratio);
    resampledData = new Float32Array(newLength);

    // Larger filter size for better quality
    const filterSize = 30; // Increased from 15 to 30
    const cutoff = (0.9 * (targetSampleRate / 2)) / originalSampleRate;

    // Use a Blackman window for better frequency response
    const blackmanWindow = (j: number, filterSize: number): number => {
      return 0.42 - 0.5 * Math.cos(2 * Math.PI * j / filterSize) +
        0.08 * Math.cos(4 * Math.PI * j / filterSize);
    };

    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      let sum = 0;
      let weightSum = 0;

      for (
        let j = Math.max(0, Math.floor(srcIdx - filterSize));
        j <= Math.min(pcmData.length - 1, Math.floor(srcIdx + filterSize));
        j++
      ) {
        const dist = Math.abs(j - srcIdx);
        if (dist === 0) {
          sum += pcmData[j];
          weightSum += 1;
          continue;
        }

        // Windowed sinc filter for better quality
        const windowedSinc = dist < filterSize ?
          (Math.sin(Math.PI * cutoff * dist) / (Math.PI * dist)) *
          blackmanWindow(dist, filterSize) : 0;

        sum += pcmData[j] * windowedSinc;
        weightSum += windowedSinc;
      }
      resampledData[i] = weightSum > 0 ? sum / weightSum : 0;
    }
  } else {
    resampledData = pcmData;
  }

  // Convert Float32Array to mu-law encoded Uint8Array (Buffer)
  const muLawBuffer = Buffer.alloc(resampledData.length);
  for (let i = 0; i < resampledData.length; i++) {
    // Clamp values to avoid clipping
    const clampedValue = Math.max(-1.0, Math.min(1.0, resampledData[i]));
    const sample = Math.floor(clampedValue * 32767);
    muLawBuffer[i] = linearToMuLaw(sample);
  }
  return muLawBuffer;
}

// Helper to write string to DataView for WAV header
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Creates a WAV file Buffer from PCM Int16Array data.
 * @param {Int16Array} pcmData - The PCM audio data.
 * @param {number} sampleRate - The sample rate of the PCM data.
 * @returns {Buffer} A Node.js Buffer containing the WAV file.
 */
export function createWavFromPCM(pcmData: Int16Array, sampleRate: number): Buffer {
  // Input validation
  if (!pcmData || pcmData.length === 0) {
    console.error("Empty PCM data provided to createWavFromPCM");
    return Buffer.alloc(44); // Return empty WAV header
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize); // Use Node.js Buffer

  const view = new DataView(buffer.buffer as ArrayBuffer);

  // "RIFF" chunk
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // "fmt " sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM data
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(44 + i * 2, pcmData[i], true);
  }
  return buffer;
}

/**
 * Upsample 8kHz PCM audio to 16kHz for Whisper
 * Uses a higher quality cubic interpolation method
 * @param {Int16Array} pcmData - 8kHz PCM audio data
 * @returns {Int16Array} - 16kHz upsampled audio data
 */
export function upsampleTo16k(pcmData: Int16Array): Int16Array {
  // Input validation
  if (!pcmData || pcmData.length < 4) {
    console.warn("Audio segment too short for upsampling");

    // For very short segments, just duplicate each sample
    if (pcmData && pcmData.length > 0) {
      const result = new Int16Array(pcmData.length * 2);
      for (let i = 0; i < pcmData.length; i++) {
        result[i * 2] = result[i * 2 + 1] = pcmData[i];
      }
      return result;
    }

    return new Int16Array(0);
  }

  // Create a new buffer twice the size for 16kHz
  const upsampledData = new Int16Array(pcmData.length * 2);

  // Add boundary samples for the cubic interpolation algorithm
  const extendedPcm = new Int16Array(pcmData.length + 6);
  extendedPcm[0] = extendedPcm[1] = extendedPcm[2] = pcmData[0];
  for (let i = 0; i < pcmData.length; i++) {
    extendedPcm[i + 3] = pcmData[i];
  }
  extendedPcm[pcmData.length + 3] = extendedPcm[pcmData.length + 4] = extendedPcm[pcmData.length + 5] = pcmData[pcmData.length - 1];

  // Cubic interpolation function
  const cubicInterpolate = (y0: number, y1: number, y2: number, y3: number, mu: number): number => {
    const mu2 = mu * mu;
    const a0 = y3 - y2 - y0 + y1;
    const a1 = y0 - y1 - a0;
    const a2 = y2 - y0;
    const a3 = y1;
    return Math.round(a0 * mu * mu2 + a1 * mu2 + a2 * mu + a3);
  };

  // Fill direct samples
  for (let i = 0; i < pcmData.length; i++) {
    upsampledData[i * 2] = pcmData[i];
  }

  // Fill interpolated samples using cubic interpolation
  for (let i = 0; i < pcmData.length - 1; i++) {
    const y0 = extendedPcm[i + 2];
    const y1 = extendedPcm[i + 3];
    const y2 = extendedPcm[i + 4];
    const y3 = extendedPcm[i + 5];
    upsampledData[i * 2 + 1] = cubicInterpolate(y0, y1, y2, y3, 0.5);
  }

  // Handle the last interpolated sample
  upsampledData[(pcmData.length - 1) * 2 + 1] = pcmData[pcmData.length - 1];

  return upsampledData;
}

/**
 * Converts a WAV file to an 8kHz mu-law encoded Buffer.
 * @param {string} filePath - The path to the WAV file.
 * @returns {Buffer} The mu-law encoded audio data as a Node.js Buffer.
 */
export function convertWavToMuLaw(filePath: string): Buffer {
  try {
    const buffer = fs.readFileSync(filePath);
    const wav = new WaveFile(buffer);

    wav.toSampleRate(8000);
    wav.toBitDepth('32f'); // Convert to Float32Array
    const pcmData64 = wav.getSamples(true) as Float64Array;
    const pcmData = new Float32Array(pcmData64);
    const sampleRate = (wav.fmt as any).sampleRate;

    return convertToStreamCompatibleAudio(pcmData, sampleRate, 8000);
  } catch (error) {
    console.error(`Error converting WAV file: ${error}`);
    return Buffer.alloc(0);
  }
}

export function processAudioBuffer(audioBuffer: Buffer): Buffer {
  console.log("Processing audio buffer for transcription...");

  const pcmData = new Int16Array(audioBuffer.length);
  for (let i = 0; i < audioBuffer.length; i++) {
    pcmData[i] = muLawToLinear(audioBuffer[i]);
  }

  const wavBuffer = createWavFromPCM(pcmData, 8000);
  console.log(`Processed audio: ${audioBuffer.length} bytes → ${wavBuffer.length} bytes`);

  return wavBuffer;
}
