import { describe, expect, test } from "vitest";
import { DISABLE_FOCUS_CLASS, installFocusVisibilityPolicy } from "../../src/focusVisibility.js";

describe("Focus visibility", () => {
  test("Focus rings stay disabled until tab is pressed", () => {
    installFocusVisibilityPolicy();

    expect(document.documentElement).toHaveClass(DISABLE_FOCUS_CLASS);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
      }),
    );

    expect(document.documentElement).toHaveClass(DISABLE_FOCUS_CLASS);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Tab",
      }),
    );

    expect(document.documentElement).not.toHaveClass(DISABLE_FOCUS_CLASS);
  });

  test("Space also enables focus rings", () => {
    installFocusVisibilityPolicy();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: " ",
      }),
    );

    expect(document.documentElement).not.toHaveClass(DISABLE_FOCUS_CLASS);
  });
});
