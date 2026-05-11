import { Action, GroupAction, SplitflapHardware, SplitflapState, SplitflapUnit, scaleGroupActions, delayGroupActions } from './hardware';
import * as OrderModule from './order';
import { GridOrder, GrowFromCentre } from './order';
import {
    CascadeImage, CascadeSpinEnd, diffIndices, EvenOddRhythmTransition, FlipConstantSpeed, FlipDirectional, FlipSyncEnd,
    generateMaskFromCoords, OneByOne, OneByOneKeepFlipping, SnapTransition,
    StaggeredRateTransition, textToPixelCoords, Transition,
    VerticalDriftRateTransition, WaveTransition,
} from './transitions';
import { Colour, PixelArtTarget } from './language2';
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
    { name: 'CascadeSpinEnd',       description: 'End-shape units spin at half rate against fast background, tiled to fill duration', needsOrder: true, create: o => new CascadeSpinEnd(o) },
];

// ── Sequence nodes ────────────────────────────────────────────────────────────
interface PlaygroundNode {
    startGrid:       boolean[][];
    endGrid:         boolean[][];
    startCharGrid?:  string[][];
    endCharGrid?:    string[][];
    transitionIdx:   number;
    orderIdx:        number;
    duration:        number;
    scale:           number;
    fps:             number;
    syncStart:       boolean;
    reel:            string;
    text:            string;
}

function makeNode(overrides: Partial<PlaygroundNode> = {}): PlaygroundNode {
    return {
        startGrid:     Array.from({ length: SH }, () => new Array(SW).fill(false)),
        endGrid:       Array.from({ length: SH }, () => new Array(SW).fill(true)),
        transitionIdx: 0,
        orderIdx:      0,
        duration:      200,
        scale:         1,
        fps:           3,
        syncStart:     true,
        reel:          ' abcdefghijklmnopqrstuvwxyz!?*',
        text:          '',
        ...overrides,
    };
}

let nodes: PlaygroundNode[] = [makeNode()];
let selectedNodeIdx = 0;

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

let lastNodeActions: GroupAction[] = [];
let lastSeqActions:  GroupAction[] = [];
let seqNodeBoundaries: number[] = [];
let seqNodeEndStates: Array<{ charGrid: string[][], boolGrid: boolean[][] }> = [];
let timelineMode: 'node' | 'seq' = 'node';

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
let timelineCanvas!: HTMLCanvasElement;

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

// ── Timeline viewer ───────────────────────────────────────────────────────────
const TL_CELL = 3;
const TL_LABEL = 46;
const TL_ENTRY = TL_CELL * SH + 3;
const TL_NODE_COLORS = ['#c8a040', '#40a8c8', '#a040c8', '#40c880', '#c84040', '#c8c840'];

function renderTimeline(actions: GroupAction[], nodeBoundaries: number[] = []) {
    const flipsAtTime = new Map<number, Set<number>>();
    for (const ga of actions) {
        const t = Math.round(ga.tPlus);
        for (const [action, ids] of ga.actions) {
            if (action !== Action.FLIP) continue;
            if (!flipsAtTime.has(t)) flipsAtTime.set(t, new Set());
            for (const id of ids) flipsAtTime.get(t)!.add(id);
        }
    }
    const times = [...flipsAtTime.keys()].sort((a, b) => a - b);

    timelineCanvas.width  = TL_LABEL + SW * TL_CELL;
    timelineCanvas.height = Math.max(1, times.length * TL_ENTRY);

    const ctx = timelineCanvas.getContext('2d')!;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, timelineCanvas.width, timelineCanvas.height);

    const nodeAt = (t: number) => {
        let n = 0;
        for (let i = 0; i < nodeBoundaries.length; i++) if (t >= nodeBoundaries[i]) n = i;
        return n;
    };

    times.forEach((t, i) => {
        const flipping = flipsAtTime.get(t)!;
        const y = i * TL_ENTRY;
        const color = nodeBoundaries.length > 1
            ? TL_NODE_COLORS[nodeAt(t) % TL_NODE_COLORS.length]
            : '#c8a040';

        ctx.fillStyle = '#444';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(String(t), TL_LABEL - 3, y + TL_CELL * SH / 2 + 3);

        for (let row = 0; row < SH; row++) {
            for (let col = 0; col < SW; col++) {
                const id = row * SW + col;
                ctx.fillStyle = flipping.has(id) ? color : '#181818';
                ctx.fillRect(TL_LABEL + col * TL_CELL, y + row * TL_CELL, TL_CELL - 1, TL_CELL - 1);
            }
        }
    });
}

