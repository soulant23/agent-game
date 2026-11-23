export const MAX_DISPLAY_NAME_LENGTH = 20;
export const MAX_MESSAGE_BYTES = 1024;

export type ClientMessage = JoinMessage;

export interface JoinMessage {
  type: 'join';
  displayName: string;
}

export type ServerMessage = JoinedMessage | PresenceMessage | ErrorMessage;

export interface JoinedMessage {
  type: 'joined';
  displayName: string;
  participants: string[];
}

export interface PresenceMessage {
  type: 'presence';
  participants: string[];
}

export type ErrorCode =
  | 'invalid_message'
  | 'message_too_large'
  | 'invalid_display_name'
  | 'duplicate_display_name'
  | 'already_joined';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}
