import { describe, expect, it } from "vitest";
import { athleteApplication, instagramHandle } from "@/lib/athlete";

// Contact Form 7 does not send one consistent shape: a [select] arrives as an
// array and a [text] as a string, and either can be an empty string when the
// field was optional. The Athlete Program screen reads tier, sport and handle
// out of that payload, so the parsing is pinned here rather than trusted.

describe("athleteApplication", () => {
  it("reads a select posted as an array and text posted as a string", () => {
    const app = athleteApplication({
      "your-name": "Dana Reyes",
      "your-email": "dana@example.com",
      "your-tier": ["Professional"],
      "your-sport": "Olympic weightlifting",
      "your-instagram": "@dana.lifts",
      "tell-us-about": "Two-time national qualifier.",
    });

    expect(app.name).toBe("Dana Reyes");
    expect(app.tier).toBe("Professional");
    expect(app.sport).toBe("Olympic weightlifting");
    expect(app.instagram).toBe("dana.lifts");
    expect(app.instagramUrl).toBe("https://instagram.com/dana.lifts");
    expect(app.about).toBe("Two-time national qualifier.");
  });

  it("treats a blank optional field as absent, not as an empty handle", () => {
    const app = athleteApplication({ "your-name": "Sam", "your-instagram": "   " });

    expect(app.instagram).toBeNull();
    expect(app.instagramUrl).toBeNull();
    expect(app.sport).toBeNull();
  });

  it("survives a payload with none of the expected fields", () => {
    expect(athleteApplication({}).tier).toBeNull();
    expect(athleteApplication(null).name).toBeNull();
    expect(athleteApplication(undefined).email).toBeNull();
  });
});

describe("instagramHandle", () => {
  it("normalises the three ways people enter a handle", () => {
    expect(instagramHandle("@rf_supps")).toBe("rf_supps");
    expect(instagramHandle("rf_supps")).toBe("rf_supps");
    expect(instagramHandle("https://www.instagram.com/rf_supps/")).toBe("rf_supps");
  });

  it("returns null when there is nothing left after stripping", () => {
    expect(instagramHandle("@")).toBeNull();
    expect(instagramHandle("")).toBeNull();
    expect(instagramHandle(null)).toBeNull();
  });
});
