import { Action, GroupAction, SplitflapHardware, SplitflapState, scaleGroupActions } from './hardware';
import * as OrderModule from './order';
import { GridOrder, GrowFromCentre } from './order';
import {
    CascadeImage, OneByOne, OneByOneKeepFlipping, SnapTransition,
    TextOrder, textToPixelCoords, Transition, WaveTransition,
} from './transitions';
import { PixelArtTarget, RectangleTarget } from './language2';
import { ALPHABET_WITH_EXCLAMATION } from './constants';

// ── Constants ────────────────────────────────────────────────────────────────
const SW = 32;
const SH = 6;
const REEL = ALPHABET_WITH_EXCLAMATION.split('');
const CELL_W = 16;
const CELL_H = 24;
const PAINTER_CELL = 18;

// ── PainterOrder ─────────────────────────────────────────────────────────────
class PainterOrder extends GridOrder {
    constructor(private grid: number[][]) { super(); }
    generateGrid(_w: number, _h: number): number[][] { return this.grid; }
}

// ── Order registry ────────────────────────────────────────────────────────────
interface OrderDef {
    name: string;
    description: string;
    needsText?: true;
    isPainter?: true;
    create: (text?: string) => GridOrder;
}

const ORDER_DESCRIPTIONS: Record<string, string> = {
    AllAtOnce:          'All units simultaneously',
    LeftToRight:        'Column by column, left to right',
    BottomUp:           'Row by row from bottom',
    MatrixDown:         'Raining columns, staggered',
    Diagonal:           'Diagonal sweep',
    LineDiagonal:       'Sharp diagonal line sweep',
    ShallowDiagonal:    'Shallow angle diagonal',
    MiddleOutDiagonal:  'Diagonals from centre outward',
    SpiralIn:           'Spiral inward from edges',
    SpiralOut:          'Spiral outward from centre',
    SpiralOrder:        'Clockwise spiral',
    GrowFromCentre:     'Radial expand from centre',
    GrowFromPoint:      'Radial expand from a point',
    OutFromCentre:      'Row-based expand from middle row',
    CentrePulse:        'Pulses from centre',
    BackAndForth:       'Snake: left-right alternating rows',
    StaggeredRow:       'Rows with staggered column offsets',
    RowByRowOverlap:    'Overlapping row waves',
    PingPong:           'Bounces between left and right',
    OrganicRipple:      'Irregular ripple effect',
    RandomOrder:        'Random per-unit timing',
    BottomLeftWildfire: 'Spreads from bottom-left corner',
    GrowAlongContour:   'Grows along the contour of the shape',
};

function buildOrderDefs(): OrderDef[] {
    const defs: OrderDef[] = [];
    const seen = new Set<string>();

    for (const [name, val] of Object.entries(OrderModule)) {
        if (typeof val !== 'function' || (val as unknown) === GridOrder) continue;
        try {
            const Cls = val as new () => GridOrder;
            const instance = new Cls();
            if (!(instance instanceof GridOrder)) continue;
            seen.add(name);
            defs.push({ name, description: ORDER_DESCRIPTIONS[name] ?? '', create: () => new Cls() });
        } catch {
            // constructor requires arguments — handled by manual entries below
        }
    }

    // Manual entries for orders needing constructor args or special UI
    const manuals: OrderDef[] = [
        { name: 'GrowFromCentre', description: ORDER_DESCRIPTIONS['GrowFromCentre'] ?? '',
            create: () => new GrowFromCentre((w, h) => [Math.floor(w / 2), Math.floor(h / 2)]) },
        { name: 'TextOrder', description: 'Text pixels first, background second', needsText: true,
            create: (text = 'hello') => new TextOrder(textToPixelCoords(text, {})) },
        { name: 'Custom (Painter)', description: 'Paint your own timing grid', isPainter: true,
            create: () => new PainterOrder(painterGrid) },
    ];

    for (const m of manuals) {
        const idx = defs.findIndex(d => d.name === m.name);
        if (idx !== -1) defs[idx] = m; else defs.push(m);
    }

    return defs;
}

