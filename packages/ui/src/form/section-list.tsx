import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DraggableAttributes,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Button } from "../ui/button";

interface SectionListProps<T extends { id: string }> {
  title: string;
  onTitleChange: (value: string) => void;
  placeholder: string;
  items: T[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onReorder?: (items: T[]) => void;
  addLabel: string;
  summary: (entry: T, index: number) => string;
  hasError?: (entry: T) => boolean;
  renderContent: (entry: T, index: number) => ReactNode;
  titleExtra?: ReactNode;
  titleIcon?: ReactNode;
  triggerExtra?: (entry: T, index: number) => ReactNode;
}

import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (dragHandleProps: {
    attributes: DraggableAttributes;
    listeners: SyntheticListenerMap | undefined;
  }) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}

export function SectionList<T extends { id: string }>({
  title,
  onTitleChange,
  placeholder,
  items,
  onAdd,
  onRemove,
  onReorder,
  addLabel,
  summary,
  hasError,
  renderContent,
  titleExtra,
  titleIcon,
  triggerExtra,
}: SectionListProps<T>) {
  const [openItems, setOpenItems] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) {
      return;
    }
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <section>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {titleIcon && (
            <span className="inline-flex shrink-0 items-center">
              {titleIcon}
            </span>
          )}
          <input
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent font-medium text-base outline-none placeholder:text-muted-foreground md:text-sm"
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={placeholder}
            value={title}
          />
        </div>
        {titleExtra}
      </div>
      <div className="mt-3 space-y-3">
        {items.length > 0 && (
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <SortableContext
              items={items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <Accordion
                onValueChange={setOpenItems}
                type="multiple"
                value={openItems}
              >
                {items.map((entry, index) => (
                  <SortableItem id={entry.id} key={entry.id}>
                    {({ attributes, listeners }) => (
                      <AccordionItem value={entry.id}>
                        <AccordionTrigger className="min-w-0 items-center gap-2">
                          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle inside button — dnd-kit provides keyboard a11y via attributes/listeners */}
                          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag handle inside button — dnd-kit provides keyboard a11y via attributes/listeners */}
                          {/* biome-ignore lint/a11y/useKeyWithClickEvents: spread keyboard handlers come from dnd-kit listeners */}
                          <span
                            className="inline-flex shrink-0 cursor-grab items-center text-muted-foreground/50 hover:text-muted-foreground"
                            {...attributes}
                            {...listeners}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <GripVertical className="size-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {summary(entry, index)}
                          </span>
                          {triggerExtra?.(entry, index)}
                          {hasError?.(entry) && (
                            <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
                          )}
                          {/* biome-ignore lint/a11y/useKeyWithClickEvents: visual button nested in parent <button>; keyboard delete handled by accordion remove flow */}
                          {/* biome-ignore lint/a11y/useSemanticElements: cannot nest <button> inside AccordionTrigger which is already a button */}
                          <span
                            className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground md:size-5"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(entry.id);
                            }}
                            role="button"
                            tabIndex={-1}
                          >
                            <X className="size-4 md:size-3" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderContent(entry, index)}
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </SortableItem>
                ))}
              </Accordion>
            </SortableContext>
          </DndContext>
        )}
        <Button onClick={onAdd} size="sm" variant="outline">
          <Plus /> {addLabel}
        </Button>
      </div>
    </section>
  );
}
