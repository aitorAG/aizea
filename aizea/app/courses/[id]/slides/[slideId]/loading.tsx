export default function SlideDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="h-5 w-64 bg-muted rounded-lg animate-pulse" />

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-5 w-8 bg-muted rounded-lg animate-pulse" />
            <div className="h-7 w-56 bg-muted rounded-lg animate-pulse" />
          </div>
          <div className="h-4 w-80 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="flex shrink-0 gap-2">
          <div className="h-8 w-32 bg-muted rounded-lg animate-pulse" />
          <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[55fr_45fr]">
        {/* LEFT: Preview + Design Instructions */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 bg-muted rounded-lg animate-pulse" />
              <div className="h-8 w-8 bg-muted rounded-lg animate-pulse" />
            </div>
            <div className="aspect-video bg-muted rounded-lg animate-pulse" />
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="h-5 w-40 bg-muted rounded-lg animate-pulse" />
            <div className="h-4 w-72 bg-muted rounded-lg animate-pulse" />
            <div className="h-24 w-full bg-muted rounded-lg animate-pulse" />
            <div className="h-8 w-full bg-muted rounded-lg animate-pulse" />
          </div>
        </div>

        {/* RIGHT: Boxes */}
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-5 w-28 bg-muted rounded-lg animate-pulse" />
                <div className="h-7 w-16 bg-muted rounded-lg animate-pulse" />
              </div>
              <div className="h-20 w-full bg-muted rounded-lg animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
