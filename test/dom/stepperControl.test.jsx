import React from "react";
import {render, screen} from "@testing-library/react";
import {expect, test} from "vitest";
import StepperControl from "../../src/components/StepperControl.jsx";

test("stepper control defaults to small size", () => {
  render(
      <StepperControl
          value="100"
          onDecrement={() => {}}
          onIncrement={() => {}}
          decrementAriaLabel="Decrease"
          incrementAriaLabel="Increase"
      />
  );

  const decrementButton = screen.getByRole("button", {name: "Decrease"});
  const incrementButton = screen.getByRole("button", {name: "Increase"});
  expect(decrementButton.parentElement).toHaveClass("h-11");
  expect(decrementButton.parentElement).not.toHaveClass("h-16");
  expect(decrementButton.firstChild).toHaveClass("h-5", "w-5");
  expect(incrementButton.firstChild).toHaveClass("h-5", "w-5");
});

test("stepper control supports large size", () => {
  render(
      <StepperControl
          size="large"
          value="100"
          onDecrement={() => {}}
          onIncrement={() => {}}
          decrementAriaLabel="Decrease"
          incrementAriaLabel="Increase"
      />
  );

  const decrementButton = screen.getByRole("button", {name: "Decrease"});
  const incrementButton = screen.getByRole("button", {name: "Increase"});
  expect(decrementButton.parentElement).toHaveClass("h-16");
  expect(decrementButton).toHaveClass("px-4");
  expect(incrementButton).toHaveClass("px-4");
  expect(decrementButton.firstChild).toHaveClass("h-6", "w-6");
  expect(incrementButton.firstChild).toHaveClass("h-6", "w-6");
});

test("stepper control can show units below the value", () => {
  render(
      <StepperControl
          size="large"
          value="300"
          units="BPM"
          onDecrement={() => {}}
          onIncrement={() => {}}
          decrementAriaLabel="Decrease"
          incrementAriaLabel="Increase"
      />
  );

  expect(screen.getByText("300")).toBeInTheDocument();
  const units = screen.getByText("BPM");
  expect(units).toHaveClass("text-slate-500");
  expect(units).toHaveClass("text-sm");
});
