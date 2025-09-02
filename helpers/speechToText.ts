// directWhisperTranscriber.ts
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec, execSync } = require("child_process");
const util = require("util");
const {
  muLawToLinear,
  applyNoiseReduction,
  createWavFromPCM,
} = require("./audioProcessor");

const execPromise = util.promisify(exec);
const TEMP_DIR = path.join(os.tmpdir(), "whisper-audio");
const MODELS_DIR = path.join(__dirname, "models");
const WHISPER_SRC_DIR = path.join(__dirname, "../node_modules/nodejs-whisper/cpp/whisper.cpp");
const WHISPER_CLI_PATH = path.join(WHISPER_SRC_DIR, "build/bin/whisper-cli");
const MODEL_PATH = path.join(WHISPER_SRC_DIR, "models/ggml-base.en.bin");

// Available Whisper models
export const MODELS_LIST: string[] = [
  "tiny",
  "tiny.en",
  "base",
  "base.en",
  "small",
  "small.en",
  "medium",
  "medium.en",
  "large-v1",
  "large",
  "large-v3-turbo",
];

// Default model configuration
const DEFAULT_MODEL = "base.en";
let modelInitialized = false;
let modelPath: string | null = null;

// Create necessary directories
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

/**
 * Install Whisper CLI by building from source
 * @returns {Promise<boolean>} Success status
 */
async function installWhisperCli(): Promise<boolean> {
  console.log("🔧 Installing Whisper CLI...");

  try {
    // Check if we can access the source directory
    if (!fs.existsSync(WHISPER_SRC_DIR)) {
      console.log("📦 Whisper source not found. Installing nodejs-whisper package...");
      execSync("npm install nodejs-whisper", { stdio: 'inherit' });

      if (!fs.existsSync(WHISPER_SRC_DIR)) {
        throw new Error("Failed to install nodejs-whisper package");
      }
    }

    // Check the directory structure to understand what we're working with
    console.log(`📂 Checking Whisper directory structure in ${WHISPER_SRC_DIR}...`);
    if (fs.existsSync(WHISPER_SRC_DIR)) {
      console.log("Files in whisper.cpp directory:");
      const files = fs.readdirSync(WHISPER_SRC_DIR);
      console.log(files.join(', '));
    }

    // Build using CMake which is what the package uses
    console.log(`🔨 Building Whisper in ${WHISPER_SRC_DIR}...`);
    execSync("cmake -B build", { cwd: WHISPER_SRC_DIR, stdio: 'inherit' });
    execSync("cmake --build build --config Release", { cwd: WHISPER_SRC_DIR, stdio: 'inherit' });

    // The built executable should be in the build/bin directory
    const builtCliPath = path.join(WHISPER_SRC_DIR, "build", "bin", "whisper-cli");

    if (fs.existsSync(builtCliPath)) {
      console.log(`✅ Found built whisper-cli at ${builtCliPath}`);

      // Create the target directory
      const targetDir = path.dirname(WHISPER_CLI_PATH);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy the executable
      fs.copyFileSync(builtCliPath, WHISPER_CLI_PATH);
      fs.chmodSync(WHISPER_CLI_PATH, 0o755); // Make executable
      console.log(`✅ Copied whisper-cli to ${WHISPER_CLI_PATH}`);
      return true;
    }

    // If not found at the expected path, search for it
    console.log("🔍 Searching for whisper-cli executable in build directory...");
    const buildDir = path.join(WHISPER_SRC_DIR, "build");
    const findExecutable = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const found = findExecutable(fullPath);
          if (found) return found;
        } else if (
          entry.isFile() &&
          (entry.name === "whisper-cli" || entry.name === "main" || entry.name === "whisper")
        ) {
          try {
            // Check if it's executable
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
          } catch (e) {
            // Not executable
          }
        }
      }

      return null;
    };

    const foundExecutable = findExecutable(buildDir);

    if (foundExecutable) {
      console.log(`✅ Found executable at ${foundExecutable}`);

      // Create the target directory
      const targetDir = path.dirname(WHISPER_CLI_PATH);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy the executable
      fs.copyFileSync(foundExecutable, WHISPER_CLI_PATH);
      fs.chmodSync(WHISPER_CLI_PATH, 0o755); // Make executable
      console.log(`✅ Copied to ${WHISPER_CLI_PATH} and made executable`);
      return true;
    }

    throw new Error("Build completed but whisper-cli executable not found");
  } catch (error) {
    console.error(`❌ Failed to install Whisper CLI: ${(error as Error).message}`);
    console.log("💡 You may need to install build dependencies (make, g++/clang) and try again");
    console.log("💡 Alternative: install whisper.cpp manually and set WHISPER_CLI_PATH environment variable");
    return false;
  }
}
/**
 * Download model if not available
 * @param {string} modelName Model name to download
 * @returns {Promise<boolean>} Success status
 */
