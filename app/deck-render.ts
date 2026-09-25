// Headless one-shot mode for presentation v2 HTML decks:
//
//   Workspace computer --deck-render <abs deck.html> --out-dir <abs dir>
//     [--probe <abs probe.js>] [--vendor-dir <abs>] [--fonts-dir <abs>]
//     [--pptx] [--pdf] [--png]
//
// Spawned by the skill's helpers/render.cjs (ELECTRON_RUN_AS_NODE=1 node
// render.cjs), which is why stdout formatting matters: the model reads it and
// fixes deck.html. The same run produces, inside --out-dir:
//
//   slide-NN.png   one 1280×720 capture per slide (unless --png 0)
//   report.json    layout issues per slide (merged with a pixel blank check)
//   inventory.json per-slide element inventory (the model's eyes for edits)
//   <deck>.pptx    native PowerPoint export (only with --pptx): real text
//                  boxes, shapes, embedded TTFs, speaker notes
//   <deck>.pdf     one slide per page (only with --pdf)
//
// Nothing here touches the normal app startup: add a light argv check next to
// the existing pptx-verify one (src/main/pptx-verify-check.ts pattern) and
// call runDeckRender() before the single-instance lock / sidecar / updater.
//
// Exit codes: 0 = rendered (issues are warnings, not failures) · 2 = bad
// arguments · 3 = render/export failure or timeout.
import { app, BrowserWindow } from "electron"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join } from "node:path"

const RENDER_W = 1280
const RENDER_H = 720
const PAGE_W_IN = 40 / 3 // 13.333in — the deck stage at 96dpi
const PAGE_H_IN = 7.5
// The helper may raise the budget via PRESENTATION_RENDER_TIMEOUT_MS (it also
// sets it just below its own kill timer); never allow 0/NaN to disable it.
const TIMEOUT_MS = Math.max(30_000, Number(process.env.PRESENTATION_RENDER_TIMEOUT_MS || 240_000) - 3_000)

type Issue = { type: string; detail: string; severity?: string }
type SlideReport = { index: number; issues: Issue[] }
type Logger = { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void }

// Pure detector: true when launched as `Workspace computer --deck-render …`.
// Keep it free of electron imports so index.ts can call it before deciding
// which one-shot entry to pull in lazily (mirrors isRunPptxVerify()).
export function isRunDeckRender(): boolean {
  return process.argv.indexOf("--deck-render") !== -1
}

export function runDeckRender(logger: Logger): void {
  if (process.platform === "darwin") {
    try {
      app.setActivationPolicy("accessory")
      app?.dock?.hide?.()
    } catch {
      // Dock hiding is best effort.
    }
  }
  const idx = process.argv.indexOf("--deck-render")
  const deck = process.argv[idx + 1]
  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(name)
    return i === -1 ? undefined : process.argv[i + 1]
  }
  void run(
    deck,
    {
      outDir: flag("--out-dir"),
      probe: flag("--probe"),
      vendorDir: flag("--vendor-dir"),
      fontsDir: flag("--fonts-dir"),
      pptx: process.argv.includes("--pptx"),
      pdf: process.argv.includes("--pdf"),
      png: !process.argv.includes("--no-png"),
      // Escape hatch: deliver the .pptx even with blocking findings, with a
      // loud warning. A deck with a stated defect beats no deck at all.
      allowBlocking: process.argv.includes("--allow-blocking"),
    },
    logger,
  )
}

function fail(code: number, message: string): never {
  console.error(message)
  app.exit(code)
  throw new Error(message)
}

