import type { FromSignal, ToSignal } from '@terra/shared';

/** WebSocket to the signaling server with automatic reconnect. */
export class SignalClient {
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private closed = false;
  connected = false;

  private readonly url: string;
  private readonly onOpen: () => void;
  private readonly onMessage: (m: FromSignal) => void;
  private readonly onDown: () => void;

  constructor(url: string, onOpen: () => void, onMessage: (m: FromSignal) => void, onDown: () => void) {
    this.url = url;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onDown = onDown;
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoff = 1000;
      this.onOpen();
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch (err) {
        console.warn('bad signal message', err);
      }
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.onDown();
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    };
  }

  send(m: ToSignal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
