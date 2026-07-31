import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/browser/mock.js";
import {
  TEXTUAL_SURFACE,
  TOUCH_VISUAL_SURFACE,
  VISUAL_SURFACE,
} from "../src/surface/capabilities.js";

describe("surface capabilities", () => {
  it("describes a visual surface as spatial, screenshot-capable, mouse-pointed and hoverable", () => {
    expect(VISUAL_SURFACE.spatial).toBe(true);
    expect(VISUAL_SURFACE.modality).toBe("visual");
    expect(VISUAL_SURFACE.canScreenshot).toBe(true);
    expect(VISUAL_SURFACE.pointer).toBe("mouse");
    expect(VISUAL_SURFACE.canHover).toBe(true);
  });

  it("describes a textual surface as non-spatial with no screenshots or hover", () => {
    expect(TEXTUAL_SURFACE.spatial).toBe(false);
    expect(TEXTUAL_SURFACE.modality).toBe("textual");
    expect(TEXTUAL_SURFACE.canScreenshot).toBe(false);
    expect(TEXTUAL_SURFACE.canHover).toBe(false);
  });

  it("describes a touch surface as spatial and screenshot-capable but with no hover", () => {
    expect(TOUCH_VISUAL_SURFACE.spatial).toBe(true);
    expect(TOUCH_VISUAL_SURFACE.modality).toBe("visual");
    expect(TOUCH_VISUAL_SURFACE.canScreenshot).toBe(true);
    expect(TOUCH_VISUAL_SURFACE.pointer).toBe("touch");
    expect(TOUCH_VISUAL_SURFACE.canHover).toBe(false);
  });

  it("exposes capabilities on the shipped mock adapter", () => {
    const adapter = new MockAdapter();
    expect(adapter.capabilities.spatial).toBe(true);
    expect(adapter.capabilities.pointer).toBe("mouse");
  });
});
