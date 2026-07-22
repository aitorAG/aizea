// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks for server-side data fetching -------------------------------

const mockCourse = {
  id: "course-1",
  name: "Termodinámica 101",
  nodes: [
    {
      id: "root-1",
      courseId: "course-1",
      parentId: null,
      name: "Termodinámica",
      summary: "Capítulo raíz",
      depth: 0,
      isLeaf: false,
      version: 1,
      sourceMaterialId: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "child-1",
      courseId: "course-1",
      parentId: "root-1",
      name: "Primera ley",
      summary: null,
      depth: 1,
      isLeaf: true,
      version: 1,
      sourceMaterialId: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
};

const mockEmptyCourse = {
  id: "course-2",
  name: "Curso sin árbol",
  nodes: [],
};

const mockGetCourseTree = vi.fn();
const mockGetJobStatus = vi.fn();
const mockStartPipeline = vi.fn();
const mockRouterRefresh = vi.fn();

vi.mock("@/lib/actions/tree", () => ({
  getCourseTreeAction: (...args: unknown[]) => mockGetCourseTree(...args),
}));

vi.mock("@/lib/actions/pipeline", () => ({
  getJobStatusAction: (...args: unknown[]) => mockGetJobStatus(...args),
  startPipelineAction: (...args: unknown[]) => mockStartPipeline(...args),
}));

vi.mock("@/lib/actions/slide", () => ({
  createSlide: vi.fn().mockResolvedValue({
    ok: true,
    id: "new-slide-1",
    title: "T1",
    description: "",
    order: 0,
  }),
}));

// Mock the TreeViewer to keep this test focused on the page, not on the
// canvas (which has its own dedicated test file). The mock keeps its own
// selection set and exposes a "generate" button that fires the
// onGenerateSlides callback with the selected ids, mirroring how the
// real TreeViewer behaves when the user clicks the "Generar diapositivas"
// floating action button.
import { useState as useMockState } from "react";

vi.mock("@/components/TreeViewer/TreeViewer", () => {
  function MockTreeViewer({
    nodes,
    onChange,
    onGenerateSlides,
  }: {
    nodes: Array<{ id: string; name: string }>;
    onChange: (n: unknown) => void;
    onGenerateSlides?: (ids: string[]) => void;
  }) {
    const [selected, setSelected] = useMockState<Set<string>>(() => new Set());
    const toggle = (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      onChange(nodes);
    };
    return (
      <div data-testid="tree-viewer" data-nodes={String(nodes.length)}>
        {nodes.map((n) => (
          <button
            key={n.id}
            data-testid={`page-node-${n.id}`}
            data-selected={selected.has(n.id) ? "true" : "false"}
            onClick={() => toggle(n.id)}
          >
            {n.name}
          </button>
        ))}
        {onGenerateSlides && selected.size > 0 && (
          <button
            data-testid="tree-generate"
            onClick={() => onGenerateSlides(Array.from(selected))}
          >
            generate
          </button>
        )}
      </div>
    );
  }
  return { TreeViewer: MockTreeViewer };
});

vi.mock("@/components/PipelineProgress/PipelineProgress", () => ({
  PipelineProgress: () => <div data-testid="pipeline-progress" />,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ push: vi.fn(), refresh: mockRouterRefresh }),
}));

