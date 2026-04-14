export type ConnectorConfigValidationResult =
  | { valid: true }
  | { valid: false; missing?: string[]; message?: string }
