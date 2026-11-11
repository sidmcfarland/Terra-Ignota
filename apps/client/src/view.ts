import type { PlayerInfo } from '@terra/shared';

export interface Player {
  info: PlayerInfo;
  x: number;
  y: number;
  self: boolean;
}

/** A renderer the main loop can drive. */
export interface View {
  readonly canvas: HTMLCanvasElement;
  /** Screen-relative input (x right, y down) → world direction. */
  toWorld(d: { x: number; y: number }): { x: number; y: number };
  frame(self: { x: number; y: number }, players: Player[], zoom: number): void;
}
