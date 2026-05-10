import { Action, GroupAction, SplitflapHardware, SplitflapState, scaleGroupActions } from './hardware';
import * as OrderModule from './order';
import { GridOrder, GrowFromCentre } from './order';
import {
    CascadeImage, diffIndices, EvenOddRhythmTransition, FlipConstantSpeed, FlipDirectional, FlipSyncEnd,
    generateMaskFromCoords, OneByOne, OneByOneKeepFlipping, SnapTransition,
    StaggeredRateTransition, textToPixelCoords, Transition,
    VerticalDriftRateTransition, WaveTransition,
} from './transitions';
import { Colour, PixelArtTarget, Target } from './language2';
import { ALPHABET_WITH_EXCLAMATION } from './constants';
import { frameDisplay } from './util';

// ── Constants ────────────────────────────────────────────────────────────────
const SW = 32;
const SH = 6;
let REEL = ALPHABET_WITH_EXCLAMATION.split('');
const CELL_W = 16;
const CELL_H = 24;
const PAINTER_CELL = 18;
const SHAPE_CELL = 10;
const CHAR_W = 16;
const CHAR_H = 22;

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
    needsFlipsPerSecond?: boolean;
    needsSyncStart?: boolean;
    needsOnChar?: boolean;
    create: (order: GridOrder) => Transition;
}

const TRANSITION_DEFS: TransitionDef[] = [
    { name: 'OneByOneKeepFlipping', description: 'Units activate in order, all keep flipping', needsOrder: true,  create: o => new OneByOneKeepFlipping(o) },
    { name: 'CascadeImage',         description: 'Active units flip 2× faster than background', needsOrder: true,  create: o => new CascadeImage(o) },
    { name: 'OneByOne',             description: 'Units flip once, one at a time',               needsOrder: true,  create: o => new OneByOne(o) },
    { name: 'WaveTransition',       description: 'Wave-like sweep of flips',                     needsOrder: true,  create: o => new WaveTransition(o) },
    { name: 'SnapTransition',       description: 'All differing units flip at time t',           needsOrder: false, create: _o => new SnapTransition() },
    { name: 'StaggeredRate',        description: 'Each order group fires at orderVal × delay',    needsOrder: true,  create: o => new StaggeredRateTransition(o) },
    { name: 'VerticalDriftRate',    description: 'Flip rate depends on vertical offset from prev group', needsOrder: true, create: o => new VerticalDriftRateTransition(o) },
    { name: 'EvenOddRhythm',        description: 'Even groups: 1,2,1,2… / Odd groups: 2,1,2,1…',       needsOrder: true,  create: o => new EvenOddRhythmTransition(o) },
    { name: 'FlipConstantSpeed',    description: 'Each unit flips at a fixed rate to reach its target',  needsOrder: false, needsFlipsPerSecond: true, needsOnChar: true, create: _o => new FlipConstantSpeed() },
    { name: 'FlipDirectional',      description: 'Units flip in order direction, sync or staggered',     needsOrder: true,  needsFlipsPerSecond: true, needsSyncStart: true, needsOnChar: true, create: o => new FlipDirectional(o) },
    { name: 'FlipSyncEnd',          description: 'Units speed-match so all finish at the same time',     needsOrder: false, needsFlipsPerSecond: true, needsSyncStart: true, needsOnChar: true, create: _o => new FlipSyncEnd() },
];

// ── Mutable state ─────────────────────────────────────────────────────────────
let painterGrid: number[][] = Array.from({ length: SH }, () => new Array(SW).fill(0));
let painterMaxValue = 5;
let dragPaintValue = 1;
let isPainting = false;

let startGrid: boolean[][] = Array.from({ length: SH }, () => new Array(SW).fill(false));
let endGrid:   boolean[][] = Array.from({ length: SH }, () => new Array(SW).fill(true));
let shapeDragValue = false;
let shapeDragTarget: 'start' | 'end' | null = null;

let startCharGrid: string[][] = Array.from({ length: SH }, () => new Array(SW).fill(' '));
let endCharGrid:   string[][] = Array.from({ length: SH }, () => new Array(SW).fill(' '));
let charFocusedCell: [number, number] | null = null;
let charFocusedTarget: 'start' | 'end' | null = null;
let useCharSource = false;

let selectedOrderIdx = 0;
let selectedTransitionIdx = 0;

let is3dMode = false;
let hw3d: SplitflapHardware | null = null;
let simContainer: HTMLElement;