function updateTimeline() {
    if (timelineMode === 'node') renderTimeline(lastNodeActions);
    else                         renderTimeline(lastSeqActions, seqNodeBoundaries);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function stopAnimation() {
    if (animTimer !== null) { clearInterval(animTimer); animTimer = null; }
}

// ── URL state ─────────────────────────────────────────────────────────────────
function packBoolGrid(grid: boolean[][]): string {
    const flat = grid.flat();
    const bytes = new Uint8Array(Math.ceil(flat.length / 8));
    for (let i = 0; i < flat.length; i++)
        if (flat[i]) bytes[i >> 3] |= (1 << (7 - (i & 7)));
    return btoa(String.fromCharCode(...bytes));
}

function packCharGrid(grid: string[][]): string {
    return grid.flat().join('');
}

function unpackCharGrid(s: string, rows: number, cols: number): string[][] {
    const chars = [...s];
    return Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => chars[r * cols + c] ?? ' ')
    );
}

function unpackBoolGrid(s: string, rows: number, cols: number): boolean[][] {
    try {
        const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
        const grid: boolean[][] = [];
        let i = 0;
        for (let r = 0; r < rows; r++) {
            const row: boolean[] = [];
            for (let c = 0; c < cols; c++, i++)
                row.push(!!(bytes[i >> 3] & (1 << (7 - (i & 7)))));
            grid.push(row);
        }
        return grid;
    } catch { return Array.from({ length: rows }, () => new Array(cols).fill(false)); }
}

function updateURL() {
    const params = new URLSearchParams();
    params.set('n',   String(nodes.length));
    params.set('sel', String(selectedNodeIdx));
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        params.set(`${i}.tr`,    TRANSITION_DEFS[node.transitionIdx]?.name ?? '');
        params.set(`${i}.or`,    ORDER_DEFS[node.orderIdx]?.name ?? '');
        params.set(`${i}.s`,     packBoolGrid(node.startGrid));
        params.set(`${i}.e`,     packBoolGrid(node.endGrid));
        if (node.startCharGrid) params.set(`${i}.sc`, packCharGrid(node.startCharGrid));
        if (node.endCharGrid)   params.set(`${i}.ec`, packCharGrid(node.endCharGrid));
        params.set(`${i}.dur`,   String(node.duration));
        params.set(`${i}.scale`, String(node.scale));
        params.set(`${i}.reel`,  node.reel);
        params.set(`${i}.text`,  node.text);
        params.set(`${i}.fps`,   String(node.fps));
        params.set(`${i}.sync`,  node.syncStart ? '1' : '0');
    }
    history.replaceState(null, '', '?' + params.toString());
}

function loadNodeFromParams(params: URLSearchParams, prefix: string): PlaygroundNode {
    const node = makeNode();
    const trName = params.get(`${prefix}tr`);
    if (trName) { const idx = TRANSITION_DEFS.findIndex(d => d.name === trName); if (idx !== -1) node.transitionIdx = idx; }
    const orName = params.get(`${prefix}or`);
    if (orName) { const idx = ORDER_DEFS.findIndex(d => d.name === orName);      if (idx !== -1) node.orderIdx = idx; }
    const s = params.get(`${prefix}s`); if (s) node.startGrid = unpackBoolGrid(s, SH, SW);
    const e = params.get(`${prefix}e`); if (e) node.endGrid   = unpackBoolGrid(e, SH, SW);
    const sc = params.get(`${prefix}sc`); if (sc) node.startCharGrid = unpackCharGrid(sc, SH, SW);
    const ec = params.get(`${prefix}ec`); if (ec) node.endCharGrid   = unpackCharGrid(ec, SH, SW);
    if (params.has(`${prefix}dur`))   node.duration  = parseInt(params.get(`${prefix}dur`)!)   || 200;
    if (params.has(`${prefix}scale`)) node.scale     = parseFloat(params.get(`${prefix}scale`)!) || 1;
    if (params.has(`${prefix}reel`))  node.reel      = params.get(`${prefix}reel`)!;
    if (params.has(`${prefix}text`))  node.text      = params.get(`${prefix}text`)!;
    if (params.has(`${prefix}fps`))   node.fps       = parseFloat(params.get(`${prefix}fps`)!)  || 3;
    if (params.has(`${prefix}sync`))  node.syncStart = params.get(`${prefix}sync`) === '1';
    return node;
}

