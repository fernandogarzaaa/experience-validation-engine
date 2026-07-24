/**
 * Persistence for digital twins — a JSON-file store keyed by twin id, so a
 * twin survives and keeps evolving across processes and sessions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { TwinProfile } from "./types.js";

interface TwinStoreBody {
  version: 1;
  twins: Record<string, TwinProfile>;
}

const EMPTY: TwinStoreBody = { version: 1, twins: {} };

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
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as TwinStoreBody;
      if (parsed.version !== 1 || typeof parsed.twins !== "object") return { ...EMPTY };
      return parsed;
    } catch {
      return { ...EMPTY };
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
