import { useEffect, useMemo, useState } from 'react';
import LiveMonitoringPanel, { type LiveSummary } from './components/LiveMonitoringPanel';
import { incidentApi, type ChatMessage } from './services/api';
import assistantPage from './stitch/ai_incident_assistant_chatbot/code.html?raw';
import incidentPage from './stitch/incident_details_ai_root_cause_analysis/code.html?raw';
import reportsPage from './stitch/incident_reports_sla_analytics/code.html?raw';
import logsPage from './stitch/live_logs_explorer/code.html?raw';
import servicesPage from './stitch/services_health_catalog/code.html?raw';
import overviewPage from './stitch/system_overview_dashboard/code.html?raw';
import shieldLogo from './stitch/ai_incident_commander_shield_logo/code.html?raw';

const pages = [
  { id: 'overview', label: 'Overview', icon: 'dashboard', document: overviewPage },
  { id: 'incidents', label: 'Incidents', icon: 'warning', document: incidentPage },
  { id: 'services', label: 'Services', icon: 'dns', document: servicesPage },
  { id: 'logs', label: 'Live Logs', icon: 'terminal', document: logsPage },
  { id: 'assistant', label: 'AI Assistant', icon: 'psychology', document: assistantPage },
  { id: 'reports', label: 'Reports', icon: 'analytics', document: reportsPage },
] as const;

type PageId = (typeof pages)[number]['id'];

function readPageFromHash(): PageId {
  const requestedPage = window.location.hash.slice(2);
  return pages.find((page) => page.id === requestedPage)?.id ?? 'overview';
}

function markDemoActions(markup: string) {
  const demoActionHandler = `<script>
    window.executeAction = function(button) {
      button.innerHTML = '<span class="material-symbols-outlined text-[16px]">block</span><span>Demo only: no command sent</span>';
      button.disabled = true;
      button.classList.remove('bg-error', 'bg-surface-container-high');
      button.classList.add('bg-surface-container', 'text-secondary');
    };
  </script>`;

  return markup.replace('</body>', `${demoActionHandler}</body>`);
}

