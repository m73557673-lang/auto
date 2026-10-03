export interface IncidentRecord {
  id: string;
  title: string;
  summary: string;
  service: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved';
  firstDetected: string;
  lastObserved: string;
  resolvedAt: string | null;
  lastHttpStatus: number | null;
  lastResponseTimeMs: number | null;
  errorDetails: string;
  eventCount: number;
}

export interface MonitoringCheck {
  id: number;
  service: string;
  incidentId: string | null;
  observedAt: string;
  healthy: boolean | 0 | 1;
  httpStatus: number | null;
  responseTimeMs: number | null;
  failureKind: string | null;
  errorDetails: string;
}

export interface MonitoringStatus {
  enabled: boolean;
  targetConfigured: boolean;
  service: string;
  intervalSeconds: number;
  failureThreshold: number;
  consecutiveFailures: number;
  status: 'healthy' | 'failing' | 'unknown';
  lastCheck: Omit<MonitoringCheck, 'id' | 'service' | 'incidentId'> | null;
}

export interface ServiceHealth {
  service: string;
  consecutiveFailures: number;
  lastStatus: 'healthy' | 'failing' | 'unknown';
  activeIncidentId: string | null;
  observedAt: string | null;
  healthy: boolean | 0 | 1 | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorDetails: string | null;
  activeIncidentCount: number;
}

export interface IncidentEvent {
  id: number;
  incidentId: string;
  eventType: string;
  observedAt: string;
  summary: string;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorDetails: string;
}

export interface IncidentAnalysis {
  id?: number;
  incidentId: string;
  summary: string;
  observedSymptoms: string[];
  supportingEvidence: string[];
  possibleRootCauses: string[];
  potentialImpact: string;
  recommendedSteps: string[];
  timeline: string[];
  missingInformation: string[];
  confidence: string;
  model?: string;
  createdAt?: string;
  status?: string;
}

export interface ChatMessage {
  id?: number;
  incidentId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

async function request<T>(path: string, _options: RequestInit = {}, _timeoutMs = 8000): Promise<T> {
  throw new Error(`Live API is disabled in the isolated baseline preview (${path}).`);
}

export const incidentApi = {
  health: () => request<{ status: string; database: string }>('/api/health'),
  monitoringStatus: () => request<MonitoringStatus>('/api/monitoring/status'),
  services: () => request<ServiceHealth[]>('/api/services'),
  incidentCounts: () => request<{ active: number; resolved: number }>('/api/incidents/summary'),
  list: (status: 'active' | 'resolved' | 'all' = 'active', limit = 100) =>
    request<IncidentRecord[]>(`/api/incidents?status=${status}&limit=${limit}`),
  detail: (incidentId: string) => request<IncidentRecord>(`/api/incidents/${encodeURIComponent(incidentId)}`),
  events: (incidentId: string) => request<IncidentEvent[]>(`/api/incidents/${encodeURIComponent(incidentId)}/events`),
  logs: (incidentId: string) => request<MonitoringCheck[]>(`/api/incidents/${encodeURIComponent(incidentId)}/logs`),
  analyze: (incidentId: string) =>
    request<IncidentAnalysis>(`/api/incidents/${encodeURIComponent(incidentId)}/analysis`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, 45000),
  getAnalysis: (incidentId: string) => request<IncidentAnalysis>(`/api/incidents/${encodeURIComponent(incidentId)}/analysis`),
  chat: (incidentId: string, message: string, conversationId = 'default') =>
    request<{ answer: string; confidence: string; conversationId: string; createdAt: string; incidentId: string }>(
      `/api/incidents/${encodeURIComponent(incidentId)}/chat`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId }),
      }, 45000,
    ),
  listChat: (incidentId: string, conversationId?: string) => {
    const search = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
    return request<ChatMessage[]>(`/api/incidents/${encodeURIComponent(incidentId)}/chat${search}`);
  },
};