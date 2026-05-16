/* eslint-disable no-console */
import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT ?? process.env.PORT ?? "3100");
const baseUrl = `http://127.0.0.1:${port}`;
const deviceCookie = "rb_device_session=legacy:kiosk:local-kiosk-key";

const probes = [
  { path: "/", allowedStatuses: [200, 307, 308] },
  { path: "/admin/login", allowedStatuses: [200] },
  { path: "/admin/menu", allowedStatuses: [200, 302, 307, 401, 403] },
  { path: "/admin/users", allowedStatuses: [200, 302, 307, 401, 403] },
  { path: "/kiosk", allowedStatuses: [200, 302, 307] },
  { path: "/counter", allowedStatuses: [200, 302, 307] },
  { path: "/kitchen", allowedStatuses: [200, 302, 307] },
  { path: "/board", allowedStatuses: [200, 302, 307] },
  {
    path: "/api/menu",
    headers: { cookie: deviceCookie },
    allowedStatuses: [200, 401, 403],
  },
  {
    path: "/api/orders",
    headers: { cookie: deviceCookie },
    allowedStatuses: [200, 401, 403],
  },
  {
    path: "/api/orders/nonexistent-id",
    headers: { cookie: deviceCookie },
    allowedStatuses: [401, 403, 404],
    label: "dynamic order detail route",
  },
  {
    path: "/api/payments/sessions",
    method: "GET",
    headers: { cookie: deviceCookie },
    allowedStatuses: [401, 403, 405],
    label: "POST-only payment sessions route",
  },
  {
    path: "/api/health",
    allowedStatuses: [200, 429],
    label: "liveness health endpoint",
  },
  {
    path: "/api/health/ready",
    allowedStatuses: [200, 503, 429],
    label: "readiness health endpoint",
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`next start exited before accepting connections with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function startServer() {
  const child = spawn("npm", ["run", "start"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[next start] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[next start] ${chunk}`);
  });

  return child;
}

async function stopServer(child) {
  if (child.exitCode != null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode == null && !child.killed) child.kill("SIGKILL");
    }),
  ]);
}

async function runProbe(probe) {
  const url = `${baseUrl}${probe.path}`;
  const response = await fetch(url, {
    method: probe.method ?? "GET",
    headers: probe.headers,
    redirect: "manual",
  });
  const status = response.status;
  const label = probe.label ? `${probe.path} (${probe.label})` : probe.path;

  if (probe.allowedStatuses.includes(status)) {
    console.log(`PASS ${status} ${label}`);
    return;
  }

  if (status === 404) {
    throw new Error(`Route-missing smoke failure: ${status} ${label}`);
  }
  if (status >= 500) {
    throw new Error(`Runtime smoke failure: ${status} ${label}`);
  }

  throw new Error(
    `Unexpected smoke status: ${status} ${label}; expected ${probe.allowedStatuses.join(", ")}`
  );
}

async function main() {
  const server = startServer();
  try {
    await waitForServer(server);
    for (const probe of probes) {
      await runProbe(probe);
    }
    console.log(`Route smoke check passed on ${baseUrl}`);
  } finally {
    await stopServer(server);
  }
}

main().catch((err) => {
  console.error("Route smoke check failed.");
  console.error(err);
  process.exit(1);
});
