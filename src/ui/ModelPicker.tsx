// The startup dialog: every actor, what it resolved to, and a file picker to replace it.
//
// This is the tutorial seam made visible. `src/models/registry.ts` has always been the one place a
// model is named, and `src/models/loader.ts` has always reported what happened to it — into the
// console, where a viewer following a video tutorial never looks. So the same records that feed the
// renderers feed this screen instead, with the fallback drawn rather than described.
//
// It is a GATE, not an overlay: App.tsx does not mount the game canvas until START is pressed. That
// is what keeps `overrideActor` as simple as it is — no renderer is holding a geometry when one is
// swapped, so nothing under scene/ has to become reactive about models (the invariant main.tsx
// exists to protect, and MODEL-PIPELINE §1's degrade ladder rests on).

import { useEffect, useRef, useState } from 'react';
import {
  ACTOR_IDS,
  getActor,
  overrideActor,
  revertActor,
  type ResolvedActor,
} from '../models/loader';
import type { ActorId } from '../models/registry';
import { PreviewStage, PreviewTile, type Slots } from './ModelPreview';
import { summarise, type Tone } from './modelRows';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const PREVIEW = 84;

/** Tone → ink. The palette is the game's (ui/GameOver.tsx, ART-STYLE): amber warns, red fails. */
const INK: Record<Tone, string> = {
  ok: '#8fa0b8',
  warn: '#e8b86d',
  bad: '#d1585a',
  muted: '#6c7a8f',
};

const BUTTON: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid #8fa0b855',
  background: '#2a2f38',
  color: '#e8ecf2',
  cursor: 'pointer',
  font: `600 11px ${MONO}`,
  letterSpacing: 1,
};

/** What one actor's row needs from the loader, flattened for `summarise`. */
function view(a: ResolvedActor) {
  return summarise({
    id: a.id,
    url: a.url,
    status: a.status,
    source: a.source,
    uploaded: a.uploaded,
    note: a.note,
    tris: a.tris,
    textured: a.textured,
    clips: a.vat ? a.vat.clips.map((c) => c.name) : [],
    vatMB: a.vat ? a.vat.bytes / 1024 / 1024 : 0,
    shape: a.geometry.type,
    height: a.height,
  });
}

