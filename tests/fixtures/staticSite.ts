/**
 * A tiny two-page site served over loopback HTTP for the real-browser
 * integration test.
 *
 * It is deliberately hand-written HTML with no build step: the point is to
 * exercise the perception script and the adapter contract against a genuine
 * rendering engine, not to test a framework. Every affordance the adapter
 * contract exposes has something here to act on — a link that navigates, a
 * button that mutates the page, a text field, a scrollable region, and a
 * native `confirm()` dialog.
 */

import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

const SIGNUP_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Acme — Sign up</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 0; padding: 24px;">
    <h1 style="font-size: 28px;">Create your Acme account</h1>
    <p id="status" style="font-size: 16px; color: #222;">Step 1 of 1</p>
    <label for="email" style="display: block; font-size: 16px;">Email address</label>
    <input id="email" type="email" placeholder="you@example.com"
           style="font-size: 16px; padding: 8px; width: 280px;" />
    <p>
      <button id="submit" style="font-size: 16px; padding: 10px 18px;">Create account</button>
    </p>
    <p><a href="/" style="font-size: 16px;">Back to home</a></p>
    <div style="height: 1400px;"></div>
    <p id="footer" style="font-size: 16px;">You have reached the bottom.</p>
    <script>
      document.getElementById("submit").addEventListener("click", () => {
        // A native dialog, so the adapter's dialog handling is exercised too.
        window.confirm("Create this account?");
        document.getElementById("status").textContent = "Account created";
      });
    </script>
  </body>
</html>`;

const HOME_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Acme — Home</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 0; padding: 24px;">
    <h1 style="font-size: 28px;">Acme</h1>
    <p style="font-size: 16px;">The everything widget.</p>
    <p>
      <a id="cta" href="/signup"
         style="font-size: 18px; display: inline-block; padding: 12px 20px;
                background: #1a56db; color: #fff; text-decoration: none;">Sign up</a>
    </p>
    <p><button id="noop" disabled style="font-size: 16px;">Coming soon</button></p>
  </body>
</html>`;

export interface StaticSite {
  /** Base origin, e.g. `http://127.0.0.1:41234`. */
  readonly origin: string;
  close(): Promise<void>;
}

/** Start the fixture site on an ephemeral loopback port. */
export async function startStaticSite(): Promise<StaticSite> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const body = path === "/signup" ? SIGNUP_PAGE : HOME_PAGE;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
