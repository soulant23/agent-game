import type { WebSocket } from 'ws';

export class Room {
  private readonly members = new Map<WebSocket, string>();

  get participants(): string[] {
    return [...this.members.values()];
  }

  has(socket: WebSocket): boolean {
    return this.members.has(socket);
  }

  hasDisplayName(displayName: string): boolean {
    const candidate = normalize(displayName);
    return [...this.members.values()].some((name) => normalize(name) === candidate);
  }

  add(socket: WebSocket, displayName: string): void {
    this.members.set(socket, displayName);
  }

  remove(socket: WebSocket): void {
    this.members.delete(socket);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
