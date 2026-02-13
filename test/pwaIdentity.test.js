import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, test} from "vitest";

const CANONICAL_APP_NAME = "Voicebox";

function extractMetaContent(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const doubleQuoted = new RegExp(`<meta[^>]*name=\"${escapedName}\"[^>]*content=\"([^\"]+)\"`, "i");
  const singleQuoted = new RegExp(`<meta[^>]*name='${escapedName}'[^>]*content='([^']+)'`, "i");
  const doubleMatch = html.match(doubleQuoted);
  if (doubleMatch) return doubleMatch[1];
  const singleMatch = html.match(singleQuoted);
  if (singleMatch) return singleMatch[1];
  return null;
}

describe("PWA identity metadata", () => {
  test("uses one canonical app name across manifest config and HTML metadata", () => {
    const viteConfigSource = readFileSync(resolve(process.cwd(), "vite.config.js"), "utf8");
    const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    const appNameConstant = viteConfigSource.match(/const\s+APP_DISPLAY_NAME\s*=\s*"([^"]+)"/);
    const manifestUsesNameConstant = /name:\s*APP_DISPLAY_NAME/.test(viteConfigSource);
    const manifestUsesShortNameConstant = /short_name:\s*APP_DISPLAY_NAME/.test(viteConfigSource);
    const titleMatch = indexHtml.match(/<title>([^<]+)<\/title>/i);

    expect(appNameConstant).not.toBeNull();
    expect(manifestUsesNameConstant).toBe(true);
    expect(manifestUsesShortNameConstant).toBe(true);
    expect(titleMatch).not.toBeNull();

    expect(appNameConstant[1]).toBe(CANONICAL_APP_NAME);
    expect(titleMatch[1].trim()).toBe(CANONICAL_APP_NAME);
    expect(extractMetaContent(indexHtml, "application-name")).toBe(CANONICAL_APP_NAME);
    expect(extractMetaContent(indexHtml, "apple-mobile-web-app-title")).toBe(CANONICAL_APP_NAME);
  });
});
