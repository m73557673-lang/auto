import { useEffect, useState } from 'react';
import { Icon } from './components/ui';
import AssistantPage from './pages/AssistantPage';
import IncidentsPage from './pages/IncidentsPage';
import LogsPage from './pages/LogsPage';
import OverviewPage from './pages/OverviewPage';
import ReportsPage from './pages/ReportsPage';
import ServicesPage from './pages/ServicesPage';
import { incidentApi, type MonitoringStatus } from './services/api';

const pages = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'incidents', label: 'Incidents', icon: 'warning' },
  { id: 'services', label: 'Services', icon: 'monitor_heart' },
  { id: 'logs', label: 'Logs explorer', icon: 'receipt_long' },
  { id: 'assistant', label: 'AI assistant', icon: 'psychology' },
  { id: 'reports', label: 'Reports', icon: 'analytics' },
] as const;
type PageId = (typeof pages)[number]['id'];

function readPageFromHash(): PageId {
  const requested = window.location.hash.replace(/^#\/?/, '');
  return pages.find((page) => page.id === requested)?.id ?? 'overview';
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(readPageFromHash);
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [connection, setConnection] = useState<'loading' | 'connected' | 'unavailable'>('loading');
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(() => window.sessionStorage.getItem('lastSelectedIncidentId'));

  useEffect(() => {
    const syncPage = () => setActivePage(readPageFromHash());
    if (!window.location.hash) window.location.hash = '/overview';
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    let live = true;
    const updateStatus = async () => {
      const [healthResult, monitorResult, countResult] = await Promise.allSettled([
        incidentApi.health(), incidentApi.monitoringStatus(), incidentApi.incidentCounts(),
      ]);
      if (!live) return;
      setConnection(healthResult.status === 'fulfilled' ? 'connected' : 'unavailable');
      if (monitorResult.status === 'fulfilled') setMonitoring(monitorResult.value);
      if (countResult.status === 'fulfilled') setActiveCount(countResult.value.active);
    };
    void updateStatus();
    const timer = window.setInterval(updateStatus, 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [refreshKey]);

  const selectIncident = (id: string) => {
    setSelectedIncidentId(id);
    window.sessionStorage.setItem('lastSelectedIncidentId', id);
  };
  const openIncident = (id: string) => {
    selectIncident(id);
    window.location.hash = '/incidents';
  };
  const goToAssistant = (id: string) => {
    selectIncident(id);
    window.location.hash = '/assistant';
  };

  const monitorLabel = connection === 'loading'
    ? 'Checking backend'
    : connection === 'unavailable'
      ? 'Backend unavailable'
      : !monitoring
        ? 'Monitor status unavailable'
        : !monitoring.enabled
          ? 'Monitoring disabled'
          : monitoring.status === 'healthy'
            ? 'Target healthy'
            : monitoring.status === 'failing'
              ? 'Target failing'
              : 'Awaiting first check';
  const monitorTone = connection === 'unavailable' ? 'unavailable' : connection === 'loading' || !monitoring ? 'loading' : !monitoring.enabled ? 'disabled' : monitoring.status === 'failing' ? 'failing' : 'connected';

  const stanleyMood =
    monitoring?.status === 'failing'
      ? { text: 'Stanley: Investigating Incident! 🚨', status: 'alert' as const }
      : monitoring?.status === 'healthy'
        ? { text: 'Stanley: Vital Signs Healthy 🐾', status: 'healthy' as const }
        : { text: 'Stanley: Standby Watchdog 🐾', status: 'online' as const };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#/overview" className="brand" aria-label="Vitality Incident Commander overview">
          <span className="brand-mark">
            <img src="/assets/vitality_dog_circle_avatar.png" alt="Stanley the Vitality Dog Mascot" />
          </span>
          <span className="brand-copy">
            <strong>Vitality SRE</strong>
            <small>Stanley Watchdog Ops</small>
          </span>
        </a>
        <div>
          <p className="nav-caption">Operations</p>
          <nav className="primary-nav" aria-label="Primary navigation">
            {pages.map((page) => (
              <a
                key={page.id}
                href={`#/${page.id}`}
                className={`nav-link ${activePage === page.id ? 'active' : ''}`}
                aria-label={page.label}
                aria-current={activePage === page.id ? 'page' : undefined}
              >
                <Icon name={page.icon} className="nav-icon" />
                <span>{page.label}</span>
                {page.id === 'incidents' && activeCount !== null && activeCount > 0 && (
                  <span className="nav-badge" aria-label={`${activeCount} active incidents`}>
                    {activeCount}
                  </span>
                )}
              </a>
            ))}
          </nav>
        </div>
        <div className="sidebar-mascot-card">
          <div className="sidebar-mascot-head">
            <img
              src="/assets/vitality_dog_circle_avatar.png"
              alt="Stanley"
              className="sidebar-mascot-avatar"
            />
            <div>
              <div className="sidebar-mascot-title">Stanley the Watchdog</div>
              <div className="sidebar-mascot-sub">Live longer, resolve faster</div>
            </div>
          </div>
          <p>“Keep your services active and healthy! Proactive telemetry prevents downtime.”</p>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="page-title-group">
            <span className="page-kicker">Vitality Health & Resilience</span>
            <strong className="console-name">Incident Commander</strong>
          </div>
          <div className="topbar-right">
            <div className="stanley-companion-badge" title="Stanley AI companion status">
              <img src="/assets/vitality_dog_circle_avatar.png" alt="Stanley" />
              <span>{stanleyMood.text}</span>
            </div>
            <span className={`connection-indicator ${monitorTone}`} role="status" title={monitorLabel}>
              <span className="connection-dot" />
              {monitorLabel}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh application data"
              title="Refresh application data"
              onClick={() => setRefreshKey((key) => key + 1)}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </header>

        <main className="workspace" key={activePage}>
          {activePage === 'overview' && <OverviewPage refreshKey={refreshKey} onOpenIncident={openIncident} />}
          {activePage === 'incidents' && <IncidentsPage refreshKey={refreshKey} selectedId={selectedIncidentId} onSelect={selectIncident} onOpenAssistant={goToAssistant} />}
          {activePage === 'services' && <ServicesPage refreshKey={refreshKey} />}
          {activePage === 'logs' && <LogsPage refreshKey={refreshKey} selectedId={selectedIncidentId} onSelect={selectIncident} />}
          {activePage === 'assistant' && <AssistantPage refreshKey={refreshKey} incidentId={selectedIncidentId} onSelectIncident={selectIncident} />}
          {activePage === 'reports' && <ReportsPage refreshKey={refreshKey} onOpenIncident={openIncident} />}
        </main>
      </div>
    </div>
  );
}