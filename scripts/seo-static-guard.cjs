#!/usr/bin/env node
/**
 * seo-static-guard — catch broken navigation BEFORE it deploys.
 *
 * Sibling to seo-url-guard.cjs, which checks the LIVE host and therefore only
 * ever reports damage that has already shipped. This one reads the repo, so it
 * can run on push.
 *
 * Every check here is modelled on something that actually shipped and sat
 * broken on cardiffandcaerphillycarpentry.com:
 *
 *   dead-anchor   The hero "View Packages" button pointed at #services on 14
 *                 pages. No page had an element with that id. The primary
 *                 above-the-fold CTA did nothing, for months.
 *   dead-link     A link to a file that is not in the repo.
 *   redirected    A link straight at a URL that 301s. Costs a hop and leaks
 *                 link equity; all 13 kitchen-fitting-<area> pages redirect.
 *   tier-mismatch The site runs a deliberate canonical strategy: a page is
 *                 either self-canonical AND in the sitemap, or canonical to a
 *                 parent AND absent from it. Listing a page whose canonical
 *                 points elsewhere is the self-deindexing pattern that took the
 *                 All Aspects site out of the index in July 2026.
 *   orphan        A page that is self-canonical and in the sitemap but has no
 *                 inbound internal link. bright-sparks.html shipped like this
 *                 and was reachable only from sitemap.xml for two days.
 *
 * Zero dependencies, CommonJS, no network: it must run in CI on a bare checkout.
 *
 * Usage:
 *   node scripts/seo-static-guard.cjs                 # the repo you are in
 *   node scripts/seo-static-guard.cjs <site-dir>      # a specific site
 *   node scripts/seo-static-guard.cjs <dir> --warn    # report, never exit 1
 *
 * Exit 1 if any error-level check fails.
 */

const fs = require("fs");
const path = require("path");

const ERROR_KINDS = new Set(["dead-anchor", "dead-link", "tier-mismatch"]);
// "tier-mismatch" is kept an ERROR in one direction only: a page LISTED in the
// sitemap whose canonical points elsewhere is unambiguously wrong. The reverse
// (self-canonical, unlisted) is reported as "unlisted" and only warns, because
// thank-you pages, forms and drafts are legitimately kept out of the sitemap.
// 'redirected' and 'orphan' are warnings: both are sometimes deliberate, and a
// guard that blocks on judgement calls gets switched off.

function readdirHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // pages live at the site root
    if (/\.html$/i.test(entry.name)) out.push(entry.name);
  }
  return out.sort();
}

/**
 * Pages that exist but are not source files at the root.
 *
 * The all-aspects site is a Vite build: some pages are served from public/ and
 * never appear beside the root .html files. Ignoring that made the guard report
 * four perfectly good links to design-studio.html as dead. dist/ is build output
 * and is deliberately NOT counted - a link that only resolves after a build
 * would hide a genuinely missing source file.
 */
function servedElsewhere(dir) {
  const extra = new Set();
  const pub = path.join(dir, "public");
  if (fs.existsSync(pub) && fs.statSync(pub).isDirectory()) {
    for (const f of readdirHtml(pub)) extra.add(f.toLowerCase());
  }
  return extra;
}

/**
 * True if this page is retired behind a redirect.
 *
 * EXACT MATCH ONLY, because that is what the server does: it lowercases the
 * path, strips a trailing slash, and looks the key up whole (server.js ~1087).
 * It never strips ".html".
 *
 * Two earlier versions of this guessed instead of reading that code, and each
 * guess was wrong in a different direction: checking only the literal filename
 * missed garden-rooms.html, while inferring retirement from an extensionless
 * rule flagged 1,489 healthy links and then another 157 - door-styles.html has
 * a /door-styles rule pointing elsewhere yet serves 200 quite happily, because
 * only the extensionless URL redirects.
 */
function isRetired(redirects, file) {
  return redirects.has(file.toLowerCase());
}

/** The destination a retired page/target goes to. */
function redirectTarget(redirects, file) {
  return redirects.get(file.toLowerCase()) || "(unknown)";
}

