import type { ConfigV1, Engine, PageMode } from '@/lib/config/types';
import { describeError } from '@/lib/error-messages';
import type { AppError } from '@/lib/errors';
import type { PortClient, PortRequest } from '@/lib/messaging/port';
import type {
  PageState,
  PageStatus,
  TranslateChunk,
  TranslateDone,
  TranslateRequest,
} from '@/lib/messaging/protocol';
import { createPacer, discoverUnits, type Unit } from './discover';
import { isInlineElement, OWN_TAG, type StyleReader } from './dom-rules';
import { watchMutations } from './mutations';
import { createRenderer, type Renderer } from './render';
import { injectStyles, removeStyles } from './styles';

// One page-translation session: discovery → viewport queue → Port requests →
// renderer, plus new content and self-healing. Every async step re-checks the
// epoch, so a stopped or restarted session never writes stale results.

type TranslatePort = PortClient<TranslateRequest, TranslateChunk, TranslateDone>;

export interface ViewportObserver {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}

export interface SessionDeps {
  win: Window;
  port: TranslatePort;
  getConfig(): Promise<ConfigV1>;
  /** Live config updates while a session runs (the translation style can change). */
  watchConfig?(callback: (config: ConfigV1) => void): () => void;
  reportStatus(status: PageStatus): void;
  createReadStyle(): StyleReader;
  /** IntersectionObserver with rootMargin 1000px; injectable for tests. */
  createViewport(onChange: (targets: Element[], visible: boolean[]) => void): ViewportObserver;
  createMutationWatch?: typeof watchMutations;
}

export interface PageSession {
  start(options?: { engine?: Engine }): Promise<PageState>;
  stop(): Promise<PageState>;
  toggle(): Promise<PageState>;
  setMode(mode: PageMode): Promise<PageState>;
  retryFailed(): PageState;
  state(): PageState;
}

const BATCH_ITEMS = 50;
const BATCH_CHARS = 8000;
const MAX_IN_FLIGHT = 6;
const FLUSH_DEBOUNCE_MS = 50;
const RENDER_COALESCE_MS = 16;
const SCROLL_QUIET_MS = 150;
const RETRY_DELAYS_MS = [500, 1000, 2000];
const LOOP_WINDOW_MS = 10_000;
const LOOP_LIMIT = 3;
const VIEWPORT_CHUNK = 500;

/** Engine-level problems: shown once, the session pauses instead of failing every paragraph. */
export function isEngineLevel(error: AppError): boolean {
  return (
    error.code.startsWith('config/') ||
    error.code === 'provider/unauthorized' ||
    error.code === 'provider/quota-exceeded' ||
    error.code === 'provider/local-origin-rejected'
  );
}

