// textToSpeech.js
import { KokoroTTS } from "kokoro-js";

// Initialize the model once
let ttsModel = null;

const initModel = async () => {
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
    } catch (error) {
      console.error(`❌ Failed to initialize Kokoro TTS: ${error.message}`);
      throw error;
    }
  }
  return ttsModel;
};
const tts = await initModel();

/**
 * Converts text to speech using Kokoro TTS
 */
export async function speak(text) {
  console.log(`🔄 Generating speech for: "${text}"`);
  
  try {
    const result = await tts.generate(text);
    
    console.log(`✅ Speech generated successfully (${result.audio.length / result.sampling_rate}s)`);
    
    return {
      audio: result.audio,
      sampling_rate: result.sampling_rate
    };
  } catch (error) {
    console.error(`❌ TTS generation failed: ${error.message}`);
    // Fall back to the placeholder implementation
    return generateFallbackAudio(text);
  }
}

// Fallback audio generation function
function generateFallbackAudio(text) {
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

/**
 * Stream version of the speak function (if you need streaming capability)
 * @param {string} text - The text to convert to speech
 * @returns {ReadableStream} - Stream of audio chunks
 */
export async function speakStream(text) {
  console.log(`🔄 Setting up streaming speech for text input`);
  
  try {
    // Ensure the model is initialized
    const tts = await initModel();
    
    // Create a TextSplitterStream for handling text input
    const { TextSplitterStream } = await import("kokoro-js");
    const splitter = new TextSplitterStream();
    const stream = tts.stream(splitter);
    
    // Start processing the text
    const words = text.match(/\s*\S+/g) || [];
    
    // Push words to the stream
    for (const word of words) {
      splitter.push(word);
    }
    
    // Close the stream
    splitter.close();
    
    return stream;
  } catch (error) {
    console.error(`❌ TTS streaming setup failed: ${error.message}`);
    throw error;
  }
}