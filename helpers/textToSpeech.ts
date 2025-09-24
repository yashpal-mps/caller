import { KokoroTTS, TextSplitterStream } from "kokoro-js";

// Initialize the model once
let ttsModel: KokoroTTS | null = null;

const initModel = async (): Promise<KokoroTTS> => {
  if (!ttsModel) {
    try {
      console.log("🔄 Initializing Kokoro TTS model...");

      // Use the direct model ID from Hugging Face instead of a local path
      const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";

      ttsModel = await KokoroTTS.from_pretrained(model_id, {
        dtype: "fp32",
        device: "cpu"
      });

      console.log("✅ Kokoro TTS model loaded successfully");
    } catch (error: any) {
      console.error(`❌ Failed to initialize Kokoro TTS: ${error.message}`);
      throw error;
    }
  }
  return ttsModel;
};

let ttsPromise: Promise<KokoroTTS> | null = null;

const getTTSModel = async (): Promise<KokoroTTS> => {
  if (!ttsPromise) {
    ttsPromise = initModel();
  }
  return ttsPromise;
};

interface SpeakResult {
  audio: Float32Array;
  sampling_rate: number;
}

/**
 * Converts text to speech using Kokoro TTS
 */
export async function speak(text: string): Promise<SpeakResult> {
  console.log(`🔄 Generating speech for: "${text}"`);

  try {
    const tts = await getTTSModel();
    const result = await tts.generate(text);

    console.log(`✅ Speech generated successfully (${result.audio.length / result.sampling_rate}s)`);
    console.log(`✅ Audio length: ${result.audio.length} samples, sampling rate: ${result.sampling_rate} Hz`);

    return {
      audio: result.audio,
      sampling_rate: result.sampling_rate
    };
  } catch (error: any) {
    console.error(`❌ TTS generation failed: ${error.message}`);
    // Fall back to the placeholder implementation
    return generateFallbackAudio(text);
  }
}

// Fallback audio generation function
function generateFallbackAudio(text: string): SpeakResult {
  const sampleRate = 24000;
  const duration = Math.min(text.length * 0.05, 3); // Simulate duration based on text length, max 3 seconds
  const numSamples = Math.floor(sampleRate * duration);
  const audio = new Float32Array(numSamples);

  // Simple sine wave for mock audio
  for (let i = 0; i < numSamples; i++) {
    audio[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.5; // 440 Hz sine wave
  }

  console.log(`✅ Fallback TTS generated mock audio (${duration.toFixed(2)}s).`);
  return { audio: audio, sampling_rate: sampleRate };
}

interface SpeakResult {
  audio: Float32Array;
  sampling_rate: number;
}

/**
 * Stream version of the speak function (if you need streaming capability)
 * @param {string} text - The text to convert to speech (pass full sentences for best results)
 * @returns {ReadableStream<SpeakResult>} - Stream of structured audio chunks
 */
export async function* speakStream(text: string): AsyncGenerator<{ text: string; phonemes: string; audio: Float32Array }> {
  console.log(`🔄 Setting up streaming speech for text input`);
  
  try {
    // Ensure the model is initialized
    const tts = await getTTSModel();
    const sampling_rate = 24000;  // Use model's default or fallback (check Kokoro docs)

    // For streaming, use TextSplitterStream on full text (better than per-word; splits internally if supported)
    const splitter = new TextSplitterStream();
    const generator = tts.stream(splitter);

    // Push the full text (or split into sentences/words if needed—experiment)
    splitter.push(text);
    splitter.close();  // Close after pushing; generator will process progressively

    // Accumulator for partial audio if Kokoro yields multiple small chunks
    let accumulatedAudio: Float32Array | null = null;

    for await (const value of generator) {
      if (!value) continue;

      // Kokoro stream yields objects with text, phonemes, and audio
      const audioChunk = value.audio;

      if (!(audioChunk instanceof Float32Array) || audioChunk.length === 0) {
        console.log("⚠️ Empty/invalid audio chunk from TTS generator—skipping", value);
        continue;
      }

      // Accumulate or yield directly (for small chunks, accumulate to avoid tiny payloads)
      if (accumulatedAudio) {
        const newAudio: Float32Array = new Float32Array(accumulatedAudio.length + audioChunk.length);
        newAudio.set(accumulatedAudio);
        newAudio.set(audioChunk, accumulatedAudio.length);
        accumulatedAudio = newAudio;
      } else {
        accumulatedAudio = audioChunk;
      }

      // Yield if accumulated > threshold (e.g., 0.1s = 2400 samples at 24kHz) for chunked streaming
      const thresholdSamples = sampling_rate * 0.1;  // 100ms chunks
      if (accumulatedAudio.length >= thresholdSamples) {
        yield { text: value.text, phonemes: value.phonemes, audio: accumulatedAudio };
        console.log(`✅ Streaming chunk: ${accumulatedAudio.length} samples at ${sampling_rate} Hz`);
        accumulatedAudio = null;  // Reset for next
      }
    }

    if (accumulatedAudio && accumulatedAudio.length > 0) {
      yield { text: "", phonemes: "", audio: accumulatedAudio }; // Yield any remaining audio
    }

  } catch (error: any) {
    console.error(`❌ TTS streaming setup failed: ${error.message}`);

    // Fallback: Return a stream from non-streaming speak (wrap single result as one-chunk stream)
    console.log("🔄 Falling back to non-streaming TTS for stream");
    try {
      const fullResult = await speak(text);  // Uses working speak
      yield { text: "", phonemes: "", audio: fullResult.audio };
    } catch (fallbackErr: any) {
      console.error(`❌ Fallback TTS failed: ${fallbackErr.message}`);
      throw error;  // Re-throw original
    }
  }
}