import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const host = option("--host", "127.0.0.1");
const port = Number(option("--port", "4173"));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".apk": "application/vnd.android.package-archive"
};

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    let filePath = resolve(root, relativePath);

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, "index.html");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Bad request");
  }
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "your-computer-ip" : host;
  console.log(`Aligned is available at http://${displayHost}:${port}`);
});
