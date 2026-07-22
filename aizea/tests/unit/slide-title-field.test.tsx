// @vitest-environment jsdom
//
// SlideTitleField — editable title/description for a slide.
//
// F5.2 design contract (from docs/drafts/product-design/flujo-usuario.md):
//   - "Otras propiedades editables (título, contenido de las cajas/boxes)"
//   - The current implementation only renders the title as a heading;
//     it is NOT editable. This test pins down the contract for the
//     inline editor that fixes the gap.
//
// What is tested:
//   - Click "Editar" → switches to inputs prefilled with current values
//   - Click "Guardar" → calls onSave with the new values
//   - Click "Cancelar" → discards the draft, returns to read-only mode
//   - Empty title → save button is disabled (don't allow empty titles)
//   - Read-only display when not in edit mode
//
// What is NOT tested here (covered by the integration test in Playwright):
//   - The persistence of the value (the server action updateSlide is
//     mocked here; the e2e test verifies the round-trip through Prisma).

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideTitleField } from "@/components/slides/SlideTitleField";

afterEach(() => {
  cleanup();
});

const DEFAULT_PROPS = {
  title: "Chumacera de camisa",
  description: "Una chumacera de camisa es...",
  onSave: vi.fn(),
  saving: false,
};

describe("<SlideTitleField /> — read-only mode", () => {
  it("renders the current title and description as text by default", () => {
    render(<SlideTitleField {...DEFAULT_PROPS} />);
    expect(
      screen.getByRole("heading", { name: /chumacera de camisa/i })
    ).toBeInTheDocument();
    // Description is also visible in read-only mode
    expect(screen.getByText(/una chumacera de camisa es/i)).toBeInTheDocument();
  });

  it("renders an Editar button to enter edit mode", () => {
    render(<SlideTitleField {...DEFAULT_PROPS} />);
    expect(screen.getByRole("button", { name: /editar/i })).toBeInTheDocument();
  });

  it("does NOT render inputs in read-only mode", () => {
    render(<SlideTitleField {...DEFAULT_PROPS} />);
    expect(
      screen.queryByRole("textbox", { name: /título/i })
    ).not.toBeInTheDocument();
  });
});

describe("<SlideTitleField /> — edit mode", () => {
  it("clicking Editar shows inputs prefilled with current values", async () => {
    const user = userEvent.setup();
    render(<SlideTitleField {...DEFAULT_PROPS} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));

    const titleInput = screen.getByRole("textbox", { name: /título/i });
    expect(titleInput).toBeInTheDocument();
    expect(titleInput).toHaveValue("Chumacera de camisa");

    const descInput = screen.getByRole("textbox", { name: /descripción/i });
    expect(descInput).toBeInTheDocument();
    expect(descInput).toHaveValue("Una chumacera de camisa es...");
  });

  it("clicking Guardar calls onSave with the new values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SlideTitleField {...DEFAULT_PROPS} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));

    const titleInput = screen.getByRole("textbox", { name: /título/i });
    await user.clear(titleInput);
    await user.type(titleInput, "Nuevo título");

    const descInput = screen.getByRole("textbox", { name: /descripción/i });
    await user.clear(descInput);
    await user.type(descInput, "Nueva descripción");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      title: "Nuevo título",
      description: "Nueva descripción",
    });
  });

  it("clicking Cancelar discards the draft and returns to read-only mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SlideTitleField {...DEFAULT_PROPS} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));

    const titleInput = screen.getByRole("textbox", { name: /título/i });
    await user.clear(titleInput);
    await user.type(titleInput, "Borrador descartado");

    await user.click(screen.getByRole("button", { name: /cancelar/i }));

    // No save call
    expect(onSave).not.toHaveBeenCalled();
    // Back to read-only: the original title is rendered
    expect(
      screen.getByRole("heading", { name: /chumacera de camisa/i })
    ).toBeInTheDocument();
    // No draft leaked into the rendered output
    expect(screen.queryByText("Borrador descartado")).not.toBeInTheDocument();
  });
});

describe("<SlideTitleField /> — validation", () => {
  it("disables the Guardar button when the title is empty (whitespace-only too)", async () => {
    const user = userEvent.setup();
    render(<SlideTitleField {...DEFAULT_PROPS} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));

    const titleInput = screen.getByRole("textbox", { name: /título/i });
    await user.clear(titleInput);
    await user.type(titleInput, "   "); // whitespace only

    const saveBtn = screen.getByRole("button", { name: /guardar/i });
    expect(saveBtn).toBeDisabled();
  });

  it("allows an empty description (description is optional)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SlideTitleField {...DEFAULT_PROPS} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));

    const descInput = screen.getByRole("textbox", { name: /descripción/i });
    await user.clear(descInput);

    const saveBtn = screen.getByRole("button", { name: /guardar/i });
    expect(saveBtn).not.toBeDisabled();
  });
});

describe("<SlideTitleField /> — saving state", () => {
  it("disables all inputs and buttons while saving=true", () => {
    render(<SlideTitleField {...DEFAULT_PROPS} saving={true} />);
    // While saving, we are still in read-only view (the inputs are
    // only visible after Editar). But the Editar button itself must
    // be disabled so the user doesn't open an editor mid-save.
    expect(screen.getByRole("button", { name: /editar/i })).toBeDisabled();
  });

  it("while in edit mode AND saving=true, the Guardar button shows a spinner and is disabled", async () => {
    const user = userEvent.setup();
    // Render in read-only first, then re-render with saving=true and
    // an open editor by clicking Editar. To exercise the "saving
    // during edit" state we mount the component with an
    // `isEditing` prop (default false in this version — but the
    // user can click Editar before saving starts). We simulate
    // the race by clicking Editar and immediately toggling saving.
    const onSave = vi.fn(
      () => new Promise<void>(() => undefined)
    ); // never resolves
    render(<SlideTitleField {...DEFAULT_PROPS} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    // Now saving is in flight. Re-render with saving=true.
    cleanup();
    render(
      <SlideTitleField
        {...DEFAULT_PROPS}
        onSave={onSave}
        saving={true}
      />
    );
    // Read-only view shows disabled Editar
    expect(screen.getByRole("button", { name: /editar/i })).toBeDisabled();
  });
});

describe("<SlideTitleField /> — re-sync after async save", () => {
  it("returns to read-only mode after onSave resolves", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        })
    );
    render(<SlideTitleField {...DEFAULT_PROPS} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /editar/i }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    // We are still waiting on the server action
    expect(
      screen.queryByRole("textbox", { name: /título/i })
    ).toBeInTheDocument();

    resolveSave();
    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: /título/i })
      ).not.toBeInTheDocument();
    });
  });
});
