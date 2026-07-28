import { OBJECT_COLORS, OBJECT_COLOR_FALLBACK } from "@/lib/constants";

/**
 * Five-segment distribution bar, sized with flex-grow set to the raw counts —
 * the same trick the Evidence page uses (field-triage.md:180-193), which means
 * the bar is a true proportional view with no arithmetic in the component.
 */
export function HealthBar({
  dead,
  low,
  partial,
  healthy,
  noData,
}: {
  dead: number;
  low: number;
  partial: number;
  healthy: number;
  noData: number;
}) {
  const total = dead + low + partial + healthy + noData;

  if (total === 0) {
    return (
      <div className="health-bar" title="No custom fields — nothing to triage">
        <div className="seg seg-none" style={{ flexGrow: 1 }} />
      </div>
    );
  }

  return (
    <div
      className="health-bar"
      title={`${dead} dead · ${low} low · ${partial} partial · ${healthy} healthy · ${noData} no data`}
    >
      <div className="seg seg-dead" style={{ flexGrow: dead }} />
      <div className="seg seg-low" style={{ flexGrow: low }} />
      <div className="seg seg-partial" style={{ flexGrow: partial }} />
      <div className="seg seg-healthy" style={{ flexGrow: healthy }} />
      <div className="seg seg-nodata" style={{ flexGrow: noData }} />
    </div>
  );
}

export function ObjectDot({ object }: { object: string }) {
  return (
    <span
      className="obj-dot"
      style={{ backgroundColor: OBJECT_COLORS[object] ?? OBJECT_COLOR_FALLBACK }}
    />
  );
}

export function HealthLegend() {
  return (
    <p className="legend">
      Health bar (custom fields only): <span className="legend-chip seg-dead" /> dead (&lt;1%
      populated)
      <span className="legend-chip seg-low" /> low (&lt;10%)
      <span className="legend-chip seg-partial" /> partial (&lt;80%)
      <span className="legend-chip seg-healthy" /> healthy
      <span className="legend-chip seg-nodata" /> no data (no records)
      <span className="legend-chip seg-none" /> no custom fields
    </p>
  );
}
