import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { incidentApi, type ChatMessage, type IncidentRecord } from '../services/api';
import { Button, ErrorState, formatDate, Icon, PageIntro, SkeletonRows, StateBox } from '../components/ui';

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
      <PageIntro eyebrow="Operations / Investigation" title="AI assistant" description="A persisted, incident-scoped conversation for exploring recorded evidence and investigation questions." />
      {incidentError && <ErrorState message={incidentError} retry={() => setRetry((value) => value + 1)} />}
      <div className="assistant-layout">
        <section className="panel conversation-panel" aria-label="Incident assistant conversation">
          <header className="conversation-head">
            <div><h3>{selectedIncident ? selectedIncident.title : 'Incident conversation'}</h3><p>{selectedIncident ? `${selectedIncident.service} · ${selectedIncident.id}` : 'Choose an incident to begin'}</p></div>
            {selectedIncident && <span className={`status-badge ${selectedIncident.status}`}>{selectedIncident.status}</span>}
          </header>
          {!incidentId ? (
            <div style={{ padding: 17 }}>
              {incidentError ? null : incidents.length === 0 ? <StateBox icon="forum" title="No incident context available">The assistant requires an incident record so its context is grounded in backend data.</StateBox> : (
                <label className="incident-picker">
                  <span>Select incident context</span>
                  <select aria-label="Select incident context" value="" onChange={(event) => { if (event.target.value) onSelectIncident(event.target.value); }}>
                    <option value="">Choose an incident</option>
                    {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.status.toUpperCase()} · {incident.service} · {incident.title}</option>)}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <>
              <div className="chat-context"><Icon name="info" /><span>Responses use the selected incident context. Chat history is stored by the backend and this browser session.</span></div>
              <div className="chat-messages" aria-live="polite" aria-busy={historyLoading || sending}>
                {historyLoading ? <SkeletonRows count={3} /> : history.length === 0 ? <StateBox icon="forum" title="No messages yet">Ask a specific question about the incident record or evidence.</StateBox> : history.map((entry, index) => (
                  <article key={`${entry.id ?? entry.createdAt}-${entry.role}-${index}`} className={`chat-message ${entry.role}`}>
                    <header className="chat-message-header"><strong>{entry.role === 'assistant' ? 'Incident assistant' : 'You'}</strong><time>{formatDate(entry.createdAt)}</time></header>
                    <p>{entry.content}</p>
                  </article>
                ))}
                {sending && <p className="analysis-copy" role="status">Sending your question to the incident assistant…</p>}
                <div ref={bottomRef} />
              </div>
              {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Reload conversation</button></div>}
              <form className="composer" onSubmit={submit}>
                <textarea aria-label="Message to incident assistant" placeholder="Ask about the incident, its evidence, or what to investigate next…" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={handleKeyDown} rows={2} maxLength={4000} disabled={sending || historyLoading} />
                <Button type="submit" className="primary" disabled={sending || historyLoading || !message.trim()} icon={sending ? 'progress_activity' : 'send'}>{sending ? 'Sending…' : 'Send'}</Button>
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
          <h3 style={{ marginTop: 20 }}>Suggested questions</h3>
          <p>Prompts are suggestions only; responses come from the incident assistant API.</p>
          <div className="prompt-list">
            {['What happened according to the recorded timeline?', 'Which evidence supports the current hypothesis?', 'What should I investigate next?'].map((prompt) => (
              <button key={prompt} className="prompt-button" type="button" onClick={() => { setMessage(prompt); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus(); }} disabled={!incidentId || sending}>{prompt}</button>
            ))}
          </div>
        </aside>
      </div>
      <p className="footer-note">Assistant output is advisory. No incident status changes are made by chat responses.</p>
    </>
  );
}