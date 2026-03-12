import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import DebugPage from "../../src/debug/DebugPage.jsx";

test("debug page shows a localStorage snapshot above the audio controls", () => {
  localStorage.setItem("voicebox.alpha", "1");
  localStorage.setItem("voicebox.beta", '{"enabled":true}');

  render(<DebugPage />);

  const localStorageHeading = screen.getByText("Local Storage");
  const localStorageSection = localStorageHeading.closest("details");
  const controlsSection = screen.getByLabelText("autoGainControl").closest("details");

  expect(localStorageSection).toBeInTheDocument();
  expect(localStorageSection).toHaveTextContent('"voicebox.alpha": "1"');
  expect(localStorageSection).toHaveTextContent('"voicebox.beta": "{\\"enabled\\":true}"');
  expect(controlsSection).toBeInTheDocument();
  expect(localStorageSection.compareDocumentPosition(controlsSection)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("debug page shows overlay metrics and main app navigation", async () => {
  render(<DebugPage />);

  expect(screen.getByRole("link", { name: "Main app" })).toHaveAttribute("href", "/");
  const metricsSection = screen.getByText("Overlay Metrics").closest("details");

  expect(metricsSection).toBeInTheDocument();
  expect(metricsSection).toHaveTextContent("innerHeight:");

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: 640,
  });
  window.dispatchEvent(new Event("resize"));

  await waitFor(() => {
    expect(metricsSection).toHaveTextContent("innerHeight: 640");
  });
});
