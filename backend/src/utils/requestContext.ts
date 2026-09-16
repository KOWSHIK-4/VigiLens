import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a request's middleware + handler stack inside an async-local context
 * that holds the server-assigned request id. Background work spawned from
 * within the request (e.g. an outbound call to the AI service) inherits the
 * same context, allowing logs and downstream services to be correlated.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The current request's correlation id, when executing inside one. */
export function getRequestId(): string | undefined {
  return getRequestContext()?.requestId;
}