export function createPageSession(deps: SessionDeps): PageSession {
  const { win, port } = deps;
  const doc = win.document;
  const now = () => Date.now();
  const watch = deps.createMutationWatch ?? watchMutations;

  let epoch = 0;
  let phase: PageState['phase'] = 'idle';
  let halted = false;
  let engine: Engine | undefined;
  let engineError: AppError | undefined;
  let config: ConfigV1 | undefined;
  let renderer: Renderer | undefined;
  let viewport: ViewportObserver | undefined;
  let stopWatching: (() => void) | undefined;
  let stopWatchingConfig: (() => void) | undefined;
  let sheet: HTMLStyleElement | undefined;
  /** This session's own Port requests: stop cancels these, never other features' requests. */
  const requests = new Set<PortRequest<TranslateDone>>();
  let readStyle: StyleReader = deps.createReadStyle();
  let lastScroll = Number.NEGATIVE_INFINITY;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 0;
  let inFlight = 0;
  let stopping: Promise<unknown> | undefined;

  const unitsByRoot = new Map<Element, Unit[]>();
  const ids = new Map<Unit, string>();
  const byId = new Map<string, Unit>();
  const pending = new Set<Unit>();
  const sent = new Set<Unit>();
  const settled = new Set<Unit>();
  const failed = new Set<Unit>();
  const translations = new Map<string, string>();
  const reinserts = new Map<string, number[]>();
  /** Texts a page keeps throwing our translation away for: left alone for the session. */
  const abandoned = new Set<string>();
  /** Roots the viewport observer last reported inside the 1000px margin. */
  const visibleRoots = new Set<Element>();
  const queued = new Set<Unit>();
  const toRender: { unit: Unit; translation: string }[] = [];

  const onScroll = () => {
    lastScroll = now();
  };

  function status(): PageStatus {
    if (phase === 'idle') return 'idle';
    if (engineError || failed.size > 0) return 'error';
    return pending.size > 0 || inFlight > 0 ? 'running' : 'done';
  }

  function report() {
    if (phase === 'idle' || halted) return;
    phase = pending.size > 0 || inFlight > 0 ? 'running' : 'done';
    deps.reportStatus(status());
  }

  function state(): PageState {
    let translated = 0;
    for (const units of unitsByRoot.values()) {
      for (const unit of units) if (renderer?.has(unit)) translated += 1;
    }
    return {
      phase,
      mode: renderer?.mode ?? config?.page.mode ?? 'bilingual',
      translated,
      failed: failed.size,
      engineError,
      engine,
    };
  }

  function idOf(unit: Unit): string {
    let id = ids.get(unit);
    if (!id) {
      id = `u${nextId++}`;
      ids.set(unit, id);
      byId.set(id, unit);
    }
    return id;
  }

  /** Repeated re-insertion of the same text means a framework fight: give up on it. */
  function allowReinsert(text: string): boolean {
    const at = now();
    const recent = (reinserts.get(text) ?? []).filter((time) => at - time < LOOP_WINDOW_MS);
    if (recent.length >= LOOP_LIMIT) {
      abandoned.add(text);
      console.warn('[easy-translate] a page keeps removing a translation; leaving it alone');
      return false;
    }
    recent.push(at);
    reinserts.set(text, recent);
    return true;
  }

  function queueRender(unit: Unit, translation: string) {
    queued.add(unit);
    toRender.push({ unit, translation });
    scheduleRender();
  }

  /** A unit came into range: render from memory, or queue it for the network. */
  function want(unit: Unit): boolean {
    if (
      queued.has(unit) ||
      sent.has(unit) ||
      settled.has(unit) ||
      failed.has(unit) ||
      renderer?.has(unit)
    ) {
      return false;
    }
    const known = translations.get(unit.seg.text);
    if (known !== undefined) {
      queueRender(unit, known);
      return false;
    }
    if (pending.has(unit)) return false;
    pending.add(unit);
    return true;
  }

  function register(units: Unit[]) {
    let added = false;
    for (const unit of units) {
      if (abandoned.has(unit.seg.text)) continue;
      const list = unitsByRoot.get(unit.root);
      if (list) list.push(unit);
      else {
        unitsByRoot.set(unit.root, [unit]);
        viewport?.observe(unit.root);
      }
      // Already-observed roots get no new observer callback: queue them here.
      if (visibleRoots.has(unit.root) && want(unit)) added = true;
    }
    if (added) scheduleFlush();
  }

  function scheduleRender() {
    if (renderTimer !== undefined) return;
    const current = epoch;
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      if (current !== epoch || !renderer) return;
      const batch = toRender.splice(0);
      for (const { unit } of batch) queued.delete(unit);
      if (batch.length === 0) return;
      void renderer.insert(batch).then((stale) => {
        if (current !== epoch) return;
        for (const unit of stale) {
          forget(unit);
          void rescan([unit.root]);
        }
        report();
      });
    }, RENDER_COALESCE_MS);
  }

  function scheduleFlush(immediate = false) {
    if (flushTimer !== undefined) {
      if (!immediate) return;
      clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flush, immediate ? 0 : FLUSH_DEBOUNCE_MS);
  }

  function onViewport(targets: Element[], visible: boolean[]) {
    let changed = false;
    targets.forEach((target, index) => {
      const inRange = visible[index] === true;
      if (inRange) visibleRoots.add(target);
      else visibleRoots.delete(target);
      for (const unit of unitsByRoot.get(target) ?? []) {
        if (inRange ? want(unit) : pending.delete(unit)) changed = true;
      }
    });
    if (changed) scheduleFlush();
  }

  function onViewportChunked(targets: Element[], visible: boolean[]) {
    if (targets.length <= VIEWPORT_CHUNK) {
      onViewport(targets, visible);
      return;
    }
    // A first callback on a huge page can carry tens of thousands of entries.
    const current = epoch;
    let offset = 0;
    const step = () => {
      if (current !== epoch) return;
      onViewport(
        targets.slice(offset, offset + VIEWPORT_CHUNK),
        visible.slice(offset, offset + VIEWPORT_CHUNK),
      );
      offset += VIEWPORT_CHUNK;
      if (offset < targets.length) setTimeout(step, 0);
    };
    step();
  }

  function flush() {
    flushTimer = undefined;
    if (phase === 'idle' || halted || engineError || !config) return;
    if (pending.size === 0) {
      report();
      return;
    }
    const scrolling = now() - lastScroll < SCROLL_QUIET_MS;
    // Read all positions in one pass, then order: visible, below, above.
    const ranked = [...pending]
      .map((unit) => ({ unit, rect: unit.root.getBoundingClientRect() }))
      .map(({ unit, rect }) => {
        const visible = rect.bottom > 0 && rect.top < win.innerHeight;
        const band = visible ? 0 : rect.top >= win.innerHeight ? 1 : 2;
        return { unit, band, top: rect.top };
      })
      .filter((entry) => !scrolling || entry.band === 0)
      .sort((a, b) => a.band - b.band || (a.band === 2 ? b.top - a.top : a.top - b.top));
    let index = 0;
    while (index < ranked.length && inFlight < MAX_IN_FLIGHT) {
      const batch: Unit[] = [];
      let chars = 0;
      while (index < ranked.length && batch.length < BATCH_ITEMS) {
        const entry = ranked[index] as (typeof ranked)[number];
        const size = entry.unit.seg.text.length;
        if (batch.length > 0 && chars + size > BATCH_CHARS) break;
        batch.push(entry.unit);
        chars += size;
        index += 1;
      }
      send(batch, 0);
    }
    if (scrolling && pending.size > 0) scheduleFlush();
    report();
  }

  function send(batch: Unit[], attempt: number) {
    if (!config || batch.length === 0) return;
    const current = epoch;
    for (const unit of batch) {
      pending.delete(unit);
      sent.add(unit);
    }
    inFlight += 1;
    const request = port.request(
      {
        items: batch.map((unit) => ({ id: idOf(unit), text: unit.seg.text })),
        target: config.language.target,
        source: config.language.source,
        engine,
      },
      (chunk) => {
        if (current !== epoch) return;
        const unit = byId.get(chunk.id);
        if (!unit) return;
        sent.delete(unit);
        if ('error' in chunk) {
          if (isEngineLevel(chunk.error)) pause(chunk.error, [unit]);
          else markFailed(unit, chunk.error);
          return;
        }
        if (chunk.disposition !== 'translated') {
          settled.add(unit);
          return;
        }
        translations.set(unit.seg.text, chunk.text);
        failed.delete(unit);
        queueRender(unit, chunk.text);
      },
    );
    requests.add(request);
    void request.outcome.then((outcome) => {
      requests.delete(request);
      if (current !== epoch) return;
      inFlight -= 1;
      // Units the request never answered for (request-level failure or cancel).
      const unanswered = batch.filter((unit) => sent.has(unit));
      for (const unit of unanswered) sent.delete(unit);
      if (outcome.status === 'error') onRequestError(outcome.error, unanswered, attempt);
      else if (outcome.status === 'cancelled') for (const unit of unanswered) pending.add(unit);
      scheduleFlush();
      report();
    });
  }

  /** A whole request failed: never turn that into per-paragraph errors directly. */
  function onRequestError(error: AppError, units: Unit[], attempt: number) {
    if (error.code === 'internal/context-invalidated') {
      halt();
      return;
    }
    if (isEngineLevel(error)) {
      pause(error, units);
      return;
    }
    if (error.code === 'validation/payload-too-large' && units.length > 1) {
      const half = Math.ceil(units.length / 2);
      send(units.slice(0, half), attempt);
      send(units.slice(half), attempt);
      return;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      for (const unit of units) markFailed(unit, error);
      return;
    }
    const current = epoch;
    setTimeout(() => {
      if (current === epoch && !engineError) send(units, attempt + 1);
    }, delay);
  }

  function markFailed(unit: Unit, error: AppError) {
    failed.add(unit);
    void renderer?.fail(unit, () => retry([unit]), describeError(error));
    report();
  }

  function pause(error: AppError, units: Unit[]) {
    if (!engineError) engineError = error;
    for (const unit of units) pending.add(unit);
    report();
  }

  function retry(units: Unit[]) {
    for (const unit of units) {
      failed.delete(unit);
      renderer?.drop(unit);
      pending.add(unit);
    }
    scheduleFlush(true);
  }

  /** Re-discovers changed areas; keeps units whose text and nodes are unchanged. */
  async function rescan(elements: Element[]) {
    if (!renderer || phase === 'idle' || halted) return;
    const current = epoch;
    const roots = new Set<Element>();
    for (const element of elements) {
      let el: Element | null = element;
      while (el && el !== doc.body && isInlineElement(el, readStyle)) el = el.parentElement;
      if (el?.isConnected) roots.add(el);
    }
    for (const root of roots) {
      if (!root.isConnected) continue;
      const found = await discoverUnits(root, {
        readStyle,
        pace: createPacer(),
        cancelled: () => current !== epoch,
      });
      if (current !== epoch) return;
      const kept = new Set<Unit>();
      const fresh: Unit[] = [];
      for (const unit of found) {
        const existing = (unitsByRoot.get(unit.root) ?? []).find(
          (known) =>
            !kept.has(known) &&
            known.kind === unit.kind &&
            known.seg.text === unit.seg.text &&
            renderer?.isCurrent(known) === true,
        );
        if (existing) kept.add(existing);
        else fresh.push(unit);
      }
      // Old units in this area that were not found again: their text changed, their
      // shape changed (a run became a block), or they left. Only a root that was not
      // rediscovered at all may be merely hidden (a dialog marks the page aria-hidden
      // or inert for a while): its still-present, unchanged units are kept.
      const foundRoots = new Set(found.map((unit) => unit.root));
      for (const [unitRoot, units] of [...unitsByRoot]) {
        if (unitRoot.isConnected && !root.contains(unitRoot)) continue;
        const mayBeHidden = unitRoot.isConnected && !foundRoots.has(unitRoot);
        for (const unit of [...units]) {
          if (kept.has(unit)) continue;
          if (mayBeHidden && renderer.isCurrent(unit)) continue;
          forget(unit);
        }
      }
      register(fresh);
    }
    // Translations a framework threw away come back from memory, a few times at most.
    for (const unit of renderer.detached()) {
      forget(unit);
      if (allowReinsert(unit.seg.text) && unit.root.isConnected) await rescan([unit.root]);
      if (current !== epoch) return;
    }
    report();
  }

  function forget(unit: Unit) {
    const list = unitsByRoot.get(unit.root);
    if (list) {
      const index = list.indexOf(unit);
      if (index >= 0) list.splice(index, 1);
    }
    pending.delete(unit);
    sent.delete(unit);
    settled.delete(unit);
    failed.delete(unit);
    queued.delete(unit);
    renderer?.drop(unit);
    // Long-lived pages: nothing may keep a gone unit (and its detached DOM) alive.
    const id = ids.get(unit);
    if (id !== undefined) byId.delete(id);
    ids.delete(unit);
    if (list?.length === 0) {
      unitsByRoot.delete(unit.root);
      if (!unit.root.isConnected) {
        visibleRoots.delete(unit.root);
        viewport?.unobserve(unit.root);
      }
    }
  }

  const isOwn = (node: Node): boolean => {
    let current: Node | null = node;
    while (current) {
      if (current.nodeName === OWN_TAG) return true;
      if (current === sheet) return true;
      current = current.parentNode;
    }
    return false;
  };

  /** Context invalidated (extension updated): stop quietly, keep what is on the page. */
  function halt() {
    halted = true;
    epoch += 1;
    viewport?.disconnect();
    stopWatching?.();
    stopWatchingConfig?.();
    win.removeEventListener('scroll', onScroll, true);
  }

  function clearState() {
    for (const timer of [flushTimer, renderTimer]) if (timer !== undefined) clearTimeout(timer);
    flushTimer = undefined;
    renderTimer = undefined;
    unitsByRoot.clear();
    ids.clear();
    byId.clear();
    pending.clear();
    sent.clear();
    settled.clear();
    failed.clear();
    queued.clear();
    visibleRoots.clear();
    translations.clear();
    reinserts.clear();
    abandoned.clear();
    toRender.length = 0;
    inFlight = 0;
    engineError = undefined;
  }

  /** A failed start (config unreadable) leaves nothing behind. */
  async function start(options: { engine?: Engine } = {}): Promise<PageState> {
    try {
      return await begin(options);
    } catch (error) {
      if (phase !== 'idle') await stop();
      throw error;
    }
  }

  async function begin(options: { engine?: Engine }): Promise<PageState> {
    if (halted) return state();
    if (options.engine !== undefined && options.engine !== engine && phase !== 'idle') {
      // "这次先用 Google": switch the running session's engine and resend what is left.
      engine = options.engine;
      engineError = undefined;
      retry([...failed]);
      scheduleFlush(true);
      return state();
    }
    if (phase !== 'idle') return state();
    epoch += 1;
    const current = epoch;
    clearState();
    phase = 'running';
    // A restore still fading out must finish before new styles go in.
    if (stopping) await stopping;
    if (current !== epoch) return state();
    engine = options.engine;
    deps.reportStatus('running');
    config = await deps.getConfig();
    if (current !== epoch) return state();
    readStyle = deps.createReadStyle();
    sheet = injectStyles(doc);
    renderer = createRenderer({
      win,
      style: config.page.style,
      target: config.language.target,
      // Always the current reader: it is refreshed on every mutation round.
      readStyle: (el) => readStyle(el),
    });
    await renderer.setMode(config.page.mode);
    if (current !== epoch) return state();
    viewport = deps.createViewport(onViewportChunked);
    win.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const units = await discoverUnits(doc.body, {
      readStyle,
      pace: createPacer(),
      cancelled: () => current !== epoch,
    });
    if (current !== epoch) return state();
    register(units);
    stopWatching = watch({
      root: doc.body,
      isOwn,
      onDirty: (elements) => {
        // Fresh computed styles for each round: cached ones go stale on live pages.
        readStyle = deps.createReadStyle();
        void rescan(elements);
      },
    });
    // Only the style follows the setting live; language and engine stay fixed for
    // the session so one page never mixes two target languages.
    let style = config.page.style;
    stopWatchingConfig = deps.watchConfig?.((next) => {
      if (current !== epoch || next.page.style === style) return;
      style = next.page.style;
      renderer?.setStyle(style);
    });
    scheduleFlush(true);
    return state();
  }

  async function stop(): Promise<PageState> {
    if (phase === 'idle') return state();
    epoch += 1;
    for (const request of requests) request.cancel();
    requests.clear();
    stopWatchingConfig?.();
    stopWatchingConfig = undefined;
    viewport?.disconnect();
    viewport = undefined;
    stopWatching?.();
    stopWatching = undefined;
    win.removeEventListener('scroll', onScroll, true);
    const rendererToRestore = renderer;
    const sheetToRemove = sheet;
    sheet = undefined;
    clearState();
    phase = 'idle';
    engine = undefined;
    deps.reportStatus('idle');
    renderer = undefined;
    const done = (async () => {
      await rendererToRestore?.restoreAll();
      removeStyles(sheetToRemove);
    })();
    stopping = done;
    await done;
    if (stopping === done) stopping = undefined;
    return state();
  }

  return {
    start,
    stop,
    toggle: () => (phase === 'idle' ? start() : stop()),
    async setMode(mode) {
      if (!renderer || phase === 'idle') return state();
      await renderer.setMode(mode);
      return state();
    },
    retryFailed() {
      if (engineError) {
        engineError = undefined;
        scheduleFlush(true);
      }
      retry([...failed]);
      return state();
    },
    state,
  };
}
