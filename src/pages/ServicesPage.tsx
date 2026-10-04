import { useEffect, useState } from 'react';
import { incidentApi, type MonitoringStatus, type ServiceHealth } from '../services/api';
import { ErrorState, formatDate, Icon, PageIntro, SkeletonRows, StateBox, VitalityMascotBanner } from '../components/ui';

function healthy(value: boolean | 0 | 1 | null) { return value === true || value === 1; }

export default function ServicesPage({ refreshKey }: { refreshKey: number }) {
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const load = () => {
      Promise.all([incidentApi.monitoringStatus(), incidentApi.services()])
        .then(([status, nextServices]) => {
          if (!live) return;
          setMonitoring(status);
          setServices(nextServices);
          setError(null);
        })
        .catch((requestError: unknown) => { if (live) setError(requestError instanceof Error ? requestError.message : 'Monitoring data could not be loaded.'); })
        .finally(() => { if (live) setLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [refreshKey, retry]);

  const mode = !monitoring ? 'warn' : !monitoring.enabled || !monitoring.targetConfigured ? 'warn' : monitoring.status === 'healthy' ? 'good' : monitoring.status === 'failing' ? 'bad' : 'warn';
  const statusTitle = !monitoring?.enabled ? 'Monitoring is disabled' : !monitoring.targetConfigured ? 'No monitor target configured' : monitoring.status === 'healthy' ? 'Target checks are healthy' : monitoring.status === 'failing' ? 'Target checks are failing' : 'Waiting for a monitoring check';

  return (
    <>
      <VitalityMascotBanner
        badge="Microservice Vital Signs"
        title="Proactive Health Checks & Telemetry"
        description="Every microservice undergoes continuous heartbeat verification to maintain maximum availability and zero-downtime endurance."
        accent="magenta"
      />
      <PageIntro eyebrow="Operations / Monitoring" title="Services" description="Live monitoring configuration and the latest health reported for each service." />
      {error && <ErrorState message={error} retry={() => setRetry((value) => value + 1)} />}
      {loading && !error ? <SkeletonRows count={6} /> : !error && (
        <>
          <section className="monitor-banner" aria-label="Monitoring status">
            <div className="monitor-banner-main">
              <div className={`monitor-symbol ${mode}`}><Icon name="monitor_heart" /></div>
              <div>
                <h3>{statusTitle}</h3>
                <p>{monitoring?.service || 'No target service reported'} · {monitoring?.lastCheck?.observedAt ? `Last check ${formatDate(monitoring.lastCheck.observedAt)}` : 'No completed checks reported'}</p>
              </div>
            </div>
            <span className={`monitor-badge ${mode}`}>{monitoring?.enabled ? 'Enabled' : 'Disabled'}</span>
          </section>

          <section className="metrics-grid" aria-label="Monitoring configuration" style={{ marginTop: 15 }}>
            <article className="metric-card"><div className="metric-label"><Icon name="schedule" /> Check interval</div><div className="metric-value">{monitoring ? `${monitoring.intervalSeconds}s` : '—'}</div><p className="metric-detail">Configured interval</p></article>
            <article className="metric-card"><div className="metric-label"><Icon name="rule" /> Failure threshold</div><div className="metric-value">{monitoring?.failureThreshold ?? '—'}</div><p className="metric-detail">Consecutive failures to open an incident</p></article>
            <article className={`metric-card ${monitoring?.consecutiveFailures ? 'alert' : ''}`}><div className="metric-label"><Icon name="trending_down" /> Consecutive failures</div><div className="metric-value">{monitoring?.consecutiveFailures ?? '—'}</div><p className="metric-detail">Reported by the monitor</p></article>
          </section>

          <section className="panel panel-pad" aria-labelledby="service-catalog-title">
            <div className="section-heading">
              <div><h3 id="service-catalog-title">Service catalog</h3><p>Most recent service health response</p></div>
              <span className="service-meta">{services.length} monitored</span>
            </div>
            {services.length === 0 ? <StateBox icon="dns" title="No services reported">Service records will appear after monitoring checks are received.</StateBox> : (
              <div className="service-list">
                {services.map((service) => {
                  const good = healthy(service.healthy);
                  const known = service.healthy !== null;
                  return (
                    <article className="service-row" key={service.service}>
                      <div className="service-name"><span className={`health-dot ${good ? 'healthy' : known ? 'failing' : ''}`} /><strong>{service.service}</strong></div>
                      <span className="service-meta">{service.httpStatus ? `HTTP ${service.httpStatus}` : service.responseTimeMs !== null ? `${service.responseTimeMs} ms` : service.errorDetails || 'No check result'}</span>
                      <span className={`service-health ${good ? 'healthy' : known ? 'failing' : ''}`}>{good ? 'Healthy' : known ? 'Failing' : 'Unknown'}</span>
                    </article>
                  );
                })}
              </div>
            )}
            {monitoring?.lastCheck && (
              <div className="detail-meta">
                <span>Last target response: {monitoring.lastCheck.httpStatus ? `HTTP ${monitoring.lastCheck.httpStatus}` : 'No HTTP status'}</span>
                <span>Latency: {monitoring.lastCheck.responseTimeMs == null ? '—' : `${monitoring.lastCheck.responseTimeMs} ms`}</span>
                {monitoring.lastCheck.errorDetails && <span>Detail: {monitoring.lastCheck.errorDetails}</span>}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}