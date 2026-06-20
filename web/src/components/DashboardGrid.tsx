import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  WIDTH_CYCLE,
  WIDTH_LABEL,
  WIDTH_SPAN_CLASS,
  cardTitle,
  type CardWidth,
  type DashboardLayout,
} from "../lib/dashboardLayout";

interface Props {
  layout: DashboardLayout;
  editing: boolean;
  onChange: (layout: DashboardLayout) => void;
  renderCard: (id: string) => ReactNode;
}

/** The dashboard cards as a reorderable, resizable, hide/show grid. In edit mode
 * each card gets a drag handle, a width cycler (⅓ ½ ⅔ Full) and a hide button;
 * hidden cards collect in a tray you can re-add from. Outside edit mode it's just
 * the laid-out cards. Mobile is always a single full-width column. */
export default function DashboardGrid({ layout, editing, onChange, renderCard }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = layout.cards.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange({ ...layout, cards: arrayMove(layout.cards, from, to) });
  }

  function setWidth(id: string, width: CardWidth) {
    onChange({ ...layout, cards: layout.cards.map((c) => (c.id === id ? { ...c, width } : c)) });
  }

  function hide(id: string) {
    onChange({
      cards: layout.cards.filter((c) => c.id !== id),
      hidden: [...layout.hidden, id],
    });
  }

  function show(id: string) {
    if (layout.cards.some((c) => c.id === id)) return;
    onChange({
      cards: [...layout.cards, { id, width: "full" }],
      hidden: layout.hidden.filter((h) => h !== id),
    });
  }

  const grid = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-6">
      {layout.cards.map((card) => (
        <SortableCard
          key={card.id}
          card={card}
          editing={editing}
          onCycleWidth={() =>
            setWidth(card.id, WIDTH_CYCLE[(WIDTH_CYCLE.indexOf(card.width) + 1) % WIDTH_CYCLE.length])
          }
          onHide={() => hide(card.id)}
        >
          {renderCard(card.id)}
        </SortableCard>
      ))}
    </div>
  );

  if (!editing) return grid;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={layout.cards.map((c) => c.id)} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
      {layout.hidden.length > 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-neutral-700 bg-neutral-900/40 px-4 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Hidden cards</div>
          <div className="flex flex-wrap gap-2">
            {layout.hidden.map((id) => (
              <button
                key={id}
                onClick={() => show(id)}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:border-indigo-500 hover:text-indigo-200"
              >
                + {cardTitle(id)}
              </button>
            ))}
          </div>
        </div>
      )}
    </DndContext>
  );
}

function SortableCard({
  card,
  editing,
  onCycleWidth,
  onHide,
  children,
}: {
  card: { id: string; width: CardWidth };
  editing: boolean;
  onCycleWidth: () => void;
  onHide: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  } as const;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${WIDTH_SPAN_CLASS[card.width]} ${isDragging ? "opacity-70" : ""}`}
    >
      {editing && (
        <div className="absolute -top-3 right-2 z-20 flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 px-1 py-0.5 shadow-lg">
          <button
            onClick={onCycleWidth}
            title="Change width"
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            {WIDTH_LABEL[card.width]}
          </button>
          <button
            onClick={onHide}
            title="Hide card"
            aria-label={`Hide ${cardTitle(card.id)}`}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-rose-400"
          >
            ✕
          </button>
          <button
            {...attributes}
            {...listeners}
            title="Drag to reorder"
            aria-label={`Drag ${cardTitle(card.id)} to reorder`}
            className="cursor-grab touch-none rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 active:cursor-grabbing"
          >
            ⠿
          </button>
        </div>
      )}
      {/* In edit mode a subtle ring + dimmed interactions communicate "arrange me". */}
      <div className={editing ? "pointer-events-none rounded-2xl ring-2 ring-indigo-500/30" : ""}>
        {children}
      </div>
    </div>
  );
}