let simulatedFrames: string[][] = [];
let currentTick = 0;
let animTimer: ReturnType<typeof setInterval> | null = null;
let isLooping = true;
let speedMs = 100;

let hw: SplitflapHardware;

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
let reelInput: HTMLInputElement;
let fpsInput!: HTMLInputElement;
let fpsField!: HTMLElement;
let syncStartInput!: HTMLInputElement;
let syncStartField!: HTMLElement;
let startShapeCanvas!: HTMLCanvasElement;
let startShapeCtx!: CanvasRenderingContext2D;
let endShapeCanvas!: HTMLCanvasElement;
let endShapeCtx!: CanvasRenderingContext2D;
let maskVizCanvas!: HTMLCanvasElement;
let startCharCanvas!: HTMLCanvasElement;
let startCharCtx!: CanvasRenderingContext2D;
let endCharCanvas!: HTMLCanvasElement;
let endCharCtx!: CanvasRenderingContext2D;
let sourceSelect!: HTMLSelectElement;

// ── Shape helpers ─────────────────────────────────────────────────────────────

function toShiftedPixelArt(grid: (string | boolean)[][], reel: string[], offset = 2): PixelArtTarget {
    const defaultOn = reel.find(c => c !== ' ') ?? reel[0];
    const shifted = grid.map(row =>
        row.map(cell => {
            const ch = cell === true ? defaultOn : cell === false ? ' ' : cell as string;
            const idx = reel.indexOf(ch);
            return idx === -1 ? ch : reel[(idx + offset) % reel.length];
        })
    );
    return new PixelArtTarget(shifted, ' ');
}

function gridToPixelArt(grid: boolean[][]): PixelArtTarget {
    return new PixelArtTarget(grid.map(row => row.map(v => v as unknown as Colour)), false as unknown as Colour);
}

function renderShapeCanvas(ctx: CanvasRenderingContext2D, grid: boolean[][]) {
    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const x = col * SHAPE_CELL;
            const y = row * SHAPE_CELL;
            ctx.fillStyle = grid[row][col] ? '#c8a040' : '#1a1a1a';
            ctx.fillRect(x, y, SHAPE_CELL - 1, SHAPE_CELL - 1);
        }
    }
}

const SHAPE_ON_CHAR = 'd';

function syncCharFromShape(which: 'start' | 'end') {
    const shapeGrid = which === 'start' ? startGrid : endGrid;
    const charGrid  = which === 'start' ? startCharGrid : endCharGrid;
    const charCtx   = which === 'start' ? startCharCtx : endCharCtx;
    for (let r = 0; r < SH; r++)
        for (let c = 0; c < SW; c++)
            charGrid[r][c] = shapeGrid[r][c] ? SHAPE_ON_CHAR : ' ';
    renderCharCanvas(charCtx, charGrid, null);
}

function shapeCanvasCellAt(e: MouseEvent, canvas: HTMLCanvasElement): [number, number] | null {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / SHAPE_CELL);
    const row = Math.floor((e.clientY - rect.top) / SHAPE_CELL);
    if (col < 0 || col >= SW || row < 0 || row >= SH) return null;
    return [col, row];
}

function textToGrid(text: string): boolean[][] {
    const grid = Array.from({ length: SH }, () => new Array(SW).fill(false));
    const vOffset = Math.floor((SH - 5) / 2);
    for (const [col, row] of textToPixelCoords(text, { verticalOffset: vOffset })) {
        if (col >= 0 && col < SW && row >= 0 && row < SH) grid[row][col] = true;
    }
    return grid;
}

