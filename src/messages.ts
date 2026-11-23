export const MAX_DISPLAY_NAME_LENGTH = 20;
export const MAX_MESSAGE_BYTES = 1024;

export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 600;
export const PLAYER_RADIUS = 12;
export const SPAWN_X = WORLD_WIDTH / 2;
export const SPAWN_Y = WORLD_HEIGHT / 2;
export const MAX_SPEED = 200;
export const TICK_RATE = 20;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const MAX_MOVE_INTERVAL_MS = 100;
export const MAX_MESSAGES_PER_SECOND = 60;
export const MOVE_MAGNITUDE_TOLERANCE = 1e-6;
export const MAX_MOVE_MAGNITUDE = 1 + MOVE_MAGNITUDE_TOLERANCE;

export type ClientMessage = JoinMessage | MoveMessage;

export interface JoinMessage {
  type: 'join';
  displayName: string;
}

export interface MoveMessage {
  type: 'move';
  dx: number;
  dy: number;
}

export interface PlayerPosition {
  displayName: string;
  x: number;
  y: number;
}

export type ServerMessage =
  | JoinedMessage
  | PresenceMessage
  | SnapshotMessage
  | PositionsMessage
  | ErrorMessage;

export interface JoinedMessage {
  type: 'joined';
  displayName: string;
  participants: string[];
}

export interface PresenceMessage {
  type: 'presence';
  participants: string[];
}

export interface SnapshotMessage {
  type: 'snapshot';
  players: PlayerPosition[];
}

export interface PositionsMessage {
  type: 'positions';
  tick: number;
  players: PlayerPosition[];
}

export type ErrorCode =
  | 'invalid_message'
  | 'message_too_large'
  | 'invalid_display_name'
  | 'duplicate_display_name'
  | 'already_joined'
  | 'not_joined'
  | 'invalid_move'
  | 'invalid_move_magnitude'
  | 'rate_limited';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}
