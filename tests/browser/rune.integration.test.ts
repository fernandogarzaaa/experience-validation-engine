/**
 * Real-binary integration test for the Rune adapter contract.
 *
 * The offline suite deliberately never touches a subprocess or the network,
 * and that constraint stays intact: this file lives outside `tests/**` and
 * only runs under `npm run test:browser`, with the Rune hello binary given
 * by RUNE_HELLO_BIN. It exists because the adapter shells out to a real
 * binary whose headless flags only a real run can catch drifting.
 *
 * It mirrors `tests/browser/playwright.integration.test.ts` — same contract
 * assertions (snapshot shape, real PNG, click flips state) — because the
 * Rune adapter is meant to be indistinguishable from the other adapters to
 * the cognition engine.
 */

import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { RuneAdapter } from "../../src/browser/rune.js";

const BIN = process.env.RUNE_HELLO_BIN ?? "";
const VIEWPORT = { width: 320, height: 200 };
// Centre of the hello switch (rect 141, 105.25, 38 x 22).
const SWITCH_POINT = { x: 160, y: 116 };

const adapters: RuneAdapter[] = [];

afterEach(async () => {
  while (adapters.length > 0) await adapters.pop()!.close();
});

async function openHello(): Promise<RuneAdapter> {
  const adapter = new RuneAdapter();
  adapters.push(adapter);
  await adapter.open(`rune:${BIN}`, VIEWPORT);
  return adapter;
}

describe.skipIf(!BIN)("RuneAdapter against the real hello binary", () => {
  it("perceives the hello app the way the contract promises", async () => {
    const adapter = await openHello();
    const snap = await adapter.snapshot();

    expect(snap.title).toBe("Hello");
    expect(snap.url).toBe("rune://hello");
    expect(snap.viewport).toEqual(VIEWPORT);
    expect(snap.scrollY).toBe(0);
    expect(Array.isArray(snap.elements)).toBe(true);
    expect(snap.elements).toHaveLength(2);

    const label = snap.elements.find((el) => el.role === "text");
    expect(label?.text).toBe("Lights off");
    expect(label?.textSource).toBe("visual");

    const toggle = snap.elements.find((el) => el.role === "checkbox");
    expect(toggle?.text).toBe("Lights");
    expect(toggle?.textSource).toBe("accessibility");
    expect(toggle?.interactive).toBe(true);
  });

  it("screenshot returns a real PNG of the viewport", async () => {
    const adapter = await openHello();
    const png = await adapter.screenshot();
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png!.length).toBeGreaterThan(1000);
  });

  it("screenshot pixels match the viewport, not the display scale", async () => {
    // Rune renders headlessly at 2x, so the raw PNG is 640x400 for a
    // 320x200 viewport. EVE's pixel checks sample boxes in points, so the
    // adapter must hand back a viewport-sized PNG or every sampled box
    // lands on the wrong region.
    const adapter = await openHello();
    const png = await adapter.screenshot();
    const image = PNG.sync.read(png!);
    expect(image.width).toBe(VIEWPORT.width);
    expect(image.height).toBe(VIEWPORT.height);
  });

  it("a click on the switch flips the lights on", async () => {
    const adapter = await openHello();
    const before = await adapter.screenshot();
    await adapter.clickAt(SWITCH_POINT);

    const snap = await adapter.snapshot();
    expect(snap.elements.find((el) => el.role === "text")?.text).toBe("Lights on");
    expect(snap.elements.find((el) => el.role === "checkbox")?.focused).toBe(true);

    const after = await adapter.screenshot();
    expect(after).not.toBeNull();
    expect(createHash("md5").update(after!).digest("hex")).not.toBe(
      createHash("md5").update(before!).digest("hex"),
    );
  });

  it("typeText with no editable element changes nothing and does not throw", async () => {
    const adapter = await openHello();
    await expect(adapter.typeText("hello", 10)).resolves.toBeUndefined();
    const snap = await adapter.snapshot();
    expect(snap.elements.find((el) => el.role === "text")?.text).toBe("Lights off");
  });

  it("the same journal replays to identical bytes", async () => {
    const first = await openHello();
    await first.clickAt(SWITCH_POINT);
    const firstPng = await first.screenshot();
    const firstSnap = await first.snapshot();

    const second = await openHello();
    await second.clickAt(SWITCH_POINT);
    const secondPng = await second.screenshot();
    const secondSnap = await second.snapshot();

    expect(createHash("md5").update(secondPng!).digest("hex")).toBe(
      createHash("md5").update(firstPng!).digest("hex"),
    );
    expect(secondSnap.elements).toEqual(firstSnap.elements);
  });

  it("open without a binary explains itself", async () => {
    const adapter = new RuneAdapter();
    adapters.push(adapter);
    await expect(adapter.open("rune:/does/not/exist/hello", VIEWPORT)).rejects.toThrow(
      /not executable or not found/,
    );
    const noBinary = new RuneAdapter();
    adapters.push(noBinary);
    await expect(noBinary.open("http://example.com", VIEWPORT)).rejects.toThrow(
      /no Rune app binary configured/,
    );
  });
});
