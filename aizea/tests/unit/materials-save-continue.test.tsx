// @vitest-environment jsdom
//
// MaterialsClient — "Guardar y continuar" button (F3)
//
// Product design (flujo-usuario.md, F3):
//   - After uploading files, the user clicks "Guardar y continuar".
//   - This saves the LLMContext of the course.
//   - Then it navigates to PHASE 2: the conceptual tree at
//     /courses/{id}/tree (NOT /slides, which is phase 3).
//
// These tests pin the navigation target so a regression that
// re-routes to /slides (the bug originally shipped with) cannot
// recur silently. They also pin the toast copy so the user is
// told they're moving to the árbol, not to the slides.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// --- Mocks --------------------------------------------------------------

const mockRouterPush = vi.fn();
const mockRouterRefresh = vi.fn();
const mockUpdateCourseContext = vi.fn();
const mockRevalidateMaterials = vi.fn();
const mockUploadMaterial = vi.fn();
const mockDeleteMaterial = vi.fn();
const mockToast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    refresh: mockRouterRefresh,
  }),
}));

vi.mock("next/link", () => {
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/lib/actions/course", () => ({
  updateCourseContext: (...args: unknown[]) => mockUpdateCourseContext(...args),
}));

vi.mock("@/lib/actions/revalidate", () => ({
  revalidateMaterials: (...args: unknown[]) => mockRevalidateMaterials(...args),
}));

vi.mock("@/lib/adapters/useMaterialAdapter", () => ({
  useMaterialAdapter: () => ({
    uploadMaterial: mockUploadMaterial,
    deleteMaterial: mockDeleteMaterial,
  }),
}));

// Toast is a zustand store; the cleanest way to assert what was shown is
// to spy on the `useToast().toast` call. We mock the hook to return a
// stable spy we can read from the assertions.
vi.mock("@/components/toast", () => ({
  useToast: () => ({ toast: mockToast }),
  Toaster: () => null,
}));

// --- Import under test (AFTER mocks) -----------------------------------

import { MaterialsClient } from "@/app/courses/[id]/materials/materials-client";

const COURSE_ID = "course-f3-test";
const COURSE_NAME = "Curso F3";
const INITIAL_CONTEXT = "Contexto inicial del curso";

function renderClient(props: Partial<React.ComponentProps<typeof MaterialsClient>> = {}) {
  return render(
    <MaterialsClient
      courseId={COURSE_ID}
      courseName={COURSE_NAME}
      llmContext={INITIAL_CONTEXT}
      materials={[]}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateCourseContext.mockResolvedValue(undefined);
  mockRevalidateMaterials.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

// --- Tests --------------------------------------------------------------

describe('<MaterialsClient /> — F3 "Guardar y continuar"', () => {
  it('renders a "Guardar y continuar" button that is clearly visible', () => {
    renderClient();
    const button = screen.getByRole("button", { name: /guardar y continuar/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("exposes a stable data-testid on the save button for e2e selectors", () => {
    renderClient();
    expect(screen.getByTestId("save-and-continue")).toBeInTheDocument();
  });

  it("calls updateCourseContext with the current courseId and context before navigating", async () => {
    const user = userEvent.setup();
    renderClient();

    const button = screen.getByTestId("save-and-continue");
    await user.click(button);

    await waitFor(() => {
      expect(mockUpdateCourseContext).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateCourseContext).toHaveBeenCalledWith(
      COURSE_ID,
      INITIAL_CONTEXT
    );
  });

  it("navigates to the conceptual tree (/courses/{id}/tree), NOT to /slides", async () => {
    // F3 REGRESSION GUARD: the original implementation pushed
    // /courses/{id}/slides (phase 3), skipping phase 2 entirely.
    // The user must land on the árbol conceptual.
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByTestId("save-and-continue"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });
    const target = mockRouterPush.mock.calls[0][0];
    expect(target).toBe(`/courses/${COURSE_ID}/tree`);
    expect(target).not.toMatch(/\/slides$/);
  });

  it("shows a success toast that references the árbol conceptual (not diapositivas)", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByTestId("save-and-continue"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });
    // Find the call that signals success
    const successCall = mockToast.mock.calls.find(
      (call) => call[0]?.variant === "success"
    );
    expect(successCall, "expected a success toast to be shown").toBeDefined();
    const payload = successCall![0];
    // The toast body must mention the conceptual tree so the user
    // understands where they are being sent.
    const haystack = `${payload.title ?? ""} ${payload.description ?? ""}`.toLowerCase();
    expect(haystack).toMatch(/[áa]rbol conceptual/);
    expect(haystack).not.toMatch(/diapositiva/);
  });

  it("persists the latest context typed by the user (not the initial value)", async () => {
    const user = userEvent.setup();
    renderClient();

    // Type additional instructions into the LLMContext textarea.
    const textarea = screen.getByLabelText(/instrucciones para la ia/i);
    await user.clear(textarea);
    await user.type(textarea, "Tono didáctico, ejemplos prácticos.");

    await user.click(screen.getByTestId("save-and-continue"));

    await waitFor(() => {
      expect(mockUpdateCourseContext).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateCourseContext).toHaveBeenCalledWith(
      COURSE_ID,
      "Tono didáctico, ejemplos prácticos."
    );
  });

  it("shows an error toast and does NOT navigate when updateCourseContext throws", async () => {
    const user = userEvent.setup();
    mockUpdateCourseContext.mockRejectedValueOnce(
      new Error("DB write failed")
    );

    renderClient();
    await user.click(screen.getByTestId("save-and-continue"));

    await waitFor(() => {
      const errorCall = mockToast.mock.calls.find(
        (call) => call[0]?.variant === "error"
      );
      expect(errorCall, "expected an error toast").toBeDefined();
    });

    // The user must NOT be navigated away on a failed save — they
    // need to be able to retry.
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("re-enables the button after a failed save so the user can retry", async () => {
    const user = userEvent.setup();
    mockUpdateCourseContext.mockRejectedValueOnce(
      new Error("transient")
    );

    renderClient();
    const button = screen.getByTestId("save-and-continue");
    await user.click(button);

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
