import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/browser/mock.js";
import { TEXTUAL_SURFACE, VISUAL_SURFACE } from "../src/surface/capabilities.js";

describe("surface capabilities", () => {
  it("describes a visual surface as spatial and screenshot-capable", () => {
    expect(VISUAL_SURFACE.spatial).toBe(true);
    expect(VISUAL_SURFACE.modality).toBe("visual");
    expect(VISUAL_SURFACE.canScreenshot).toBe(true);
  });

  it("describes a textual surface as non-spatial with no screenshots", () => {
    expect(TEXTUAL_SURFACE.spatial).toBe(false);
    expect(TEXTUAL_SURFACE.modality).toBe("textual");
    expect(TEXTUAL_SURFACE.canScreenshot).toBe(false);
  });

  it("exposes capabilities on the shipped mock adapter", () => {
    const adapter = new MockAdapter();
    expect(adapter.capabilities.spatial).toBe(true);
  });
});
