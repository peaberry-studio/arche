export type ConnectorConfigResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string }