const ORDER_DEFS = buildOrderDefs();

// ── Transition registry ───────────────────────────────────────────────────────
interface TransitionDef {
    name: string;
    description: string;
    needsOrder: boolean;
    create: (order: GridOrder) => Transition;
}

const TRANSITION_DEFS: TransitionDef[] = [
    { name: 'OneByOneKeepFlipping', description: 'Units activate in order, all keep flipping', needsOrder: true,  create: o => new OneByOneKeepFlipping(o) },
    { name: 'CascadeImage',         description: 'Active units flip 2× faster than background', needsOrder: true,  create: o => new CascadeImage(o) },
    { name: 'OneByOne',             description: 'Units flip once, one at a time',               needsOrder: true,  create: o => new OneByOne(o) },
    { name: 'WaveTransition',       description: 'Wave-like sweep of flips',                     needsOrder: true,  create: o => new WaveTransition(o) },
    { name: 'SnapTransition',       description: 'All differing units flip at time t',           needsOrder: false, create: _o => new SnapTransition() },
];

// ── Mutable state ─────────────────────────────────────────────────────────────
let painterGrid: number[][] = Array.from({ length: SH }, () => new Array(SW).fill(0));
let painterMaxValue = 5;
let dragPaintValue = 1;
let isPainting = false;
let selectedOrderIdx = 0;
let selectedTransitionIdx = 0;

let is3dMode = false;
let hw3d: SplitflapHardware | null = null;

let simulatedFrames: string[][] = [];
let currentTick = 0;
let animTimer: ReturnType<typeof setInterval> | null = null;
let isLooping = true;
let speedMs = 100;

let hw: SplitflapHardware;
let srectangle: RectangleTarget;

// ── DOM refs (assigned in init) ───────────────────────────────────────────────
let previewCanvas: HTMLCanvasElement;
let previewCtx: CanvasRenderingContext2D;
let painterCanvas: HTMLCanvasElement;
let painterCtx: CanvasRenderingContext2D;
let tickCounter: HTMLElement;
let transitionSelect: HTMLSelectElement;
let orderSelect: HTMLSelectElement;
let orderField: HTMLElement;
let textField: HTMLElement;
let textInput: HTMLInputElement;
let painterSection: HTMLElement;
let durationInput: HTMLInputElement;
let scaleInput: HTMLInputElement;
let playBtn: HTMLButtonElement;
let loopBtn: HTMLButtonElement;
let speedLabel: HTMLElement;

// ── Colour helpers ────────────────────────────────────────────────────────────
function timeToColor(value: number, maxValue: number): string {
    if (value === 0) return '#222';
    const ratio = Math.min(value / Math.max(maxValue, 1), 1);
    // blue → cyan → green → yellow → red
    const hue = Math.round(240 - ratio * 240);
    return `hsl(${hue}, 85%, 45%)`;
}

// ── Simulation ────────────────────────────────────────────────────────────────
function simulate(groupActions: GroupAction[]): string[][] {
    const numUnits = SW * SH;
    const state = new Array(numUnits).fill(0);
    const maxTick = groupActions.length > 0
        ? Math.ceil(Math.max(...groupActions.map(ga => ga.tPlus)))
        : 0;

    const byTick = new Map<number, GroupAction[]>();
    for (const ga of groupActions) {
        const t = Math.round(ga.tPlus);
        if (!byTick.has(t)) byTick.set(t, []);
        byTick.get(t)!.push(ga);
    }

    const frames: string[][] = [state.map(i => REEL[i])];

    for (let t = 1; t <= maxTick; t++) {
        const gas = byTick.get(t) ?? [];
        for (const ga of gas) {
            for (const [action, ids] of ga.actions) {
                if (action === Action.FLIP || action === Action.INCREMENT) {
                    for (const id of ids) {
                        state[id] = (state[id] + 1) % REEL.length;
                    }
                }
            }
        }
        frames.push([...state.map(i => REEL[i])]);
    }

    return frames;
}

