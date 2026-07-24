/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Node ships a global WebSocket, so talking to an inspector needs no
 * dependency at all -- CDP is JSON-RPC with an event channel, and this is the
 * whole of it: numbered requests, a pending map, and a queue for `paused`
 * events so a step can be awaited without missing one that arrived early.
 */

export class Cdp {
  #ws;
  #nextId = 0;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  static connect(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out connecting to the inspector."));
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      }, { once: true });

      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to the inspector."));
      }, { once: true });
    });
  }

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => this.#receive(event.data));
    ws.addEventListener("close", () => this.#fail("The debuggee disconnected."));
  }

  #receive(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return; // the inspector does not send malformed frames; ignore if it does
    }

    if (message.id !== undefined) {
      const waiter = this.#pending.get(message.id);
      if (!waiter) return;
      this.#pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
      else waiter.resolve(message.result ?? {});
      return;
    }

    for (const handler of this.#listeners.get(message.method) ?? []) {
      handler(message.params ?? {});
    }
  }

  /**
   * Resolve every in-flight request when the debuggee goes away.
   *
   * The process can exit at any point -- that is the normal end of a trace, not
   * an error -- so a pending `stepInto` must settle rather than hang the run.
   */
  #fail() {
    this.#closed = true;
    for (const waiter of this.#pending.values()) waiter.resolve({});
    this.#pending.clear();
    for (const handler of this.#listeners.get("__closed") ?? []) handler({});
  }

  get closed() {
    return this.#closed;
  }

  on(method, handler) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(handler);
  }

  send(method, params = {}) {
    if (this.#closed) return Promise.resolve({});
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch {
        this.#pending.delete(id);
        resolve({});
      }
    });
  }

  close() {
    this.#closed = true;
    try {
      this.#ws.close();
    } catch {
      /* already gone */
    }
  }
}