function loadFromURL() {
    const params = new URLSearchParams(location.search);

    // ── New multi-node format ──
    if (params.has('n')) {
        const count = Math.max(1, parseInt(params.get('n')!) || 1);
        const sel   = Math.min(Math.max(0, parseInt(params.get('sel') ?? '0') || 0), count - 1);
        nodes = Array.from({ length: count }, (_, i) => loadNodeFromParams(params, `${i}.`));
        selectedNodeIdx = sel;
        applyNode(nodes[selectedNodeIdx]);
        renderSequencePanel();
        return;
    }

    // ── Legacy single-node format ──
    if (!params.has('tr') && !params.has('e')) return;
    const node = loadNodeFromParams(params, '');
    nodes = [node];
    selectedNodeIdx = 0;
    applyNode(node);
    renderSequencePanel();
}

// ── Generate & play ────────────────────────────────────────────────────────────
function generateAndPlay() {
    nodes[selectedNodeIdx] = captureNode();
    renderSequencePanel();

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

    lastNodeActions = groupActions;
    updateTimeline();

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
    updateURL();

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

// ── Sequence panel ────────────────────────────────────────────────────────────
function captureNode(): PlaygroundNode {
    return {
        startGrid:     startGrid.map(r => [...r]),
        endGrid:       endGrid.map(r => [...r]),
        startCharGrid: startCharGrid.map(r => [...r]),
        endCharGrid:   endCharGrid.map(r => [...r]),
        transitionIdx: selectedTransitionIdx,
        orderIdx:      selectedOrderIdx,
        duration:      parseInt(durationInput.value) || 200,
        scale:         parseFloat(scaleInput.value) || 1,
        fps:           parseFloat(fpsInput?.value ?? '3') || 3,
        syncStart:     syncStartInput?.checked ?? true,
        reel:          reelInput.value,
        text:          textInput.value,
    };
}

function applyNode(node: PlaygroundNode) {
    startGrid = node.startGrid.map(r => [...r]);
    endGrid   = node.endGrid.map(r => [...r]);
    selectedTransitionIdx = node.transitionIdx;
    selectedOrderIdx      = node.orderIdx;

    transitionSelect.value = String(node.transitionIdx);
    orderSelect.value      = String(node.orderIdx);
    durationInput.value    = String(node.duration);
    scaleInput.value       = String(node.scale);
    reelInput.value        = node.reel;
    textInput.value        = node.text;
    if (fpsInput)       fpsInput.value          = String(node.fps);
    if (syncStartInput) syncStartInput.checked  = node.syncStart;

    const tDef = TRANSITION_DEFS[node.transitionIdx];
    const oDef = ORDER_DEFS[node.orderIdx];
    orderField.style.display     = tDef.needsOrder          ? '' : 'none';
    fpsField.style.display       = tDef.needsFlipsPerSecond ? '' : 'none';
    syncStartField.style.display = tDef.needsSyncStart      ? '' : 'none';
    textField.style.display      = oDef.needsText           ? '' : 'none';
    painterSection.style.display = oDef.isPainter           ? '' : 'none';

    renderShapeCanvas(startShapeCtx, startGrid);
    renderShapeCanvas(endShapeCtx, endGrid);
    if (node.startCharGrid) {
        startCharGrid = node.startCharGrid.map(r => [...r]);
        renderCharCanvas(startCharCtx, startCharGrid, null);
    } else {
        syncCharFromShape('start');
    }
    if (node.endCharGrid) {
        endCharGrid = node.endCharGrid.map(r => [...r]);
        renderCharCanvas(endCharCtx, endCharGrid, null);
    } else {
        syncCharFromShape('end');
    }
}

function createMiniGridCanvas(charGrid: string[][], color: string): HTMLCanvasElement {
    const cell = 3;
    const canvas = document.createElement('canvas');
    canvas.width  = SW * cell;
    canvas.height = SH * cell;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < SH; row++)
        for (let col = 0; col < SW; col++) {
            const ch = charGrid[row]?.[col];
            ctx.fillStyle = (ch && ch !== ' ') ? color : '#1c1c1c';
            ctx.fillRect(col * cell, row * cell, cell - 1, cell - 1);
        }
    return canvas;
}

function makeStateSeparator(charGrid: string[][], color: string): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'seq-separator';
    sep.appendChild(createMiniGridCanvas(charGrid, color));
    return sep;
}

