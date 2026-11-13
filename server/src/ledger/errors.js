export class LedgerError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function staleLedger() {
  return new LedgerError(409, 'STALE_LEDGER', 'The ledger changed. Refresh it and try again.');
}

export function unavailableLedger() {
  return new LedgerError(503, 'DATABASE_UNAVAILABLE', 'The ledger database is unavailable. Try again when the connection is restored.');
}
