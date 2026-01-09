import { BrowserWindow } from "electron";

export type CanvasPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class CanvasManager {
  private win: BrowserWindow | null = null;

  show(opts: { url?: string; placement?: CanvasPlacement }) {
    if (!this.win) {
      this.win = new BrowserWindow({
        width: opts.placement?.width ?? 900,
        height: opts.placement?.height ?? 700,
        x: opts.placement?.x,
        y: opts.placement?.y,
        webPreferences: {
          // Canvas content is hosted by the gateway; it must run scripts.
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      this.win.on("closed", () => {
        this.win = null;
      });
    }

    if (opts.placement) {
      this.win.setBounds({
        x: opts.placement.x,
        y: opts.placement.y,
        width: opts.placement.width,
        height: opts.placement.height,
      });
    }

    if (opts.url) {
      void this.win.loadURL(opts.url);
    }

    this.win.show();
    this.win.focus();
  }

  hide() {
    this.win?.hide();
  }

  async navigate(url: string) {
    if (!this.win) {
      this.show({ url });
      return;
    }
    await this.win.loadURL(url);
    this.win.show();
  }

  async evalJS(javaScript: string): Promise<string> {
    if (!this.win) throw new Error("CANVAS_NOT_PRESENT: call canvas.present first");
    const result = await this.win.webContents.executeJavaScript(javaScript, true);
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async snapshot(opts: { format: "png" | "jpeg"; quality: number }): Promise<{
    format: "png" | "jpeg";
    base64: string;
  }> {
    if (!this.win) throw new Error("CANVAS_NOT_PRESENT: call canvas.present first");
    const image = await this.win.webContents.capturePage();
    if (opts.format === "png") {
      const buf = image.toPNG();
      return { format: "png", base64: buf.toString("base64") };
    }

    const q = Math.min(1, Math.max(0.05, opts.quality));
    const buf = image.toJPEG(Math.round(q * 100));
    return { format: "jpeg", base64: buf.toString("base64") };
  }

  isOpen() {
    return Boolean(this.win && !this.win.isDestroyed());
  }
}