function loadRedirects(dir) {
  const p = path.join(dir, "_redirects");
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    map.set(parts[0].toLowerCase().replace(/^\//, ""), parts[1]);
  }
  return map;
}

function loadSitemap(dir) {
  const p = path.join(dir, "sitemap.xml");
  const set = new Set();
  if (!fs.existsSync(p)) return set;
  const xml = fs.readFileSync(p, "utf8");
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const file = m[1].replace(/[?#].*$/, "").split("/").pop();
    if (file) set.add(file.toLowerCase());
  }
  return set;
}

/** Strip comments and <script>/<style> bodies so their contents never match. */
/**
 * Replace a stripped block with the SAME NUMBER OF NEWLINES it contained.
 * Collapsing a multi-line <style> to a single space shifts every line number
 * after it, so a dead link in the page body gets reported as a line of CSS and
 * you go and edit the wrong thing.
 */
function blank(text) {
  return "\n".repeat((text.match(/\n/g) || []).length);
}

function strip(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank);
}

function collectIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1]);
  // <a name="x"> still counts as an anchor target in every browser.
  for (const m of html.matchAll(/<a\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) ids.add(m[1]);
  return ids;
}

/**
 * Per line, so repeated hrefs report their own line numbers. Scanning the whole
 * document and calling indexOf gives every occurrence the FIRST one's line,
 * which is worse than useless when six identical buttons are all broken.
 */
function collectHrefs(html) {
  const out = [];
  html.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(/\bhref\s*=\s*["']([^"']+)["']/g)) {
      out.push({ href: m[1].trim(), line: i + 1 });
    }
  });
  return out;
}

/**
 * True if the page explicitly asks not to be indexed.
 *
 * A noindex page is SUPPOSED to be absent from the sitemap and does not need
 * inbound links, so reporting it as "unlisted" or "orphan" is noise - and noise
 * is how a warning list gets ignored. 9 of 11 unlisted warnings across the
 * estate were pages carrying noindex on purpose (search, privacy, cookies,
 * payment-details, a hidden alternate-brand homepage).
 */
function isNoindex(html) {
  const m = /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i.exec(html);
  return !!m && /(^|[ ,])noindex([ ,]|$)/i.test(m[1].trim());
}

function canonicalOf(html) {
  const m = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
  if (!m) return null;
  const h = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
  return h ? h[1] : null;
}

function lineOf(raw, needle) {
  const idx = raw.indexOf(needle);
  if (idx < 0) return 0;
  return raw.slice(0, idx).split(/\r?\n/).length;
}