function Row({
  actor,
  busy,
  slots,
  onPick,
  onRevert,
}: {
  actor: ResolvedActor;
  busy: string;
  slots: Slots;
  onPick: (file: File) => void;
  onRevert: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const v = view(actor);

  return (
    <div
      data-model-row={actor.id}
      style={{
        display: 'flex',
        gap: 14,
        padding: '12px 0',
        borderTop: '1px solid #8fa0b822',
        alignItems: 'flex-start',
      }}
    >
      {/* The hole the shared canvas draws this actor into — see ui/ModelPreview.tsx. */}
      <PreviewTile id={actor.id} slots={slots} size={PREVIEW} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <span style={{ font: `700 13px ${MONO}`, letterSpacing: 1 }}>{actor.id}</span>
          <span style={{ font: `700 10px ${MONO}`, letterSpacing: 1.5, color: INK[v.tone] }}>{v.chip}</span>
        </div>

        <div style={{ font: `400 11px ${MONO}`, color: '#8fa0b8', marginTop: 4, wordBreak: 'break-all' }}>
          {v.source}
        </div>
        <div style={{ font: `400 11px ${MONO}`, color: '#6c7a8f', marginTop: 2 }}>{v.facts.join(' · ')}</div>

        {v.note && (
          <div style={{ font: `400 11px ${MONO}`, color: INK[v.tone], marginTop: 6, lineHeight: 1.5 }}>
            {v.note}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            ref={input}
            type="file"
            accept=".glb,model/gltf-binary"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so picking the SAME file twice still fires a change event — which is exactly
              // what a viewer does after re-exporting it from Blender.
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
          <button
            type="button"
            data-model-upload={actor.id}
            disabled={!!busy}
            onClick={() => input.current?.click()}
            style={{ ...BUTTON, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
          >
            {actor.uploaded ? 'REPLACE .GLB' : 'UPLOAD .GLB'}
          </button>
          {actor.uploaded && !busy && (
            <button type="button" onClick={onRevert} style={{ ...BUTTON, color: '#8fa0b8' }}>
              REVERT
            </button>
          )}
          {busy && <span style={{ font: `600 11px ${MONO}`, color: '#ffe9a8' }}>{busy}</span>}
        </div>
      </div>
    </div>
  );
}

export function ModelPicker({ onStart }: { onStart: () => void }) {
  const [actors, setActors] = useState<ResolvedActor[]>(() => ACTOR_IDS.map(getActor));
  const [busy, setBusy] = useState<Partial<Record<ActorId, string>>>({});
  // Where the previews go, and what clips them when the list is scrolled — ui/ModelPreview.tsx.
  const slots = useRef(new Map<ActorId, HTMLElement>());
  const scroller = useRef<HTMLDivElement>(null);

  // Enter starts the run without finding the button, the same courtesy the game-over card extends.
  // Not Space: the list scrolls, and Space is how a keyboard scrolls it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  /** Run one swap and republish the whole list — seven records is not a thing to be clever about. */
  async function swap(id: ActorId, run: (step: (f: number) => void) => Promise<unknown>, verb: string) {
    setBusy((b) => ({ ...b, [id]: `${verb}…` }));
    // A VAT bake is the slow part and it reports progress, so the row counts up rather than sitting
    // on one word for a second and a half (the same reason the boot splash does — main.tsx).
    await run((f) => setBusy((b) => ({ ...b, [id]: `${verb} ${Math.round(f * 100)}%` })));
    setActors(ACTOR_IDS.map(getActor));
    setBusy((b) => ({ ...b, [id]: '' }));
  }

  const anyBusy = Object.values(busy).some(Boolean);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        display: 'grid',
        placeItems: 'center',
        background: '#2a2f38',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 22px',
          borderRadius: 8,
          background: '#1c2027f2',
          border: '1px solid #8fa0b855',
          boxShadow: '0 18px 60px #0009',
          color: '#e8ecf2',
        }}
      >
        <div style={{ font: `700 13px ${MONO}`, letterSpacing: 2, color: '#ffe9a8' }}>MODELS</div>
        <div style={{ font: `400 11px ${MONO}`, color: '#8fa0b8', marginTop: 8, lineHeight: 1.6 }}>
          What the game will draw for each actor, loaded from <code>public/models/</code> and named in{' '}
          <code>src/models/registry.ts</code>. Upload a .glb to try your own — it replaces that actor
          for this tab only, and goes through the same validation, normalisation and animation bake
          as a file you ship.
        </div>

        {/* paddingRight keeps the status chip clear of the scrollbar, which otherwise sits on top of
            the one word in the row that says whether anything is wrong. */}
        <div
          ref={scroller}
          style={{ overflowY: 'auto', margin: '14px 0 4px', paddingRight: 12, flex: 1, minHeight: 0 }}
        >
          {actors.map((a) => (
            <Row
              key={a.id}
              actor={a}
              slots={slots}
              busy={busy[a.id] ?? ''}
              onPick={(file) => swap(a.id, (step) => overrideActor(a.id, file, step), 'reading')}
              onRevert={() => swap(a.id, (step) => revertActor(a.id, step), 'reverting')}
            />
          ))}
        </div>

        <button
          autoFocus
          type="button"
          data-model-start
          disabled={anyBusy}
          onClick={onStart}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '10px 0',
            borderRadius: 5,
            border: 'none',
            cursor: anyBusy ? 'default' : 'pointer',
            background: anyBusy ? '#8fa0b8' : '#ffe9a8',
            color: '#1c2027',
            font: `700 14px ${MONO}`,
            letterSpacing: 1,
          }}
        >
          {anyBusy ? 'WORKING…' : 'START RUN'}
        </button>
      </div>

      {/* One canvas for every row's turntable, laid over the dialog and click-through. Last in the
          tree so the tiles it draws into exist on the frame it first renders. */}
      <PreviewStage actors={actors} slots={slots} scroller={scroller} />
    </div>
  );
}
