"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { SlideCard } from "@/components/slide-card";
import type { SlideOutline } from "@/lib/types";

interface SortableSlideItemProps {
  slide: SlideOutline;
  onEdit: (id: string, title: string, description: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function SortableSlideItem({ slide, onEdit, onDelete }: SortableSlideItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: slide.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:cursor-grabbing"
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <SlideCard
          id={slide.id}
          order={slide.order}
          title={slide.title}
          description={slide.description}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

interface SlideListProps {
  slides: SlideOutline[];
  onReorder: (reorderedSlides: SlideOutline[]) => Promise<void>;
  onEditSlide: (id: string, title: string, description: string) => Promise<void>;
  onDeleteSlide: (id: string) => Promise<void>;
}

function SlideList({ slides, onReorder, onEditSlide, onDeleteSlide }: SlideListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      const oldIndex = slides.findIndex((s) => s.id === active.id);
      const newIndex = slides.findIndex((s) => s.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...slides];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const updated = reordered.map((s, i) => ({ ...s, order: i + 1 }));
      await onReorder(updated);
    },
    [slides, onReorder]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {slides.map((slide) => (
            <SortableSlideItem
              key={slide.id}
              slide={slide}
              onEdit={onEditSlide}
              onDelete={onDeleteSlide}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export { SlideList };
export type { SlideListProps };