// ── Preview rendering ─────────────────────────────────────────────────────────
function renderPreviewFrame(frame: string[], prevFrame: string[] | null) {
    const ctx = previewCtx;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, SW * CELL_W, SH * CELL_H);

    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const idx = row * SW + col;
            const ch = frame[idx] ?? ' ';
            const changed = prevFrame !== null && prevFrame[idx] !== ch;

            const x = col * CELL_W;
            const y = row * CELL_H;

            ctx.fillStyle = changed ? '#2a1e00' : '#181818';
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

            ctx.fillStyle = changed ? '#ffcc44' : '#bbbbbb';
            ctx.font = `bold ${Math.round(CELL_H * 0.55)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ch, x + CELL_W / 2, y + CELL_H / 2);
        }
    }
}

// ── Animation loop ────────────────────────────────────────────────────────────
function stopAnimation() {
    if (animTimer !== null) { clearInterval(animTimer); animTimer = null; }
}

// ── Generate & play ────────────────────────────────────────────────────────────
function generateAndPlay() {
    const orderDef = ORDER_DEFS[selectedOrderIdx];
    const transDef = TRANSITION_DEFS[selectedTransitionIdx];

    const text = textInput.value || 'hello';
    const order = orderDef.create(text);
    const transition = transDef.create(order);

    const t = Math.max(1, parseInt(durationInput.value) || 200);
    const scale = parseFloat(scaleInput.value) || 1;

    const o1 = new PixelArtTarget([], ' ');
    let groupActions = transition.generateGroupActions(o1, srectangle, t, hw);
    if (scale !== 1) groupActions = scaleGroupActions(groupActions, scale);

    if (is3dMode && hw3d) {
        hw3d.compile(groupActions);
    }

    simulatedFrames = simulate(groupActions);
    currentTick = 0;

    stopAnimation();
    if (simulatedFrames.length === 0) return;

    renderPreviewFrame(simulatedFrames[0], null);
    tickCounter.textContent = `tick 0 / ${simulatedFrames.length - 1}`;

    playBtn.textContent = '⏸ Pause';
    animTimer = setInterval(() => {
        const prev = currentTick > 0 ? simulatedFrames[currentTick - 1] : null;
        renderPreviewFrame(simulatedFrames[currentTick], prev);
        tickCounter.textContent = `tick ${currentTick} / ${simulatedFrames.length - 1}`;
        currentTick++;
        if (currentTick >= simulatedFrames.length) {
            if (isLooping) {
                currentTick = 0;
            } else {
                stopAnimation();
                playBtn.textContent = '▶ Play';
            }
        }
    }, speedMs) as ReturnType<typeof setInterval>;
}

// ── Painter ────────────────────────────────────────────────────────────────────
function renderPainter() {
    const ctx = painterCtx;
    const maxVal = painterMaxValue;

    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const val = painterGrid[row][col];
            const x = col * PAINTER_CELL;
            const y = row * PAINTER_CELL;
            ctx.fillStyle = timeToColor(val, maxVal);
            ctx.fillRect(x, y, PAINTER_CELL - 1, PAINTER_CELL - 1);

            if (val > 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = `bold ${Math.round(PAINTER_CELL * 0.5)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(val), x + PAINTER_CELL / 2, y + PAINTER_CELL / 2);
            }
        }
    }
}

function painterCellAt(e: MouseEvent): [number, number] | null {
    const rect = painterCanvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / PAINTER_CELL);
    const row = Math.floor((e.clientY - rect.top) / PAINTER_CELL);
    if (col < 0 || col >= SW || row < 0 || row >= SH) return null;
    return [col, row];
}

function applyPaint(cell: [number, number], value: number) {
    const [col, row] = cell;
    painterGrid[row][col] = value;
    renderPainter();
}

