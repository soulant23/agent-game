import { Buffer } from 'node:buffer';
import {
  MAX_CHAT_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_MOVE_MAGNITUDE,
  MAX_PAYLOAD_BYTES,
  MAX_SIGNAL_BYTES,
  type ClientMessage,
  type ErrorCode,
  type SignalKind,
} from './messages.js';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ErrorCode; message: string };

export function parseClientMessage(raw: string): ParseResult {
  const rawBytes = Buffer.byteLength(raw, 'utf8');
  if (rawBytes > MAX_PAYLOAD_BYTES) {
    return failure('message_too_large', `Messages must be at most ${MAX_PAYLOAD_BYTES} bytes.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return failure('invalid_message', 'Message must be valid JSON.');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failure('invalid_message', 'Expected a JSON object.');
  }

  const record = value as Record<string, unknown>;
  if (isSignalKind(record.type)) return parseSignal(record, record.type, rawBytes);
  if (rawBytes > MAX_MESSAGE_BYTES) {
    return failure('message_too_large', `Messages must be at most ${MAX_MESSAGE_BYTES} bytes.`);
  }
  if (record.type === 'join') return parseJoin(record);
  if (record.type === 'move') return parseMove(record);
  if (record.type === 'chat') return parseChat(record);
  return failure('invalid_message', 'Unknown message type.');
}

function parseJoin(record: Record<string, unknown>): ParseResult {
  const displayName = record.displayName;
  if (typeof displayName !== 'string') {
    return failure('invalid_display_name', 'Display name must be a string.');
  }

  const normalized = displayName.trim();
  if (normalized.length === 0) {
    return failure('invalid_display_name', 'Display name is required.');
  }
  if (normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    return failure(
      'invalid_display_name',
      `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    );
  }

  return { ok: true, message: { type: 'join', displayName: normalized } };
}

function parseMove(record: Record<string, unknown>): ParseResult {
  const { dx, dy } = record;
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) {
    return failure('invalid_move', 'dx and dy must be finite numbers.');
  }
  if (Math.hypot(dx, dy) > MAX_MOVE_MAGNITUDE) {
    return failure('invalid_move_magnitude', 'Move magnitude must be at most 1.');
  }
  return { ok: true, message: { type: 'move', dx, dy } };
}

function parseChat(record: Record<string, unknown>): ParseResult {
  const { text } = record;
  if (typeof text !== 'string') {
    return failure('invalid_chat', 'Chat text must be a string.');
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return failure('invalid_chat', 'Chat text is required.');
  }
  if (trimmed.length > MAX_CHAT_LENGTH) {
    return failure(
      'invalid_chat',
      `Chat text must be at most ${MAX_CHAT_LENGTH} characters.`,
    );
  }

  return { ok: true, message: { type: 'chat', text: trimmed } };
}

function parseSignal(
  record: Record<string, unknown>,
  kind: SignalKind,
  rawBytes: number,
): ParseResult {
  if (rawBytes > MAX_SIGNAL_BYTES) {
    return failure(
      'invalid_signal',
      `Signaling messages must be at most ${MAX_SIGNAL_BYTES} bytes.`,
    );
  }

  const target = record.target;
  if (typeof target !== 'string') {
    return failure('invalid_signal', 'Signal target must be a string.');
  }
  const normalized = target.trim();
  if (normalized.length === 0 || normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    return failure('invalid_signal', 'Signal target must be 1-20 characters.');
  }

  const data = record.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return failure('invalid_signal', 'Signal data must be an object.');
  }
  const dataRecord = data as Record<string, unknown>;
  if (kind === 'ice') {
    if (typeof dataRecord.candidate !== 'string') {
      return failure('invalid_signal', 'ICE data must include a candidate string.');
    }
  } else if (
    dataRecord.type !== kind ||
    typeof dataRecord.sdp !== 'string' ||
    dataRecord.sdp.length === 0
  ) {
    return failure('invalid_signal', 'SDP data must include matching type and sdp.');
  }

  return { ok: true, message: { type: kind, target: normalized, data: dataRecord } };
}

export function isSignalKind(value: unknown): value is SignalKind {
  return value === 'offer' || value === 'answer' || value === 'ice';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function failure(code: ErrorCode, message: string): ParseResult {
  return { ok: false, code, message };
}
