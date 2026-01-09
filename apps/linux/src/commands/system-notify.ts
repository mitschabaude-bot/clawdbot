import { execFile } from "node:child_process";

export type SystemNotifyParams = {
  title?: string;
  body?: string;
  sound?: string;
  priority?: "passive" | "active" | "timeSensitive";
  delivery?: "system" | "overlay" | "auto";
};

export async function systemNotify(params: SystemNotifyParams): Promise<{ ok: boolean; error?: string }>{
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const body = typeof params.body === "string" ? params.body.trim() : "";
  if (!title && !body) return { ok: false, error: "INVALID_REQUEST: empty notification" };

  // Prefer notify-send (libnotify-bin). This is the most reliable MVP option on Ubuntu.
  return await new Promise((resolve) => {
    execFile("notify-send", [title || "Clawdbot", body], (err) => {
      if (err) {
        resolve({ ok: false, error: String(err) });
        return;
      }
      resolve({ ok: true });
    });
  });
}