function buildShapeCanvases() {
    startShapeCanvas.width = SW * SHAPE_CELL;
    startShapeCanvas.height = SH * SHAPE_CELL;
    endShapeCanvas.width = SW * SHAPE_CELL;
    endShapeCanvas.height = SH * SHAPE_CELL;

    renderShapeCanvas(startShapeCtx, startGrid);
    renderShapeCanvas(endShapeCtx, endGrid);
    syncCharFromShape('start');
    syncCharFromShape('end');

    function attachListeners(canvas: HTMLCanvasElement, which: 'start' | 'end') {
        const grid = () => which === 'start' ? startGrid : endGrid;
        const ctx  = () => which === 'start' ? startShapeCtx : endShapeCtx;

        canvas.addEventListener('mousedown', e => {
            e.preventDefault();
            const cell = shapeCanvasCellAt(e, canvas);
            if (!cell) return;
            const [col, row] = cell;
            shapeDragValue = !grid()[row][col];
            shapeDragTarget = which;
            grid()[row][col] = shapeDragValue;
            renderShapeCanvas(ctx(), grid());
            syncCharFromShape(which);
        });
        canvas.addEventListener('mousemove', e => {
            if (shapeDragTarget !== which) return;
            const cell = shapeCanvasCellAt(e, canvas);
            if (!cell) return;
            const [col, row] = cell;
            grid()[row][col] = shapeDragValue;
            renderShapeCanvas(ctx(), grid());
            syncCharFromShape(which);
        });
        canvas.addEventListener('mouseup', () => { shapeDragTarget = null; });
        canvas.addEventListener('mouseleave', () => { shapeDragTarget = null; });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    attachListeners(startShapeCanvas, 'start');
    attachListeners(endShapeCanvas, 'end');

    document.getElementById('start-clear-btn')!.addEventListener('click', () => {
        startGrid = Array.from({ length: SH }, () => new Array(SW).fill(false));
        renderShapeCanvas(startShapeCtx, startGrid);
        syncCharFromShape('start');
    });
    document.getElementById('start-fill-btn')!.addEventListener('click', () => {
        startGrid = Array.from({ length: SH }, () => new Array(SW).fill(true));
        renderShapeCanvas(startShapeCtx, startGrid);
        syncCharFromShape('start');
    });
    document.getElementById('end-clear-btn')!.addEventListener('click', () => {
        endGrid = Array.from({ length: SH }, () => new Array(SW).fill(false));
        renderShapeCanvas(endShapeCtx, endGrid);
        syncCharFromShape('end');
    });
    document.getElementById('end-fill-btn')!.addEventListener('click', () => {
        endGrid = Array.from({ length: SH }, () => new Array(SW).fill(true));
        renderShapeCanvas(endShapeCtx, endGrid);
        syncCharFromShape('end');
    });

    document.getElementById('start-text-input')!.addEventListener('input', e => {
        startGrid = textToGrid((e.target as HTMLInputElement).value);
        renderShapeCanvas(startShapeCtx, startGrid);
        syncCharFromShape('start');
    });
    document.getElementById('end-text-input')!.addEventListener('input', e => {
        endGrid = textToGrid((e.target as HTMLInputElement).value);
        renderShapeCanvas(endShapeCtx, endGrid);
        syncCharFromShape('end');
    });
}

// ── Character grid ────────────────────────────────────────────────────────────
function renderCharCanvas(ctx: CanvasRenderingContext2D, grid: string[][], focused: [number, number] | null) {
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, SW * CHAR_W, SH * CHAR_H);
    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const x = col * CHAR_W;
            const y = row * CHAR_H;
            const ch = grid[row][col];
            const isFocused = focused !== null && focused[0] === col && focused[1] === row;
            ctx.fillStyle = isFocused ? '#1a2a4a' : (ch !== ' ' ? '#1a2a1a' : '#181818');
            ctx.fillRect(x + 1, y + 1, CHAR_W - 2, CHAR_H - 2);
            if (ch !== ' ') {
                ctx.fillStyle = '#88cc44';
                ctx.font = `bold ${Math.round(CHAR_H * 0.6)}px monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(ch, x + CHAR_W / 2, y + CHAR_H / 2);
            }
            if (isFocused) {
                ctx.strokeStyle = '#4488ff';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, y + 0.5, CHAR_W - 2, CHAR_H - 2);
            }
        }
    }
}

function computeFlipCounts(startCG: string[][], endCG: string[][]): number[] {
    const counts: number[] = [];
    for (let row = 0; row < SH; row++) {
        for (let col = 0; col < SW; col++) {
            const si = REEL.indexOf(startCG[row][col]);
            const ei = REEL.indexOf(endCG[row][col]);
            const s = si >= 0 ? si : 0;
            const e = ei >= 0 ? ei : 0;
            counts.push((e - s + REEL.length) % REEL.length);
        }
    }
    return counts;
}

function expandForFlipCounts(groupActions: GroupAction[], flipCounts: number[]): GroupAction[] {
    const firstTick = new Map<number, number>();
    for (const ga of groupActions) {
        for (const [action, ids] of ga.actions) {
            if (action === Action.FLIP || action === Action.INCREMENT) {
                for (const id of ids) {
                    if (!firstTick.has(id)) firstTick.set(id, Math.round(ga.tPlus));
                }
            }
        }
    }
    const extra: GroupAction[] = [];
    for (let id = 0; id < flipCounts.length; id++) {
        const n = flipCounts[id];
        if (n <= 1) continue;
        const t = firstTick.get(id) ?? 0;
        for (let i = 1; i < n; i++) {
            extra.push(new GroupAction(t + i, [[Action.FLIP, [id]]]));
        }
    }
    return [...groupActions, ...extra];
}

function buildCharCanvases() {
    startCharCanvas.width = SW * CHAR_W;
    startCharCanvas.height = SH * CHAR_H;
    startCharCanvas.tabIndex = 0;
    endCharCanvas.width = SW * CHAR_W;
    endCharCanvas.height = SH * CHAR_H;
    endCharCanvas.tabIndex = 0;

    renderCharCanvas(startCharCtx, startCharGrid, null);
    renderCharCanvas(endCharCtx, endCharGrid, null);

    function attachListeners(canvas: HTMLCanvasElement, which: 'start' | 'end') {
        const grid = () => which === 'start' ? startCharGrid : endCharGrid;
        const otherGrid = () => which === 'start' ? endCharGrid : startCharGrid;
        const ctx = () => which === 'start' ? startCharCtx : endCharCtx;
        const otherCtx = () => which === 'start' ? endCharCtx : startCharCtx;

        canvas.addEventListener('mousedown', e => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const col = Math.floor((e.clientX - rect.left) / CHAR_W);
            const row = Math.floor((e.clientY - rect.top) / CHAR_H);
            if (col < 0 || col >= SW || row < 0 || row >= SH) return;
            if (charFocusedTarget !== which) {
                renderCharCanvas(otherCtx(), otherGrid(), null);
            }
            charFocusedCell = [col, row];
            charFocusedTarget = which;
            renderCharCanvas(ctx(), grid(), charFocusedCell);
            canvas.focus();
        });

        canvas.addEventListener('keydown', e => {
            if (charFocusedCell === null || charFocusedTarget !== which) return;
            const [col, row] = charFocusedCell;
            const g = grid();

            if (e.key === 'Tab') return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'].includes(e.key) || e.key.length === 1) {
                e.preventDefault();
            }

            if (e.key === 'Escape') {
                charFocusedCell = null;
                charFocusedTarget = null;
                renderCharCanvas(ctx(), g, null);
                canvas.blur();
                return;
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                g[row][col] = ' ';
                const prevCol = col > 0 ? col - 1 : SW - 1;
                const prevRow = col > 0 ? row : Math.max(0, row - 1);
                charFocusedCell = [prevCol, prevRow];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
            if (e.key === 'ArrowRight') {
                charFocusedCell = [(col + 1) % SW, col + 1 < SW ? row : (row + 1) % SH];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
            if (e.key === 'ArrowLeft') {
                charFocusedCell = [col > 0 ? col - 1 : SW - 1, col > 0 ? row : Math.max(0, row - 1)];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
            if (e.key === 'ArrowDown') {
                charFocusedCell = [col, (row + 1) % SH];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
            if (e.key === 'ArrowUp') {
                charFocusedCell = [col, (row + SH - 1) % SH];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
            if (e.key.length === 1) {
                g[row][col] = e.key;
                const nextCol = (col + 1) % SW;
                const nextRow = col + 1 < SW ? row : (row + 1) % SH;
                charFocusedCell = [nextCol, nextRow];
                renderCharCanvas(ctx(), g, charFocusedCell);
                return;
            }
        });

        canvas.addEventListener('blur', () => {
            if (charFocusedTarget === which) {
                charFocusedCell = null;
                charFocusedTarget = null;
                renderCharCanvas(ctx(), grid(), null);
            }
        });
    }

    attachListeners(startCharCanvas, 'start');
    attachListeners(endCharCanvas, 'end');

    document.getElementById('char-start-clear-btn')!.addEventListener('click', () => {
        startCharGrid = Array.from({ length: SH }, () => new Array(SW).fill(' '));
        renderCharCanvas(startCharCtx, startCharGrid, null);
    });
    document.getElementById('char-end-clear-btn')!.addEventListener('click', () => {
        endCharGrid = Array.from({ length: SH }, () => new Array(SW).fill(' '));
        renderCharCanvas(endCharCtx, endCharGrid, null);
    });
}

// ── Colour helpers ────────────────────────────────────────────────────────────
function timeToColor(value: number, maxValue: number): string {
    if (value === 0) return '#222';
    const ratio = Math.min(value / Math.max(maxValue, 1), 1);
    // blue → cyan → green → yellow → red
    const hue = Math.round(240 - ratio * 240);
    return `hsl(${hue}, 85%, 45%)`;
}

// ── Simulation ────────────────────────────────────────────────────────────────
function simulate(groupActions: GroupAction[], initialState?: number[]): string[][] {
    const numUnits = SW * SH;
    const state = initialState ? [...initialState] : new Array(numUnits).fill(0);
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
    const newReel = reelInput.value.length >= 1 ? reelInput.value.split('') : REEL;
    if (newReel.join('') !== REEL.join('')) {
        REEL = newReel;
        rebuildHardware();
    }

    const orderDef = ORDER_DEFS[selectedOrderIdx];
    const transDef = TRANSITION_DEFS[selectedTransitionIdx];

    const text = textInput.value || 'hello';
    const order = orderDef.create(text);
    const transition = transDef.create(order);
    if (transDef.needsFlipsPerSecond) (transition as any).flipsPerSecond = fpsInput ? parseFloat(fpsInput.value) || 3 : 3;
    if (transDef.needsSyncStart)      (transition as any).synchronizedStart = syncStartInput ? syncStartInput.checked : true;

    const t = Math.max(1, parseInt(durationInput.value) || 200);
    const scale = parseFloat(scaleInput.value) || 1;

    let o1: PixelArtTarget;
    let o2: PixelArtTarget;
    let groupActions: GroupAction[];
    let initialState: number[] | undefined;

    if (useCharSource) {
        const flipCounts = computeFlipCounts(startCharGrid, endCharGrid);
        const o2Grid: boolean[][] = Array.from({ length: SH }, (_, row) =>
            Array.from({ length: SW }, (_, col) => flipCounts[row * SW + col] > 0)
        );
        o1 = gridToPixelArt(Array.from({ length: SH }, () => new Array(SW).fill(false)));
        o2 = gridToPixelArt(o2Grid);
        initialState = startCharGrid.flat().map(ch => {
            const i = REEL.indexOf(ch);
            return i >= 0 ? i : 0;
        });
        groupActions = transition.generateGroupActions(o1, o2, t, hw);
        groupActions = expandForFlipCounts(groupActions, flipCounts);
    } else if (transDef.needsOnChar) {
        const emptyGrid = Array.from({ length: SH }, () => new Array(SW).fill(' '));
        o1 = new PixelArtTarget(emptyGrid, ' ');
        o2 = toShiftedPixelArt(endCharGrid, REEL);
        groupActions = transition.generateGroupActions(o1, o2, t, hw);
    } else {
        o1 = gridToPixelArt(startGrid);
        o2 = gridToPixelArt(endGrid);
        groupActions = transition.generateGroupActions(o1, o2, t, hw);
    }

    if (scale !== 1) groupActions = scaleGroupActions(groupActions, scale);

    if (is3dMode && hw3d) {
        const flipId = (id: number) => (SH - 1 - Math.floor(id / SW)) * SW + (id % SW);
        const flipped = groupActions.map(ga => new GroupAction(
            ga.tPlus,
            ga.actions.map(([action, ids]) => [action, ids.map(flipId)] as [Action, number[]])
        ));
        hw3d.compile(flipped);
    }

    simulatedFrames = simulate(groupActions, initialState);
    currentTick = 0;

    renderMaskViz(o1, o2, order);

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

// ── Mask result visualizer ────────────────────────────────────────────────────
function renderMaskViz(o1: PixelArtTarget, o2: PixelArtTarget, order: GridOrder) {
    const cw = SHAPE_CELL, ch = SHAPE_CELL;
    maskVizCanvas.width = SW * cw;
    maskVizCanvas.height = SH * ch;
    const ctx = maskVizCanvas.getContext('2d')!;

    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, maskVizCanvas.width, maskVizCanvas.height);

    const flip = diffIndices(o1, o2, hw);
    if (flip.length === 0) return;

    const [mask, x, y] = generateMaskFromCoords(flip, hw);
    console.log("mask is")
    console.log(frameDisplay(o1.draw()))
    console.log(frameDisplay(o2.draw()))
    console.log(mask);
    const [maskTime] = order.applyMask(mask as boolean[][]);
    console.log(maskTime)

    const rows = maskTime.length;
    const cols = maskTime[0]?.length ?? 0;
    const shapeVals = maskTime.flat().filter(v => v >= 0);
    const maxVal = Math.max(...shapeVals, 0);

    const maskColor = (val: number) => {
        const ratio = maxVal === 0 ? 0 : val / maxVal;
        const hue = Math.round(240 - ratio * 240);
        return `hsl(${hue}, 85%, 50%)`;
    };

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const gCol = c + (x as number);
            const gRow = r + (y as number);
            const val = maskTime[r]?.[c];
            ctx.fillStyle = val === undefined ? '#0d0d0d' : val === -1 ? '#4a1a4a' : maskColor(val);
            ctx.fillRect(gCol * cw, gRow * ch, cw - 1, ch - 1);
        }
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
        const def = TRANSITION_DEFS[selectedTransitionIdx];
        orderField.style.display     = def.needsOrder          ? '' : 'none';
        fpsField.style.display       = def.needsFlipsPerSecond ? '' : 'none';
        syncStartField.style.display = def.needsSyncStart      ? '' : 'none';
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
    simContainer = document.getElementById('sim-container') as HTMLElement;
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

// ── Reset all state ────────────────────────────────────────────────────────────
function resetAll() {
    stopAnimation();

    startGrid = Array.from({ length: SH }, () => new Array(SW).fill(false));
    endGrid   = Array.from({ length: SH }, () => new Array(SW).fill(false));
    renderShapeCanvas(startShapeCtx, startGrid);
    renderShapeCanvas(endShapeCtx, endGrid);
    (document.getElementById('start-text-input') as HTMLInputElement).value = '';
    (document.getElementById('end-text-input')   as HTMLInputElement).value = '';

    startCharGrid = Array.from({ length: SH }, () => new Array(SW).fill(' '));
    endCharGrid   = Array.from({ length: SH }, () => new Array(SW).fill(' '));
    renderCharCanvas(startCharCtx, startCharGrid, null);
    renderCharCanvas(endCharCtx, endCharGrid, null);
    sourceSelect.value = 'shapes';
    useCharSource = false;

    painterGrid = Array.from({ length: SH }, () => new Array(SW).fill(0));
    renderPainter();

    simulatedFrames = [];
    currentTick = 0;
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    tickCounter.textContent = 'tick 0';
    playBtn.textContent = '▶ Play';

    rebuildHardware();
}

// ── Rebuild hardware when reel changes ────────────────────────────────────────
function rebuildHardware() {
    hw = SplitflapHardware.Headless(SW, SH, (_x, _y) => REEL.map(s => new SplitflapState(s)));
    if (hw3d !== null) {
        hw3d.sim!.renderer.setAnimationLoop(null);
        simContainer.removeChild(hw3d.sim!.renderer.domElement);
        hw3d = SplitflapHardware.Rectangular(SW, SH, (_x, _y) => REEL.map(s => new SplitflapState(s)), simContainer);
    }
}

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
    hw = SplitflapHardware.Headless(SW, SH, (_x, _y) => REEL.map(s => new SplitflapState(s)));

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
    reelInput         = document.getElementById('reel-input') as HTMLInputElement;
    fpsInput          = document.getElementById('fps-input') as HTMLInputElement;
    fpsField          = document.getElementById('fps-field')!;
    syncStartInput    = document.getElementById('sync-start-input') as HTMLInputElement;
    syncStartField    = document.getElementById('sync-start-field')!;

    startShapeCanvas  = document.getElementById('start-shape-canvas') as HTMLCanvasElement;
    startShapeCtx     = startShapeCanvas.getContext('2d')!;
    endShapeCanvas    = document.getElementById('end-shape-canvas') as HTMLCanvasElement;
    endShapeCtx       = endShapeCanvas.getContext('2d')!;
    maskVizCanvas     = document.getElementById('mask-viz-canvas') as HTMLCanvasElement;
    startCharCanvas   = document.getElementById('start-char-canvas') as HTMLCanvasElement;
    startCharCtx      = startCharCanvas.getContext('2d')!;
    endCharCanvas     = document.getElementById('end-char-canvas') as HTMLCanvasElement;
    endCharCtx        = endCharCanvas.getContext('2d')!;
    sourceSelect      = document.getElementById('source-select') as HTMLSelectElement;

    buildPreviewControls();
    buildComposerUI();
    buildReferencePanel();
    buildPainter();
    buildShapeCanvases();
    buildCharCanvases();
    buildExportModal();

    sourceSelect.addEventListener('change', () => {
        useCharSource = sourceSelect.value === 'characters';
    });

    document.getElementById('reset-btn')!.addEventListener('click', resetAll);

    generateAndPlay();
}

document.addEventListener('DOMContentLoaded', init);
