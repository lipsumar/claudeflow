import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

const TARGET_HOST = "api.anthropic.com";
const PORT = 4128;

function log(method, url, status, durationMs) {
  const ts = new Date().toISOString();
  console.log(`${ts} ${method} ${url} → ${status} (${durationMs}ms)`);
}

const server = createServer((req, res) => {
  const start = Date.now();
  const { method, url } = req;

  console.log(`${new Date().toISOString()} ${method} ${url} ← incoming`);

  const headers = { ...req.headers };

  // Strip incoming auth, inject real key
  delete headers["authorization"];
  delete headers["x-api-key"];
  headers["x-api-key"] = API_KEY;

  // Forward to api.anthropic.com
  headers["host"] = TARGET_HOST;

  const proxyReq = httpsRequest(
    {
      hostname: TARGET_HOST,
      port: 443,
      path: url,
      method,
      headers,
    },
    (proxyRes) => {
      log(method, url, proxyRes.statusCode, Date.now() - start);
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    log(method, url, `ERROR ${err.message}`, Date.now() - start);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Bad Gateway");
    }
  });

  req.on("error", (err) => {
    proxyReq.destroy(err);
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`auth-proxy listening on :${PORT} → ${TARGET_HOST}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, draining connections…");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("SIGINT received, draining connections…");
  server.close(() => process.exit(0));
});
