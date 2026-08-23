/**
 * Persistence for digital twins — a JSON-file store keyed by twin id, so a
 * twin survives and keeps evolving across processes and sessions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isFileNotFoundError } from "../core/fsErrors.js";
import type { TwinProfile } from "./types.js";

interface TwinStoreBody {
  version: 1;
  twins: Record<string, TwinProfile>;
}

// A function, not a shared constant: `{ ...empty() }` would still copy only
// the top level, leaving every caller's `.twins` pointing at the same nested
// object. A fresh literal per call is the only way an "empty store" from one
// read doesn't become every read's shared, mutable state.
function empty(): TwinStoreBody {
  return { version: 1, twins: {} };
}

export interface TwinStore {
  load(id: string): Promise<TwinProfile | null>;
  save(twin: TwinProfile): Promise<void>;
  list(): Promise<TwinProfile[]>;
}

/** In-memory twin store (for tests). */
export class InMemoryTwinStore implements TwinStore {
  private readonly twins = new Map<string, TwinProfile>();

  async load(id: string): Promise<TwinProfile | null> {
    return this.twins.get(id) ?? null;
  }
  async save(twin: TwinProfile): Promise<void> {
    this.twins.set(twin.id, twin);
  }
  async list(): Promise<TwinProfile[]> {
    return [...this.twins.values()];
  }
}

/** JSON-file-backed twin store for real cross-session persistence. */
export class FileTwinStore implements TwinStore {
  constructor(private readonly path: string) {}

  private async read(): Promise<TwinStoreBody> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) return empty();
      throw new Error(`could not read twin store at ${this.path}: ${String(error)}`);
    }
    try {
      const parsed = JSON.parse(text) as TwinStoreBody;
      if (
        parsed.version !== 1 ||
        parsed.twins === null ||
        typeof parsed.twins !== "object" ||
        Array.isArray(parsed.twins)
      ) {
        return empty();
      }
      return parsed;
    } catch (error) {
      throw new Error(`could not read twin store at ${this.path}: ${String(error)}`);
    }
  }

  async load(id: string): Promise<TwinProfile | null> {
    return (await this.read()).twins[id] ?? null;
  }

  async save(twin: TwinProfile): Promise<void> {
    const body = await this.read();
    body.twins[twin.id] = twin;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(body, null, 2), "utf8");
  }

  async list(): Promise<TwinProfile[]> {
    return Object.values((await this.read()).twins);
  }
}
