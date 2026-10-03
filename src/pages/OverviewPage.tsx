import { useEffect, useState } from 'react';
import { incidentApi, type IncidentRecord, type ServiceHealth } from '../services/api';
import { ErrorState, formatDate, Icon, PageIntro, Severity, SkeletonRows, StateBox, Status } from '../components/ui';

function isHealthy(value: boolean | 0 | 1 | null) {
  return value === true || value === 1;
}

export default function OverviewPage({ refreshKey, onOpenIncident }: { refreshKey: number; onOpenIncident: (id: string) => void }) {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [counts, setCounts] = useState<{ active: number; resolved: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const load = () => {
      Promise.all([incidentApi.services(), incidentApi.list('all', 100), incidentApi.incidentCounts()])
        .then(([nextServices, nextIncidents, nextCounts]) => {
          if (!live) return;
          setServices(nextServices);
          setIncidents(nextIncidents);
          setCounts(nextCounts);
          setError(null);
        })
        .catch((requestError: unknown) => {
          if (live) setError(requestError instanceof Error ? requestError.message : 'The overview request failed.');
        })
        .finally(() => { if (live) setLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [refreshKey, retry]);

  const healthyCount = services.filter((service) => isHealthy(service.healthy)).length;
  const recent = [...incidents].sort((a, b) => new Date(b.firstDetected).getTime() - new Date(a.firstDetected).getTime()).slice(0, 6);

  return (
    <>
      <PageIntro eyebrow="Operations / Summary" title="Overview" description="A current view of monitored services and recorded incident activity." />
      {error ? <ErrorState message={error} retry={() => setRetry((value) => value + 1)} /> : null}
      {loading && !error ? (
        <SkeletonRows count={7} />
      ) : !error && (
        <>
          <section className="metrics-grid" aria-label="Incident and service summary">
            <article className="metric-card">
              <div className="metric-label"><Icon name="dns" /> Monitored services</div>
              <div className="metric-value">{services.length}</div>
              <p className="metric-detail">Services with health records</p>
            </article>
            <article className="metric-card good">
              <div className="metric-label"><Icon name="check_circle" /> Healthy services</div>
              <div className="metric-value">{healthyCount}</div>
              <p className="metric-detail">{services.length - healthyCount} failing or awaiting a first check</p>
            </article>
            <article className={`metric-card ${counts?.active ? 'alert' : ''}`}>
              <div className="metric-label"><Icon name="warning" /> Active incidents</div>
              <div className="metric-value">{counts?.active ?? '—'}</div>
              <p className="metric-detail">{counts ? `${counts.resolved} resolved incidents recorded` : 'Incident summary unavailable'}</p>
            </article>
          </section>

          <div className="dashboard-grid">
            <section className="panel panel-pad" aria-labelledby="overview-services-title">
              <div className="section-heading">
                <div><h3 id="overview-services-title">Service health</h3><p>Latest checks reported by the monitor</p></div>
                <span className="service-meta">{services.length} services</span>
              </div>
              {services.length === 0 ? <StateBox icon="dns" title="No monitored services yet">Service health will appear here after the monitor reports data.</StateBox> : (
                <div className="service-list">
                  {services.slice(0, 8).map((service) => {
                    const healthy = isHealthy(service.healthy);
                    const known = service.healthy !== null;
                    return (
                      <div className="service-row" key={service.service}>
                        <div className="service-name"><span className={`health-dot ${healthy ? 'healthy' : known ? 'failing' : ''}`} /><strong>{service.service}</strong></div>
                        <span className="service-meta">{service.httpStatus ? `HTTP ${service.httpStatus}` : service.responseTimeMs !== null ? `${service.responseTimeMs} ms` : '—'}</span>
                        <span className={`service-health ${healthy ? 'healthy' : known ? 'failing' : ''}`}>{healthy ? 'Healthy' : known ? 'Failing' : 'No checks'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="panel panel-pad" aria-labelledby="overview-incidents-title">
              <div className="section-heading">
                <div><h3 id="overview-incidents-title">Recent incidents</h3><p>Latest recorded incident activity</p></div>
                <a className="text-link" href="#/incidents">All incidents <Icon name="arrow_forward" /></a>
              </div>
              {recent.length === 0 ? <StateBox icon="task_alt" title="No incidents recorded">Incidents will appear here when a monitored check identifies a failure.</StateBox> : (
                <div className="incident-list">
                  {recent.map((incident) => (
                    <button className="incident-row" type="button" key={incident.id} onClick={() => onOpenIncident(incident.id)}>
                      <Severity value={incident.severity} />
                      <span className="incident-copy">
                        <span className="incident-title">{incident.title}</span>
                        <span className="incident-meta">{incident.service} · {formatDate(incident.firstDetected)}</span>
                      </span>
                      <Status value={incident.status} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}