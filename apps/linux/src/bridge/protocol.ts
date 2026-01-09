export type BridgeHelloFrame = {
  type: "hello";
  nodeId: string;
  displayName?: string;
  token?: string;
  platform?: string;
  version?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
};

export type BridgePairRequestFrame = {
  type: "pair-request";
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  silent?: boolean;
};

export type BridgeInvokeRequestFrame = {
  type: "invoke";
  id: string;
  command: string;
  paramsJSON?: string | null;
};

export type BridgeInvokeResponseFrame = {
  type: "invoke-res";
  id: string;
  ok: boolean;
  payloadJSON?: string | null;
  error?: { code: string; message: string } | null;
};

export type BridgePingFrame = { type: "ping"; id: string };
export type BridgePongFrame = { type: "pong"; id: string };

export type BridgeHelloOkFrame = {
  type: "hello-ok";
  serverName: string;
  canvasHostUrl?: string;
};

export type BridgePairOkFrame = { type: "pair-ok"; token: string };

export type BridgeErrorFrame = { type: "error"; code: string; message: string };

export type AnyBridgeFrame =
  | BridgeHelloFrame
  | BridgePairRequestFrame
  | BridgeInvokeRequestFrame
  | BridgeInvokeResponseFrame
  | BridgePingFrame
  | BridgePongFrame
  | BridgeHelloOkFrame
  | BridgePairOkFrame
  | BridgeErrorFrame
  | { type: string; [k: string]: unknown };
