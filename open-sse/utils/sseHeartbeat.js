// SSE heartbeat wrapper to prevent Cloudflare 524 (origin idle timeout).
//
// Cloudflare cuts the connection if the origin doesn't send any byte within
// ~100s. Reasoning models (Codex high effort, Claude thinking) often need
// longer than that before the first SSE event arrives. We solve this by
// flushing a `: connected` comment immediately and emitting `: keepalive`
// every `intervalMs` until the upstream sends its first chunk.
//
// SSE comments (lines starting with ":") are part of the spec and are
// ignored by every compliant client (OpenAI SDK, Claude SDK, Codex, etc.),
// so this is safe to inject without translating payloads.
const ENCODER = new TextEncoder();
const CONNECTED = ENCODER.encode(": connected\n\n");
const KEEPALIVE = ENCODER.encode(": keepalive\n\n");

/**
 * Wrap an upstream ReadableStream with an early SSE flush + heartbeat.
 *
 * - Emits `: connected\n\n` immediately so Cloudflare resets its idle timer.
 * - Emits `: keepalive\n\n` every `intervalMs` ms while the upstream is
 *   silent.
 * - Stops the heartbeat as soon as the first upstream chunk arrives — once
 *   real data starts flowing, CF won't time out.
 *
 * @param {ReadableStream<Uint8Array>} upstream
 * @param {{ intervalMs?: number }} [options]
 * @returns {ReadableStream<Uint8Array>}
 */
export function withSSEHeartbeat(upstream, { intervalMs = 15000 } = {}) {
  const reader = upstream.getReader();
  let timer = null;
  let firstByteSeen = false;
  let closed = false;

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return new ReadableStream({
    start(controller) {
      // Initial flush — gives CF a byte instantly, well under the 100s window.
      try {
        controller.enqueue(CONNECTED);
      } catch {
        // Stream already cancelled before start completed; nothing to do.
      }

      timer = setInterval(() => {
        if (firstByteSeen || closed) {
          stopTimer();
          return;
        }
        try {
          controller.enqueue(KEEPALIVE);
        } catch {
          stopTimer();
        }
      }, intervalMs);

      // Pump upstream → controller.
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!firstByteSeen) {
              firstByteSeen = true;
              stopTimer();
            }
            controller.enqueue(value);
          }
          closed = true;
          stopTimer();
          try { controller.close(); } catch { /* already closed */ }
        } catch (error) {
          closed = true;
          stopTimer();
          try { controller.error(error); } catch { /* already closed */ }
        }
      })();
    },

    cancel(reason) {
      closed = true;
      stopTimer();
      reader.cancel(reason).catch(() => {});
    }
  });
}
