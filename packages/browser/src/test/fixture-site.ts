/**
 * A site for the browser tests to drive, served from this process on a loopback port.
 *
 * Every page here exists to make one property checkable with a real browser rather than argued about: a link the
 * snapshot reports can actually be clicked by the selector it reported, a search form echoes what was typed, a
 * password field is recognisable as one, a page that logs an error says so, a page that opens a popup does so, a
 * page that answers 500 is reported as 500, and a page tall enough to scroll has something below the fold.
 */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface FixtureSite {
  baseUrl: string;
  /** How many requests the site has answered, so a test can tell a real fetch from a cached page. */
  hits: () => number;
  close: () => Promise<void>;
}

const PAGE = (body: string, extraHead = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Northwind Traders</title>${extraHead}</head>
<body><h1>Northwind Traders</h1>${body}</body></html>`;

export async function startFixtureSite(): Promise<FixtureSite> {
  let hits = 0;
  const server: Server = createServer((req, res) => {
    hits += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: string, type = "text/html; charset=utf-8") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };

    if (url.pathname === "/") {
      return send(
        200,
        PAGE(`
        <p id="intro">Weekly revenue reports for small shops.</p>
        <nav><a id="pricing-link" href="/pricing">Pricing</a></nav>
        <form id="search" action="/search" method="get">
          <label for="q">Search the site</label>
          <input id="q" name="q" type="search" placeholder="What are you looking for?">
          <button id="go" type="submit">Search</button>
        </form>
        <form id="signin" action="/search" method="get">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password">
          <button type="submit">Sign in</button>
        </form>
        <label for="plan">Plan</label>
        <select id="plan" name="plan"><option>Starter</option><option>Growth</option></select>
        <button id="popup" onclick="window.open('/pricing','_blank')">Open pricing in a new window</button>
        <button id="submit-plan" onclick="document.getElementById('intro').textContent = 'Plan saved: ' + document.getElementById('plan').value">Save plan</button>
        <a href="#bottom" id="to-bottom">Bottom</a>
        <div style="height:2200px"></div>
        <p id="bottom">You reached the bottom.</p>`),
      );
    }
    if (url.pathname === "/pricing") return send(200, PAGE('<p id="starter">Starter $19 a month.</p><a id="home" href="/">Home</a>'));
    if (url.pathname === "/search") return send(200, PAGE(`<p id="query">You searched for ${url.searchParams.get("q") ?? url.searchParams.get("password") ?? "nothing"}.</p>`));
    if (url.pathname === "/console-error") return send(200, PAGE("<p>This page logs an error.</p>", "<script>console.error('fixture: something went wrong')</script>"));
    if (url.pathname === "/broken") return send(500, "<h1>Server error</h1>");
    if (url.pathname === "/slow") return setTimeout(() => send(200, PAGE("<p>Slow page.</p>")), 300) as unknown as void;
    return send(404, "<h1>Not found</h1>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