function renderSequencePanel() {
    const list = document.getElementById('sequence-list')!;
    list.innerHTML = '';
    nodes.forEach((node, i) => {
        const tName = TRANSITION_DEFS[node.transitionIdx]?.name ?? '?';
        const oName = ORDER_DEFS[node.orderIdx]?.name ?? '?';
        const color = TL_NODE_COLORS[i % TL_NODE_COLORS.length];

        const startCG = node.startCharGrid ?? node.startGrid.map(r => r.map(v => v ? SHAPE_ON_CHAR : ' '));
        const endCG   = seqNodeEndStates[i]?.charGrid
                      ?? node.endCharGrid
                      ?? node.endGrid.map(r => r.map(v => v ? SHAPE_ON_CHAR : ' '));

        if (i === 0) list.appendChild(makeStateSeparator(startCG, color));

        const item = document.createElement('div');
        item.className = 'seq-item' + (i === selectedNodeIdx ? ' selected' : '');
        item.innerHTML = `
            <span class="seq-num">${i + 1}</span>
            <span class="seq-label">${tName}<span class="seq-sub"> · ${oName}</span></span>
            <button class="seq-del" title="Delete">✕</button>`;

        item.querySelector('.seq-del')!.addEventListener('click', e => {
            e.stopPropagation();
            if (nodes.length === 1) return;
            nodes[selectedNodeIdx] = captureNode();
            nodes.splice(i, 1);
            if (selectedNodeIdx >= nodes.length) selectedNodeIdx = nodes.length - 1;
            applyNode(nodes[selectedNodeIdx]);
            renderSequencePanel();
        });

        item.addEventListener('click', () => {
            nodes[selectedNodeIdx] = captureNode();
            selectedNodeIdx = i;
            applyNode(nodes[i]);
            renderSequencePanel();
        });

        list.appendChild(item);
        list.appendChild(makeStateSeparator(endCG, color));
    });
}

function buildSequencePanel() {
    document.getElementById('seq-add-btn')!.addEventListener('click', () => {
        nodes[selectedNodeIdx] = captureNode();
        const prev = nodes[selectedNodeIdx];
        const prevActions = buildActionsForNode(prev);
        const { charGrid, boolGrid } = computeEndStateFromActions(prevActions);
        const next = makeNode({
            startGrid:     boolGrid,
            startCharGrid: charGrid,
            transitionIdx: prev.transitionIdx,
            orderIdx:      prev.orderIdx,
            duration:      prev.duration,
            scale:         prev.scale,
            fps:           prev.fps,
            syncStart:     prev.syncStart,
            reel:          prev.reel,
        });
        nodes.push(next);
        selectedNodeIdx = nodes.length - 1;
        applyNode(next);
        renderSequencePanel();
    });

    document.getElementById('seq-play-btn')!.addEventListener('click', playSequence);

    renderSequencePanel();
}

// ── Sequence playback ─────────────────────────────────────────────────────────
function computeEndStateFromActions(actions: GroupAction[]): { charGrid: string[][], boolGrid: boolean[][] } {
    const simUnits = new Map<number, SplitflapUnit>(
        hw.units.map(u => [u.id, (u as SplitflapUnit).clone()])
    );
    for (const ga of actions) {
        for (const [action, unitIds] of ga.actions) {
            for (const unitId of unitIds) {
                const unit = simUnits.get(unitId)!;
                const numStates = unit.states.find(s => s[0] === action)![1].length;
                unit.currentIndex = (unit.currentIndex + 1) % numStates;
            }
        }
    }
    const charGrid: string[][] = Array.from({ length: SH }, (_, row) =>
        Array.from({ length: SW }, (_, col) => {
            const unit = simUnits.get(hw.coordToIndex([col, row]))!;
            return (unit.states[0][1][unit.currentIndex] as SplitflapState).id;
        })
    );
    const boolGrid = charGrid.map(row => row.map(ch => ch !== ' '));
    return { charGrid, boolGrid };
}

