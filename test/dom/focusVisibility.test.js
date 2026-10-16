import { describe, expect, test } from "vitest";
import { DISABLE_FOCUS_CLASS, installFocusVisibilityPolicy } from "../../src/focusVisibility.js";

describe("Focus visibility", () => {
  test("Focus rings stay hidden until Tab or Space is pressed", () => {
    installFocusVisibilityPolicy();

    expect(document.documentElement).toHaveClass(DISABLE_FOCUS_CLASS);

    // A non-navigation key leaves focus rings hidden.
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    expect(document.documentElement).toHaveClass(DISABLE_FOCUS_CLASS);

    // Tab reveals focus rings.
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    expect(document.documentElement).not.toHaveClass(DISABLE_FOCUS_CLASS);

    // Space reveals them too (re-install, since the policy is one-shot per page load).
    installFocusVisibilityPolicy();
    expect(document.documentElement).toHaveClass(DISABLE_FOCUS_CLASS);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    expect(document.documentElement).not.toHaveClass(DISABLE_FOCUS_CLASS);
  });
});
