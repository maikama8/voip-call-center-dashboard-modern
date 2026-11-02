import type { Alert } from "../types";

export function AlertBanner({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-accent-soft px-4 py-3 text-sm text-accent">
        No service-level, abandon, or wait alerts.
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-live="polite">
      {alerts.map((alert) => {
        const critical = alert.severity === "critical";
        return (
          <li
            key={alert.id}
            className={`rounded-2xl border px-4 py-3 text-sm ${
              critical
                ? "border-danger/40 bg-danger-soft text-danger"
                : "border-warn/40 bg-warn-soft text-warn"
            }`}
          >
            <span className="mr-2 font-semibold uppercase tracking-[0.12em] text-xs">
              {critical ? "Critical" : "Watch"}
            </span>
            {alert.message}
          </li>
        );
      })}
    </ul>
  );
}