// Mock the server-side db / action calls used by the page.
vi.mock("@/lib/db", () => ({
  db: {
    course: {
      findUnique: vi.fn(),
    },
    topicNode: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { TreePageClient } from "@/app/courses/[id]/tree/tree-client";

beforeEach(() => {
  vi.clearAllMocks();
  mockStartPipeline.mockResolvedValue({
    ok: true,
    empty: false,
    jobs: {
      segmentationJobId: "job-seg",
      extractionJobId: "job-ext",
      integrationJobId: "job-int",
      treeBuildingJobId: "job-tree",
    },
  });
  mockGetJobStatus.mockResolvedValue({
    ok: true,
    job: {
      id: "job-99",
      phase: "extraction",
      status: "running",
      progress: 0,
      total: 100,
      currentStep: null,
      error: null,
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("<TreePageClient />", () => {
  it("renders the course name in the header", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue(
      mockCourse.nodes as never
    );
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: mockCourse.nodes });

    render(
      <TreePageClient
        courseId="course-1"
        courseName="Termodinámica 101"
        initialNodes={mockCourse.nodes as never}
      />
    );
    expect(screen.getByText("Termodinámica 101")).toBeInTheDocument();
  });

  it("renders the TreeViewer with the loaded nodes", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue(
      mockCourse.nodes as never
    );
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: mockCourse.nodes });

    render(
      <TreePageClient
        courseId="course-1"
        courseName="Termodinámica 101"
        initialNodes={mockCourse.nodes as never}
      />
    );
    const viewer = await screen.findByTestId("tree-viewer");
    expect(viewer).toHaveAttribute("data-nodes", "2");
  });

  it("shows an empty-state message when the tree is empty", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockEmptyCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue([] as never);
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: [] });

    render(
      <TreePageClient
        courseId="course-2"
        courseName="Curso sin árbol"
        initialNodes={[]}
      />
    );
    await waitFor(() => {
      expect(
        screen.getByText(/[áa]rbol.*(vac[íi]o|generar)/i)
      ).toBeInTheDocument();
    });
  });

  it("renders the PipelineProgress when a job is in progress", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue(
      mockCourse.nodes as never
    );
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: mockCourse.nodes });

    render(
      <TreePageClient
        courseId="course-1"
        courseName="Termodinámica 101"
        initialNodes={mockCourse.nodes as never}
        activeJobId="job-99"
        activeJobPhase="extraction"
      />
    );
    expect(screen.getByTestId("pipeline-progress")).toBeInTheDocument();
  });

  it("does not render PipelineProgress when no job is active", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue(
      mockCourse.nodes as never
    );
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: mockCourse.nodes });

    render(
      <TreePageClient
        courseId="course-1"
        courseName="Termodinámica 101"
        initialNodes={mockCourse.nodes as never}
      />
    );
    expect(screen.queryByTestId("pipeline-progress")).toBeNull();
  });

  it("renders a 'Generar slides desde selección' button when selection exists", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue(
      mockCourse.nodes as never
    );
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: mockCourse.nodes });

    const user = userEvent.setup();
    render(
      <TreePageClient
        courseId="course-1"
        courseName="Termodinámica 101"
        initialNodes={mockCourse.nodes as never}
      />
    );
    // Clicking a node in the mocked TreeViewer selects it. The mock
    // exposes an internal "tree-generate" button that the page can
    // detect; in the real app, the page renders its own "Generar N
    // diapositivas" button once `onGenerateSlides` has fired.
    await user.click(screen.getByTestId("page-node-root-1"));
    await user.click(screen.getByTestId("tree-generate"));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /generar.*diapositiva/i })
      ).toBeInTheDocument();
    });
  });

  // v1.5 / Task 2.4 — regression guard for "el front no se actualiza
  // de forma dinámica". Clicking "Generar árbol" on the empty state
  // must call `router.refresh()` so the server component re-runs
  // and the freshly-generated TopicNode rows flow into the client.
  it("calls router.refresh() when 'Generar árbol' is clicked (auto-refresh fix)", async () => {
    vi.mocked(db.course.findUnique).mockResolvedValue(mockEmptyCourse as never);
    vi.mocked(db.topicNode.findMany).mockResolvedValue([] as never);
    mockGetCourseTree.mockResolvedValue({ ok: true, tree: [] });

    const user = userEvent.setup();
    render(
      <TreePageClient
        courseId="course-2"
        courseName="Curso sin árbol"
        initialNodes={[]}
      />
    );
    // Sanity check: the empty state is shown with the "Generar
    // árbol" button visible.
    const generateButton = await screen.findByRole("button", {
      name: /generar.*árbol|generar.*arbol/i,
    });
    expect(mockRouterRefresh).not.toHaveBeenCalled();
    await user.click(generateButton);
    // The handler is async — wait for both the server action and
    // the subsequent router.refresh() to fire.
    await waitFor(() => {
      expect(mockStartPipeline).toHaveBeenCalledWith("course-2");
    });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
  });
});
