// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary/ErrorBoundary";

afterEach(cleanup);

// A child that throws on demand so we can drive the boundary deterministically.
function Boom({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error("kaboom");
  return <div>contenido ok</div>;
}

describe("ErrorBoundary (Fase 4)", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("contenido ok")).toBeInTheDocument();
  });

  it("catches a render throw and shows the default fallback", () => {
    // Silence React's error logging noise for this expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(screen.getByText("Reintentar")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("recovers when reset is clicked and the child no longer throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Harness(): React.ReactElement {
      const [throws, setThrows] = React.useState(true);
      return (
        <div>
          <button onClick={() => setThrows(false)}>fix</button>
          <ErrorBoundary>
            <Boom shouldThrow={throws} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<Harness />);
    // Fallback is showing.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Fix the underlying condition, then reset the boundary.
    fireEvent.click(screen.getByText("fix"));
    fireEvent.click(screen.getByText("Reintentar"));
    expect(screen.getByText("contenido ok")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders a custom fallback when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("custom: kaboom")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("invokes onError with the caught error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "kaboom" }),
      expect.anything()
    );
    spy.mockRestore();
  });
});
