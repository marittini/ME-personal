import type { FastifyReply, FastifyRequest } from "fastify";

const SECURITY_HEADERS: Record<string, string> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  // Keep user-authored remote media available without disclosing the local
  // Marinara URL in browser or CSS subresource requests.
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "xr-spatial-tracking=()",
].join(", ");

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' https://sdk.scdn.co https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  // Registered web fonts (Settings → Web fonts) load from HTTPS font hosts; the client accepts only https: sources.
  "font-src 'self' data: https:",
  "connect-src 'self' http: https: ws: wss:",
  "frame-src 'self' https://sdk.scdn.co https://accounts.spotify.com https://www.youtube.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export function securityHeadersHook(_request: FastifyRequest, reply: FastifyReply, done: () => void) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(name, value);
  }
  reply.header("Permissions-Policy", PERMISSIONS_POLICY);
  reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  done();
}
