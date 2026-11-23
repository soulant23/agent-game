import { Buffer } from 'node:buffer';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_MOVE_MAGNITUDE,
  type ClientMessage,
  type ErrorCode,
} from './messages.js';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ErrorCode; message: string };

export function parseClientMessage(raw: string): ParseResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) {
    return failure('message_too_large', `Messages must be at most ${MAX_MESSAGE_BYTES} bytes.`);
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
  if (record.type === 'join') return parseJoin(record);
  if (record.type === 'move') return parseMove(record);
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function failure(code: ErrorCode, message: string): ParseResult {
  return { ok: false, code, message };
}
