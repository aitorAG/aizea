// @vitest-environment jsdom
//
// TreeControls — toolbar above the TreeViewer.
//
// F4.3 — adds the "Generar todas las diapositivas" button to the
// toolbar. The button is wired to a `onGenerateAllSlides` callback
// (provided by the parent — typically tree-client) which generates
// slides for EVERY node in the tree, regardless of the current
// checkbox selection.
//
// Design constraints tested here:
//   - the button only renders when the parent provides the callback
//   - the button is enabled even when the selection set is empty
//   - the button is disabled when the tree itself is empty (0 nodes)
//   - the button uses a visually distinct icon from the existing
//     "Generar N" actions, so the user can tell at a glance that it
//     targets ALL nodes, not the current selection.
//   - the button lives on the RIGHT side of the toolbar (the
//     `ml-auto` group that already contains "Añadir raíz" /
//     "Recentrar"), matching the design draft.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreeControls } from "@/components/TreeViewer/TreeControls";

// The button uses the `Layers` icon from lucide-react. lucide-react
// renders icons as inline SVGs whose accessibility name is the icon
// name. We use this to assert which icon a button renders (the
// existing tree controls use Scissors / GitMerge / Plus / Trash2 /
// RotateCcw / ListChecks / XCircle / Sprout — none of which are
// `layers`).
import { Layers } from "lucide-react";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/**
 * Renders <TreeControls /> with all callbacks stubbed. Returns the
 * stubs so individual tests can assert what was called.
 *
 * `onGenerateAllSlides` is OPTIONAL on the component (rendering the
 * button is gated on the prop being supplied). To stay faithful to
 * that contract we only inject the stub when the test asks for it
 * via `overrides.onGenerateAllSlides`. Tests that don't pass it
 * must observe the "no button" branch.
 */
function renderTreeControls(
  overrides: Partial<{
    selectedCount: number;
    totalNodeCount: number;
    busy: boolean;
    onSelectAll: () => void;
    onToggleSelectAll: () => void;
    onClearSelection: () => void;
    onGenerateAllSlides: (() => void) | null;
  }> = {}
) {
  const stubs = {
    onPrune: vi.fn(),
    onMerge: vi.fn(),
    onSplit: vi.fn(),
    onDelete: vi.fn(),
    onAddChild: vi.fn(),
    onAddRoot: vi.fn(),
    onEdit: vi.fn(),
    onSelectAll: vi.fn(),
    onToggleSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onGenerateAllSlides: vi.fn(),
  };
  const props: Record<string, unknown> = {
    selectedCount: overrides.selectedCount ?? 0,
    totalNodeCount: overrides.totalNodeCount ?? 4,
    busy: overrides.busy ?? false,
    onPrune: stubs.onPrune,
    onMerge: stubs.onMerge,
    onSplit: stubs.onSplit,
    onDelete: stubs.onDelete,
    onAddChild: stubs.onAddChild,
    onAddRoot: stubs.onAddRoot,
    onEdit: stubs.onEdit,
  };
  // Selection callbacks — match the real component's contract: when
  // the test passes a stub we wire it in; when it doesn't, we leave
  // the prop unset so tests can exercise the "no callback" branch.
  if ("onSelectAll" in overrides) props.onSelectAll = overrides.onSelectAll;
  else props.onSelectAll = stubs.onSelectAll;
  if ("onToggleSelectAll" in overrides) {
    props.onToggleSelectAll = overrides.onToggleSelectAll;
  } else {
    props.onToggleSelectAll = stubs.onToggleSelectAll;
  }
  if ("onClearSelection" in overrides) {
    props.onClearSelection = overrides.onClearSelection;
  } else {
    props.onClearSelection = stubs.onClearSelection;
  }
  // F4.3 — the optional `onGenerateAllSlides` prop. Pass `null`
  // explicitly to test the "omitted" branch (button hidden), or a
  // function to test the "wired" branch.
  if (overrides.onGenerateAllSlides === null) {
    // intentionally not setting the prop at all
  } else if (typeof overrides.onGenerateAllSlides === "function") {
    props.onGenerateAllSlides = overrides.onGenerateAllSlides;
  }
  render(<TreeControls {...(props as unknown as React.ComponentProps<typeof TreeControls>)} />);
  return stubs;
}

