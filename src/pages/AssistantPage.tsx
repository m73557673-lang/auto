import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { incidentApi, type ChatMessage, type IncidentRecord } from '../services/api';
import { Button, ErrorState, formatDate, Icon, PageIntro, SkeletonRows, StateBox, VitalityDogAvatar, VitalityMascotBanner } from '../components/ui';

function conversationForIncident(incidentId: string) {
  const key = `commander:conversation:${incidentId}`;
  const stored = window.sessionStorage.getItem(key);
  if (stored) return stored;
  const created = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

export default function AssistantPage({
  refreshKey, incidentId, onSelectIncident,
}: { refreshKey: number; incidentId: string | null; onSelectIncident: (id: string) => void }) {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    incidentApi.list('all', 100)
      .then((result) => { if (live) { setIncidents(result); setIncidentError(null); } })
      .catch((failure: unknown) => { if (live) setIncidentError(failure instanceof Error ? failure.message : 'Incident records could not be loaded.'); });
    return () => { live = false; };
  }, [refreshKey, retry]);

  useEffect(() => {
    if (!incidentId) {
      setHistory([]);
      setConversationId('');
      setHistoryLoading(false);
      setError(null);
      return;
    }
    let live = true;
    const selectedConversation = conversationForIncident(incidentId);
    setConversationId(selectedConversation);
    setHistory([]);
    setHistoryLoading(true);
    setError(null);
    incidentApi.listChat(incidentId, selectedConversation)
      .then((result) => { if (live) setHistory(result); })
      .catch((failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : 'Could not load this conversation history.'); })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [incidentId, retry]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [history.length, sending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = message.trim();
    if (!incidentId || !content || !conversationId || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await incidentApi.chat(incidentId, content, conversationId);
      const nextConversation = response.conversationId || conversationId;
      window.sessionStorage.setItem(`commander:conversation:${incidentId}`, nextConversation);
      setConversationId(nextConversation);
      setHistory((current) => [
        ...current,
        { incidentId, conversationId: nextConversation, role: 'user', content, createdAt: new Date().toISOString() },
        { incidentId, conversationId: nextConversation, role: 'assistant', content: response.answer, createdAt: response.createdAt },
      ]);
      setMessage('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'AI chat is unavailable right now.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const selectedIncident = incidents.find((incident) => incident.id === incidentId);

  return (
    <>
      <VitalityMascotBanner
        badge="Stanley AI Commander"
        title="AI-Powered Incident Investigation & Triage"
        description="Stanley analyzes live telemetry logs, correlates error codes, and proposes step-by-step mitigation workflows in real time."
        accent="magenta"
      />

      <PageIntro eyebrow="Vitality AI / Investigation" title="Stanley AI Assistant" description="A persistent, incident-scoped conversation powered by Stanley to analyze telemetry evidence and guide response actions." />
      {incidentError && <ErrorState message={incidentError} retry={() => setRetry((value) => value + 1)} />}
      <div className="assistant-layout">
        <section className="panel conversation-panel" aria-label="Incident assistant conversation">
          <header className="conversation-head">
            <div className="conversation-head-left">
              <VitalityDogAvatar size={42} status={selectedIncident?.status === 'active' ? 'alert' : 'online'} />
              <div>
                <h3>{selectedIncident ? `Stanley on ${selectedIncident.service}` : 'Stanley Incident Assistant'}</h3>
                <p>{selectedIncident ? `${selectedIncident.title} · ${selectedIncident.id}` : 'Choose an incident to begin'}</p>
              </div>
            </div>
            {selectedIncident && <span className={`status-badge ${selectedIncident.status}`}>{selectedIncident.status}</span>}
          </header>
          {!incidentId ? (
            <div style={{ padding: 22 }}>
              {incidentError ? null : incidents.length === 0 ? <StateBox icon="forum" title="No incident context available">The assistant requires an incident record so its context is grounded in backend data.</StateBox> : (
                <div style={{ textAlign: 'center', maxWidth: 440, margin: '20px auto' }}>
                  <img src="/assets/vitality_dog_circle_avatar.png" alt="Stanley" style={{ width: 68, height: 68, borderRadius: '50%', border: '3px solid var(--vitality-pink)', marginBottom: 12 }} />
                  <h4 style={{ margin: '0 0 6px', fontSize: 16 }}>Ready to investigate with Stanley!</h4>
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 16px' }}>Select an incident context below so Stanley can inspect the telemetry and answer your questions.</p>
                  <label className="incident-picker" style={{ textAlign: 'left' }}>
                    <span>Select incident context</span>
                    <select aria-label="Select incident context" value="" onChange={(event) => { if (event.target.value) onSelectIncident(event.target.value); }}>
                      <option value="">Choose an incident</option>
                      {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.status.toUpperCase()} · {incident.service} · {incident.title}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="chat-context">
                <Icon name="info" />
                <span>Responses are grounded in the selected incident telemetry. Chat history is preserved per session.</span>
              </div>
              <div className="chat-messages" aria-live="polite" aria-busy={historyLoading || sending}>
                {historyLoading ? (
                  <SkeletonRows count={3} />
                ) : history.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                    <img src="/assets/vitality_dog_circle_avatar.png" alt="Stanley" style={{ width: 60, height: 60, borderRadius: '50%', border: '2px solid var(--vitality-pink)', marginBottom: 10 }} />
                    <strong style={{ display: 'block', fontSize: 14 }}>Woof! I'm Stanley, your Vitality Incident Assistant.</strong>
                    <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 380, margin: '6px auto 0' }}>
                      Ask me about the recorded timeline, failure hypotheses, or what action to take next to restore service health!
                    </p>
                  </div>
                ) : (
                  history.map((entry, index) => (
                    <div key={`${entry.id ?? entry.createdAt}-${entry.role}-${index}`} className={`chat-message-row ${entry.role}`}>
                      {entry.role === 'assistant' && (
                        <VitalityDogAvatar size={34} status="online" />
                      )}
                      <article className="chat-message">
                        <header className="chat-message-header">
                          <strong className={entry.role === 'assistant' ? 'stanley-tag' : ''}>
                            {entry.role === 'assistant' ? 'Stanley (Vitality AI)' : 'You'}
                          </strong>
                          <time>{formatDate(entry.createdAt)}</time>
                        </header>
                        <p>{entry.content}</p>
                      </article>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="chat-message-row assistant">
                    <VitalityDogAvatar size={34} status="alert" />
                    <article className="chat-message" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite', color: 'var(--vitality-pink)' }}>progress_activity</span>
                      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Stanley is analyzing telemetry and formulating response…</span>
                    </article>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Reload conversation</button></div>}
              <form className="composer" onSubmit={submit}>
                <textarea
                  aria-label="Message to incident assistant"
                  placeholder="Ask Stanley about the incident, its evidence, or what to investigate next…"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  maxLength={4000}
                  disabled={sending || historyLoading}
                />
                <Button type="submit" className="primary" disabled={sending || historyLoading || !message.trim()} icon={sending ? 'progress_activity' : 'send'}>
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </form>
            </>
          )}
        </section>
        <aside className="panel assistant-aside" aria-label="Assistant context and prompts">
          <div className="incident-picker">
            <label htmlFor="assistant-incident">Incident context</label>
            <select id="assistant-incident" value={incidentId ?? ''} onChange={(event) => { if (event.target.value) onSelectIncident(event.target.value); }}>
              <option value="">Select an incident</option>
              {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.service} · {incident.title}</option>)}
            </select>
          </div>
          <h3 style={{ marginTop: 22 }}>Stanley's Suggested Prompts</h3>
          <p>Click any prompt below to query Stanley about this incident:</p>
          <div className="prompt-list">
            {[
              '🐾 What happened according to the recorded timeline?',
              '🐾 Which telemetry evidence supports the current hypothesis?',
              '🐾 What should I investigate next to resolve this?',
              '🐾 What is the estimated business and customer impact?',
            ].map((prompt) => (
              <button
                key={prompt}
                className="prompt-button"
                type="button"
                onClick={() => {
                  setMessage(prompt.replace('🐾 ', ''));
                  document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                }}
                disabled={!incidentId || sending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </aside>
      </div>
      <p className="footer-note">Stanley's AI output is advisory. Decisions remain with your engineering team.</p>
    </>
  );
}