function syncLegendSelection() {
    document.querySelectorAll('#painter-legend .legend-item').forEach((el, i) => {
        el.classList.toggle('selected', i === dragPaintValue);
    });
}

function buildPainterLegend() {
    const legend = document.getElementById('painter-legend')!;
    legend.innerHTML = '';
    for (let v = 0; v <= painterMaxValue; v++) {
        const item = document.createElement('div');
        item.className = 'legend-item' + (v === dragPaintValue ? ' selected' : '');
        item.style.cursor = 'pointer';
        const swatch = document.createElement('div');
        swatch.className = 'legend-swatch';
        swatch.style.background = timeToColor(v, painterMaxValue);
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(String(v)));
        item.addEventListener('click', () => {
            dragPaintValue = v;
            syncLegendSelection();
        });
        legend.appendChild(item);
    }
}

// ── Order mini-preview canvas ─────────────────────────────────────────────────
function renderOrderMini(canvas: HTMLCanvasElement, order: GridOrder) {
    const cw = 3;
    const ch = 4;
    canvas.width = SW * cw;
    canvas.height = SH * ch;
    const ctx = canvas.getContext('2d')!;
    const grid = order.generateGrid(SW, SH);
    const allVals = grid.flat().filter(v => v >= 0);
    const maxVal = allVals.length > 0 ? Math.max(...allVals) : 1;

    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const val = grid[row][col];
            ctx.fillStyle = val < 0 ? '#0d0d0d' : timeToColor(val, maxVal);
            ctx.fillRect(col * cw, row * ch, cw, ch);
        }
    }
}

// ── UI builders ────────────────────────────────────────────────────────────────
function buildComposerUI() {
    // Transitions
    TRANSITION_DEFS.forEach((def, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = def.name;
        transitionSelect.appendChild(opt);
    });

    transitionSelect.addEventListener('change', () => {
        selectedTransitionIdx = parseInt(transitionSelect.value);
        const needsOrder = TRANSITION_DEFS[selectedTransitionIdx].needsOrder;
        orderField.style.display = needsOrder ? '' : 'none';
    });

    // Orders
    ORDER_DEFS.forEach((def, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = def.name;
        orderSelect.appendChild(opt);
    });

    orderSelect.addEventListener('change', () => {
        selectedOrderIdx = parseInt(orderSelect.value);
        const def = ORDER_DEFS[selectedOrderIdx];
        textField.style.display = def.needsText ? '' : 'none';
        painterSection.style.display = def.isPainter ? '' : 'none';
        // Sync selection in reference panel
        document.querySelectorAll('#orders-pane .ref-item').forEach((el, i) => {
            el.classList.toggle('selected', i === selectedOrderIdx);
        });
    });

    document.getElementById('generate-btn')!.addEventListener('click', generateAndPlay);
}

