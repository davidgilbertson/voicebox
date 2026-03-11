import { useEffect, useState } from "react";

function readMetrics() {
  const root = document.getElementById("root");
  const rootRect = root?.getBoundingClientRect();
  const shell = document.getElementById("test-overlay-shell");
  const shellRect = shell?.getBoundingClientRect();
  const footer = document.getElementById("test-overlay-footer");
  const footerRect = footer?.getBoundingClientRect();
  const visualViewport = window.visualViewport;
  const htmlStyles = getComputedStyle(document.documentElement);
  const bodyStyles = getComputedStyle(document.body);

  return [
    `host: ${document.location.host}`,
    `path: ${document.location.pathname}`,
    `standalone(matchMedia): ${window.matchMedia("(display-mode: standalone)").matches}`,
    `standalone(navigator): ${String(window.navigator.standalone ?? "n/a")}`,
    `screen.height: ${window.screen.height}`,
    `outerHeight: ${window.outerHeight}`,
    `innerHeight: ${window.innerHeight}`,
    `visualViewport.height: ${visualViewport?.height ?? "n/a"}`,
    `documentElement.clientHeight: ${document.documentElement.clientHeight}`,
    `documentElement.computedHeight: ${htmlStyles.height}`,
    `body.clientHeight: ${document.body.clientHeight}`,
    `body.computedHeight: ${bodyStyles.height}`,
    `--app-height: ${htmlStyles.getPropertyValue("--app-height").trim()}`,
    `--app-safe-area-top: ${htmlStyles.getPropertyValue("--app-safe-area-top").trim()}`,
    `root.top: ${rootRect ? Math.round(rootRect.top) : "n/a"}`,
    `root.bottom: ${rootRect ? Math.round(rootRect.bottom) : "n/a"}`,
    `root.height: ${rootRect ? Math.round(rootRect.height) : "n/a"}`,
    `shell.top: ${shellRect ? Math.round(shellRect.top) : "n/a"}`,
    `shell.bottom: ${shellRect ? Math.round(shellRect.bottom) : "n/a"}`,
    `shell.height: ${shellRect ? Math.round(shellRect.height) : "n/a"}`,
    `footer.top: ${footerRect ? Math.round(footerRect.top) : "n/a"}`,
    `footer.bottom: ${footerRect ? Math.round(footerRect.bottom) : "n/a"}`,
    `footer.height: ${footerRect ? Math.round(footerRect.height) : "n/a"}`,
  ];
}

export default function TestOverlay() {
  const [metrics, setMetrics] = useState([]);

  useEffect(() => {
    const root = document.getElementById("root");
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const rootStyle = root?.style;
    const previous = {
      htmlOverflow: htmlStyle.overflow,
      bodyHeight: bodyStyle.height,
      bodyOverflow: bodyStyle.overflow,
      rootHeight: rootStyle?.height ?? "",
      rootPaddingTop: rootStyle?.paddingTop ?? "",
      rootOverflow: rootStyle?.overflow ?? "",
    };

    htmlStyle.overflow = "hidden";
    bodyStyle.height = "1024px";
    bodyStyle.overflow = "hidden";
    if (rootStyle) {
      rootStyle.height = "100%";
      rootStyle.paddingTop = "0";
      rootStyle.overflow = "hidden";
    }

    const update = () => setMetrics(readMetrics());
    const updateNextFrame = () => requestAnimationFrame(update);

    update();
    window.addEventListener("resize", updateNextFrame, { passive: true });
    window.addEventListener("pageshow", updateNextFrame, { passive: true });
    window.visualViewport?.addEventListener("resize", updateNextFrame, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", updateNextFrame, {
      passive: true,
    });

    return () => {
      htmlStyle.overflow = previous.htmlOverflow;
      bodyStyle.height = previous.bodyHeight;
      bodyStyle.overflow = previous.bodyOverflow;
      if (rootStyle) {
        rootStyle.height = previous.rootHeight;
        rootStyle.paddingTop = previous.rootPaddingTop;
        rootStyle.overflow = previous.rootOverflow;
      }
      window.removeEventListener("resize", updateNextFrame);
      window.removeEventListener("pageshow", updateNextFrame);
      window.visualViewport?.removeEventListener("resize", updateNextFrame);
      window.visualViewport?.removeEventListener("scroll", updateNextFrame);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <div
        id="test-overlay-shell"
        className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-slate-950 shadow-[inset_0_0_0_2px_hotpink]"
      >
        <div className="h-5 shrink-0 bg-black" />
        <div className="flex-1 bg-slate-900 shadow-[inset_0_0_0_2px_lime]" />
        <div
          id="test-overlay-footer"
          className="h-12 shrink-0 bg-orange-500 shadow-[inset_0_0_0_2px_white]"
        />
      </div>

      <div className="absolute top-3 left-3 z-10 max-h-[45vh] w-[min(40rem,calc(100vw-1.5rem))] overflow-auto rounded-md bg-black/85 p-3 font-mono text-sm font-bold text-yellow-300 shadow-[inset_0_0_0_2px_yellow]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>Test overlay</div>
          <div className="flex items-center gap-3">
            <a href="/" className="rounded-md bg-yellow-300 px-3 py-2 text-base text-black">
              Main app
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-red-600 px-3 py-2 text-base text-white"
            >
              Reload
            </button>
          </div>
        </div>
        <pre className="break-words whitespace-pre-wrap">{metrics.join("\n")}</pre>
      </div>
    </div>
  );
}