function conversationForIncident(incidentId: string) {
  const key = `commander:conversation:${incidentId}`;
  const stored = window.sessionStorage.getItem(key);
  if (stored) return stored;
  const created = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(readPageFromHash);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [liveSummary, setLiveSummary] = useState<LiveSummary>({
    status: 'loading',
    activeIncidentCount: 0,
    serviceCount: 0,
    healthyCount: 0,
    criticalCount: 0,
  });
  const currentPage = pages.find((page) => page.id === activePage) ?? pages[0];

  const selectIncident = (incidentId: string | null) => {
    setSelectedIncidentId(incidentId);
    if (incidentId) window.sessionStorage.setItem('lastSelectedIncidentId', incidentId);
  };

  useEffect(() => {
    if (activePage !== 'assistant') return;
    if (!selectedIncidentId && liveSummary.activeIncidentCount > 0) {
      const activeIncident = window.sessionStorage.getItem('lastSelectedIncidentId');
      if (activeIncident) {
        setSelectedIncidentId(activeIncident);
      }
    }
  }, [activePage, liveSummary.activeIncidentCount, selectedIncidentId]);

  useEffect(() => {
    const syncPage = () => setActivePage(readPageFromHash());
    if (!window.location.hash) window.location.hash = '/overview';
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  const metrics = useMemo(() => {
    const statusTone = liveSummary.status === 'connected'
      ? (liveSummary.activeIncidentCount > 0 ? 'warning' : 'healthy')
      : liveSummary.status === 'unavailable'
        ? 'critical'
        : 'neutral';

    return [
      {
        label: 'Monitoring',
        value: liveSummary.status === 'loading'
          ? 'Connecting'
          : liveSummary.status === 'connected'
            ? (liveSummary.activeIncidentCount > 0 ? 'Degraded' : 'Healthy')
            : 'Offline',
        detail: liveSummary.status === 'loading'
          ? 'Checking backend health'
          : liveSummary.status === 'connected'
            ? (liveSummary.activeIncidentCount > 0 ? 'Target checks are failing' : 'All monitored targets healthy')
            : 'Backend is unreachable',
        tone: statusTone,
        icon: 'monitor_heart',
      },
      {
        label: 'Services',
        value: String(liveSummary.serviceCount),
        detail: 'Monitored endpoints',
        tone: 'neutral',
        icon: 'dns',
      },
      {
        label: 'Healthy',
        value: String(liveSummary.healthyCount),
        detail: liveSummary.serviceCount > 0
          ? `${Math.max(0, Math.round((liveSummary.healthyCount / liveSummary.serviceCount) * 100))}% of fleet healthy`
          : 'No checks yet',
        tone: 'healthy',
        icon: 'check_circle',
      },
      {
        label: 'Active incidents',
        value: String(liveSummary.activeIncidentCount),
        detail: `${liveSummary.criticalCount} critical / high priority`,
        tone: liveSummary.activeIncidentCount > 0 ? 'warning' : 'neutral',
        icon: 'error',
      },
    ];
  }, [liveSummary]);

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-row">
          <a className="brand" href="#/overview" aria-label="AI Incident Commander overview">
            <span className="brand-mark" dangerouslySetInnerHTML={{ __html: shieldLogo }} />
            {!sidebarCollapsed && (
              <span className="brand-copy">
                <strong>Commander</strong>
                <small>SRE Suite</small>
              </span>
            )}
            {!sidebarCollapsed && <span className="edition-tag">DEMO</span>}
          </a>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{sidebarCollapsed ? 'chevron_right' : 'chevron_left'}</span>
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="environment-picker">
            <span className="status-dot" />
            <span>Production · sample</span>
            <span className="material-symbols-outlined">unfold_more</span>
          </div>
        )}

        <nav className="primary-nav" aria-label="Workspace">
          {pages.map((page) => (
            <a
              className={`nav-link${activePage === page.id ? ' active' : ''}`}
              href={`#/${page.id}`}
              key={page.id}
              aria-current={activePage === page.id ? 'page' : undefined}
              title={page.label}
            >
              <span className="material-symbols-outlined nav-icon" aria-hidden="true">{page.icon}</span>
              {!sidebarCollapsed && <span>{page.label}</span>}
              {!sidebarCollapsed && page.id === 'incidents' && liveSummary.status === 'connected' && (
                <span className="nav-badge">{liveSummary.activeIncidentCount}</span>
              )}
            </a>
          ))}
        </nav>

        {!sidebarCollapsed && (
          <div className="sidebar-footer">
            <span className="avatar">ER</span>
            <span className="operator-copy"><strong>Elena Rostova</strong><small>Incident Lead</small></span>
            <span className="material-symbols-outlined signout-icon" aria-hidden="true">logout</span>
          </div>
        )}
      </aside>

      <header className="topbar">
        <div className="page-title-group">
          <span className="page-kicker">Operations</span>
          <h1>{currentPage.label}</h1>
        </div>
        <div className="topbar-status">
          <span className="mesh-indicator"><span className="status-dot" /> Demo environment</span>
          <span className={`connection-indicator ${liveSummary.status}`}>
            <span className="connection-dot" />
            {liveSummary.status === 'loading' ? 'Connecting…' : liveSummary.status === 'connected' ? 'Backend connected' : 'Backend unavailable'}
          </span>
        </div>
      </header>

      <main className="workspace">
        <div className="demo-notice" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">info</span>
          <span><strong>Real monitor status</strong> · Stitch visuals remain as design reference while live service data is pulled from the backend.</span>
        </div>

        {activePage === 'overview' && (
          <section className="overview-shell" aria-labelledby="overview-summary-title">
            <div className="overview-surface">
              <div className="overview-header">
                <div>
                  <span className="eyebrow">Status overview</span>
                  <h2 id="overview-summary-title">Incident operations</h2>
                </div>
                <span className="time-range">Last 24h</span>
              </div>

              <div className="metric-grid">
                {metrics.map((metric) => (
                  <article key={metric.label} className={`metric-card ${metric.tone}`}>
                    <div className="metric-card-top">
                      <span className="metric-icon material-symbols-outlined" aria-hidden="true">{metric.icon}</span>
                      <span className="metric-label">{metric.label}</span>
                    </div>
                    <div className="metric-value">{metric.value}</div>
                    <p className="metric-detail">{metric.detail}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="overview-focus">
              <div className="focus-card">
                <div className="focus-header">
                  <div>
                    <span className="eyebrow">Service health</span>
                    <h3>Operational posture</h3>
                  </div>
                  <span className="focus-tag">Updated live</span>
                </div>

                <div className="trend-stack">
                  <div className="trend-row">
                    <span className="trend-label">Healthy fleet</span>
                    <div className="trend-bar">
                      <span style={{ width: `${liveSummary.serviceCount > 0 ? (liveSummary.healthyCount / liveSummary.serviceCount) * 100 : 0}%` }} />
                    </div>
                    <span className="trend-value">
                      {liveSummary.serviceCount > 0 ? `${Math.round((liveSummary.healthyCount / liveSummary.serviceCount) * 100)}%` : '0%'}
                    </span>
                  </div>
                  <div className="trend-row subtle">
                    <span className="trend-label">Critical alerting</span>
                    <div className="trend-bar warning">
                      <span style={{ width: `${liveSummary.activeIncidentCount > 0 ? Math.min(100, (liveSummary.criticalCount / liveSummary.activeIncidentCount) * 100) : 0}%` }} />
                    </div>
                    <span className="trend-value">
                      {liveSummary.activeIncidentCount > 0 ? `${Math.round((liveSummary.criticalCount / liveSummary.activeIncidentCount) * 100)}%` : '0%'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <LiveMonitoringPanel onSummaryChange={setLiveSummary} onIncidentSelect={selectIncident} />
        {activePage === 'assistant' && <AssistantPanel incidentId={selectedIncidentId} />}
        <iframe
          className="stitch-view"
          key={currentPage.id}
          title={currentPage.label}
          srcDoc={markDemoActions(currentPage.document)}
        />
      </main>
    </div>
  );
}

function AssistantPanel({ incidentId }: { incidentId: string | null }) {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => incidentId ? conversationForIncident(incidentId) : '');

  useEffect(() => {
    if (!incidentId) {
      setHistory([]);
      setConversationId('');
      return;
    }

    const selectedConversation = conversationForIncident(incidentId);
    let active = true;
    setConversationId(selectedConversation);
    setHistory([]);
    setLoadingHistory(true);
    setError(null);
    const load = async () => {
      try {
        const messages = await incidentApi.listChat(incidentId, selectedConversation);
        if (active) setHistory(messages);
      } catch {
        if (active) setError('Could not load this conversation history.');
      } finally {
        if (active) setLoadingHistory(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [incidentId]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!incidentId || !message.trim() || !conversationId) return;
    setSending(true);
    setError(null);
    try {
      const submittedMessage = message.trim();
      const response = await incidentApi.chat(incidentId, submittedMessage, conversationId);
      setHistory((current) => [
        ...current,
        { incidentId, conversationId: response.conversationId, role: 'user', content: submittedMessage, createdAt: new Date().toISOString() },
        { incidentId, conversationId: response.conversationId, role: 'assistant', content: response.answer, createdAt: response.createdAt },
      ]);
      setMessage('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI chat is unavailable right now.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="live-panel" aria-label="Incident assistant">
      <div className="live-panel-header">
        <div className="live-panel-heading">
          <span className="material-symbols-outlined live-panel-icon" aria-hidden="true">smart_toy</span>
          <div className="live-panel-title-group">
            <div className="live-panel-title-line">
              <h2>Incident AI assistant</h2>
            </div>
            <p>{incidentId ? `Incident context: ${incidentId}` : 'Select an active incident to enable the assistant.'}</p>
          </div>
        </div>
      </div>

      <div className="live-panel-content" style={{ display: 'grid', gap: '1rem' }}>
        {!incidentId ? (
          <p className="live-empty">No incident selected yet. Pick one from the live monitoring panel to begin.</p>
        ) : (
          <>
            <div className="assistant-context">
              <span className="material-symbols-outlined" aria-hidden="true">link</span>
              <span>Conversation scoped to incident <strong>{incidentId}</strong>. Recorded facts and AI suggestions are shown separately.</span>
            </div>
            <div className="assistant-suggestions" aria-label="Suggested questions">
              {['What happened?', 'What evidence supports this?', 'What should I investigate next?'].map((question) => (
                <button key={question} type="button" disabled={sending} onClick={() => setMessage(question)}>{question}</button>
              ))}
            </div>
            <div className="assistant-thread" aria-live="polite" aria-busy={loadingHistory || sending}>
              {loadingHistory ? <p className="live-empty" role="status">Loading conversation…</p> : history.length === 0 ? (
                <p className="live-empty">No chat history yet. Ask a factual question about the incident.</p>
              ) : history.map((entry) => (
                <article key={`${entry.role}-${entry.id ?? entry.createdAt}-${entry.content}`} className={`assistant-bubble ${entry.role}`}>
                  <header><strong>{entry.role === 'assistant' ? 'Incident assistant' : 'You'}</strong><time>{new Date(entry.createdAt).toLocaleTimeString()}</time></header>
                  <p>{entry.content}</p>
                </article>
              ))}
              {sending && <p className="assistant-thinking" role="status">Checking the incident record…</p>}
            </div>

            <form className="assistant-input-row" onSubmit={submit}>
              <textarea
                aria-label="Ask the incident assistant"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask about the incident, root cause, or next steps"
                rows={2}
                maxLength={4000}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button type="submit" aria-label="Send message" title="Send message" disabled={sending || loadingHistory || !message.trim()}>
                <span className="material-symbols-outlined" aria-hidden="true">{sending ? 'progress_activity' : 'send'}</span>
                <span>{sending ? 'Sending…' : 'Send'}</span>
              </button>
            </form>
            {error && <div className="live-feedback error" role="alert">{error}</div>}
          </>
        )}
      </div>
    </section>
  );
}