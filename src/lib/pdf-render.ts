import type { Browser } from "puppeteer-core";
import type { PrintDoc } from "./pdf-doc";

/**
 * Server-side PDF rendering with a real headless Chrome.
 *
 * Why a browser and not a PDF library: the 21 CV designs are ordinary HTML and
 * CSS, but they lean on flexbox, CSS grid, negative margins, absolute
 * positioning and nine variable web fonts — and above all on CvRenderer's
 * measure-and-reflow loop, which rescales type until the content fits exactly
 * one A4 page. That loop IS browser layout. Reimplementing it inside a PDF
 * library would mean reimplementing the renderer; letting Chrome do it costs
 * one dependency and reproduces the on-screen design exactly.
 *
 * And Chrome emits real, selectable text — which is the entire requirement.
 * An image-based PDF (html2canvas and friends) looks identical and is rejected
 * by every applicant tracking system, taking the product's core promise with
 * it.
 */

/** A4 at 96dpi — the viewport the CV is laid out against. */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

/** How long to wait for the page to report that layout has settled. */
const READY_TIMEOUT_MS = 20_000;

/** Chrome installs to try when running outside a serverless environment. */
const LOCAL_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function localChromePath(): string | null {
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) return explicit;
  // Only worth looking on a real machine; on Lambda the bundled build wins.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync } = require("fs") as typeof import("fs");
  return LOCAL_CHROME_PATHS.find((p) => existsSync(p)) ?? null;
}

/**
 * One browser per warm instance.
 *
 * Launching Chrome costs a second or three — most of it decompressing the
 * bundled build — and a five-job download is ten files. Reusing the instance
 * turns that into a one-off cost. Any failure drops the handle so the next
 * request starts clean rather than inheriting a wedged browser.
 */
let cached: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cached?.connected) return cached;
  cached = null;

  const puppeteer = await import("puppeteer-core");
  const local = localChromePath();
  if (local) {
    cached = await puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return cached;
  }

  /**
   * `@sparticuz/chromium` is CommonJS (`module.exports = Chromium`), so which
   * of these two the bundler hands back depends on how it applies ESM interop
   * — and getting it wrong throws before anything else runs.
   */
  const mod = await import("@sparticuz/chromium");
  const chromium = (mod.default ?? mod) as typeof mod.default;

  cached = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    /**
     * NOT `true`. This is a headless-SHELL build, and chromium.args already
     * carries `--headless='shell'`; passing `true` makes puppeteer add
     * `--headless=new` on top, and the shell binary exits on the conflicting
     * flag. It fails in about a second and reads exactly like a crash.
     */
    headless: chromium.headless,
  });
  return cached;
}

async function dropBrowser() {
  const browser = cached;
  cached = null;
  try {
    await browser?.close();
  } catch {
    // Already gone — nothing to clean up.
  }
}

export class PdfRenderError extends Error {}

/**
 * Renders one document to a PDF.
 *
 * The document is INJECTED into the page rather than fetched by it: /print
 * holds no data and reads nothing, so it stays useless to anyone who opens it,
 * and the two surfaces whose CVs live only in localStorage (the anonymous
 * funnel and History) work through the same path as the signed-in ones.
 */
export async function renderPdf(
  doc: PrintDoc,
  baseUrl: string
): Promise<Uint8Array> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    await dropBrowser();
    throw new PdfRenderError(
      `Could not start the PDF renderer: ${e instanceof Error ? e.message : e}`
    );
  }

  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: A4_WIDTH_PX,
      height: A4_HEIGHT_PX,
      deviceScaleFactor: 1,
    });
    // Print media from the start, so the page lays out exactly as it will
    // print — the existing @media print rules are what position the sheet and
    // pin the CV to one page (globals.css).
    await page.emulateMediaType("print");

    // Preview deployments sit behind Vercel's protection, and this request
    // comes from outside the user's browser — without the bypass it would
    // load a login page and print that.
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      await page.setExtraHTTPHeaders({ "x-vercel-protection-bypass": bypass });
    }

    await page.goto(`${baseUrl}/print`, {
      waitUntil: "networkidle0",
      timeout: READY_TIMEOUT_MS,
    });

    await page.evaluate((payload) => {
      window.__setPrintDoc?.(payload as never);
    }, doc as unknown as Record<string, unknown>);

    // The page decides when it is done — it watches its own layout stop
    // moving, which is the only honest signal that the fit loop has finished.
    await page.waitForFunction(() => window.__printReady === true, {
      timeout: READY_TIMEOUT_MS,
    });

    return await page.pdf({
      format: "a4",
      printBackground: true,
      // Honour `@page { size: A4; margin: 0 }` — every margin in these designs
      // is the sheet's own padding, so an added print margin would shrink and
      // re-wrap the whole layout.
      preferCSSPageSize: true,
    });
  } catch (e) {
    // A wedged page can wedge the browser; the next request gets a fresh one.
    await dropBrowser();
    throw e instanceof PdfRenderError
      ? e
      : new PdfRenderError(
          `Rendering failed: ${e instanceof Error ? e.message : e}`
        );
  } finally {
    try {
      if (!page.isClosed()) await page.close();
    } catch {
      // The browser was dropped above — nothing left to close.
    }
  }
}