function buildReferencePanel() {
    const ordersPane = document.getElementById('orders-pane')!;
    ORDER_DEFS.forEach((def, i) => {
        const item = document.createElement('div');
        item.className = 'ref-item' + (i === 0 ? ' selected' : '');
        item.innerHTML = `<div class="ref-item-name">${def.name}${def.needsText ? '<span class="ref-item-badge">text</span>' : ''}${def.isPainter ? '<span class="ref-item-badge">painter</span>' : ''}</div><div class="ref-item-desc">${def.description}</div>`;

        if (!def.needsText && !def.isPainter) {
            try {
                const mini = document.createElement('canvas');
                mini.className = 'ref-item-canvas';
                renderOrderMini(mini, def.create());
                item.appendChild(mini);
            } catch (_) { /* skip if order fails without text */ }
        }

        item.addEventListener('click', () => {
            selectedOrderIdx = i;
            orderSelect.value = String(i);
            const d = ORDER_DEFS[i];
            textField.style.display = d.needsText ? '' : 'none';
            painterSection.style.display = d.isPainter ? '' : 'none';
            document.querySelectorAll('#orders-pane .ref-item').forEach((el, j) => {
                el.classList.toggle('selected', j === i);
            });
        });

        ordersPane.appendChild(item);
    });

    const transitionsPane = document.getElementById('transitions-pane')!;
    TRANSITION_DEFS.forEach((def, i) => {
        const item = document.createElement('div');
        item.className = 'ref-item' + (i === 0 ? ' selected' : '');
        item.innerHTML = `<div class="ref-item-name">${def.name}${def.needsOrder ? '<span class="ref-item-badge">order</span>' : ''}</div><div class="ref-item-desc">${def.description}</div>`;

        item.addEventListener('click', () => {
            selectedTransitionIdx = i;
            transitionSelect.value = String(i);
            const needsOrder = def.needsOrder;
            orderField.style.display = needsOrder ? '' : 'none';
            document.querySelectorAll('#transitions-pane .ref-item').forEach((el, j) => {
                el.classList.toggle('selected', j === i);
            });
        });

        transitionsPane.appendChild(item);
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = (btn as HTMLElement).dataset['tab']!;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tab}-pane`)!.classList.add('active');
        });
    });
}

function buildPainter() {
    painterCanvas.width = SW * PAINTER_CELL;
    painterCanvas.height = SH * PAINTER_CELL;
    renderPainter();
    buildPainterLegend();

    painterCanvas.addEventListener('mousedown', e => {
        e.preventDefault();
        isPainting = true;
        const cell = painterCellAt(e);
        if (!cell) return;
        if (e.button === 2) {
            dragPaintValue = 0;
            syncLegendSelection();
        }
        applyPaint(cell, e.button === 2 ? 0 : dragPaintValue);
    });
    painterCanvas.addEventListener('mousemove', e => {
        if (!isPainting) return;
        const cell = painterCellAt(e);
        if (cell) applyPaint(cell, e.buttons === 2 ? 0 : dragPaintValue);
    });
    painterCanvas.addEventListener('mouseup', () => { isPainting = false; });
    painterCanvas.addEventListener('mouseleave', () => { isPainting = false; });
    painterCanvas.addEventListener('contextmenu', e => e.preventDefault());

    document.getElementById('max-value')!.addEventListener('input', e => {
        painterMaxValue = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1);
        renderPainter();
        buildPainterLegend();
    });

    document.getElementById('clear-painter')!.addEventListener('click', () => {
        painterGrid = Array.from({ length: SH }, () => new Array(SW).fill(0));
        renderPainter();
    });

    document.getElementById('fill-painter')!.addEventListener('click', () => {
        for (let row = 0; row < SH; row++) {
            for (let col = 0; col < SW; col++) {
                painterGrid[row][col] = row + 1;
            }
        }
        renderPainter();
    });

    document.getElementById('export-ts-btn')!.addEventListener('click', () => {
        const modal = document.getElementById('export-modal')!;
        modal.style.display = 'flex';
        refreshExportCode();
    });
}

function generateExportCode(className: string): string {
    const rows = painterGrid
        .map(row => `            [${row.join(', ')}]`)
        .join(',\n');
    return (
        `import { GridOrder } from './order';\n\n` +
        `export class ${className} extends GridOrder {\n` +
        `    generateGrid(_width: number, _height: number): number[][] {\n` +
        `        return [\n${rows}\n        ];\n` +
        `    }\n` +
        `}`
    );
}

function refreshExportCode() {
    const name = (document.getElementById('export-classname') as HTMLInputElement).value || 'CustomOrder';
    (document.getElementById('export-code') as HTMLTextAreaElement).value = generateExportCode(name);
}

function buildExportModal() {
    document.getElementById('export-classname')!.addEventListener('input', refreshExportCode);
    document.getElementById('export-copy-btn')!.addEventListener('click', () => {
        const code = (document.getElementById('export-code') as HTMLTextAreaElement).value;
        navigator.clipboard.writeText(code);
    });
    document.getElementById('export-close-btn')!.addEventListener('click', () => {
        document.getElementById('export-modal')!.style.display = 'none';
    });
    document.getElementById('export-modal')!.addEventListener('click', e => {
        if (e.target === e.currentTarget) {
            (e.currentTarget as HTMLElement).style.display = 'none';
        }
    });
}

function buildPreviewControls() {
    previewCanvas.width = SW * CELL_W;
    previewCanvas.height = SH * CELL_H;

    playBtn.addEventListener('click', () => {
        if (animTimer !== null) {
            stopAnimation();
            playBtn.textContent = '▶ Play';
        } else {
            if (simulatedFrames.length === 0) { generateAndPlay(); return; }
            playBtn.textContent = '⏸ Pause';
            animTimer = setInterval(() => {
                const prev = currentTick > 0 ? simulatedFrames[currentTick - 1] : null;
                renderPreviewFrame(simulatedFrames[currentTick], prev);
                tickCounter.textContent = `tick ${currentTick} / ${simulatedFrames.length - 1}`;
                currentTick++;
                if (currentTick >= simulatedFrames.length) {
                    if (isLooping) { currentTick = 0; }
                    else { stopAnimation(); playBtn.textContent = '▶ Play'; }
                }
            }, speedMs) as ReturnType<typeof setInterval>;
        }
    });

    loopBtn.addEventListener('click', () => {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);
    });

    const sim3dBtn = document.getElementById('sim3d-btn') as HTMLButtonElement;
    const simContainer = document.getElementById('sim-container') as HTMLElement;
    sim3dBtn.addEventListener('click', () => {
        is3dMode = !is3dMode;
        sim3dBtn.classList.toggle('active', is3dMode);
        simContainer.style.display = is3dMode ? 'block' : 'none';
        if (is3dMode && hw3d === null) {
            hw3d = SplitflapHardware.Rectangular(SW, SH, (_x, _y) => REEL.map(s => new SplitflapState(s)), simContainer);
        }
        if (is3dMode && simulatedFrames.length > 0) {
            generateAndPlay();
        }
    });

    const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
    speedSlider.addEventListener('input', () => {
        speedMs = parseInt(speedSlider.value);
        speedLabel.textContent = `${speedMs}ms`;
        if (animTimer !== null) {
            stopAnimation();
            playBtn.click(); // restart at new speed
        }
    });
}

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
    hw = SplitflapHardware.Headless(SW, SH, (_x, _y) => REEL.map(s => new SplitflapState(s)));
    srectangle = new RectangleTarget(SW, SH, [0, 0], [SW, SH]);

    previewCanvas   = document.getElementById('preview-canvas') as HTMLCanvasElement;
    previewCtx      = previewCanvas.getContext('2d')!;
    painterCanvas   = document.getElementById('painter-canvas') as HTMLCanvasElement;
    painterCtx      = painterCanvas.getContext('2d')!;
    tickCounter     = document.getElementById('tick-counter')!;
    transitionSelect = document.getElementById('transition-select') as HTMLSelectElement;
    orderSelect     = document.getElementById('order-select') as HTMLSelectElement;
    orderField      = document.getElementById('order-field')!;
    textField       = document.getElementById('text-field')!;
    textInput       = document.getElementById('text-input') as HTMLInputElement;
    painterSection  = document.getElementById('painter-section')!;
    durationInput   = document.getElementById('duration-input') as HTMLInputElement;
    scaleInput      = document.getElementById('scale-input') as HTMLInputElement;
    playBtn         = document.getElementById('play-btn') as HTMLButtonElement;
    loopBtn         = document.getElementById('loop-btn') as HTMLButtonElement;
    speedLabel      = document.getElementById('speed-label')!;

    buildPreviewControls();
    buildComposerUI();
    buildReferencePanel();
    buildPainter();
    buildExportModal();

    generateAndPlay();
}

document.addEventListener('DOMContentLoaded', init);
