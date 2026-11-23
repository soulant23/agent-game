import type { WebSocket } from 'ws';
import {
  MAX_MOVE_INTERVAL_MS,
  MAX_SPEED,
  PLAYER_RADIUS,
  SPAWN_X,
  SPAWN_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type PlayerPosition,
} from './messages.js';

interface Member {
  displayName: string;
  x: number;
  y: number;
  lastMoveAt: number;
}

export type MoveOutcome = { ok: true } | { ok: false; code: 'not_joined' };

export class Room {
  private readonly members = new Map<WebSocket, Member>();

  get participants(): string[] {
    return [...this.members.values()].map((member) => member.displayName);
  }

  has(socket: WebSocket): boolean {
    return this.members.has(socket);
  }

  hasDisplayName(displayName: string): boolean {
    const candidate = normalize(displayName);
    return [...this.members.values()].some((member) => normalize(member.displayName) === candidate);
  }

  add(socket: WebSocket, displayName: string, now = Date.now()): void {
    this.members.set(socket, {
      displayName,
      x: SPAWN_X,
      y: SPAWN_Y,
      lastMoveAt: now,
    });
  }

  remove(socket: WebSocket): void {
    this.members.delete(socket);
  }

  displayNameOf(socket: WebSocket): string | undefined {
    return this.members.get(socket)?.displayName;
  }

  positions(): PlayerPosition[] {
    return [...this.members.values()].map((member) => ({
      displayName: member.displayName,
      x: member.x,
      y: member.y,
    }));
  }

  applyMove(socket: WebSocket, dx: number, dy: number, now = Date.now()): MoveOutcome {
    const member = this.members.get(socket);
    if (member === undefined) return { ok: false, code: 'not_joined' };

    const elapsedMs = clamp(now - member.lastMoveAt, 0, MAX_MOVE_INTERVAL_MS);
    member.lastMoveAt = now;

    const nextX = member.x + dx * MAX_SPEED * elapsedMs / 1000;
    const nextY = member.y + dy * MAX_SPEED * elapsedMs / 1000;
    member.x = round2(clamp(nextX, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS));
    member.y = round2(clamp(nextY, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS));

    return { ok: true };
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