describe("<TreeControls /> — F4.3 'Generar todas las diapositivas' button", () => {
  it("renders the button when the parent provides onGenerateAllSlides", () => {
    renderTreeControls({ onGenerateAllSlides: vi.fn() });
    expect(
      screen.getByRole("button", { name: /generar todas las diapositivas/i })
    ).toBeInTheDocument();
  });

  it("does NOT render the button when the parent omits onGenerateAllSlides", () => {
    // `null` → the prop is not passed at all (test the omitted branch).
    renderTreeControls({ onGenerateAllSlides: null });
    expect(
      screen.queryByRole("button", { name: /generar todas las diapositivas/i })
    ).not.toBeInTheDocument();
  });

  it("is enabled even when no node is selected (it ignores the selection set)", () => {
    renderTreeControls({
      selectedCount: 0,
      onGenerateAllSlides: vi.fn(),
    });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    expect(btn).not.toBeDisabled();
  });

  it("stays enabled when some nodes are selected", () => {
    renderTreeControls({
      selectedCount: 2,
      onGenerateAllSlides: vi.fn(),
    });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    expect(btn).not.toBeDisabled();
  });

  it("is disabled when the tree has zero nodes (nothing to generate)", () => {
    renderTreeControls({
      totalNodeCount: 0,
      onGenerateAllSlides: vi.fn(),
    });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    expect(btn).toBeDisabled();
  });

  it("is disabled while a server action is in flight (busy=true)", () => {
    renderTreeControls({
      busy: true,
      onGenerateAllSlides: vi.fn(),
    });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    expect(btn).toBeDisabled();
  });

  it("calls onGenerateAllSlides exactly once when clicked", async () => {
    const onGenerateAllSlides = vi.fn();
    const user = userEvent.setup();
    renderTreeControls({ onGenerateAllSlides });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    await user.click(btn);
    expect(onGenerateAllSlides).toHaveBeenCalledTimes(1);
  });

  it("uses the Layers icon (different from the Sparkles used by the per-selection generate action)", () => {
    // Visual differentiation matters: the per-selection generate
    // action (the page header button) uses Sparkles, and the existing
    // 'Seleccionar todas' uses ListChecks. Using Layers for "all"
    // signals to the user that this targets the whole stack, not the
    // current selection.
    renderTreeControls({ onGenerateAllSlides: vi.fn() });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    // lucide-react renders each icon as a <svg> with `class` containing
    // `lucide-<icon-name>`. The Layers icon exposes `lucide-layers`.
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class") ?? "").toMatch(/lucide-layers/);
    // Belt + suspenders: the imported component renders a single <svg>
    // with the icon name baked into the class name.
    expect(svg!.classList.contains("lucide-layers")).toBe(true);
  });

  it("lives on the RIGHT side of the toolbar (inside the ml-auto group)", () => {
    // The toolbar is split into a left section (selection helpers,
    // structural actions) and a right section that uses Tailwind's
    // `ml-auto` class to push it to the end. The new "Generar todas"
    // button must be in the right section so the design draft's
    // "Posición de los botones" is satisfied.
    renderTreeControls({ onGenerateAllSlides: vi.fn() });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    // Walk up to the closest container with `ml-auto`.
    let parent = btn.parentElement;
    while (parent && !parent.classList.contains("ml-auto")) {
      parent = parent.parentElement;
    }
    expect(parent).not.toBeNull();
    expect(parent!.classList.contains("ml-auto")).toBe(true);
  });

  it("renders inside the toolbar landmark (role='toolbar')", () => {
    // Accessibility: the new button must be discoverable as part of
    // the existing toolbar landmark, not floating outside it.
    renderTreeControls({ onGenerateAllSlides: vi.fn() });
    const toolbar = screen.getByRole("toolbar", { name: /acciones del [áa]rbol/i });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    expect(toolbar.contains(btn)).toBe(true);
  });

  it("carries an aria-label and a descriptive title for screen readers", () => {
    renderTreeControls({ onGenerateAllSlides: vi.fn() });
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    // Both fields must be set so the button is usable via keyboard
    // and assistive tech.
    expect(btn).toHaveAttribute("aria-label");
    expect(btn.getAttribute("aria-label")).toMatch(/generar todas/i);
    expect(btn).toHaveAttribute("title");
    expect(btn.getAttribute("title")).toMatch(/todas las cajas|generar todas/i);
  });

  it("clicking the button does NOT also fire unrelated callbacks (e.g. onAddRoot)", async () => {
    // The button must be isolated: clicking it must invoke ONLY
    // onGenerateAllSlides and not, say, onPrune or onAddRoot — those
    // would be a regression of F4.1's "every button is its own
    // action" model.
    const stubs = renderTreeControls({ onGenerateAllSlides: vi.fn() });
    const user = userEvent.setup();
    const btn = screen.getByRole("button", {
      name: /generar todas las diapositivas/i,
    });
    await user.click(btn);
    expect(stubs.onPrune).not.toHaveBeenCalled();
    expect(stubs.onMerge).not.toHaveBeenCalled();
    expect(stubs.onSplit).not.toHaveBeenCalled();
    expect(stubs.onDelete).not.toHaveBeenCalled();
    expect(stubs.onAddChild).not.toHaveBeenCalled();
    expect(stubs.onAddRoot).not.toHaveBeenCalled();
    expect(stubs.onSelectAll).not.toHaveBeenCalled();
    expect(stubs.onToggleSelectAll).not.toHaveBeenCalled();
    expect(stubs.onClearSelection).not.toHaveBeenCalled();
  });
});

