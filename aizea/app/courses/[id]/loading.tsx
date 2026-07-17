export default function CourseDetailLoading() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-5 w-32 bg-muted rounded-lg animate-pulse" />
          <div className="h-8 w-56 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="h-9 w-28 bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          {/* Materials section */}
          <section className="space-y-3">
            <div className="h-6 w-32 bg-muted rounded-lg animate-pulse" />
            <div className="h-32 w-full bg-muted rounded-lg animate-pulse" />
            <div className="space-y-2">
              <div className="h-12 w-full bg-muted rounded-lg animate-pulse" />
              <div className="h-12 w-full bg-muted rounded-lg animate-pulse" />
            </div>
          </section>

          {/* Slides section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-6 w-48 bg-muted rounded-lg animate-pulse" />
              <div className="h-8 w-40 bg-muted rounded-lg animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-16 w-full bg-muted rounded-lg animate-pulse" />
              <div className="h-16 w-full bg-muted rounded-lg animate-pulse" />
              <div className="h-16 w-full bg-muted rounded-lg animate-pulse" />
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Figures section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-6 w-24 bg-muted rounded-lg animate-pulse" />
              <div className="h-8 w-28 bg-muted rounded-lg animate-pulse" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="aspect-square bg-muted rounded-lg animate-pulse" />
              <div className="aspect-square bg-muted rounded-lg animate-pulse" />
              <div className="aspect-square bg-muted rounded-lg animate-pulse" />
              <div className="aspect-square bg-muted rounded-lg animate-pulse" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
