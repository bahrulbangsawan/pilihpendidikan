import type { DragEndEvent, DraggableAttributes } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MinusIcon, Plus, PlusIcon, X } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "../lib/utils";
import { Accordion, AccordionContent, AccordionItem } from "../ui/accordion";
import { Button } from "../ui/button";

interface SectionListProps<T extends { id: string }> {
  title: string;
  onTitleChange?: (value: string) => void;
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
  /** Accessible name and hover hint for each row's remove ×. */
  removeLabel?: string;
  /** Accessible name and hover hint for each row's drag grip. */
  reorderLabel?: string;
  triggerExtra?: (entry: T, index: number) => ReactNode;
}

// Drag-to-reorder is direct feedback, so it keeps moving (DESIGN.md §
// Deviations), on the system duration and curve rather than dnd-kit's
// `250ms ease`.
const SORTABLE_TRANSITION = {
  duration: 150,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// Each sortable wrapper is one hairline row of the list.
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
  } = useSortable({ id, transition: SORTABLE_TRANSITION });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      className={cn(
        "border-line border-b bg-card last:border-b-0",
        isDragging && "relative z-10"
      )}
      ref={setNodeRef}
      style={style}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/**
 * An editor list of entries (Zedative): an inline-editable section title,
 * then hairline accordion rows on `bg-2` with a drag grip, the entry
 * summary, an error dot and a remove ×, then an outline "add" button.
 */
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
  removeLabel = "Remove",
  reorderLabel = "Drag to reorder",
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {titleIcon && (
            <span className="inline-flex shrink-0 items-center text-muted-foreground">
              {titleIcon}
            </span>
          )}
          <input
            aria-label={placeholder}
            className="type-subtitle weight-semibold field-touch -ml-1.5 h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-standard placeholder:text-muted-foreground hover:border-input read-only:hover:border-transparent focus-visible:border-ring focus-visible:bg-card/60 focus-visible:ring-3 focus-visible:ring-ring/20"
            onChange={(e) => onTitleChange?.(e.target.value)}
            placeholder={placeholder}
            readOnly={!onTitleChange}
            value={title}
          />
        </div>
        {titleExtra}
      </div>
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
              className="border border-line bg-card"
              onValueChange={setOpenItems}
              type="multiple"
              value={openItems}
            >
              {items.map((entry, index) => (
                <SortableItem id={entry.id} key={entry.id}>
                  {({ attributes, listeners }) => (
                    <AccordionItem className="border-b-0" value={entry.id}>
                      {/* Three sibling controls in the row header: the drag
                          grip, the trigger (summary, extra, error dot, +/−)
                          and the remove ×. None is nested in another, so
                          each keeps its own name and focus stop. */}
                      <AccordionPrimitive.Header className="flex items-center gap-1 pr-2 pl-1">
                        <button
                          aria-label={reorderLabel}
                          className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none transition-[background-color,color] duration-150 ease-standard hover:bg-pane/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2 active:cursor-grabbing"
                          title={reorderLabel}
                          type="button"
                          {...attributes}
                          {...listeners}
                        >
                          <GripVertical
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </button>
                        <AccordionPrimitive.Trigger
                          className="group/accordion-trigger type-body weight-semibold flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
                          data-slot="accordion-trigger"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {summary(entry, index)}
                          </span>
                          {triggerExtra?.(entry, index)}
                          {hasError?.(entry) && (
                            <span
                              aria-hidden="true"
                              className="size-1.5 shrink-0 rounded-full bg-destructive"
                            />
                          )}
                          <PlusIcon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground group-aria-expanded/accordion-trigger:hidden"
                          />
                          <MinusIcon
                            aria-hidden="true"
                            className="hidden size-4 shrink-0 text-muted-foreground group-aria-expanded/accordion-trigger:block"
                          />
                        </AccordionPrimitive.Trigger>
                        <button
                          aria-label={removeLabel}
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-[background-color,color] duration-150 ease-standard hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid focus-visible:outline-offset-2"
                          onClick={() => onRemove(entry.id)}
                          title={removeLabel}
                          type="button"
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </AccordionPrimitive.Header>
                      <AccordionContent className="px-3 pt-1">
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
      <Button
        className="self-start"
        onClick={onAdd}
        size="sm"
        variant="outline"
      >
        <Plus data-icon="inline-start" />
        {addLabel}
      </Button>
    </section>
  );
}
