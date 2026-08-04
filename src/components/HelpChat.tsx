import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X, Send } from 'lucide-react';
import { HELP_CONTENT, HELP_CATEGORIES, searchHelp, HelpEntry, ScoredHelpEntry } from '../data/helpContent';

type Message =
  | { from: 'user'; text: string }
  | { from: 'app'; kind: 'answer'; entry: HelpEntry }
  | { from: 'app'; kind: 'choices'; entries: HelpEntry[] }
  | { from: 'app'; kind: 'none' }
  | { from: 'app'; kind: 'welcome' };

function AnswerBubble({ entry }: { entry: HelpEntry }) {
  return (
    <div className="bg-slate-100 rounded-lg px-3 py-2 max-w-[85%]">
      <p className="text-xs font-semibold text-emerald-700 mb-1">{entry.question}</p>
      {entry.answer.split('\n\n').map((para, i) => (
        <p key={i} className="text-sm text-slate-700 whitespace-pre-line mb-1.5 last:mb-0">
          {para}
        </p>
      ))}
    </div>
  );
}

export default function HelpChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ from: 'app', kind: 'welcome' }]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  function ask(text: string) {
    if (!text.trim()) return;
    const results: ScoredHelpEntry[] = searchHelp(text, 5);
    setMessages((prev) => {
      const next: Message[] = [...prev, { from: 'user', text }];
      const top = results[0];
      const runnerUp = results[1];
      // A top score clearly ahead of the next one is shown directly; a close
      // spread means the question was ambiguous, so offer a pick-list
      // instead of guessing which one the user actually meant.
      if (!top) {
        next.push({ from: 'app', kind: 'none' });
      } else if (!runnerUp || top.score >= runnerUp.score + 3) {
        next.push({ from: 'app', kind: 'answer', entry: top.entry });
      } else {
        next.push({ from: 'app', kind: 'choices', entries: results.map((r) => r.entry) });
      }
      return next;
    });
    setInput('');
  }

  function pickEntry(entry: HelpEntry) {
    setMessages((prev) => [...prev, { from: 'user', text: entry.question }, { from: 'app', kind: 'answer', entry }]);
  }

  function pickCategory(category: string) {
    const entries = HELP_CONTENT.filter((e) => e.category === category);
    setMessages((prev) => [...prev, { from: 'user', text: category }, { from: 'app', kind: 'choices', entries }]);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full p-3 shadow-lg"
        title="Help"
      >
        <HelpCircle size={22} />
      </button>

      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-full max-w-sm h-[70vh] max-h-[560px] bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <HelpCircle size={16} className="text-emerald-600" /> Help
            </h3>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => {
              if (m.from === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-emerald-600 text-white rounded-lg px-3 py-2 max-w-[85%] text-sm">{m.text}</div>
                  </div>
                );
              }
              if (m.kind === 'welcome') {
                return (
                  <div key={i} className="space-y-2">
                    <div className="bg-slate-100 rounded-lg px-3 py-2 max-w-[85%]">
                      <p className="text-sm text-slate-700">
                        Ask me how to do anything in this app - e.g. "how do I add a sale" or "what is capital" - or pick a topic below.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {HELP_CATEGORIES.map((c) => (
                        <button key={c} onClick={() => pickCategory(c)} className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-full">
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }
              if (m.kind === 'answer') {
                return (
                  <div key={i}>
                    <AnswerBubble entry={m.entry} />
                  </div>
                );
              }
              if (m.kind === 'choices') {
                return (
                  <div key={i} className="bg-slate-100 rounded-lg px-3 py-2 max-w-[90%]">
                    <p className="text-sm text-slate-700 mb-1.5">Did you mean one of these?</p>
                    <div className="flex flex-col gap-1">
                      {m.entries.map((e) => (
                        <button key={e.id} onClick={() => pickEntry(e)} className="text-left text-sm text-emerald-700 hover:underline">
                          {e.question}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }
              // kind === 'none'
              return (
                <div key={i} className="space-y-2">
                  <div className="bg-slate-100 rounded-lg px-3 py-2 max-w-[85%]">
                    <p className="text-sm text-slate-700">
                      I don't have an answer for that yet. Here are the topics I can help with:
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {HELP_CATEGORIES.map((c) => (
                      <button key={c} onClick={() => pickCategory(c)} className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-2.5 py-1 rounded-full">
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 p-3 border-t border-slate-100">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(input); }}
              placeholder="Ask a question..."
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            />
            <button onClick={() => ask(input)} className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
