import { describe, expect, it } from "vitest";
import { formatBytes, formatChange, summarizeParams } from "./format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("formats change", () => {
    expect(formatChange(1000, 650)).toBe("-35%");
    expect(formatChange(1000, 1200)).toBe("+20%");
  });

  it("summarizes params", () => {
    expect(summarizeParams("resize", { mode: "pixel", width: 1080, height: 1080, fit: "cover", format: "jpg" })).toBe(
      "1080×1080 (잘라서 채우기) · JPG",
    );
    expect(summarizeParams("upscale", { scale: 4, style: "photo", denoise: "medium", format: "png" })).toBe(
      "4배 · 사진 · 노이즈 중간 · PNG",
    );
  });
});
