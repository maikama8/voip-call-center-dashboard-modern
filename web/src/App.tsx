import { useState } from "react";
import { ActiveCalls } from "./components/ActiveCalls";
import { AgentBoard } from "./components/AgentBoard";
import { AlertBanner } from "./components/AlertBanner";
import { HourlyChart } from "./components/HourlyChart";
import { KpiStrip } from "./components/KpiStrip";
import { QueueBoard } from "./components/QueueBoard";
import { TopBar } from "./components/TopBar";
import { useTheme } from "./lib/theme";
import { useDashboard, useNow } from "./lib/useDashboard";
import type { AgentStatus } from "./types";

export function App() {
  const { snapshot, status } = useDashboard();
  const { theme, toggle } = useTheme();
  const now = useNow();
  const [queueId, setQueueId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<AgentStatus | "all">("all");
  const timezone = snapshot?.timezone ?? "UTC";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-4 overflow-x-hidden px-4 py-4 md:px-6 md:py-6">
      <TopBar
        status={status}
        source={snapshot?.source ?? null}
        timezone={timezone}
        statsDate={snapshot?.statsDate ?? null}
        now={now}
        theme={theme}
        onToggleTheme={toggle}
      />
      {!snapshot ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-16 text-center text-muted">
          Connecting to the wallboard…
        </p>
      ) : (
        <>
          <KpiStrip
            overall={snapshot.kpis.overall}
            queues={snapshot.queues}
            byQueue={snapshot.kpis.byQueue}
            alerts={snapshot.alerts}
            now={now}
            statsLabel={snapshot.statsLabel}
          />
          <AlertBanner alerts={snapshot.alerts} />
          <QueueBoard
            queues={snapshot.queues}
            kpis={snapshot.kpis.byQueue}
            agents={snapshot.agents}
            now={now}
            maxWaitSeconds={snapshot.rules.maxWaitSeconds}
            selectedId={queueId}
            onSelect={(id) => setQueueId((current) => (current === id ? null : id))}
          />
          <AgentBoard
            agents={snapshot.agents}
            calls={snapshot.calls}
            queues={snapshot.queues}
            now={now}
            statsLabel={snapshot.statsLabel}
            filter={agentFilter}
            onFilter={setAgentFilter}
            queueId={queueId}
          />
          <div className="grid min-w-0 gap-3 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-3">
              <ActiveCalls
                calls={snapshot.calls}
                agents={snapshot.agents}
                queues={snapshot.queues}
                now={now}
                queueId={queueId}
              />
            </div>
            <div className="min-w-0 xl:col-span-2">
              <HourlyChart
                buckets={snapshot.kpis.overall.callsPerHour}
                statsDate={snapshot.statsDate}
                timezone={snapshot.timezone}
                now={now}
              />
            </div>
          </div>
          <footer className="pb-2 text-xs text-muted">
            {snapshot.statsLabel} ({snapshot.statsDate}, {snapshot.timezone}). Service level ignores abandons under{" "}
            {snapshot.rules.shortAbandonSeconds}s. Alerts start at {snapshot.rules.minOfferedForAlert} offered calls,
            abandon rate above {snapshot.rules.maxAbandonPercent}%, or a wait past {snapshot.rules.maxWaitSeconds}s.
            {snapshot.source === "ami"
              ? " AMI figures are what this process has seen since it connected. PBX counters are Asterisk's own, since the queue was loaded."
              : " The simulated source is standing in for the PBX."}
          </footer>
        </>
      )}
    </div>
  );
}
