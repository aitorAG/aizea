// @vitest-environment jsdom
//
// InlineTreeNodeEditor — inline edit form for a freshly-created
// tree node.
//
// What is tested:
//   - Read-only mode: the editor renders the current name + summary
//     pre-filled in the inputs
//   - autoFocus: the description input is focused on mount (the
//     user can immediately start typing the description)
//   - Save on Enter: pressing Enter in either field calls onSave
//     with the trimmed name + summary
//   - Save on blur: blurring the description field also calls onSave
//   - Save shows "Guardado" indicator briefly
//   - Empty name is rejected (no onSave call, error message shown)
//   - Escape reverts the draft to the original values
//   - Stop propagation: clicks inside the editor do NOT bubble up
//     to the parent (regression guard for F4.1 body-click selection)
//
// What is NOT tested here (covered by Playwright):
//   - The persistence of the values (the server action is mocked;
//     the e2e test verifies the round-trip through Prisma)
//   - The TTL / recently-added expiry (covered by the tree-client
//     test in tests/integration).

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineTreeNodeEditor } from "@/components/TreeViewer/InlineTreeNodeEditor";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DEFAULT_PROPS = {
  initialName: "Nuevo nodo",
  initialSummary: null as string | null,
  onSave: vi.fn().mockResolvedValue(undefined),
};

describe("<InlineTreeNodeEditor />", () => {
  it("renders an input for the name pre-filled with the initial value", () => {
    render(<InlineTreeNodeEditor {...DEFAULT_PROPS} initialName="Termodinámica" />);
    const nameInput = screen.getByTestId("inline-tree-node-name-input");
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue("Termodinámica");
  });

  it("renders a description input pre-filled with the initial summary", () => {
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="X"
        initialSummary="Capítulo sobre energía y entropía"
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    expect(summaryInput).toBeInTheDocument();
    expect(summaryInput).toHaveValue("Capítulo sobre energía y entropía");
  });

  it("renders the description placeholder when summary is null", () => {
    render(<InlineTreeNodeEditor {...DEFAULT_PROPS} initialSummary={null} />);
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    expect(summaryInput).toHaveAttribute(
      "placeholder",
      "Describe el contenido de esta caja"
    );
  });

  it("autoFocus: the description input is focused on mount", async () => {
    render(<InlineTreeNodeEditor {...DEFAULT_PROPS} />);
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    // React 19 + jsdom: focus is async, give it a tick.
    await waitFor(() => {
      expect(summaryInput).toHaveFocus();
    });
  });

  it("typing in the description and pressing Enter calls onSave with trimmed values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="Capítulo A"
        initialSummary={null}
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.type(summaryInput, "Leyes de Newton");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith({
      name: "Capítulo A",
      summary: "Leyes de Newton",
    });
  });

  it("typing in the name and pressing Enter calls onSave with the new name", async () => {
    // Enter on the name field saves the current draft. The user
    // can keep editing — the editor stays mounted until the
    // parent removes the id from the "recently added" set.
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="X"
        initialSummary="algo"
        onSave={onSave}
      />
    );
    const nameInput = screen.getByTestId("inline-tree-node-name-input");
    await user.click(nameInput);
    // Append to the existing name (no clear) — userEvent.clear()
    // on controlled inputs has known quirks in v14 + jsdom.
    await user.type(nameInput, " 2");
    await user.keyboard("{Enter}");

    // The contract: onSave was called AT LEAST once with the new
    // values. We don't pin the exact call count because some
    // userEvent paths trigger an additional save cycle (the
    // `dirty` blur-save runs when the input loses focus during
    // userEvent's teardown). The important contract is that the
    // last call carries the user's intended values.
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(onSave).toHaveBeenLastCalledWith({
      name: "X 2",
      summary: "algo",
    });
  });

  it("typing in the description and blurring the field calls onSave", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="Capítulo A"
        initialSummary={null}
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.click(summaryInput);
    await user.type(summaryInput, "Resumen del capítulo");
    // Blur the description by clicking on a different element.
    await user.click(document.body);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith({
      name: "Capítulo A",
      summary: "Resumen del capítulo",
    });
  });

  it("onSave receives summary=null when the description is empty", async () => {
    // We test the "empty description → null summary" contract by
    // passing initialSummary="" and pressing Enter without any
    // additional typing. The component trims the empty string to
    // null before calling onSave.
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="Capítulo A"
        initialSummary=""
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.click(summaryInput);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(onSave).toHaveBeenLastCalledWith({
      name: "Capítulo A",
      summary: null,
    });
  });

  it("onSave receives the trimmed name and summary (whitespace stripped)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="  Capítulo con espacios  "
        initialSummary="  descripción con espacios  "
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    // No additional typing — the trimmed initial values should
    // be passed straight through.
    await user.click(summaryInput);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith({
      name: "Capítulo con espacios",
      summary: "descripción con espacios",
    });
  });

  it("empty name: pressing Enter shows an error and does NOT call onSave", async () => {
    // Force the name to empty by passing it as initialName=""
    // and then immediately pressing Enter on the description
    // field. This is a cleaner way to test the empty-name guard
    // than trying to clear a controlled input via userEvent.
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        initialName=""
        initialSummary="algo"
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.click(summaryInput);
    await user.keyboard("{Enter}");

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("inline-tree-node-error")).toBeInTheDocument();
  });

  it("shows the 'Guardado' indicator briefly after a successful save", async () => {
    // We test the indicator's appearance with REAL timers (no
    // fake timers), which avoids the well-known userEvent v14 +
    // fake timers interaction issues. The timer expiry is
    // covered by the component's internal useEffect cleanup.
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="Capítulo A"
        initialSummary={null}
        onSave={onSave}
      />
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.type(summaryInput, "Resumen");
    await user.keyboard("{Enter}");

    // The indicator appears immediately after a successful save.
    await waitFor(() => {
      expect(screen.getByTestId("inline-tree-node-saved")).toBeInTheDocument();
    });
  });

  it("Escape reverts the draft to the initial values (and does NOT save)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineTreeNodeEditor
        {...DEFAULT_PROPS}
        initialName="Nombre original"
        initialSummary="Resumen original"
        onSave={onSave}
      />
    );
    const nameInput = screen.getByTestId("inline-tree-node-name-input");
    // Append to the existing values — avoids user.clear() which
    // has known issues with controlled inputs in v14 + jsdom.
    await user.click(nameInput);
    await user.type(nameInput, " BORRADOR");

    // Focus the summary and append, then press Escape.
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.click(summaryInput);
    await user.type(summaryInput, " BORRADOR DESC");
    await user.keyboard("{Escape}");

    // The Escape handler reverts the inputs to the initial values
    // and does NOT call onSave.
    await waitFor(() => {
      expect(nameInput).toHaveValue("Nombre original");
      expect(summaryInput).toHaveValue("Resumen original");
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clicking inside the editor does NOT propagate to the parent (F4.1 body-click guard)", async () => {
    // We wrap the editor in a parent that records click events
    // bubbling up. Clicks on the editor's inputs MUST NOT bubble
    // — otherwise ReactFlow's body click would also fire and the
    // F4.1 selection model would break for new nodes.
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick} data-testid="parent">
        <InlineTreeNodeEditor {...DEFAULT_PROPS} initialName="X" />
      </div>
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await userEvent.click(summaryInput);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
