import { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { useWords } from './Words';
import { videoFor } from './help-videos.mjs';
import { helpChapters, quickStartCards, searchTopics, topicForPage, topicsFor } from './help-content.mjs';

type Topic = ReturnType<typeof topicsFor>[number];

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Print a one-page quick-start card through a hidden frame (no pop-up window). */
function printCard(title: string, businessName: string, topics: Topic[], w: (text: string) => string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(w(title))}</title>
<style>
@page { size: A4; margin: 12mm; }
body { font: 10.5pt/1.35 system-ui, sans-serif; color: #111; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 2mm; }
.sub { color: #555; margin: 0 0 5mm; }
.grid { columns: 2; column-gap: 8mm; }
section { break-inside: avoid; margin: 0 0 4mm; padding: 3mm 4mm; border: 1px solid #ccc; border-radius: 3mm; }
h2 { font-size: 11.5pt; margin: 0 0 1.5mm; }
ol { margin: 0; padding-left: 5mm; }
li { margin: 0 0 1mm; }
footer { margin-top: 3mm; color: #555; font-size: 9pt; }
</style></head><body>
<h1>${escape(w(title))}</h1>
<p class="sub">${escape(businessName)} · PrintShopLedger</p>
<div class="grid">
${topics
  .map(
    (t) =>
      `<section><h2>${escape(w(t.title))}</h2><ol>${t.steps.map((s) => `<li>${escape(w(s))}</li>`).join('')}</ol></section>`,
  )
  .join('\n')}
</div>
<footer>More help: press ? at the top of any page, or Help in the menu.</footer>
</body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 200);
}

/**
 * The user manual: search, chapters and one topic at a time. Opened from the ? button on a page
 * (showing that page's topic) or from Help in the menu. Shows only topics for the user's rank.
 */
export default function HelpPanel({
  page,
  rank,
  businessName,
  onClose,
}: {
  page: string | null;
  rank: number;
  businessName: string;
  onClose: () => void;
}) {
  const { w } = useWords();
  const topics = useMemo(() => topicsFor(rank), [rank]);
  // The ? on a page opens that page's topic: if they can open the page, they need its help.
  const start = page ? topicForPage(page, 4) : null;
  const [current, setCurrent] = useState<Topic | null>(start);
  const [query, setQuery] = useState('');
  const shown = searchTopics(topics, query);
  const card = quickStartCards[Math.min(Math.max(rank, 1), 3) as 1 | 2 | 3];
  const cardTopics = card.topics.map((id) => topics.find((t) => t.id === id)).filter((t): t is Topic => !!t);
  return (
    <Modal title="Help" wide onClose={onClose} className="help-modal">
      <div className={`help-layout${current ? ' reading' : ''}`}>
        <nav className="help-index" aria-label="Help topics">
          <input
            type="search"
            aria-label="Search help"
            placeholder="Search help, e.g. receipt, offline, discount"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {page && !start && !query && (
            <p className="muted">{w(`No guide for ${page} yet. Choose a topic below.`)}</p>
          )}
          {query ? (
            <ul>
              {shown.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="text-button"
                    aria-current={current?.id === t.id}
                    onClick={() => setCurrent(t)}
                  >
                    {w(t.title)}
                  </button>
                </li>
              ))}
              {!shown.length && <li className="muted">Nothing found. Try another word.</li>}
            </ul>
          ) : (
            helpChapters.map((chapter, index) => {
              const list = topics.filter((t) => t.chapter === chapter.id);
              if (!list.length) return null;
              return (
                <section key={chapter.id}>
                  <h3>
                    {index + 1}. {w(chapter.title)}
                  </h3>
                  <ul>
                    {list.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="text-button"
                          aria-current={current?.id === t.id}
                          onClick={() => setCurrent(t)}
                        >
                          {w(t.title)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
          {cardTopics.length > 0 && (
            <button
              type="button"
              className="secondary help-card-button"
              onClick={() => printCard(card.title, businessName, cardTopics, w)}
            >
              <Icon name="services" /> Print the {card.title.toLowerCase()} card
            </button>
          )}
        </nav>
        <article className="help-topic" aria-live="polite">
          {current ? (
            <>
              <button type="button" className="text-button help-back" onClick={() => setCurrent(null)}>
                ← All topics
              </button>
              <h3>{w(current.title)}</h3>
              <p className="help-summary">{w(current.summary)}</p>
              {(current.video || videoFor(current.id)) && (
                <div className="help-video">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(current.video || videoFor(current.id))}`}
                    title={`Video: ${w(current.title)}`}
                    allow="encrypted-media; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
              )}
              <ol>
                {current.steps.map((step) => (
                  <li key={step}>{w(step)}</li>
                ))}
              </ol>
              {current.notes && current.notes.length > 0 && (
                <div className="notice">
                  <ul>
                    {current.notes.map((note) => (
                      <li key={note}>{w(note)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="help-welcome">
              <h3>How can we help?</h3>
              <p>
                Choose a topic or search. Press <strong>?</strong> at the top of any page for help with that
                page.
              </p>
            </div>
          )}
        </article>
      </div>
    </Modal>
  );
}
