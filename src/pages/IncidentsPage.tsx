import { useEffect, useState } from 'react';
import { incidentApi, type IncidentAnalysis, type IncidentEvent, type IncidentRecord, type MonitoringCheck } from '../services/api';
import { Button, ErrorState, formatDate, Icon, PageIntro, Severity, SkeletonRows, StateBox, Status, VitalityMascotBanner } from '../components/ui';

function requestError(error: unknown) { return error instanceof Error ? error.message : 'The incident request failed.'; }

export default function IncidentsPage({
  refreshKey, selectedId, onSelect, onOpenAssistant,
}: { refreshKey: number; selectedId: string | null; onSelect: (id: string) => void; onOpenAssistant: (id: string) => void }) {
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    incidentApi.list(filter, 100)
      .then((result) => { if (live) { setIncidents(result); setError(null); } })
      .catch((requestFailure: unknown) => { if (live) setError(requestError(requestFailure)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filter, refreshKey, retry]);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    incidentApi.detail(selectedId)
      .then((record) => { if (live && record.status !== filter) setFilter(record.status); })
      .catch(() => { /* The detail panel reports missing or unavailable incident records. */ });
    return () => { live = false; };
  }, [selectedId]);

  return (
    <>
      <VitalityMascotBanner
        badge="Autonomous Incident Watchdog"
        title="Active Incident Triage & Rapid Recovery"
        description="Continuously detecting anomalous latency, correlating health checks, and triggering autonomous root-cause analysis."
        accent="dark"
      />
      <PageIntro eyebrow="Operations / Response" title="Incidents" description="Investigate recorded failures, review check evidence, and examine AI-generated analysis." />
      <div className="detail-layout">
        <section className="panel" aria-label="Incident list">
          <div className="incident-filter">
            <h3>Incident records</h3>
            <div className="button-group" role="group" aria-label="Filter incidents">
              <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Active</button>
              <button type="button" aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolved</button>
            </div>
          </div>
          {error ? <div style={{ padding: 12 }}><ErrorState message={error} retry={() => setRetry((value) => value + 1)} /></div>
            : loading ? <div style={{ padding: 15 }}><SkeletonRows count={5} /></div>
              : incidents.length === 0 ? <div style={{ padding: 12 }}><StateBox icon={filter === 'active' ? 'task_alt' : 'history'} title={`No ${filter} incidents`}>There are no incident records in this view.</StateBox></div>
                : (
                  <div className="incident-select-list">
                    {incidents.map((incident) => (
                      <button type="button" key={incident.id} className={`incident-select ${selectedId === incident.id ? 'selected' : ''}`} onClick={() => onSelect(incident.id)} aria-pressed={selectedId === incident.id}>
                        <span className="incident-select-top"><Severity value={incident.severity} /><Status value={incident.status} /></span>
                        <strong>{incident.title}</strong>
                        <small>{incident.service} · {formatDate(incident.firstDetected)}</small>
                      </button>
                    ))}
                  </div>
                )}
        </section>
        {selectedId && incidents.some((incident) => incident.id === selectedId)
          ? <IncidentDetail key={selectedId} id={selectedId} onOpenAssistant={() => onOpenAssistant(selectedId)} />
          : <section className="panel panel-pad"><StateBox icon="manage_search" title="Choose an incident">Select an incident record to review its summary, evidence, events, and analysis.</StateBox></section>}
      </div>
    </>
  );
}

