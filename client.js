require('ts-node').register();
const WebSocket = require('ws');
const fs = require('fs');
const { convertWavToMuLaw } = require('./helpers/audioProcessor.ts');

async function sendAudioInOneMessage() {
  // Create variables for tracking connection and message sequence
  const ws = new WebSocket('ws://localhost:8080');
  const streamSid = `stream_${Date.now()}`;
  let sequenceNumber = 1;

  // Set up event handlers
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on('message', (data) => {
    console.log('Received from server:', data.toString());
  });

  ws.on('close', () => {
    console.log('Disconnected from the server.');
  });

  // Wait for connection to establish before proceeding
  await new Promise((resolve) => {
    ws.on('open', resolve);
  });
  
  console.log('Connected to the server.');

  try {
    // 1. Send start message
    const startMessage = {
      event: 'start',
      sequenceNumber: (sequenceNumber++).toString(),
      streamSid: streamSid,
      start: {
        from: '1234567890',
        to: '0987654321',
        tracks: ['inbound'],
        mediaFormat: {
          encoding: 'audio/x-mulaw',
          sampleRate: 8000,
          channels: 1,
        },
      },
    };
    ws.send(JSON.stringify(startMessage));
    console.log('Sent start message.');

    // 2. Convert WAV to mu-law - this happens in one go
    const audioFilePath = 'sample.wav';
    console.log(`Converting ${audioFilePath}...`);
    const muLawBuffer = convertWavToMuLaw(audioFilePath);
    console.log(`Conversion complete. Buffer size: ${muLawBuffer.length} bytes`);

    // 3. Send the entire audio data in one media message
    const mediaMessage = {
      event: 'media',
      sequenceNumber: (sequenceNumber++).toString(),
      streamSid: streamSid,
      media: {
        payload: muLawBuffer.toString('base64'),
      },
    };
    ws.send(JSON.stringify(mediaMessage));
    console.log('Sent complete media payload in one message.');

    // 4. Send stop message after a short delay to ensure media is processed
    setTimeout(() => {
      const stopMessage = {
        event: 'stop',
        sequenceNumber: (sequenceNumber++).toString(),
        streamSid: streamSid,
        stop: {
          reason: 'end-of-stream',
        },
      };
      ws.send(JSON.stringify(stopMessage));
      console.log('Sent stop message.');
      
      // Close connection after ensuring stop message is sent
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 500);
    }, 1000);
  } catch (error) {
    console.error('Error processing audio:', error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

// Run the function
sendAudioInOneMessage().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});