async function run(
  deck: string | undefined,
  opts: {
    outDir?: string
    probe?: string
    vendorDir?: string
    fontsDir?: string
    pptx: boolean
    pdf: boolean
    png: boolean
    allowBlocking?: boolean
  },
  logger: Logger,
) {
  let scratch: string | undefined
  const exit = (code: number) => {
    if (scratch) {
      try {
        rmSync(scratch, { recursive: true, force: true })
      } catch {
        // best-effort cleanup of the throwaway profile
      }
    }
    app.exit(code)
  }
  const watchdog = setTimeout(() => {
    console.error(`render: timed out after ${Math.round(TIMEOUT_MS / 1000)}s`)
    exit(3)
  }, TIMEOUT_MS)

  try {
    // The app chdir()s to the home directory at import time; helpers always
    // pass absolute paths — reject anything else loudly.
    if (!deck || !isAbsolute(deck)) {
      fail(2, "usage: --deck-render </absolute/path/deck.html> --out-dir </absolute/dir> [--pptx] [--pdf] [--no-png]")
    }
    if (!opts.outDir || !isAbsolute(opts.outDir)) fail(2, `render: --out-dir must be absolute`)
    if (!existsSync(deck)) fail(2, `render: deck not found: ${deck}`)
    const probePath = opts.probe ?? join(__dirname, "..", "..", "skills", "presentation", "helpers", "probe.js")
    if (!existsSync(probePath)) fail(2, `render: probe.js not found at ${probePath} (pass --probe <abs path>)`)
    if (opts.pptx) {
      const bundle = opts.vendorDir ? join(opts.vendorDir, "dom-to-pptx.bundle.js") : undefined
      if (!bundle || !existsSync(bundle)) fail(2, `render: --pptx needs --vendor-dir with dom-to-pptx.bundle.js`)
    }

    scratch = mkdtempSync(join(tmpdir(), "wsc-deck-render-"))
    app.setPath("userData", scratch)
    app.disableHardwareAcceleration()

    await app.whenReady()
    app.dock?.hide()

    const win = new BrowserWindow({
      show: false,
      width: RENDER_W,
      height: RENDER_H,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    win.webContents.on("will-navigate", (event) => event.preventDefault())

    const pageConsole: string[] = []
    win.webContents.on("console-message", (event) => {
      pageConsole.push((event as unknown as { message?: string }).message ?? "")
    })

    const loaded = new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve())
      win.webContents.once("did-fail-load", (_e, code, desc) => reject(new Error(`page load failed: ${desc} (${code})`)))
    })
    void win.loadFile(deck)
    await loaded

    const js = (script: string) => win.webContents.executeJavaScript(script, true)

    // The probe defines window.__deckProbe and pins the stage at scale 1.
    await js(readFileSync(probePath, "utf8"))
    const meta = (await js("window.__deckProbe.ready()")) as {
      slideCount: number
      stageW: number
      stageH: number
      fontsMissing: string[]
      fontsUsed?: string[]
    }
    if (!meta || !meta.slideCount) {
      console.error(`render: the deck rendered 0 slides${pageConsole.length ? `\npage console:\n${pageConsole.join("\n")}` : ""}`)
      exit(3)
      return
    }

    mkdirSync(opts.outDir, { recursive: true })

    if (meta.fontsMissing?.length) {
      for (const font of meta.fontsMissing) {
        console.log(`deck: FONT NOT LOADED: ${font} — the deck will fall back to another face; vendor the font or change the token`)
      }
    }

    if (opts.pdf) {
      await js("window.__deckProbe.printLayout()")
      const buffer = await win.webContents.printToPDF({
        pageSize: { width: PAGE_W_IN, height: PAGE_H_IN },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
        preferCSSPageSize: false,
      })
      const pdfPath = join(opts.outDir, basename(deck).replace(/\.html?$/i, "") + ".pdf")
      writeFileSync(pdfPath, buffer)
      console.log(`pdf: ${pdfPath}`)
    }

    const pixelBlank: boolean[] = []
    if (opts.png) {
      for (let i = 0; i < meta.slideCount; i++) {
        await js(`window.__deckProbe.reveal(${i})`)
        await delay(60) // offscreen paint after the class flip
        let image = await win.webContents.capturePage({ x: 0, y: 0, width: RENDER_W, height: RENDER_H })
        if (image.getSize().width !== RENDER_W) image = image.resize({ width: RENDER_W })
        pixelBlank.push(isVisuallyBlank(image.toBitmap(), image.getSize().width, image.getSize().height))
        writeFileSync(join(opts.outDir, slideName(i)), image.toPNG())
      }
      console.log(`captures: ${meta.slideCount} slide(s) → ${opts.outDir}`)
    }

    const domReports = (await js("window.__deckProbe.report()")) as SlideReport[]
    if (opts.png) {
      // Pixel uniformity confirms (or independently finds) blank slides.
      for (let i = 0; i < domReports.length; i++) {
        const report = domReports[i]
        const domBlank = report.issues.some((issue) => issue.type === "maybe-blank")
        if (pixelBlank[i] && !domBlank) {
          report.issues.push({
            type: "low-contrast",
            detail: "slide has content but captures as a near-uniform image — text may match the background color",
            severity: "error",
          })
        } else if (!pixelBlank[i] && domBlank) {
          report.issues = report.issues.filter((issue) => issue.type !== "maybe-blank")
        } else if (pixelBlank[i] && domBlank) {
          report.issues = report.issues.map((issue) =>
            issue.type === "maybe-blank" ? { type: "blank", detail: "slide is empty" } : issue,
          )
        }
      }
    }

    const inventory = await js("window.__deckProbe.inventory()")
    const reportPath = join(opts.outDir, "report.json")
    const inventoryPath = join(opts.outDir, "inventory.json")
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          file: deck,
          slideCount: meta.slideCount,
          stage: { w: meta.stageW, h: meta.stageH },
          fontsMissing: meta.fontsMissing ?? [],
          fontsUsed: meta.fontsUsed ?? [],
          slides: domReports,
        },
        null,
        2,
      ),
    )
    writeFileSync(inventoryPath, JSON.stringify({ file: deck, slides: inventory }, null, 2))

    // Only fatal render defects stop the export: blank, hidden, clipped or
    // broken slides. Overlaps, off-slide bleed, contrast and emptiness are
    // suggestions the model judges visually — gates that over-police stalled
    // real runs (they flagged the template's own design as errors).
    const BLOCKING = new Set([
      "text-clip",
      "blank",
      "maybe-blank",
      "broken-image",
      "stage-broken",
      "probe-error",
      "hidden-slide",
    ])
    const isBlocking = (i: { type: string; severity?: string }) => (i.severity ? i.severity === "error" : BLOCKING.has(i.type))
    const countBy = (fn: (i: { type: string; severity?: string }) => boolean) =>
      domReports.reduce((n, r) => n + (r.issues ?? []).filter(fn).length, 0)

    // Print every finding BEFORE the export gate: exit 4 used to skip these
    // lines, so the agent saw "N blocking error(s)" with no slide/type.
    const totalIssues = domReports.reduce((n, r) => n + (r.issues?.length ?? 0), 0)
    const errorCount = countBy(isBlocking)
    const suggestionCount = totalIssues - errorCount
    const label: Record<string, string> = {
      "text-clip": "TEXT CLIPPED",
      "out-of-bounds": "OUT OF BOUNDS",
      "low-contrast": "LOW CONTRAST",
      blank: "BLANK SLIDE",
      "maybe-blank": "BLANK SLIDE",
      "broken-image": "BROKEN IMAGE",
      "empty-region": "EMPTY REGION",
      "text-overlap": "TEXT OVERLAP",
      "stage-broken": "STAGE BROKEN",
      "probe-error": "PROBE ERROR",
      "mostly-empty": "MOSTLY EMPTY",
      "image-reuse": "IMAGE REUSED",
      "tiny-image": "TINY IMAGE",
      "hidden-slide": "HIDDEN SLIDE",
      "missing-br": "MISSING BR",
      "no-accent": "NO ACCENT",
      "accent-heading": "ACCENT HEADING",
      "accent-overload": "ACCENT OVERLOAD",
      "plain-cover": "PLAIN COVER",
      "sparse-box": "SPARSE BOX",
      "tight-gap": "TIGHT GAP",
      "img-no-alt": "IMG NO ALT",
    }
    for (const report of domReports) {
      for (const issue of report.issues) {
        const kind = isBlocking(issue) ? "error" : "suggestion"
        console.log(`slide ${report.index + 1}: ${kind}: ${label[issue.type] ?? issue.type.toUpperCase()}: ${issue.detail}`)
      }
    }

    if (opts.pptx || opts.pdf) {
      if (errorCount > 0) {
        if (opts.allowBlocking) {
          console.log(
            `render: WARNING — exporting with ${errorCount} blocking error(s) (--allow-blocking): the .pptx is produced, but the listed layout defects remain. Say exactly what is still wrong in the summary.`,
          )
        } else {
          console.log(
            `render: ${errorCount} blocking error(s), ${suggestionCount} suggestion(s) — export skipped. Fix deck.html and re-run; export only after a clean render.`,
          )
          // app.exit() does not stop this function: without the return the
          // code fell through into the pptx branch and touched the destroyed
          // window ("Object has been destroyed" — looked like an app crash).
          exit(4)
          return
        }
      }
    }

    if (opts.pptx) {
      const prep = (await js("window.__deckProbe.exportPrep()")) as { slides: number; notes: number }
      await js(readFileSync(join(opts.vendorDir as string, "dom-to-pptx.bundle.js"), "utf8"))
      const fonts = readFonts(opts.fontsDir)
      if (!fonts.length) {
        console.error("pptx: no embeddable TTF found (--fonts-dir/manifest.json) — the .pptx will reference fonts by name only")
      }
      const exported = (await js(`
        window.__deckProbeB64 = (u8) => {
          const parts = [];
          const chunk = 0x8000;
          for (let i = 0; i < u8.length; i += chunk) {
            parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + chunk)));
          }
          return btoa(parts.join(""));
        };
        window.domToPptx
          .exportToPptx(Array.from(document.querySelectorAll(".slide")), {
            skipDownload: true,
            width: ${PAGE_W_IN},
            height: ${PAGE_H_IN},
            svgAsVector: true,
            fonts: ${JSON.stringify(fonts)},
          })
          .then((blob) => blob.arrayBuffer())
          .then((buf) => window.__deckProbeB64(new Uint8Array(buf)));
      `)) as string
      await js("window.__deckProbe.exportRestore()")
      if (!exported || exported.length < 1000) fail(3, "render: the pptx export produced no data")
      const pptxPath = join(opts.outDir, basename(deck).replace(/\.html?$/i, "") + ".pptx")
      writeFileSync(pptxPath, Buffer.from(exported, "base64"))
      console.log(
        `pptx: ${pptxPath} (${Math.round(Buffer.from(exported, "base64").length / 1024)}KB, slides ${prep.slides}, notes ${prep.notes}, fonts ${fonts.length})`,
      )
    }

    console.log(`render: ${meta.slideCount} slide(s) → ${opts.outDir}`)
    console.log(`report: ${reportPath}`)
    console.log(`inventory: ${inventoryPath}`)
    console.log(
      errorCount === 0
        ? `render: clean — no blocking errors${suggestionCount ? ` (${suggestionCount} suggestion(s) to review visually)` : ""}`
        : `render: ${errorCount} blocking error(s), ${suggestionCount} suggestion(s) — fix deck.html, re-run, then render again`,
    )
    exit(0)
  } catch (e) {
    logger.error("deck-render failed", e)
    console.error(`render: failed: ${e instanceof Error ? e.message : String(e)}`)
    exit(3)
  } finally {
    clearTimeout(watchdog)
  }
}

