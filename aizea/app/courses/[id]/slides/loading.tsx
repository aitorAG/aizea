export default function SlidesLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-5 w-40 bg-muted rounded-lg animate-pulse" />
        <div className="h-8 w-64 bg-muted rounded-lg animate-pulse" />
        <div className="h-5 w-48 bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Slide block rows */}
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex items-stretch gap-1"
          >
            <div className="my-1 h-6 w-6 bg-muted rounded-lg animate-pulse" />
            <div className="min-w-0 flex-1 rounded-lg border border-border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-5 w-1/3 bg-muted rounded-lg animate-pulse" />
                <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
              </div>
              <div className="h-4 w-2/3 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Bottom controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
        <div className="h-8 w-28 bg-muted rounded-lg animate-pulse" />
        <div className="h-8 w-36 bg-muted rounded-lg animate-pulse" />
        <div className="h-8 w-24 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
