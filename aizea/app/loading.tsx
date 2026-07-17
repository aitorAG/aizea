export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Title header */}
      <div className="space-y-2">
        <div className="h-9 w-40 bg-muted rounded-lg animate-pulse" />
        <div className="h-5 w-64 bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end">
        <div className="h-9 w-32 bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Course cards */}
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border border-border p-4"
          >
            <div className="h-10 w-10 shrink-0 bg-muted rounded-lg animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-1/3 bg-muted rounded-lg animate-pulse" />
              <div className="flex items-center gap-2">
                <div className="h-5 w-24 bg-muted rounded-lg animate-pulse" />
                <div className="h-5 w-24 bg-muted rounded-lg animate-pulse" />
                <div className="h-4 w-28 bg-muted rounded-lg animate-pulse" />
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="h-8 w-16 bg-muted rounded-lg animate-pulse" />
              <div className="h-8 w-8 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
