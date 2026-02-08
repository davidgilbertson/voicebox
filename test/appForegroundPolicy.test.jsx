import React from "react";
import {render} from "@testing-library/react";
import {test, expect, vi} from "vitest";
import App from "../src/App.jsx";

test("foreground tracking subscribes and unsubscribes to page lifecycle events", () => {
  const documentAdd = vi.spyOn(document, "addEventListener");
  const documentRemove = vi.spyOn(document, "removeEventListener");
  const windowAdd = vi.spyOn(window, "addEventListener");
  const windowRemove = vi.spyOn(window, "removeEventListener");

  const {unmount} = render(<App/>);
  unmount();

  expect(documentAdd).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  expect(documentRemove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  expect(windowAdd).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(windowAdd).toHaveBeenCalledWith("blur", expect.any(Function));
  expect(windowAdd).toHaveBeenCalledWith("pageshow", expect.any(Function));
  expect(windowAdd).toHaveBeenCalledWith("pagehide", expect.any(Function));
  expect(windowRemove).toHaveBeenCalledWith("focus", expect.any(Function));
  expect(windowRemove).toHaveBeenCalledWith("blur", expect.any(Function));
  expect(windowRemove).toHaveBeenCalledWith("pageshow", expect.any(Function));
  expect(windowRemove).toHaveBeenCalledWith("pagehide", expect.any(Function));
});
