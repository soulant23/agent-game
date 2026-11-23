import { Buffer } from 'node:buffer';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_BYTES,
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

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).type !== 'join'
  ) {
    return failure('invalid_message', 'Expected a join message.');
  }

  const displayName = (value as Record<string, unknown>).displayName;
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

function failure(code: ErrorCode, message: string): ParseResult {
  return { ok: false, code, message };
}
