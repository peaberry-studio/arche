declare module "node:sqlite" {
  type Statement = {
    all(...params: Array<string | number>): unknown[]
    get(...params: Array<string | number>): unknown
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    close(): void
    prepare(sql: string): Statement
  }
}
