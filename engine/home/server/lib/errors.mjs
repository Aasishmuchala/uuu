// The one error type the home server sends to the browser.
// `message` and `next` are plain sentences for the owner: never a stack, a status code or a tool name.
// `upstreamStatus` and `excType` stay on the server (modules may branch on them); they are never sent.
export class HomeError extends Error {
  constructor(status, message, next, code, extra = {}) {
    super(message);
    this.status = status;
    this.next = next || "";
    this.code = code || "error";
    this.upstreamStatus = extra.upstreamStatus ?? null;
    this.excType = extra.excType ?? null;
  }

  toBody() {
    return { error: { message: this.message, next: this.next, code: this.code } };
  }
}

// ctx.fail: returns the error so a handler can `throw ctx.fail(...)`.
export function fail(status, message, next, code) {
  return new HomeError(status, message, next, code);
}

export function isHomeError(e) {
  return e instanceof HomeError;
}

export const internalError = () => new HomeError(500,
  "Something went wrong inside the home screen.",
  "Try again. If it keeps happening, restart the engine with: engine stop, then engine start.",
  "internal");
