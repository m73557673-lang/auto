import { useEffect, useMemo, useState } from 'react';
import { incidentApi, type IncidentRecord } from '../services/api';
import { ErrorState, Icon, PageIntro, Severity, SkeletonRows, StateBox, Status, formatDate, VitalityMascotBanner } from '../components/ui';

export default function ReportsPage({ refreshKey, onOpenIncident }: { refreshKey: number; onOpenIncident: (id: string) => void }) {
  const [records, setRecords] = useState<IncidentRecord[]>([]);
  const [counts, setCounts] = useState<{ active: number; resolved: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([incidentApi.list('all', 100), incidentApi.incidentCounts()])
      .then(([incidents, summary]) => {
        if (!live) return;
        setRecords(incidents);
        setCounts(summary);
        setError(null);
      })
      .catch((requestError: unknown) => { if (live) setError(requestError instanceof Error ? requestError.message : 'Incident report data could not be loaded.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refreshKey, retry]);

  const severityCounts = useMemo(() => ({
    critical: records.filter((item) => item.severity === 'critical').length,
    high: records.filter((item) => item.severity === 'high').length,
    medium: records.filter((item) => item.severity === 'medium').length,
    low: records.filter((item) => item.severity === 'low').length,
  }), [records]);
  const services = useMemo(() => {
    const grouped = new Map<string, number>();
    records.forEach((incident) => grouped.set(incident.service, (grouped.get(incident.service) ?? 0) + 1));
    return [...grouped.entries()].sort((a, b) => b[1] - a[1]);
  }, [records]);

  return (
    <>
      <VitalityMascotBanner
        badge="System Reliability Scorecard"
        title="Reliability Benchmarks & Incident Metrics"
        description="Historical distribution of incident severities, recovery velocity, and operational endurance across all registered microservices."
        accent="magenta"
      />
      <PageIntro eyebrow="Operations / Records" title="Reports" description="Incident summaries derived from records available through the incident service." />
      {error && <ErrorState message={error} retry={() => setRetry((value) => value + 1)} />}
      {loading && !error ? <SkeletonRows count={5} /> : !error && (
        <>
          <section className="report-grid" aria-label="Incident totals">
            <article className="report-stat"><span>Active incidents</span><strong>{counts?.active ?? '—'}</strong><small>Current API summary</small></article>
            <article className="report-stat"><span>Resolved incidents</span><strong>{counts?.resolved ?? '—'}</strong><small>Current API summary</small></article>
            <article className="report-stat"><span>Records reviewed</span><strong>{records.length}</strong><small>Up to 100 most recent incident records</small></article>
          </section>
          <div className="dashboard-grid">
            <section className="panel panel-pad">
              <div className="section-heading"><div><h3>Severity distribution</h3><p>Severity among incident records retrieved</p></div></div>
              {records.length === 0 ? <StateBox icon="bar_chart" title="No incident records to summarize">This report will populate when incident records are available.</StateBox> : (
                <div className="distribution">
                  {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
                    <div className="distribution-row" key={severity}>
                      <Severity value={severity} />
                      <div className="distribution-track" aria-label={`${severityCounts[severity]} incidents`}><div className="distribution-fill" style={{ width: `${Math.max(0, severityCounts[severity] / records.length * 100)}%` }} /></div>
                      <span className="distribution-count">{severityCounts[severity]}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel panel-pad">
              <div className="section-heading"><div><h3>Incidents by service</h3><p>Counts from retrieved incident records</p></div></div>
              {services.length === 0 ? <StateBox icon="dns" title="No service incident records">There are no available records to group by service.</StateBox> : (
                <div className="service-list">
                  {services.slice(0, 8).map(([service, total]) => (
                    <div className="service-row" key={service}>
                      <div className="service-name"><Icon name="dns" /><strong>{service}</strong></div>
                      <span className="service-meta">{total} {total === 1 ? 'incident' : 'incidents'}</span>
                      <span className="service-health">{records.filter((incident) => incident.service === service && incident.status === 'active').length} active</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="panel panel-pad" style={{ marginTop: 16 }}>
            <div className="section-heading"><div><h3>Incident register</h3><p>Most recent records returned by the incident API</p></div></div>
            {records.length === 0 ? <StateBox icon="inbox" title="No incidents recorded">There is no incident history to display yet.</StateBox> : (
              <div className="incident-list">
                {records.slice(0, 12).map((incident) => (
                  <button type="button" className="incident-row" key={incident.id} onClick={() => onOpenIncident(incident.id)}>
                    <Severity value={incident.severity} />
                    <span className="incident-copy"><span className="incident-title">{incident.title}</span><span className="incident-meta">{incident.service} · {formatDate(incident.firstDetected)}</span></span>
                    <Status value={incident.status} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}