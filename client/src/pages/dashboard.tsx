import { WIDGETS, type WidgetSize } from "@/widgets/registry";
import { WidgetFrame } from "@/widgets/WidgetFrame";

// One size grid for every card: 1 column on phones, 6 at md, 12 at xl.
// Tailwind needs literal class names, hence the lookup tables.
const COLS: Record<WidgetSize["w"], string> = {
  3: "md:col-span-3 xl:col-span-3",
  4: "md:col-span-3 xl:col-span-4",
  6: "md:col-span-6 xl:col-span-6",
  8: "md:col-span-6 xl:col-span-8",
  12: "md:col-span-6 xl:col-span-12",
};
const ROWS: Record<WidgetSize["h"], string> = { 1: "", 2: "md:row-span-2" };

export default function Dashboard() {
  return (
    <div className="grid grid-cols-1 gap-4 md:auto-rows-[minmax(9.5rem,auto)] md:grid-cols-6 xl:grid-cols-12">
      {WIDGETS.map(({ id, title, icon, defaultSize, component: Body }) => (
        <WidgetFrame key={id} id={id} title={title} icon={icon} className={`${COLS[defaultSize.w]} ${ROWS[defaultSize.h]}`}>
          <Body />
        </WidgetFrame>
      ))}
    </div>
  );
}
