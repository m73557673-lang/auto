import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  incidentApi,
  type IncidentAnalysis,
  type IncidentEvent,
  type IncidentRecord,
  type MonitoringCheck,
  type MonitoringStatus,
  type ServiceHealth,
} from '../services/api';

export interface LiveSummary {
  status: 'loading' | 'connected' | 'unavailable';
  activeIncidentCount: number;
  serviceCount: number;
  healthyCount: number;
  criticalCount: number;
}

interface Props {
  onSummaryChange: Dispatch<SetStateAction<LiveSummary>>;
  onIncidentSelect?: (incidentId: string | null) => void;
}

function formatTime(value: string | null | undefined) {
  if (!value) return 'Waiting for first check';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function asHealthy(value: boolean | 0 | 1 | null | undefined) {
  return value === true || value === 1;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The backend request failed.';
}

export default function LiveMonitoringPanel({ onSummaryChange, onIncidentSelect }: Props) {
  const [backendState, setBackendState] = useState<LiveSummary['status']>('loading');
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [activeIncidentCount, setActiveIncidentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentRecord | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [logs, setLogs] = useState<MonitoringCheck[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<IncidentAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const results = await Promise.allSettled([
        incidentApi.health(),
        incidentApi.monitoringStatus(),
        incidentApi.services(),
        incidentApi.list('all', 25),
        incidentApi.incidentCounts(),
      ]);
      if (!active) return;

      const [healthResult, monitorResult, serviceResult, incidentResult, countsResult] = results;
      if (monitorResult.status === 'fulfilled') setMonitoring(monitorResult.value);
      if (serviceResult.status === 'fulfilled') setServices(serviceResult.value);
      if (incidentResult.status === 'fulfilled') setIncidents(incidentResult.value);

      const resolvedServices = serviceResult.status === 'fulfilled' ? serviceResult.value : [];
      const resolvedIncidents = incidentResult.status === 'fulfilled' ? incidentResult.value : [];
      const activeCount = countsResult.status === 'fulfilled'
        ? countsResult.value.active
        : resolvedIncidents.filter((incident) => incident.status === 'active').length;
      const healthyCount = resolvedServices.filter((service) => asHealthy(service.healthy)).length;
      const criticalCount = resolvedIncidents.filter((incident) => incident.status === 'active' && incident.severity === 'critical').length;

      if (countsResult.status === 'fulfilled') setActiveIncidentCount(countsResult.value.active);
      const connected = results.every((result) => result.status === 'fulfilled');
      const nextState = connected ? 'connected' : 'unavailable';
      setBackendState(nextState);
      onSummaryChange({
        status: nextState,
        activeIncidentCount: activeCount,
        serviceCount: resolvedServices.length,
        healthyCount,
        criticalCount,
      });
      const firstFailure = results.find((result) => result.status === 'rejected');
      setError(healthResult.status === 'rejected'
        ? errorMessage(healthResult.reason)
        : firstFailure?.status === 'rejected'
          ? errorMessage(firstFailure.reason)
          : null);
      setLoading(false);
    };

    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onSummaryChange, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const loadAnalysis = async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const latest = await incidentApi.getAnalysis(selectedId);
        if (active) setAnalysis(latest);
      } catch {
        if (active) setAnalysis(null);
      } finally {
        if (active) setAnalysisLoading(false);
      }
    };

    void loadAnalysis();
    return () => {
      active = false;
    };
  }, [selectedId, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const loadDetails = async () => {
      setDetailLoading(true);
      const results = await Promise.allSettled([
        incidentApi.detail(selectedId),
        incidentApi.events(selectedId),
        incidentApi.logs(selectedId),
      ]);
      if (!active) return;
      const [incidentResult, eventResult, logResult] = results;
      if (incidentResult.status === 'fulfilled') setSelectedIncident(incidentResult.value);
      if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
      if (logResult.status === 'fulfilled') setLogs(logResult.value);
      const failed = results.find((result) => result.status === 'rejected');
      setDetailError(failed?.status === 'rejected' ? errorMessage(failed.reason) : null);
      setDetailLoading(false);
    };

    void loadDetails();
    const timer = window.setInterval(loadDetails, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const runAnalysis = async () => {
    if (!selectedId) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const latest = await incidentApi.analyze(selectedId);
      setAnalysis(latest);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'The analysis request failed.');
    } finally {
      setAnalysisLoading(false);
    }
  };

  const activeCount = activeIncidentCount;
  const monitorHealthy = monitoring?.status === 'healthy';
  const monitorFailing = monitoring?.status === 'failing';
  const statusLabel = backendState === 'loading'
    ? 'Connecting to backend'
    : backendState === 'unavailable'
      ? 'Backend unavailable'
      : !monitoring?.enabled
        ? 'Monitoring disabled'
        : monitorHealthy
          ? 'Target healthy'
          : monitorFailing
            ? 'Target failing'
            : 'Waiting for first check';

  return (
    <section className="live-panel" aria-label="Live monitoring data">
      <div className="live-panel-header">
        <div className="live-panel-heading">
          <span className={`material-symbols-outlined live-panel-icon ${monitorFailing ? 'is-failing' : ''}`} aria-hidden="true">
            monitor_heart
          </span>
          <div className="live-panel-title-group">
            <div className="live-panel-title-line">
              <h2>Live monitoring</h2>
              <span className={`live-status-pill ${backendState} ${monitorFailing ? 'failing' : ''}`}>
                <span className="live-status-dot" />{statusLabel}
              </span>
            </div>
            <p>
              {monitoring?.service ?? 'Configured target'}
              {monitoring?.lastCheck?.observedAt ? ` · Last check ${formatTime(monitoring.lastCheck.observedAt)}` : ''}
              {monitoring?.lastCheck?.responseTimeMs != null ? ` · ${monitoring.lastCheck.responseTimeMs} ms` : ''}
            </p>
          </div>
        </div>
        <div className="live-panel-actions">
          <span className="live-incident-count"><strong>{backendState === 'connected' ? activeCount : '—'}</strong> active</span>
          <button className="live-icon-button" type="button" aria-label="Refresh live data" title="Refresh live data" onClick={() => setRefreshKey((key) => key + 1)}>
            <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
          </button>
          <button className="live-expand-button" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            <span>{expanded ? 'Hide live data' : 'View live data'}</span>
            <span className="material-symbols-outlined" aria-hidden="true">{expanded ? 'expand_less' : 'expand_more'}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="live-panel-content">
          {error && <div className="live-feedback error" role="alert">{error} Stitch previews remain available as sample data.</div>}
          {loading && <p className="live-feedback">Connecting to the monitoring API…</p>}
          {!loading && backendState === 'connected' && (
            <>
              <div className="live-grid">
                <section className="live-section" aria-labelledby="live-services-heading">
                  <div className="live-section-heading">
                    <h3 id="live-services-heading">Service health</h3>
                    <span>{services.length} monitored</span>
                  </div>
                  {services.length === 0 ? (
                    <p className="live-empty">No health checks recorded yet. The monitor will report after its first check.</p>
                  ) : (
                    <div className="live-service-list">
                      {services.map((service) => {
                        const healthy = asHealthy(service.healthy);
                        const hasCheck = service.healthy !== null;
                        return (
                          <div className="live-service-row" key={service.service}>
                            <div className="live-service-name">
                              <span className={`live-health-dot ${healthy ? 'healthy' : hasCheck ? 'failing' : ''}`} />
                              <strong>{service.service}</strong>
                            </div>
                            <span className={`live-health-label ${healthy ? 'healthy' : hasCheck ? 'failing' : ''}`}>
                              {healthy ? 'Healthy' : hasCheck ? 'Failing' : 'No checks'}
                            </span>
                            <span className="live-service-metric">
                              {service.httpStatus ? `HTTP ${service.httpStatus}` : service.errorDetails || '—'}
                              {service.responseTimeMs != null ? ` · ${service.responseTimeMs} ms` : ''}
                            </span>
                            <time>{formatTime(service.observedAt)}</time>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {monitoring && (
                    <p className="live-threshold-note">
                      {monitoring.enabled
                        ? `Opens after ${monitoring.failureThreshold} consecutive failures · checks every ${monitoring.intervalSeconds}s`
                        : 'Set MONITOR_TARGET_URL to enable scheduled checks.'}
                    </p>
                  )}
                </section>

                <section className="live-section" aria-labelledby="live-incidents-heading">
                  <div className="live-section-heading">
                    <h3 id="live-incidents-heading">Incident history</h3>
                    <span>{activeCount} active · {incidents.length} shown</span>
                  </div>
                  {incidents.length === 0 ? (
                    <p className="live-empty">No incidents recorded. Healthy checks do not create incidents.</p>
                  ) : (
                    <div className="live-incident-list">
                      {incidents.map((incident) => (
                        <button
                          className={`live-incident-row${selectedId === incident.id ? ' selected' : ''}`}
                          type="button"
                          key={incident.id}
                          onClick={() => {
                            setSelectedId(incident.id);
                            onIncidentSelect?.(incident.id);
                            setSelectedIncident(null);
                            setEvents([]);
                            setLogs([]);
                            setAnalysis(null);
                            setAnalysisError(null);
                            setDetailError(null);
                          }}
                        >
                          <span className={`live-severity ${incident.severity}`}>{incident.severity}</span>
                          <span className="live-incident-copy">
                            <strong>{incident.title}</strong>
                            <small>{incident.id} · {incident.service} · {formatTime(incident.firstDetected)}</small>
                          </span>
                          <span className={`live-incident-state ${incident.status}`}>{incident.status}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {selectedId && (
                <section className="live-detail" aria-labelledby="live-detail-heading">
                  <div className="live-section-heading">
                    <div>
                      <h3 id="live-detail-heading">{selectedIncident?.title ?? 'Incident detail'}</h3>
                      {selectedIncident && <p>{selectedIncident.id} · {selectedIncident.service} · {selectedIncident.status}</p>}
                    </div>
                    <button className="live-text-button" type="button" onClick={() => { setSelectedId(null); onIncidentSelect?.(null); }}>Close detail</button>
                  </div>
                  {detailLoading && <p className="live-empty">Loading incident detail…</p>}
                  {detailError && <div className="live-feedback error" role="alert">{detailError}</div>}
                  {selectedIncident && (
                    <>
                      <p className="live-incident-summary">{selectedIncident.summary}</p>
                      <div className="analysis-actions">
                        <button className="analysis-button" type="button" onClick={runAnalysis} disabled={analysisLoading}>
                          <span className="material-symbols-outlined" aria-hidden="true">{analysisLoading ? 'progress_activity' : 'auto_awesome'}</span>
                          {analysisLoading ? 'Analyzing incident…' : analysis ? 'Refresh analysis' : 'Analyze incident'}
                        </button>
                        {analysis?.createdAt && <time>Last analyzed {formatTime(analysis.createdAt)}</time>}
                      </div>
                      {analysisError && <div className="live-feedback error" role="alert">{analysisError}</div>}
                      {analysisLoading && <p className="analysis-loading" role="status">Reviewing recorded checks and event history…</p>}
                      {analysis && (
                        <div className="analysis-card" aria-live="polite">
                          <div className="analysis-card-header">
                            <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                            <div><strong>AI incident analysis</strong><small>Evidence is recorded; causes and actions are hypotheses.</small></div>
                          </div>
                          <div className="analysis-section"><h4>Summary</h4><p>{analysis.summary}</p></div>
                          <div className="analysis-columns">
                            <div className="analysis-section"><h4>Observed symptoms</h4>
                              {analysis.observedSymptoms.length ? <ul>{analysis.observedSymptoms.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>No symptoms are present in the available check records.</p>}
                            </div>
                            <div className="analysis-section fact-section"><h4>Recorded evidence</h4>
                              {analysis.supportingEvidence.length ? <ul>{analysis.supportingEvidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>No health checks or events are associated with this incident.</p>}
                            </div>
                          </div>
                          <div className="analysis-columns">
                            <div className="analysis-section hypothesis-section"><h4>Possible causes · hypotheses</h4>
                              {analysis.possibleRootCauses.length ? <ul>{analysis.possibleRootCauses.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>No cause could be suggested from the available evidence.</p>}
                            </div>
                            <div className="analysis-section"><h4>Potential impact</h4><p>{analysis.potentialImpact}</p></div>
                          </div>
                          <div className="analysis-columns">
                            <div className="analysis-section"><h4>Suggested investigation</h4>
                              {analysis.recommendedSteps.length ? <ul>{analysis.recommendedSteps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>No investigation steps were returned.</p>}
                            </div>
                            <div className="analysis-section"><h4>Missing information</h4>
                              {analysis.missingInformation.length ? <ul>{analysis.missingInformation.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>No additional data gaps were identified.</p>}
                            </div>
                          </div>
                          <div className="analysis-section"><h4>Recorded timeline</h4>
                            {analysis.timeline.length ? <ol>{analysis.timeline.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol> : <p>No event timeline is recorded.</p>}
                            <small className="analysis-confidence">Uncertainty: {analysis.confidence}</small>
                          </div>
                        </div>
                      )}
                      <div className="live-detail-meta">
                        <span>First detected: {formatTime(selectedIncident.firstDetected)}</span>
                        <span>Last observed: {formatTime(selectedIncident.lastObserved)}</span>
                        <span>Resolved: {formatTime(selectedIncident.resolvedAt)}</span>
                        <span>Last HTTP: {selectedIncident.lastHttpStatus ?? '—'}</span>
                      </div>
                      <div className="live-detail-columns">
                        <div>
                          <h4>Event history</h4>
                          {events.length === 0 ? <p className="live-empty">No events recorded.</p> : events.map((event) => (
                            <div className="live-timeline-row" key={event.id}>
                              <span className="live-timeline-dot" />
                              <div><strong>{event.eventType.replaceAll('_', ' ')}</strong><p>{event.summary}</p><time>{formatTime(event.observedAt)}</time></div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <h4>Check logs</h4>
                          {logs.length === 0 ? <p className="live-empty">No check logs recorded.</p> : logs.slice(-8).reverse().map((log) => (
                            <div className="live-log-row" key={log.id}>
                              <time>{formatTime(log.observedAt)}</time>
                              <strong>{log.healthy ? 'HEALTHY' : (log.failureKind ?? 'FAILURE').toUpperCase()}</strong>
                              <span>{log.httpStatus ? `HTTP ${log.httpStatus}` : log.errorDetails || 'No status'}</span>
                              <span>{log.responseTimeMs == null ? '—' : `${log.responseTimeMs} ms`}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}