function IncidentDetail({ id, onOpenAssistant }: { id: string; onOpenAssistant: () => void }) {
  const [incident, setIncident] = useState<IncidentRecord | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [checks, setChecks] = useState<MonitoringCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [analysis, setAnalysis] = useState<IncidentAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisRetry, setAnalysisRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const load = () => {
      Promise.all([incidentApi.detail(id), incidentApi.events(id), incidentApi.logs(id)])
        .then(([record, timeline, monitoringChecks]) => {
          if (!live) return;
          setIncident(record);
          setEvents(timeline);
          setChecks(monitoringChecks);
          setError(null);
        })
        .catch((failure: unknown) => { if (live) setError(requestError(failure)); })
        .finally(() => { if (live) setLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [id, retry]);

  useEffect(() => {
    let live = true;
    setAnalysisLoading(true);
    setAnalysisError(null);
    incidentApi.getAnalysis(id)
      .then((saved) => { if (live) setAnalysis(saved); })
      .catch((failure: unknown) => {
        if (!live) return;
        const message = requestError(failure);
        if (/404|not found|no analysis/i.test(message)) {
          setAnalysis(null);
          setAnalysisError(null);
        } else {
          setAnalysis(null);
          setAnalysisError(message);
        }
      })
      .finally(() => { if (live) setAnalysisLoading(false); });
    return () => { live = false; };
  }, [id, analysisRetry]);

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const saved = await incidentApi.analyze(id);
      setAnalysis(saved);
    } catch (failure) {
      setAnalysisError(requestError(failure));
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <article className="panel panel-pad" aria-label="Incident details">
      {loading && <SkeletonRows count={5} />}
      {error && <ErrorState message={error} retry={() => setRetry((value) => value + 1)} />}
      {!loading && !error && incident && (
        <>
          <header className="detail-header">
            <div><div className="detail-tags"><Severity value={incident.severity} /><Status value={incident.status} /></div><h2 style={{ marginTop: 9 }}>{incident.title}</h2><p>{incident.id} · {incident.service}</p></div>
            <Button className="small" icon="forum" onClick={onOpenAssistant}>Ask assistant</Button>
          </header>
          <section className="detail-block"><h3>Incident summary</h3><p>{incident.summary || 'No summary was recorded.'}</p>
            {incident.errorDetails && <p style={{ marginTop: 8 }}><strong>Latest error: </strong>{incident.errorDetails}</p>}
            <div className="detail-meta"><span>First detected: {formatDate(incident.firstDetected)}</span><span>Last observed: {formatDate(incident.lastObserved)}</span><span>Resolved: {formatDate(incident.resolvedAt)}</span><span>Last HTTP: {incident.lastHttpStatus ?? '—'}</span><span>Events: {incident.eventCount}</span></div>
          </section>

          <section className="analysis-box" aria-labelledby="analysis-title">
            <div className="analysis-heading">
              <div className="analysis-heading-main"><Icon name="auto_awesome" /><div><h3 id="analysis-title">AI root-cause analysis</h3><p>Recorded facts are separated from possible causes and recommendations.</p></div></div>
              <Button className="small primary" onClick={runAnalysis} disabled={analysisLoading} icon={analysisLoading ? 'progress_activity' : 'auto_awesome'}>{analysisLoading ? 'Analyzing…' : analysis ? 'Refresh analysis' : 'Generate analysis'}</Button>
            </div>
            {analysisLoading && <p className="analysis-copy" role="status" style={{ marginTop: 13 }}>Reviewing recorded events and monitoring checks…</p>}
            {analysisError && <div className="inline-error" role="alert">{analysisError}<button type="button" onClick={() => setAnalysisRetry((value) => value + 1)}>Retry saved analysis</button></div>}
            {!analysisLoading && !analysis && !analysisError && <p className="analysis-copy" style={{ marginTop: 13 }}>No saved analysis is available for this incident. Generate an analysis to request one from the backend.</p>}
            {analysis && (
              <div aria-live="polite">
                <div className="analysis-group"><h4>Summary</h4><p className="analysis-copy">{analysis.summary}</p></div>
                <div className="detail-columns">
                  <div className="analysis-group analysis-facts"><h4>Supporting evidence</h4>{analysis.supportingEvidence.length ? <ul>{analysis.supportingEvidence.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul> : <p className="analysis-copy">No supporting evidence returned.</p>}</div>
                  <div className="analysis-group"><h4>Observed symptoms</h4>{analysis.observedSymptoms.length ? <ul>{analysis.observedSymptoms.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul> : <p className="analysis-copy">No symptoms returned.</p>}</div>
                </div>
                <div className="detail-columns">
                  <div className="analysis-group analysis-hypotheses"><h4>Possible causes · hypotheses</h4>{analysis.possibleRootCauses.length ? <ul>{analysis.possibleRootCauses.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul> : <p className="analysis-copy">No possible causes returned.</p>}</div>
                  <div className="analysis-group"><h4>Potential impact</h4><p className="analysis-copy">{analysis.potentialImpact}</p></div>
                </div>
                <div className="detail-columns">
                  <div className="analysis-group"><h4>Recommended investigation</h4>{analysis.recommendedSteps.length ? <ol>{analysis.recommendedSteps.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol> : <p className="analysis-copy">No steps returned.</p>}</div>
                  <div className="analysis-group"><h4>Missing information</h4>{analysis.missingInformation.length ? <ul>{analysis.missingInformation.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ul> : <p className="analysis-copy">No data gaps returned.</p>}</div>
                </div>
                <div className="analysis-group"><h4>Analysis timeline</h4>{analysis.timeline.length ? <ol>{analysis.timeline.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol> : <p className="analysis-copy">No timeline returned.</p>}<p className="analysis-copy" style={{ marginTop: 7 }}>Confidence: {analysis.confidence}{analysis.createdAt ? ` · Saved ${formatDate(analysis.createdAt)}` : ''}</p></div>
                <p className="footer-note">Analysis is advisory only. Incident status remains {incident.status} until updated through an authorized incident workflow.</p>
              </div>
            )}
          </section>

          <div className="detail-columns">
            <section className="detail-block" aria-labelledby="incident-events-heading">
              <h3 id="incident-events-heading">Event timeline</h3>
              {events.length === 0 ? <p className="analysis-copy">No events are recorded for this incident.</p> : <div className="timeline">{events.map((event) => (
                <div className="timeline-item" key={event.id}><span className="timeline-marker" /><div className="timeline-copy"><strong>{event.eventType.replaceAll('_', ' ')}</strong><p>{event.summary}</p><time>{formatDate(event.observedAt)}</time></div></div>
              ))}</div>}
            </section>
            <section className="detail-block" aria-labelledby="incident-checks-heading">
              <h3 id="incident-checks-heading">Monitoring checks</h3>
              {checks.length === 0 ? <p className="analysis-copy">No checks are associated with this incident.</p> : (
                <div className="table-wrap"><table className="check-table"><thead><tr><th>Observed</th><th>Result</th><th>Response</th></tr></thead><tbody>
                  {[...checks].reverse().slice(0, 8).map((check) => <tr key={check.id}><td className="mono">{formatDate(check.observedAt)}</td><td>{check.healthy ? 'Healthy' : check.failureKind || 'Failed'}</td><td>{check.httpStatus ? `HTTP ${check.httpStatus}` : check.errorDetails || '—'}{check.responseTimeMs != null ? ` · ${check.responseTimeMs} ms` : ''}</td></tr>)}
                </tbody></table></div>
              )}
            </section>
          </div>
        </>
      )}
    </article>
  );
}