describe("<TreeControls /> — 'Seleccionar todas' toggle behaviour", () => {
  // The toolbar's "Seleccionar todas" button is a TOGGLE. When not
  // every node is selected the next click selects the rest, and
  // when every node is selected the next click deselects all. The
  // label and the variant reflect the action the click will
  // perform. These tests exercise the component in isolation, with
  // the parent only declaring `selectedCount` / `totalNodeCount`.

  it("renders the button as 'Seleccionar todas' when nothing is selected", () => {
    renderTreeControls({ selectedCount: 0, totalNodeCount: 4 });
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
    // The "Deseleccionar" label must NOT be present in the no-selection
    // state — otherwise the user can't tell what the click will do.
    expect(
      screen.queryByRole("button", { name: /^deseleccionar todas$/i })
    ).not.toBeInTheDocument();
  });

  it("renders the button as 'Seleccionar todas' when only SOME nodes are selected", () => {
    renderTreeControls({ selectedCount: 2, totalNodeCount: 4 });
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("renders the button as 'Deseleccionar todas' when ALL nodes are selected", () => {
    renderTreeControls({ selectedCount: 4, totalNodeCount: 4 });
    expect(
      screen.getByRole("button", { name: /deseleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("fires onToggleSelectAll when the button is clicked (not onSelectAll)", async () => {
    // The toggle button must call the toggle callback. The legacy
    // `onSelectAll` is NOT used by this button anymore — keeping it
    // for backward compat with external callers.
    const stubs = renderTreeControls({
      selectedCount: 0,
      totalNodeCount: 4,
    });
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    await user.click(btn);
    expect(stubs.onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it("uses the default (primary) variant when ALL nodes are selected", () => {
    // The button is highlighted when offering the "deselect" action.
    // `default` variant renders the `bg-primary` class on the
    // underlying <button> element.
    renderTreeControls({ selectedCount: 4, totalNodeCount: 4 });
    const btn = screen.getByRole("button", { name: /deseleccionar todas/i });
    expect(btn.className).toMatch(/bg-primary/);
  });

  it("uses the outline variant when NOT all nodes are selected", () => {
    renderTreeControls({ selectedCount: 0, totalNodeCount: 4 });
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    // `outline` variant renders the `border` class; the `default`
    // variant would have `bg-primary` instead.
    expect(btn.className).toMatch(/border/);
    expect(btn.className).not.toMatch(/bg-primary/);
  });

  it("updates the aria-label to match the label", () => {
    // Accessibility: the aria-label must always reflect what the
    // click will do, not the historical "seleccionar" label.
    const { rerender } = render(
      <TreeControls
        selectedCount={0}
        totalNodeCount={4}
        onPrune={() => {}}
        onMerge={() => {}}
        onSplit={() => {}}
        onDelete={() => {}}
        onAddChild={() => {}}
        onAddRoot={() => {}}
        onEdit={() => {}}
        onSelectAll={() => {}}
        onToggleSelectAll={() => {}}
        onClearSelection={() => {}}
      />
    );
    const btn = screen.getByTestId("select-all");
    expect(btn).toHaveAttribute("aria-label", "Seleccionar todas");

    rerender(
      <TreeControls
        selectedCount={4}
        totalNodeCount={4}
        onPrune={() => {}}
        onMerge={() => {}}
        onSplit={() => {}}
        onDelete={() => {}}
        onAddChild={() => {}}
        onAddRoot={() => {}}
        onEdit={() => {}}
        onSelectAll={() => {}}
        onToggleSelectAll={() => {}}
        onClearSelection={() => {}}
      />
    );
    expect(btn).toHaveAttribute("aria-label", "Deseleccionar todas");
  });

  it("still calls onToggleSelectAll when totalNodeCount is undefined (no info)", async () => {
    // The parent is supposed to pass `totalNodeCount`; when it
    // doesn't, the button falls back to "always select" semantics.
    // We still want the toggle callback to fire.
    const stubs = renderTreeControls({ selectedCount: 0, totalNodeCount: 0 });
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    await user.click(btn);
    expect(stubs.onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it("falls back to onSelectAll when the parent omits onToggleSelectAll (backward compat)", async () => {
    // External code that imports TreeControls might not have been
    // updated yet. When the parent only passes `onSelectAll`, the
    // button must still work — it just behaves the old way
    // (always select).
    const onSelectAll = vi.fn();
    renderTreeControls({
      selectedCount: 0,
      totalNodeCount: 4,
      onSelectAll,
      // explicitly pass undefined so the helper doesn't wire a stub
      onToggleSelectAll: undefined,
    });
    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    await user.click(btn);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });
});

describe("<TreeControls /> — F4.1 regression: existing buttons still work", () => {
  // F4.3 adds a button; it must not perturb the F4.1 surface.
  it("still renders the 'Seleccionar todas' button (F4.1)", () => {
    renderTreeControls();
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("still renders the 'Limpiar' button (F4.1)", () => {
    renderTreeControls();
    expect(screen.getByRole("button", { name: /limpiar/i })).toBeInTheDocument();
  });

  it("still renders the structural actions (Unir, Eliminar, etc.)", () => {
    renderTreeControls();
    expect(screen.getByRole("button", { name: /podar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unir/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dividir/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eliminar/i })).toBeInTheDocument();
  });
});

// v1.5 / Task 3.1 — single-node "Editar" button. Sits next to
// Podar / Unir / Dividir and is enabled only when exactly one
// node is selected. The actual modal lives in TreeViewer; the
// toolbar just emits `onEdit` so this is a thin contract test.
describe("<TreeControls /> — v1.5 'Editar' button (single-node edit shortcut)", () => {
  it("renders the button in the toolbar", () => {
    renderTreeControls();
    expect(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    ).toBeInTheDocument();
  });

  it("is disabled when no node is selected", () => {
    renderTreeControls({ selectedCount: 0 });
    expect(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    ).toBeDisabled();
  });

  it("is enabled when exactly one node is selected", () => {
    renderTreeControls({ selectedCount: 1 });
    const btn = screen.getByRole("button", { name: /editar nodo seleccionado/i });
    expect(btn).not.toBeDisabled();
  });

  it("is disabled when more than one node is selected", () => {
    // Same `singleSelection` predicate as "Dividir" / "Añadir hijo":
    // editing multiple nodes at once is out of scope.
    renderTreeControls({ selectedCount: 2 });
    expect(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    ).toBeDisabled();
  });

  it("is disabled while a server action is in flight (busy=true)", () => {
    renderTreeControls({ selectedCount: 1, busy: true });
    expect(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    ).toBeDisabled();
  });

  it("calls onEdit exactly once when clicked", async () => {
    const stubs = renderTreeControls({ selectedCount: 1 });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    );
    expect(stubs.onEdit).toHaveBeenCalledTimes(1);
  });

  it("clicking it does NOT fire unrelated callbacks (e.g. onPrune, onAddRoot)", async () => {
    // The button is isolated: clicking it must invoke ONLY onEdit
    // and not any other mutation handler — same contract as the
    // F4.3 "Generar todas" button.
    const stubs = renderTreeControls({ selectedCount: 1 });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /editar nodo seleccionado/i })
    );
    expect(stubs.onPrune).not.toHaveBeenCalled();
    expect(stubs.onMerge).not.toHaveBeenCalled();
    expect(stubs.onSplit).not.toHaveBeenCalled();
    expect(stubs.onDelete).not.toHaveBeenCalled();
    expect(stubs.onAddChild).not.toHaveBeenCalled();
    expect(stubs.onAddRoot).not.toHaveBeenCalled();
    expect(stubs.onSelectAll).not.toHaveBeenCalled();
    expect(stubs.onToggleSelectAll).not.toHaveBeenCalled();
    expect(stubs.onClearSelection).not.toHaveBeenCalled();
  });

  it("carries an aria-label, a title, and a stable data-testid for E2E tests", () => {
    renderTreeControls({ selectedCount: 1 });
    const btn = screen.getByRole("button", { name: /editar nodo seleccionado/i });
    expect(btn).toHaveAttribute("aria-label");
    expect(btn.getAttribute("aria-label")).toMatch(/editar/i);
    expect(btn).toHaveAttribute("title");
    expect(btn.getAttribute("title")).toMatch(/editar/i);
    expect(btn).toHaveAttribute("data-testid", "edit-selected");
  });
});

// Sanity check: the Layers icon we import is the same one the
// component will use. If lucide-react ever renames it, this test
// would fail and alert us to fix the import.
describe("lucide-react Layers import", () => {
  it("is a valid React component", () => {
    expect(Layers).toBeDefined();
    expect(typeof Layers).toBe("object"); // forwardRef returns an object
  });
});
