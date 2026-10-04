import { useEffect, useState } from 'react';
import { incidentApi, type IncidentEvent, type IncidentRecord, type MonitoringCheck } from '../services/api';
import { ErrorState, formatDate, Icon, PageIntro, Severity, SkeletonRows, StateBox, Status, VitalityMascotBanner } from '../components/ui';

export default function LogsPage({ refreshKey, selectedId, onSelect }: { refreshKey: number; selectedId: string | null; onSelect: (id: string) => void }) {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [checks, setChecks] = useState<MonitoringCheck[]>([]);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setListLoading(true);
    incidentApi.list('all', 100)
      .then((result) => {
        if (!live) return;
        setIncidents(result);
        setListError(null);
        if (result.length > 0 && (!selectedId || !result.some((incident) => incident.id === selectedId))) {
          onSelect(result.find((item) => item.status === 'active')?.id ?? result[0].id);
        }
      })
      .catch((failure: unknown) => { if (live) setListError(failure instanceof Error ? failure.message : 'Incidents could not be loaded.'); })
      .finally(() => { if (live) setListLoading(false); });
    return () => { live = false; };
  }, [refreshKey, retry]);

  useEffect(() => {
    if (!selectedId) { setChecks([]); setEvents([]); setDetailError(null); return; }
    let live = true;
    setDetailLoading(true);
    const load = () => {
      Promise.all([incidentApi.logs(selectedId), incidentApi.events(selectedId)])
        .then(([nextChecks, nextEvents]) => {
          if (!live) return;
          setChecks(nextChecks);
          setEvents(nextEvents);
          setDetailError(null);
        })
        .catch((failure: unknown) => { if (live) setDetailError(failure instanceof Error ? failure.message : 'Incident monitoring records could not be loaded.'); })
        .finally(() => { if (live) setDetailLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [selectedId, refreshKey, detailRetry]);

  const selected = incidents.find((item) => item.id === selectedId);
  const sortedChecks = [...checks].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
  const sortedEvents = [...events].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());

  return (
    <>
      <VitalityMascotBanner
        badge="Autonomous Telemetry & Trace"
        title="Diagnostics & Raw Incident Logs"
        description="Comprehensive tracing for timestamped probes, HTTP status responses, and transition events to help uncover system root causes."
        accent="dark"
      />
      <PageIntro eyebrow="Operations / Evidence" title="Logs explorer" description="Monitoring check and event records are scoped to a selected incident. No global log stream is available through this API." />
      {listError ? <ErrorState message={listError} retry={() => setRetry((value) => value + 1)} /> : (
        <>
          <div className="logs-context">
            <p><strong>Incident context</strong> · Only checks and events linked to one incident are shown.</p>
            {!listLoading && incidents.length > 0 && (
              <label className="incident-picker">
                <span className="sr-only">Select incident</span>
                <select aria-label="Select an incident for logs" value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value)}>
                  {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.status.toUpperCase()} · {incident.service} · {incident.title}</option>)}
                </select>
              </label>
            )}
          </div>
          {listLoading ? <SkeletonRows count={5} /> : incidents.length === 0 ? <StateBox icon="receipt_long" title="No incident records">Monitoring logs are available through the incident-scoped API. No incidents exist to select.</StateBox> : (
            <>
              <section className="panel panel-pad" aria-labelledby="selected-log-incident">
                <div className="section-heading">
                  <div><h3 id="selected-log-incident">{selected?.title ?? 'Incident monitoring records'}</h3><p>{selected ? `${selected.id} · ${selected.service} · ${formatDate(selected.firstDetected)}` : selectedId}</p></div>
                  {selected && <div className="detail-tags"><Severity value={selected.severity} /><Status value={selected.status} /></div>}
                </div>
                {detailError && <ErrorState message={detailError} retry={() => setDetailRetry((value) => value + 1)} />}
                {detailLoading ? <SkeletonRows count={5} /> : !detailError && (
                  <>
                    <div className="section-heading" style={{ marginTop: 17 }}><div><h3>Monitoring checks</h3><p>{checks.length} recorded checks for this incident</p></div><Icon name="monitor_heart" /></div>
                    {sortedChecks.length === 0 ? <StateBox icon="hourglass_empty" title="No checks linked to this incident">The incident API returned no monitoring checks for this record.</StateBox> : (
                      <div className="log-list">
                        {sortedChecks.map((check) => (
                          <div className="log-row" key={check.id}>
                            <time>{formatDate(check.observedAt)}</time>
                            <span className={check.healthy ? 'service-health healthy' : 'service-health failing'}>{check.healthy ? 'Healthy' : check.failureKind || 'Failure'}</span>
                            <span className="mono">{check.httpStatus ? `HTTP ${check.httpStatus}` : check.responseTimeMs !== null ? `${check.responseTimeMs} ms` : '—'}</span>
                            <span className="log-message">{check.errorDetails || (check.responseTimeMs !== null ? `Response time ${check.responseTimeMs} ms` : 'No additional check detail recorded.')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
              {!detailLoading && !detailError && (
                <section className="panel panel-pad" style={{ marginTop: 15 }} aria-labelledby="selected-event-heading">
                  <div className="section-heading"><div><h3 id="selected-event-heading">Incident events</h3><p>{events.length} recorded events · {selected?.id}</p></div><Icon name="history" /></div>
                  {sortedEvents.length === 0 ? <StateBox icon="event_busy" title="No events recorded">There are no timeline events associated with this incident.</StateBox> : (
                    <div className="timeline">{sortedEvents.map((event) => (
                      <div className="timeline-item" key={event.id}><span className="timeline-marker" /><div className="timeline-copy"><strong>{event.eventType.replaceAll('_', ' ')}</strong><p>{event.summary}</p><time>{formatDate(event.observedAt)}{event.httpStatus ? ` · HTTP ${event.httpStatus}` : ''}{event.responseTimeMs !== null ? ` · ${event.responseTimeMs} ms` : ''}</time></div></div>
                    ))}</div>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}