async function downloadModel(modelName: string): Promise<boolean> {
  const modelFileName = `ggml-${modelName}.bin`;
  const modelDir = path.join(WHISPER_SRC_DIR, "models");
  const targetPath = path.join(modelDir, modelFileName);

  if (fs.existsSync(targetPath)) {
    console.log(`✅ Model ${modelName} already exists at ${targetPath}`);
    return true;
  }

  console.log(`📥 Downloading model ${modelName}...`);

  try {
    // Create models directory if it doesn't exist
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    // Use the download script from whisper.cpp
    const downloadScript = path.join(WHISPER_SRC_DIR, "models", "download-ggml-model.sh");

    if (!fs.existsSync(downloadScript)) {
      // If script doesn't exist, use curl directly
      const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
      execSync(`curl -L ${modelUrl} -o ${targetPath}`, { stdio: 'inherit' });
    } else {
      // Use the provided script
      execSync(`bash ${downloadScript} ${modelName}`, { cwd: modelDir, stdio: 'inherit' });
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`Model download seemed to succeed but file not found at ${targetPath}`);
    }

    console.log(`✅ Model ${modelName} downloaded successfully to ${targetPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to download model ${modelName}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Initialize the Whisper model
 * @param {string} modelName - Model name to use (defaults to base.en)
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
export async function initWhisper(modelName: string = DEFAULT_MODEL): Promise<boolean> {
  console.log(`🔄 Initializing Whisper model (${modelName})...`);

  try {
    if (!MODELS_LIST.includes(modelName)) {
      console.warn(
        `⚠️ Model ${modelName} not in standard models list. Using anyway.`
      );
    }

    // Check if whisper-cli exists
    if (!fs.existsSync(WHISPER_CLI_PATH)) {
      console.log(`⚠️ Whisper CLI executable not found at: ${WHISPER_CLI_PATH}`);
      const installed = await installWhisperCli();
      if (!installed) {
        throw new Error("Failed to install Whisper CLI");
      }
    }

    // Find the model file
    const possibleModelPaths = [
      path.join(MODELS_DIR, `ggml-${modelName}.bin`),
      path.join("./models", `ggml-${modelName}.bin`),
      path.join(WHISPER_SRC_DIR, "models", `ggml-${modelName}.bin`),
    ];

    let modelFound = false;
    for (const p of possibleModelPaths) {
      if (fs.existsSync(p)) {
        modelPath = p;
        modelFound = true;
        console.log(`✅ Found model at: ${modelPath}`);
        break;
      }
    }

    if (!modelFound) {
      console.log(`⚠️ Model ${modelName} not found. Attempting to download...`);
      const downloaded = await downloadModel(modelName);
      if (downloaded) {
        modelPath = path.join(WHISPER_SRC_DIR, "models", `ggml-${modelName}.bin`);
        modelFound = true;
      } else {
        throw new Error(`Failed to download model ${modelName}`);
      }
    }

    modelInitialized = true;
    console.log("✅ Whisper ready to use!");
    return true;
  } catch (error) {
    console.error(`❌ Failed to initialize Whisper: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Process audio buffer to make it compatible with Whisper
 * @param {Buffer} audioBuffer - Raw audio buffer
 * @returns {Buffer} - Processed audio buffer in WAV format
 */
function processAudioBuffer(audioBuffer: Buffer): Buffer {
  console.log("🔄 Processing audio buffer...");

  // Convert mu-law to PCM
  const pcmData = new Int16Array(audioBuffer.length);
  for (let i = 0; i < audioBuffer.length; i++) {
    pcmData[i] = muLawToLinear(audioBuffer[i]);
  }

  // Apply noise reduction
  const cleanedPcm = applyNoiseReduction(pcmData);

  // Create WAV from PCM data
  const wavBuffer = createWavFromPCM(cleanedPcm, 8000);
  console.log(
    `✅ Audio processed: ${audioBuffer.length} bytes → ${wavBuffer.length} bytes`
  );

  return wavBuffer;
}

/**
 * Transcribe audio buffer using Whisper directly
 * @param {Buffer} audioBuffer - Audio buffer to transcribe
 * @param {Object} options - Additional options for transcription
 * @returns {Promise<{transcription: string, audioFiles?: {original?: string, processed?: string}}>} - Transcription result and audio file paths
 */
export async function transcribeAudio(
  audioBuffer: Buffer, 
  options: { 
    modelName?: string, 
    saveAudio?: boolean | 'original' | 'processed' | 'both',
    outputDir?: string,
    jobId?: string
  } = {}
): Promise<{transcription: string, audioFiles?: {original?: string, processed?: string}}> {
  console.log("🔄 Transcribing audio with Whisper (direct execution)...");

  if (!modelInitialized) {
    console.log("⚠️ Model not initialized. Initializing now...");
    const initialized = await initWhisper(options.modelName || DEFAULT_MODEL);
    if (!initialized) {
      return { transcription: "Error: Failed to initialize STT model" };
    }
  }

  let jobDir: string | undefined;
  let audioFiles: {original?: string, processed?: string} = {};
  
  try {
    // Create dedicated output directory for this job
    const jobId = options.jobId || Date.now().toString();
    const baseDir = options.outputDir || path.join(__dirname, "whisper_jobs");
    jobDir = path.join(baseDir, `job_${jobId}`);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    fs.mkdirSync(jobDir, { recursive: true });

    // First, save the original audio buffer
    const originalFile = path.join(jobDir, "original.raw");
    fs.writeFileSync(originalFile, audioBuffer);
    console.log(`✅ Saved original audio file: ${originalFile} (${audioBuffer.length} bytes)`);
    audioFiles.original = originalFile;

    // Process the audio for transcription
    console.log("🔄 Processing audio for transcription...");
    const processedAudio = processAudioBuffer(audioBuffer);

    // Save the processed audio
    const inputFile = path.join(jobDir, "input.wav");
    fs.writeFileSync(inputFile, processedAudio);
    console.log(`✅ Saved processed audio file: ${inputFile} (${processedAudio.length} bytes)`);
    audioFiles.processed = inputFile;

    // Output path
    const outputPath = path.join(jobDir, "output");

    // Execute command
    const command = `"${WHISPER_CLI_PATH}" -m "${modelPath}" -f "${inputFile}" -otxt -of "${outputPath}" -l en`;

    console.log(`Executing command: ${command}`);
    const { stdout, stderr } = await execPromise(command);

    // Log complete command output for debugging
    console.log("\n--- STDOUT ---");
    console.log(stdout);

    console.log("\n--- STDERR ---");
    console.log(stderr);

    // Look for output file
    const outputFile = `${outputPath}.txt`;
    let transcription = "";

    if (fs.existsSync(outputFile)) {
      transcription = fs.readFileSync(outputFile, "utf8").trim();
      console.log(`✅ Found output file: ${outputFile}`);
      console.log(`Output file size: ${fs.statSync(outputFile).size} bytes`);

      if (!transcription) {
        console.log("⚠️ Output file exists but is empty");
      }
    } else {
      console.log(`⚠️ Output file not found: ${outputFile}`);
    }

    // If no transcription yet, try using different parameters
    if (!transcription) {
      console.log(
        "⚠️ No transcription found. Trying with sensitive settings..."
      );

      const outputPath2 = path.join(jobDir, "output_sensitive");
      const command2 = `"${WHISPER_CLI_PATH}" -m "${modelPath}" -f "${inputFile}" -otxt -of "${outputPath2}" -l en -nth 0.1 -wt 0.01`;

      await execPromise(command2);

      const outputFile2 = `${outputPath2}.txt`;
      if (fs.existsSync(outputFile2)) {
        transcription = fs.readFileSync(outputFile2, "utf8").trim();
      }
    }

    console.log(
      `✅ Transcription complete: "${transcription.substring(0, 100)}${transcription.length > 100 ? "..." : ""}"`
    );

    // Determine which audio files to keep based on options
    const shouldSaveAudio = options.saveAudio || false;
    
    if (shouldSaveAudio) {
      console.log(`📁 Keeping audio files in job directory: ${jobDir}`);
      
      // If specific file types are requested, only return those
      if (shouldSaveAudio === 'original') {
        delete audioFiles.processed;
      } else if (shouldSaveAudio === 'processed') {
        delete audioFiles.original;
      }
      
      return { 
        transcription,
        audioFiles
      };
    }

    return { transcription };
  } catch (error) {
    console.error(`❌ Whisper transcription failed: ${(error as Error).message}`);
    // If there was an error, we might want to keep the job directory for debugging
    if (jobDir) {
      console.log(`📁 Keeping job directory due to error: ${jobDir}`);
      return { 
        transcription: `Error: ${(error as Error).message}`,
        audioFiles
      };
    }
    return { transcription: `Error: ${(error as Error).message}` };
  } finally {
    // Clean up the job directory if not explicitly saving and no error occurred
    if (jobDir && fs.existsSync(jobDir) && !options.saveAudio) {
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up job directory: ${jobDir}`);
      } catch (cleanupError) {
        console.warn(`⚠️ File cleanup error: ${(cleanupError as Error).message}`);
      }
    }
  }
}

/**
 * Get the contents of an audio file saved during transcription
 * @param {string} filePath - Path to the audio file
 * @returns {Buffer|null} - Audio file contents or null if not found
 */
export function getAudioFile(filePath: string): Buffer | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed to read audio file: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Copy an audio file to a user-specified location
 * @param {string} sourcePath - Path to the source audio file
 * @param {string} destinationPath - Path where the file should be copied
 * @returns {boolean} - Success status
 */
export function copyAudioFile(sourcePath: string, destinationPath: string): boolean {
  try {
    if (!fs.existsSync(sourcePath)) {
      console.error(`❌ Source file not found: ${sourcePath}`);
      return false;
    }
    
    // Create destination directory if it doesn't exist
    const destinationDir = path.dirname(destinationPath);
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }
    
    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`✅ Copied audio file to: ${destinationPath}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to copy audio file: ${(error as Error).message}`);
    return false;
  }
}

/**
 * List all available models for Whisper
 * @returns {string[]} - List of model names
 */
export function listAvailableModels(): string[] {
  return MODELS_LIST;
}

/**
 * Check if a model is available locally
 * @param {string} modelName - Name of the model to check
 * @returns {boolean} - Whether the model is available
 */
export function isModelAvailable(modelName: string): boolean {
  const possibleModelPaths = [
    path.join(MODELS_DIR, `ggml-${modelName}.bin`),
    path.join("./models", `ggml-${modelName}.bin`),
    path.join(WHISPER_SRC_DIR, "models", `ggml-${modelName}.bin`),
  ];

  for (const p of possibleModelPaths) {
    if (fs.existsSync(p)) {
      return true;
    }
  }

  return false;
}