function auditSite(dir) {
  const findings = [];
  const files = readdirHtml(dir);
  if (!files.length) return { findings, files };

  const redirects = loadRedirects(dir);
  const sitemap = loadSitemap(dir);
  const present = new Set(files.map((f) => f.toLowerCase()));
  for (const extra of servedElsewhere(dir)) present.add(extra);
  const inboundLinks = new Map(files.map((f) => [f.toLowerCase(), 0]));

  const parsed = new Map();
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const html = strip(raw);
    parsed.set(f, { raw, html, ids: collectIds(html), canonical: canonicalOf(html),
      noindex: isNoindex(raw),
      // A file carrying {{PLACEHOLDER}} is a template, not a page: its links and
      // canonical are unrendered and mean nothing until a post is generated from it.
      isTemplate: /\{\{[A-Z_]+\}\}/.test(raw) });
  }

  for (const f of files) {
    const { html, ids, isTemplate } = parsed.get(f);
    if (isTemplate) continue; // {{SLUG}} placeholders are not broken links
    if (isRetired(redirects, f)) continue; // nobody reaches this page; its links are moot
    for (const { href, line } of collectHrefs(html)) {
      if (/^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href) || href === "#") continue;
      if (href.includes("{{") || href.includes("${")) continue; // unrendered placeholder

      const [pathPart, hash] = href.split("#");

      if (!pathPart && hash) {
        if (!ids.has(hash)) {
          findings.push({ kind: "dead-anchor", file: f, line, detail: `#${hash} — no element with that id on this page` });
        }
        continue;
      }

      const target = pathPart.replace(/^\.\//, "").replace(/^\//, "").split("?")[0];
      if (!target || !/\.html?$/i.test(target)) continue; // assets are not this guard's job

      const key = target.toLowerCase();
      if (isRetired(redirects, key)) {
        findings.push({ kind: "redirected", file: f, line, detail: `${target} → ${redirectTarget(redirects, key)} (link the destination directly)` });
        continue;
      }
      if (!present.has(key)) {
        findings.push({ kind: "dead-link", file: f, line, detail: `${target} does not exist in this repo` });
        continue;
      }
      if (key !== f.toLowerCase()) inboundLinks.set(key, (inboundLinks.get(key) || 0) + 1);

      // A link to another page's anchor must resolve on THAT page.
      if (hash) {
        const other = parsed.get(files.find((x) => x.toLowerCase() === key));
        if (other && !other.isTemplate && !other.ids.has(hash)) {
          findings.push({ kind: "dead-anchor", file: f, line, detail: `${target}#${hash} — no element with that id on ${target}` });
        }
      }
    }
  }

  // Canonical tier consistency, and orphans among the pages that are meant to rank.
  for (const f of files) {
    const { canonical, isTemplate, noindex } = parsed.get(f);
    if (!canonical || isTemplate) continue;
    // A page that says noindex has opted out of ranking: absent from the
    // sitemap and unlinked are both correct for it, not findings.
    if (noindex) continue;
    // A page that 301s is retired on purpose; its canonical and its absence from
    // the sitemap are both correct and not a mismatch.
    if (isRetired(redirects, f)) continue;
    const canonFile = canonical.replace(/[?#].*$/, "").split("/").pop().toLowerCase();
    const selfCanonical = canonFile === f.toLowerCase();
    const listed = sitemap.has(f.toLowerCase());

    if (selfCanonical && !listed && sitemap.size) {
      findings.push({ kind: "unlisted", file: f, line: 0, detail: "self-canonical but absent from sitemap.xml — it wants to rank and is not listed" });
    }
    if (!selfCanonical && listed) {
      findings.push({ kind: "tier-mismatch", file: f, line: 0, detail: `in sitemap.xml but canonical points at ${canonFile} — this is the self-deindexing pattern` });
    }
    if (selfCanonical && listed && inboundLinks.get(f.toLowerCase()) === 0) {
      findings.push({ kind: "orphan", file: f, line: 0, detail: "no inbound internal link — reachable only from sitemap.xml" });
    }
  }

  return { findings, files };
}

function main() {
  const argv = process.argv.slice(2);
  const warnOnly = argv.includes("--warn");
  const dir = argv.find((a) => !a.startsWith("--")) || process.cwd();

  if (!fs.existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    return 1;
  }

  const { findings, files } = auditSite(dir);
  const errors = findings.filter((f) => ERROR_KINDS.has(f.kind));
  const warns = findings.filter((f) => !ERROR_KINDS.has(f.kind));

  console.log(`\n${"=".repeat(70)}\n${dir}\n  ${files.length} page(s) scanned\n`);

  const show = (list, label) => {
    if (!list.length) return;
    console.log(`  ${label}:`);
    const byKind = new Map();
    for (const f of list) {
      if (!byKind.has(f.kind)) byKind.set(f.kind, []);
      byKind.get(f.kind).push(f);
    }
    for (const [kind, items] of byKind) {
      console.log(`    ${kind} (${items.length})`);
      for (const it of items.slice(0, 25)) {
        console.log(`      ${it.file}${it.line ? `:${it.line}` : ""} — ${it.detail}`);
      }
      if (items.length > 25) console.log(`      … +${items.length - 25} more`);
    }
    console.log("");
  };

  show(errors, "ERRORS");
  show(warns, "WARNINGS");

  if (!findings.length) {
    console.log("  OK — every internal link and anchor resolves, and canonical/sitemap tiers agree.\n");
    return 0;
  }
  console.log(`  ${errors.length} error(s), ${warns.length} warning(s)\n`);
  return errors.length && !warnOnly ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { auditSite };