function buildActionsForNode(node: PlaygroundNode): GroupAction[] {
    const orderDef  = ORDER_DEFS[node.orderIdx];
    const transDef  = TRANSITION_DEFS[node.transitionIdx];
    const nodeReel  = node.reel.length >= 1 ? node.reel.split('') : REEL;
    const text      = node.text || 'hello';
    const order     = orderDef.create(text);
    const transition = transDef.create(order);
    if (transDef.needsFlipsPerSecond) (transition as any).flipsPerSecond = node.fps;
    if (transDef.needsSyncStart)      (transition as any).synchronizedStart = node.syncStart;

    const t = Math.max(1, node.duration);

    let o1: PixelArtTarget;
    let o2: PixelArtTarget;
    let actions: GroupAction[];

    const nodeStartCharGrid = node.startCharGrid ?? node.startGrid.map(row => row.map(v => v ? SHAPE_ON_CHAR : ' '));
    const nodeEndCharGrid   = node.endCharGrid   ?? node.endGrid.map(row => row.map(v => v ? SHAPE_ON_CHAR : ' '));

    if (transDef.needsOnChar) {
        // Set hw unit indices to the actual starting character state so
        // computeFlipDistance calculates distances from the real start, not blank.
        for (let row = 0; row < SH; row++)
            for (let col = 0; col < SW; col++) {
                const unit = hw.units.find(u => u.id === hw.coordToIndex([col, row])) as SplitflapUnit;
                unit.currentIndex = Math.max(0, nodeReel.indexOf(nodeStartCharGrid[row][col]));
            }

        const emptyGrid = Array.from({ length: SH }, () => new Array(SW).fill(' '));
        o1 = new PixelArtTarget(emptyGrid, ' ');
        o2 = toShiftedPixelArt(nodeEndCharGrid, nodeReel);
        actions = transition.generateGroupActions(o1, o2, t, hw);

        // Reset hw units back to default so other callers start from blank.
        for (const unit of hw.units) (unit as SplitflapUnit).currentIndex = 0;
    } else {
        o1 = gridToPixelArt(node.startGrid);
        o2 = gridToPixelArt(node.endGrid);
        actions = transition.generateGroupActions(o1, o2, t, hw);
    }

    if (node.scale !== 1) actions = scaleGroupActions(actions, node.scale);
    return actions;
}

function playSequence() {
    nodes[selectedNodeIdx] = captureNode();
    renderSequencePanel();

    seqNodeBoundaries = [];
    seqNodeEndStates = [];
    let allActions: GroupAction[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const timeOffset = allActions.length > 0
            ? Math.ceil(Math.max(...allActions.map(ga => ga.tPlus))) + 1
            : 0;
        seqNodeBoundaries.push(timeOffset);
        const nodeActions = buildActionsForNode(node);
        const delayed = timeOffset > 0 ? delayGroupActions(nodeActions, timeOffset) : nodeActions;
        allActions = [...allActions, ...delayed];
        const endState = computeEndStateFromActions(allActions);
        seqNodeEndStates.push(endState);
        if (i + 1 < nodes.length) {
            nodes[i + 1].startGrid     = endState.boolGrid;
            nodes[i + 1].startCharGrid = endState.charGrid;
        }
    }
    renderSequencePanel();

    lastSeqActions = allActions;
    updateTimeline();

    if (is3dMode && hw3d) {
        const flipId = (id: number) => (SH - 1 - Math.floor(id / SW)) * SW + (id % SW);
        hw3d.compile(allActions.map(ga => new GroupAction(
            ga.tPlus,
            ga.actions.map(([action, ids]) => [action, ids.map(flipId)] as [Action, number[]])
        )));
    }

    simulatedFrames = simulate(allActions);
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
            if (isLooping) { currentTick = 0; }
            else { stopAnimation(); playBtn.textContent = '▶ Play'; }
        }
    }, speedMs) as ReturnType<typeof setInterval>;
}

function buildTimelinePanel() {
    timelineCanvas = document.getElementById('timeline-canvas') as HTMLCanvasElement;
    document.querySelectorAll<HTMLButtonElement>('.tl-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            timelineMode = btn.dataset['tl'] as 'node' | 'seq';
            document.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('active', b === btn));
            updateTimeline();
        });
    });
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
    history.replaceState(null, '', location.pathname);

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
    buildSequencePanel();
    buildTimelinePanel();
    buildExportModal();

    sourceSelect.addEventListener('change', () => {
        useCharSource = sourceSelect.value === 'characters';
    });

    document.getElementById('reset-btn')!.addEventListener('click', resetAll);

    document.getElementById('copy-link-btn')!.addEventListener('click', () => {
        nodes[selectedNodeIdx] = captureNode();
        updateURL();
        navigator.clipboard.writeText(location.href);
    });

    loadFromURL();
    generateAndPlay();
}

document.addEventListener('DOMContentLoaded', init);