function slideName(i: number): string {
  return `slide-${String(i + 1).padStart(2, "0")}.png`
}

// Embeddable TTFs for the export engine: manifest.json maps family → ttf files.
function readFonts(fontsDir?: string): { name: string; url: string }[] {
  if (!fontsDir) {
    console.error("fonts: --fonts-dir not passed — nothing will be embedded")
    return []
  }
  const manifestPath = join(fontsDir, "manifest.json")
  if (!existsSync(manifestPath)) {
    console.error(`fonts: manifest.json not found in ${fontsDir} — nothing will be embedded`)
    return []
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { ttf?: Record<string, string[]> }
    const out: { name: string; url: string }[] = []
    for (const [family, files] of Object.entries(manifest.ttf ?? {})) {
      for (const file of files) {
        const abs = join(fontsDir, file)
        if (!existsSync(abs)) {
          console.error(`fonts: ${file} listed in manifest but missing on disk`)
          continue
        }
        out.push({ name: family, url: `data:font/ttf;base64,${readFileSync(abs).toString("base64")}` })
      }
    }
    return out
  } catch (e) {
    console.error(`fonts: manifest read failed — ${e instanceof Error ? e.message : String(e)}; nothing will be embedded`)
    return []
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A slide whose pixels are ≥99.8% one color is visually blank (or its text
// matches the background). BGRA bitmap, sampled on a 16px grid for speed.
function isVisuallyBlank(bitmap: Buffer, width: number, height: number): boolean {
  const counts = new Map<number, number>()
  let total = 0
  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      const off = (y * width + x) * 4
      const key = ((bitmap[off] >> 4) << 8) | ((bitmap[off + 1] >> 4) << 4) | (bitmap[off + 2] >> 4)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    }
  }
  let dominant = 0
  for (const count of counts.values()) if (count > dominant) dominant = count
  return total > 0 && dominant / total >= 0.998
}
