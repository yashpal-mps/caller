// types/index.ts
import { WebSocket } from "ws";
export interface ConnectionState {
  socket: WebSocket | null;
  streamSid: string | null;
  sequenceNumber: number;
  mediaChunkCounter: number;
  pendingMarks: string[];
  activeStreamStartTime?: number;
  phoneNumber: string | null;
  mediaChunks?: Array<{
    payload: string;
    chunk: number;
    timestamp?: number;
  }>;
}

export interface WebSocketMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  [key: string]: any;
}

export interface ConnectedMessage {
  event: "connected";
  sequenceNumber?: string;
}

export interface StartMessage {
  event: "start";
  sequenceNumber: string;
  streamSid: string;
  start: {
    accountSid: string;
    callSid: string;
    streamSid: string;
    from?: string;
    to?: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
    customParameters?: Record<string, string>;
  };
}

export interface MediaMessage {
  event: "media";
  sequenceNumber: string;
  streamSid: string;
  media: {
    payload: string;
    track?: string;
    chunk?: number;
    timestamp?: number;
  };
}

export interface MarkMessage {
  event: "mark";
  sequenceNumber: string;
  streamSid: string;
  mark: {
    name: string;
  };
}

export interface StopMessage {
  event: "stop";
  sequenceNumber: string;
  streamSid: string;
  stop: {
    accountSid: string;
    callSid: string;
    reason: string;
  };
}

export interface ClearMessage {
  event: "clear";
  sequenceNumber: string;
  streamSid: string;
}

export interface DtmfMessage {
  event: "dtmf";
  sequenceNumber: string;
  streamSid: string;
  dtmf: {
    digit: string;
  };
}

export interface ErrorMessage {
  event: "error";
  sequenceNumber?: string;
  streamSid?: string;
  message: string;
  code?: number;
}

export interface AudioProcessResult {
  audio: Buffer;
  marks?: string[];
}

export interface TextToSpeechResult {
  audio: Float32Array;
  sampling_rate: number;
}
