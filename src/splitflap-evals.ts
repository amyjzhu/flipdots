import { Action, BrixelSimHardware, FlipdotSimAsyncHardware, GroupAction, HardwareInterface, SplitflapHardware, SplitflapState, SplitflapUnit, delayGroupActions } from './hardware';
import { CircleTarget, PixelArtTarget, RectangleTarget, generateAnimationToGroupAction } from './language2';
import {
Diagonal, GridOrder, GrowAlongContour, GrowAlongContoursParallel, GrowFromCentre, GrowFromPoint, InterpolationOrder, RightToLeft,
    AllAtOnce, BackAndForth, CentrePulse, CrescentOrder, CurvedWave, FastCentrePulse, LeftToRight, LineDiagonal,
    MatrixDown, MiddleOutDiagonal, OrganicRipple, OutFromCentre, PingPong,
    PropagateFromObject,
    RandomOrder, RowByRowOverlap, ShallowDiagonal, SpiralIn, SpiralOrder, SpiralOut, StaggeredRow,
    TopDown,
    Ring2,
} from './order';
import {
    AcceleratingCascadeTransition,
    AlternatingFlapTransition, AndThenFlipTo, BeatTransition, CascadeImage, EvenOddRhythmTransition, FarEdgeTripleTransition, FittedWaveTransition, FlipConstantSpeed, FlipDirectional, FlipSyncEnd,
    FlipSyncLastFlipTogether, RowSyncSpinTransition, SpinHoldFlipTogether,
    LayerForeBackTransition, OneByOne, OneByOneKeepFlipping, PulseTransition, RotateRevealTransition, SnapTransition,
    StaggeredRateTransition,
    StochasticTransition, Transition, TrickleKeepFlipping, VerticalDriftRateTransition,
    WaveTransition,
} from './transitions';
import { EvalCase, EvalRunner, HardwareSpec } from './eval';
import { generateSplitflapState, getImages } from './util';
import { EffectType, GenericEffect, Instantaneous } from './effect';
import { ALPHABET_WITH_EXCLAMATION } from './constants';

const BASE = import.meta.env.BASE_URL; // e.g. '/flipdots/' — set in vite.config

const SW = 32;
const SH = 6;

const HARDWARE = { type: 'splitflap' as const, width: SW, height: SH };
// const CAPTURE  = { video: true, pngIntervalMs: 50 };
// const CAPTURE  = { video: false, pngIntervalMs: 100 };
// const CAPTURE  = { video: true, gif: { fps: 15, maxFrames: 200 }, pngIntervalMs: 50 };
const CAPTURE  = { video: true};
// const CAPTURE  = { video: true};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sfCase(
    name: string,
    build: (sfhw: SplitflapHardware, rect: RectangleTarget) => GroupAction[],
): EvalCase {
    return {
        name,
        hardware: HARDWARE,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            return build(hw as SplitflapHardware, new RectangleTarget(SW, SH, [0, 0], [SW, SH]));
        },
    };
}

function keepFlipping(order: GridOrder, duration = 50) {
    return (sfhw: SplitflapHardware, rect: RectangleTarget): GroupAction[] =>
        new OneByOneKeepFlipping(order).generateGroupActions(new PixelArtTarget([], ''), rect, duration, sfhw);
}

function centeredMsg(msg: string): string[][] {
    const rows = msg.split('\n');
    const grid: string[][] = Array.from({ length: SH }, () => Array(SW).fill(' '));
    const rowStart = Math.round((SH - rows.length) / 2);
    rows.forEach((row, ri) => {
        const colStart = Math.round((SW - row.length) / 2);
        [...row].forEach((ch, ci) => { if (grid[ri + rowStart]) grid[ri + rowStart][ci + colStart] = ch; });
    });
    return grid;
}

function offsetCenteredMsg(msg: string): string[][] {
    let msgstate = centeredMsg(msg);
    let bank = ALPHABET_WITH_EXCLAMATION.split("");
    // cipher it...
    msgstate = msgstate.map(r => r.map(c => {
        let idx = bank.findIndex(t => t == c);
        if (idx == -1) {
            throw new Error("message can't be parsed")
        }
        return bank[(idx+2) % bank.length]
    }))
    return msgstate
}

// ── Menu / signage content ────────────────────────────────────────────────────

// The splitflap display renders grid row 0 at the BOTTOM, so flip the rows here
// to make the lines read top-to-bottom on screen. Local workaround — the display
// mapping itself is unchanged.
const flipRows = (grid: string[][]): string[][] => [...grid].reverse();

const menuSpring = new PixelArtTarget(flipRows(offsetCenteredMsg(
    'spring specials      \n' +
    'lime cold brew       \n' +
    'matcha tonic         \n' +
    'horchata cold foam   \n' +
    'na dark and stormy   \n' +
    'lavender latte'
)), ' ');

const menuSlogans = new PixelArtTarget(flipRows(offsetCenteredMsg(
    '   drink coffee\n' +
    'live better        \n' +
    '         open your mind\n' +
    'explore the everyday'
)), ' ');

const menuClasses = new PixelArtTarget(flipRows(offsetCenteredMsg(
    'barista classes      \n' +
    'may twentieth\n' +
    'june twelfth         \n' +
    'two pm          \n' +
    'all ingredients included'
)), ' ');

// ── Sequence helper ───────────────────────────────────────────────────────────
// Run several transitions back-to-back on the same hardware, threading the
// on-screen state between them. GroupAction flips are *relative* reel advances,
// and transitions read each unit's currentIndex (via computeFlipDistance) to
// decide how far to spin. So between steps we must advance currentIndex to
// reflect what the previous steps left on the display — otherwise a later step
// is generated against a blank reel while the screen shows something else, and
// every unit lands offset by that mismatch. (Mirrors playground's playSequence;
// duplicated here on purpose to keep the eval harness self-contained.)
type SeqStep = (hw: SplitflapHardware) => GroupAction[];

function advanceState(hw: SplitflapHardware, actions: GroupAction[]): void {
    for (const ga of actions) {
        for (const [, unitIds] of ga.actions) {
            for (const id of unitIds) {
                const unit = hw.units.find(u => u.id === id) as SplitflapUnit;
                const numStates = unit.states[0][1].length;
                unit.currentIndex = (unit.currentIndex + 1) % numStates;
            }
        }
    }
}

// `gap` is the pause (in flip-time units) inserted after each step before the
// next begins — e.g. to hold a menu on screen before transitioning away.
function runSequence(hw: SplitflapHardware, steps: SeqStep[], gap = 0): GroupAction[] {
    let all: GroupAction[] = [];
    for (const step of steps) {
        const offset = all.length > 0
            ? Math.ceil(Math.max(...all.map(ga => ga.tPlus))) + 1 + gap
            : 0;
        const raw = step(hw);
        const actions = offset > 0 ? delayGroupActions(raw, offset) : raw;
        all = [...all, ...actions];
        advanceState(hw, actions);
    }
    // Playback renders from the construction-time (blank) snapshot, so restore
    // currentIndex to 0 to stay consistent with it.
    for (const unit of hw.units) (unit as SplitflapUnit).currentIndex = 0;
    return all;
}

// ── Menu cases ────────────────────────────────────────────────────────────────

// flip each line together and then flip away from it and keep flipping 
const menuCases: EvalCase[] = [
    // sfCase('menu-spring', (sfhw) =>
    //     new FlipSyncLastFlipTogether().generateGroupActions(new PixelArtTarget([], ' '), menuSpring, 30, sfhw)
    // ),
    // sfCase('menu-spring-to-slogans', (sfhw) =>
    //     new FlipSyncLastFlipTogether().generateGroupActions(menuSpring, menuSlogans, 30, sfhw)
    // ),
    // sfCase('menu-slogans-to-classes', (sfhw) =>
    //     new FlipSyncLastFlipTogether().generateGroupActions(menuSlogans, menuClasses, 30, sfhw)
    // ),
    sfCase('menu-spring-to-classes-row-sync', (sfhw) =>
        // Two separate transitions, chained with state threaded between them:
        //   1. Initial flip-in of the spring menu (blank → menuSpring).
        //   2. RowSyncSpinTransition starting FROM menuSpring:
        //        Phase 1 row-cascades menuSpring → menuSlogans (rows land
        //          top-to-bottom),
        //        Phase 2 spins menuSlogans → menuClasses.
        // runSequence sets currentIndex to menuSpring before step 2, so Phase 1's
        // distances (spring → slogans) are real and the row cascade is preserved.
        // (o1 = menuSlogans differs from the start menuSpring, so Phase 1 is not
        // flattened to zero — unlike spinning to the message already on screen.)
        runSequence(sfhw, [
            hw => new FlipSyncLastFlipTogether().generateGroupActions(new PixelArtTarget([], ' '), menuSpring, 30, hw),
            hw => new RowSyncSpinTransition(1, 20).generateGroupActions(menuSlogans, menuClasses, 0, hw),
        ], 30)
    ),
    sfCase('menu-spring-to-classes-spin-hold', (sfhw) =>
        // Whole-grid cousin of the row-sync case: flip in the spring menu, then
        // SpinHoldFlipTogether spins menuSlogans → menuClasses. Background flaps
        // land on their pre-goal state together and hold; the message flaps keep
        // spinning for at least 15s longer, then everything reveals in one beat.
        runSequence(sfhw, [
            hw => new FlipSyncLastFlipTogether().generateGroupActions(new PixelArtTarget([], ' '), menuSpring, 30, hw),
            hw => new SpinHoldFlipTogether(1, 15).generateGroupActions(menuSlogans, menuClasses, 0, hw),
        ], 30)
    ),
    sfCase('veni-vidi-vici', (sfhw) => {
        const o1 = new PixelArtTarget(centeredMsg('xgpk xkfk xkek'), ' ');
        const o2 = new PixelArtTarget([], ' ');
        return new RowSyncSpinTransition(1, 10).generateGroupActions(o1, o2, 0, sfhw);
    }),
    sfCase('menu-cycle', (sfhw) => {
        const hold = 60;
        const t = () => new FlipSyncLastFlipTogether();

        // Each leg is generated from the previous leg's end state (threaded by
        // runSequence), so e.g. menuSpring→menuSlogans measures its flips from
        // menuSpring rather than from blank.
        return runSequence(sfhw, [
            hw => t().generateGroupActions(new PixelArtTarget([], ' '), menuSpring, 30, hw),
            hw => t().generateGroupActions(menuSpring, menuSlogans, 30, hw),
            hw => t().generateGroupActions(menuSlogans, menuClasses, 30, hw),
        ], hold);
    }),
];

// ── 32×6 cases ────────────────────────────────────────────────────────────────

const cases: EvalCase[] = [
    sfCase('matrix-down',         keepFlipping(new MatrixDown())),
    sfCase('back-and-forth',      keepFlipping(new BackAndForth())),
    sfCase('left-to-right',       keepFlipping(new LeftToRight())),
    sfCase('out-from-centre',     keepFlipping(new OutFromCentre())),
    sfCase('staggered-row',       keepFlipping(new StaggeredRow())),
    sfCase('spiral-in',           keepFlipping(new SpiralIn())),
    sfCase('row-by-row-overlap',  keepFlipping(new RowByRowOverlap())),
    sfCase('random-order',        keepFlipping(new RandomOrder())),
    sfCase('diagonal',            keepFlipping(new Diagonal())),
    sfCase('spiral-out',          keepFlipping(new SpiralOut())),
    sfCase('organic-ripple',      keepFlipping(new OrganicRipple())),
    sfCase('centre-pulse',        keepFlipping(new CentrePulse())),
    sfCase('ping-pong',           keepFlipping(new PingPong())),
    sfCase('middle-out-diagonal', keepFlipping(new MiddleOutDiagonal())),
    sfCase('shallow-diagonal',    keepFlipping(new ShallowDiagonal())),
    sfCase('line-diagonal',       keepFlipping(new LineDiagonal(), 200)),
    sfCase('top-down',            keepFlipping(new TopDown(), 200)),
    sfCase('ring',            keepFlipping(new Ring2(), 50)),

    sfCase('trickle-keep-matrix', (_sfhw, rect) =>
        new TrickleKeepFlipping(new MatrixDown(), 3).generateGroupActions(new PixelArtTarget([], ''), rect, 120, _sfhw)
    ),

    sfCase('and-then-flip-to', (sfhw, rect) => {
        const flipAnim = new OneByOneKeepFlipping(new LineDiagonal())
            .generateGroupActions(new PixelArtTarget([], ''), rect, 200, sfhw);
        const target = new PixelArtTarget(centeredMsg('up next\nmatrix'), ' ');
        return new AndThenFlipTo(flipAnim).generateGroupActions(rect, target, 30, sfhw);
    }),

    sfCase('layer-fore-back', (sfhw, rect) => {
        const square = new RectangleTarget(3, 3, [Math.round(SW / 2) + 2, 2], [SW, SH]);
        const order1 = new AllAtOnce();
        const order2 = new LineDiagonal();
        return new LayerForeBackTransition(
            order1, order2, rect,
            new OneByOneKeepFlipping(order1),
            new OneByOneKeepFlipping(order2),
        ).generateGroupActions(new PixelArtTarget([], ''), square, 50, sfhw);
    }),
];

// ── Image-based cases (thinking.png) ─────────────────────────────────────────
// Top-level await: image is fetched before the runner is registered so that
// hardware dimensions (which must match the image) are known at case-creation time.

const [imgW, imgH, imgRgb] = await getImages([`${BASE}animations/thinking.png`]);

const imgFrameIds: number[] = imgRgb[0].flatMap((row: number[][], i: number) =>
    row.flatMap((px: number[], j: number) =>
        (px[0] !== 255 && px[1] !== 255 && px[2] !== 255) ? [i * imgW + j] : []
    )
);

const thinkingMsg = 'gwtgmc*'; // 'eureka!';
const thinkingMsgGrid: string[][] = Array.from({ length: imgH }, (_, r) =>
    Array.from({ length: imgW }, (_, c) =>
        r === 6 && c > 12 && c <= 12 + thinkingMsg.length ? thinkingMsg[c - 13] : ' '
    )
);

const thinkingMsgTarget = new PixelArtTarget(thinkingMsgGrid, ' ');

const IMG_HW = { type: 'splitflap' as const, width: imgW, height: imgH };

function thinkingCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: IMG_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const sfhw = hw as SplitflapHardware;
            const frame1 = new GroupAction(1, [[Action.FLIP, imgFrameIds]]);
            const frame2 = new GroupAction(2, [[Action.FLIP, imgFrameIds]]);
            const anim = makeTransition().generateGroupActions(
                new PixelArtTarget([], ''), thinkingMsgTarget, 1, sfhw,
            );

            return [frame1, frame2, ...delayGroupActions(anim, 4)];
        },
    };
}

const thinkingCases: EvalCase[] = [
    // thinkingCase('thinking-flip-constant-speed',  () => new FlipConstantSpeed()),
    // thinkingCase('thinking-flip-directional-ltr', () => new FlipDirectional(new LeftToRight())),
    // thinkingCase('thinking-flip-sync-end',        () => new FlipSyncEnd()),
    thinkingCase('thinking-flip-sync-lastfliptogether',        () => new FlipSyncLastFlipTogether()),
];

// ── Flipdot DSL cases ─────────────────────────────────────────────────────────

const [logoW, logoH, logoRgb] = await getImages([
    `${BASE}animations/text-logo1.png`,
    `${BASE}animations/text-logo2.png`,
]);
const [dandelionW, dandelionH, dandelionRgb] = await getImages([
    `${BASE}animations/dandelion1.png`,
    `${BASE}animations/dandelion2.png`,
]);
const [golfW, golfH, golfRgb] = await getImages(
    Array.from({ length: 9 }, (_, i) => `${BASE}animations/golf-collide${i + 1}.png`)
);
const [waveW, waveH, waveRgb] = await getImages(
    Array.from({ length: 11 }, (_, i) => `${BASE}animations/wave${i + 1}.png`)
);

const [moonW, moonH, moonRgb] = await getImages(
    Array.from({ length: 11 }, (_, i) => `${BASE}animations/moon${i + 1}.png`)
);

const [eW, eH, eRgb] = await getImages([`${BASE}animations/e2.png`]);

const LOGO_HW      = { type: 'flipdot' as const, width: logoW,      height: logoH      };
const DANDELION_HW = { type: 'flipdot' as const, width: dandelionW, height: dandelionH };
const WAVE_HW         = { type: 'flipdot' as const, width: waveW, height: waveH, frontColour: 'white',    backColour: '#137596' };
// const WAVE_HW         = { type: 'flipdot' as const, width: waveW, height: waveH, frontColour: 'white',    backColour: '#add8e6' };
const WAVE_HW_INVERTED = { type: 'flipdot' as const, width: waveW, height: waveH, frontColour: '#137596', backColour: 'white'    };
const MOON_HW = { type: 'flipdot' as const, width: moonW, height: moonH, frontColour: '#137596', backColour: 'white'    };

// Logo is #000000 on white — any non-white pixel is active.
function logoGrid(frame: number[][][], w: number, h: number): string[][] {
    return Array.from({ length: h }, (_, r) =>
        Array.from({ length: w }, (_, c) => {
            const [pr, pg, pb] = frame[r][c];
            return (pr !== 255 || pg !== 255 || pb !== 255) ? 'X' : ' ';
        })
    );
}

const logoSource = new PixelArtTarget(logoGrid(logoRgb[0], logoW, logoH), ' ');
const logoTarget = new PixelArtTarget(logoGrid(logoRgb[1], logoW, logoH), ' ');

const waveFrames = waveRgb.map(frame => new PixelArtTarget(logoGrid(frame, waveW, waveH), ' '));
const moonFrames = moonRgb.map(frame => new PixelArtTarget(logoGrid(frame, moonW, moonH), ' '));
const GOLF_HW      = { type: 'flipdot' as const, width: golfW,      height: golfH      };

// Extract pixels of a given RGB color from image frames as boolean PixelArtTargets.
const matchColor = ([r, g, b]: [number, number, number]) =>
    (frameRgb: number[][][]): boolean[][] =>
        frameRgb.map(row => row.map(px => px[0] === r && px[1] === g && px[2] === b));

const matchNonWhite = (frameRgb: number[][][]): boolean[][] =>
    frameRgb.map(row => row.map(px => px[0] !== 255 || px[1] !== 255 || px[2] !== 255));

function makeTargets(
    frames: number[][][][],
    colorFn: (f: number[][][]) => boolean[][],
    start: number,
    end: number,
): PixelArtTarget[] {
    return frames.slice(start, end + 1).map((f, i) => {
        const t = new PixelArtTarget(colorFn(f), false);
        t.frameId = start + i;
        return t;
    });
}

function chainInstantaneous(targets: PixelArtTarget[]): void {
    for (let i = 0; i < targets.length - 1; i++)
        targets[i].effect = new Instantaneous(targets[i], targets[i + 1], EffectType.Complete);
}

// Build a PixelArtTarget grid from a dandelion frame.
// head: #222034 = rgb(34,32,52)   stem: #d77bba = rgb(215,123,186)
// Any pixel matching either colour becomes 'X' (on); everything else is ' ' (off).
function dandelionGrid(frame: number[][][], w: number, h: number): string[][] {
    return Array.from({ length: h }, (_, r) =>
        Array.from({ length: w }, (_, c) => {
            const [pr, pg, pb] = frame[r][c];
            const isHead = Math.abs(pr - 34)  < 20 && Math.abs(pg - 32)  < 20 && Math.abs(pb - 52)  < 20;
            const isStem = Math.abs(pr - 215) < 20 && Math.abs(pg - 123) < 20 && Math.abs(pb - 186) < 20;
            return isHead || isStem ? 'X' : ' ';
        })
    );
}

const dandelionSource = new PixelArtTarget(dandelionGrid(dandelionRgb[0], dandelionW, dandelionH), ' ');
const dandelionTarget = new PixelArtTarget(dandelionGrid(dandelionRgb[1], dandelionW, dandelionH), ' ');

function logoCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: LOGO_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            return makeTransition().generateGroupActions(logoSource, logoTarget, 30, hw);
        },
    };
}

const logoCases: EvalCase[] = [
    // logoCase('logo-snap',          () => new SnapTransition()),
    // logoCase('logo-wave-ltr',      () => new WaveTransition(new LeftToRight())),
    // logoCase('logo-wave-diagonal', () => new WaveTransition(new Diagonal())),
    // logoCase('logo-wave-random',   () => new WaveTransition(new RandomOrder(20))),
    logoCase('logo-experimental',      () => new CascadeImage(new TopDown())),
    // logoCase('logo-cascade-ltr',      () => new CascadeImage(new AllAtOnce())),
];

// Plays through `frames` in order, snapping to the first frame then applying
// `transition` between each consecutive pair. `spaceBetween` is the tick gap
// between transition start times; `duration` is how many ticks each transition
// spans (defaults to `spaceBetween` so there's no idle pause between frames).
// Set `loop` to true to add a final transition back to the first frame.
function animationCase(
    name: string,
    hardware: HardwareSpec,
    frames: PixelArtTarget[],
    {
        transition,
        spaceBetween = 4,
        duration,
        loop = false,
    }: {
        transition?: Transition;
        spaceBetween?: number;
        duration?: number;
        loop?: boolean;
    } = {}
): EvalCase {
    const tr = transition ?? new FittedWaveTransition(new InterpolationOrder(new LeftToRight()));
    const dur = duration ?? spaceBetween;
    return {
        name,
        hardware,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const emptyFrame = new PixelArtTarget(frames[0].draw().map(r => r.map(() => ' ')), ' ');
            const path = loop ? [...frames, frames[0]] : frames;
            const result: GroupAction[] = [
                ...new SnapTransition().generateGroupActions(emptyFrame, path[0], 0, hw),
            ];
            for (let i = 0; i < path.length - 1; i++) {
                result.push(
                    ...delayGroupActions(
                        tr.generateGroupActions(path[i], path[i + 1], dur, hw),
                        (i + 1) * spaceBetween
                    )
                );
            }
            return result;
        },
    };
}

function waveCase(name: string, hw = WAVE_HW): EvalCase {
    return animationCase(name, hw, waveFrames, { spaceBetween: 2 });
}

function dandelionCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: DANDELION_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const emptyFrame = new PixelArtTarget(dandelionSource.draw().map(r => r.map(() => ' ')), ' ');
            const bootstrap = new SnapTransition().generateGroupActions(emptyFrame, dandelionSource, 0, hw);
            const transition = makeTransition().generateGroupActions(dandelionSource, dandelionTarget, 30, hw);
            return [...bootstrap, ...delayGroupActions(transition, 1)];
        },
    };
}

const dandelionCases: EvalCase[] = [
    // dandelionCase('dandelion-snap',          () => new SnapTransition()),
    // dandelionCase('dandelion-crescent-stochastic', () => new StochasticTransition(new CrescentOrder(0.4))),
    // dandelionCase('dandelion-centre-stochastic', () => new StochasticTransition(new FastCentrePulse())),
    
];

// Frames for a solid box moving diagonally from top-left to bottom-right corner.
const DIAG_BOX_W = 16, DIAG_BOX_H = 10, DIAG_STEPS = 30;
const diagonalBoxFrames: PixelArtTarget[] = Array.from({ length: DIAG_STEPS }, (_, i) => {
    const t = i / (DIAG_STEPS - 1);
    const bx = Math.round(t * (logoW - DIAG_BOX_W));
    const by = Math.round(t * (logoH - DIAG_BOX_H));
    return new PixelArtTarget(
        Array.from({ length: logoH }, (_, row) =>
            Array.from({ length: logoW }, (_, col) =>
                col >= bx && col < bx + DIAG_BOX_W && row >= by && row < by + DIAG_BOX_H ? 'X' : ' '
            )
        ),
        ' ',
    );
});

// Noise: single canvas-anchored pattern; box pixels invert it so the full box shape is always distinct.
// Every pixel the box passes over flips as it enters/exits the box area.
function applyNoise(frames: PixelArtTarget[]): PixelArtTarget[] {
    const src0 = frames[0].draw() as string[][];
    const h = src0.length, w = src0[0].length;
    const pattern = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => Math.random() > 0.5)
    );
    return frames.map(f =>
        new PixelArtTarget(
            (f.draw() as string[][]).map((row, y) =>
                row.map((cell, x) => (cell !== ' ' ? !pattern[y][x] : pattern[y][x]) ? 'X' : ' ')
            ),
            ' ',
        )
    );
}

// MovingNoise: box interior uses a pattern anchored to the box; background uses a separate fixed pattern.
function applyMovingNoise(frames: PixelArtTarget[]): PixelArtTarget[] {
    const src0 = frames[0].draw() as string[][];
    const h = src0.length, w = src0[0].length;
    const bgPattern = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => Math.random() > 0.5)
    );
    const boxPattern = Array.from({ length: DIAG_BOX_H }, () =>
        Array.from({ length: DIAG_BOX_W }, () => Math.random() > 0.5)
    );
    return frames.map(f => {
        const src = f.draw() as string[][];
        let yMin = src.length, xMin = src[0]?.length ?? 0;
        for (let y = 0; y < src.length; y++)
            for (let x = 0; x < src[y].length; x++)
                if (src[y][x] !== ' ') { yMin = Math.min(yMin, y); xMin = Math.min(xMin, x); }
        return new PixelArtTarget(
            src.map((row, y) => row.map((cell, x) =>
                cell !== ' '
                    ? (boxPattern[y - yMin]?.[x - xMin] ? 'X' : ' ')
                    : (bgPattern[y][x] ? 'X' : ' ')
            )),
            ' ',
        );
    });
}

const diagonalBoxNoiseFrames       = applyNoise(diagonalBoxFrames);
const diagonalBoxMovingNoiseFrames = applyMovingNoise(diagonalBoxFrames);

const flipdotCases: EvalCase[] = [
    {
        name: 'golf-collision',
        hardware: GOLF_HW,
        capture: CAPTURE,
        async build(_hw, ctx) {
            // TODO: collision should be detected at frames 4–5, not 3–4
            await ctx.fromDSL([
                'timing: [1,2,3,4,5,6,7,8,9]',
                `filepath: ${BASE}animations/golf-collide\${i}.png`,
                'objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball]',
                'golfstick 0 ->* instantaneous ->* golfstick 8',
                'golfer 0 ->* instantaneous ->* golfer 8',
                'ball 0 ->* instantaneous ->* ball 8',
                'collision: collision(ball 4, golfstick 4) 4 -> instantaneous -> collision(ball 4, golfstick 4) 5',
            ].join('\n'));
        },
    },
    {
        name: 'golf-path',
        hardware: GOLF_HW,
        capture: CAPTURE,
        async build(_hw, ctx) {
            await ctx.fromDSL([
                'timing: [4,8,12,16,20,24,28,32,36]',
                `filepath: ${BASE}animations/golf-collide\${i}.png`,
                'objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball]',
                'golfstick 0 ->* instantaneous ->* golfstick 8',
                'golfer 0 ->* instantaneous ->* golfer 8',
                'ball 4 ->* move ->* ball 8',
                'ball 4 -> path -> ball 5 -> path -> ball 6 -> path -> ball 7 -> path -> ball 8',
            ].join('\n'));
        },
    },
    {
        name: 'golf',
        hardware: GOLF_HW,
        capture: CAPTURE,
        async build(_hw, ctx) {
            await ctx.fromDSL([
                'timing: [4,8,12,16,20,24,28,32,36]',
                `filepath: ${BASE}animations/golf-collide\${i}.png`,
                'objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball]',
                'golfstick 0 ->* instantaneous ->* golfstick 8',
                'golfer 0 ->* instantaneous ->* golfer 8',
                'ball 4 ->* instantaneous ->* ball 8',
                // 'ball 4 -> path -> ball 5 -> path -> ball 6 -> path -> ball 7 -> path -> ball 8',
            ].join('\n'));
        },
    },

    {
        name: 'golf-direct',
        hardware: GOLF_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const golfstick = makeTargets(golfRgb, matchColor([0,   0,   0  ]), 0, 8); // #000000
            const golfer    = makeTargets(golfRgb, matchColor([95,  205, 228]), 0, 8); // #5fcde4
            const ball      = makeTargets(golfRgb, matchColor([91,  110, 225]), 4, 8); // #5b6ee1

            chainInstantaneous(golfstick);
            chainInstantaneous(golfer);
            chainInstantaneous(ball);

            const timing = [4, 8, 12, 16, 20, 24, 28, 32, 36];
            return generateAnimationToGroupAction(
                [[golfstick[0]], [golfer[0]], [ball[0]]],
                timing,
                hw as HardwareInterface,
            );
        },
    },

    waveCase('wave'),
    waveCase('wave-inverted', WAVE_HW_INVERTED),
    animationCase('wave-far-edge-triple', WAVE_HW, waveFrames, {
        transition: new FarEdgeTripleTransition(new InterpolationOrder(new LeftToRight())),
        spaceBetween: 6,
    }),

    {
        name: 'wave-direct',
        hardware: WAVE_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const frames = makeTargets(waveRgb, matchNonWhite, 0, 10);
            chainInstantaneous(frames);
            const timing = Array.from({ length: 10 }, (_, i) => (i + 1) * 2);
            return generateAnimationToGroupAction([[frames[0]]], timing, hw as HardwareInterface);
        },
    },

    {
        name: 'wave-direct-interp',
        hardware: WAVE_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const frames = makeTargets(waveRgb, matchNonWhite, 0, 10);
            const tr = () => new FittedWaveTransition(new InterpolationOrder(new LeftToRight()));
            for (let i = 0; i < frames.length - 1; i++)
                frames[i].effect = new GenericEffect(frames[i], frames[i + 1], tr, EffectType.Complete);
            const timing = Array.from({ length: 10 }, (_, i) => (i + 1) * 2);
            return generateAnimationToGroupAction([[frames[0]]], timing, hw as HardwareInterface);
        },
    },

    {
        name: 'wave-direct-interp-more',
        hardware: WAVE_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const frames = makeTargets(waveRgb, matchNonWhite, 0, 10);
            const tr = () => new FittedWaveTransition(new InterpolationOrder(new LeftToRight()));
            for (let i = 0; i < frames.length - 1; i++)
                frames[i].effect = new GenericEffect(frames[i], frames[i + 1], tr, EffectType.Complete);
            const timing = Array.from({ length: 10 }, (_, i) => (i + 1) * 4);
            return generateAnimationToGroupAction([[frames[0]]], timing, hw as HardwareInterface);
        },
    },

    animationCase('moon', MOON_HW, moonFrames, {
        transition: new SnapTransition(),
        spaceBetween: 1,
    }),

    animationCase('moon-interp', MOON_HW, moonFrames, {
        transition: new WaveTransition(new InterpolationOrder(new RightToLeft())),
        spaceBetween: 3,
    }),

    animationCase('diagonal-box', LOGO_HW, diagonalBoxFrames, {
        transition: new SnapTransition(),
        spaceBetween: 3,
        loop: true,
    }),

    // Noise anchored to canvas — box moves through a fixed static field
    animationCase('diagonal-box-noise', LOGO_HW, diagonalBoxNoiseFrames, {
        transition: new SnapTransition(),
        spaceBetween: 1,
        loop: true,
    }),

    // MovingNoise anchored to box — static travels with the box
    animationCase('diagonal-box-moving-noise', LOGO_HW, diagonalBoxMovingNoiseFrames, {
        transition: new SnapTransition(),
        spaceBetween: 1,
        loop: true,
    }),

];


// ── Fill cases (empty → full grid) ───────────────────────────────────────────

const FILL_W = 20;
const FILL_H = 10;
const FILL_HW = { type: 'flipdot' as const, width: FILL_W, height: FILL_H };

const emptyGrid = new PixelArtTarget(Array.from({ length: FILL_H }, () => Array(FILL_W).fill(' ')), ' ');
const fullGrid  = new PixelArtTarget(Array.from({ length: FILL_H }, () => Array(FILL_W).fill('X')), ' ');

function fillCase(name: string, transition: Transition): EvalCase {
    return {
        name,
        hardware: FILL_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            return transition.generateGroupActions(emptyGrid, fullGrid, 10, hw);
        },
    };
}

const fillCases: EvalCase[] = [
    // fillCase('fill-wave-ltr',  new WaveTransition(new LeftToRight())),
    // fillCase('fill-wave-rtl',  new WaveTransition(new RightToLeft())),
    // OneByOneKeepFlipping = KeepFlippingTransition with order support
    fillCase('fill-accel-ltr', new AcceleratingCascadeTransition(new LeftToRight())),
    // fillCase('fill-accel-rtl', new AcceleratingCascadeTransition(new RightToLeft())),
    // fillCase('fill-keep-ltr',  new OneByOneKeepFlipping(new LeftToRight())),
    // fillCase('fill-keep-rtl',  new OneByOneKeepFlipping(new RightToLeft())),
];

// ── Async flipdot cases ───────────────────────────────────────────────────────
// FlipdotSimAsyncHardware lets each disc animate independently, so we can
// schedule flips at any sim frame rather than aligning to FULL_CYCLE_LENGTH
// boundaries. These cases pin framesPerMs = 1 so GroupAction.tPlus directly
// addresses an animation frame; the staggering happens within a single
// flip duration (≈ numFramesRotating frames), which is what makes the
// motion look continuous rather than stepped.

const ASYNC_W = 20;
const ASYNC_H = 10;
const ASYNC_HW = { type: 'flipdot' as const, async: true, width: ASYNC_W, height: ASYNC_H };

function asyncCase(
    name: string,
    build: (hw: FlipdotSimAsyncHardware) => GroupAction[],
): EvalCase {
    return {
        name,
        hardware: ASYNC_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            const fhw = hw as FlipdotSimAsyncHardware;
            fhw.framesPerMs = 1;
            return build(fhw);
        },
    };
}

// Logo case on async hardware. Transitions like CascadeImage lay out their
// tPlus values in multiples of actionDurations[FLIP] (= 1 on flipdot hw).
// The default framesPerMs (NUM_FRAMES_ROTATING = 6) maps one tPlus to one
// rotation duration; bumping it stretches the schedule and inserts idle
// frames between rotations, slowing the overall animation.
const ASYNC_LOGO_HW = { type: 'flipdot' as const, async: true, width: logoW, height: logoH };
const ASYNC_LOGO_FRAMES_PER_MS = 8; //default is 6

// Both async logo variants use only text-logo-1 (logoSource); text-logo-2
// has off-white bleed that confuses logoGrid. The "background" effect is
// produced by inverting logoSource programmatically rather than relying on
// a second image.
const blankLogo = () => new PixelArtTarget(
    logoSource.draw().map(r => r.map(() => ' ')), ' '
);

const invertedLogo = () => new PixelArtTarget(
    logoSource.draw().map(r => r.map(c => c === ' ' ? 'X' : ' ')), ' '
);

// Foreground variant — diff is exactly the text pixels of logoSource, so the
// letters animate in from a blank display.
function asyncLogoCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: ASYNC_LOGO_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            (hw as FlipdotSimAsyncHardware).framesPerMs = ASYNC_LOGO_FRAMES_PER_MS;
            return makeTransition().generateGroupActions(blankLogo(), logoSource, 100, hw);
        },
    };
}

// Background variant — diff is everything in logoSource that ISN'T text, so
// the negative space fills in around the letters and the text is left as
// the "hole" through which the unlit display shows.
function asyncLogoBgCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: ASYNC_LOGO_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            (hw as FlipdotSimAsyncHardware).framesPerMs = ASYNC_LOGO_FRAMES_PER_MS;
            return makeTransition().generateGroupActions(blankLogo(), invertedLogo(), 100, hw);
        },
    };
}

const ThreeByThreeMatrixCases: EvalCase[] = [
    // asyncLogoCase('logo-wipe-topdown', () => new WaveTransition(new TopDown())),
    // asyncLogoCase('logo-wipe-contour-fg', () => new WaveTransition(new GrowAlongContoursParallel([logoW/2, logoH/2]))),
    // asyncLogoCase('logo-wipe-random', () => new WaveTransition(new RandomOrder(20))), // added 20 for video
    // asyncLogoCase('logo-wipe-allatonce', () => new WaveTransition(new AllAtOnce())),


    asyncLogoCase('logo-pulse-topdown', () => new PulseTransition(new TopDown(), 15)),
    // asyncLogoCase('logo-pulse-contour-fg', () => new PulseTransition(new GrowAlongContoursParallel([logoW/2, logoH/2]), 20)),
    // asyncLogoCase('logo-pulse-random', () => new PulseTransition(new RandomOrder(20), 200)),
    // asyncLogoCase('logo-pulse-allatonce', () => new PulseTransition(new AllAtOnce())),

    // asyncLogoCase('logo-evenodd-topdown', () => new EvenOddRhythmTransition(new TopDown())),
    // asyncLogoCase('logo-evenodd-contour-fg', () => new EvenOddRhythmTransition(new GrowAlongContoursParallel([logoW/2, logoH/2]))),
    // asyncLogoCase('logo-evenodd-random', () => new EvenOddRhythmTransition(new RandomOrder(20))),
    // asyncLogoCase('logo-evenodd-allatonce', () => new EvenOddRhythmTransition(new AllAtOnce())),

    // asyncLogoCase('logo-cascade-topdown', () => new CascadeImage(new TopDown())),
    // asyncLogoCase('logo-cascade-contour-fg', () => new CascadeImage(new GrowAlongContoursParallel([logoW/2, logoH/2]))),
    // asyncLogoCase('logo-cascade-random', () => new CascadeImage(new RandomOrder(20))),
    // asyncLogoCase('logo-cascade-allatonce', () => new CascadeImage(new AllAtOnce())),

/// ====
    // asyncLogoBgCase('logo-wipe-contour-bg', () => new WaveTransition(new GrowAlongContoursParallel([logoW/2, logoH/2]))),
    // asyncLogoCase('logo-experimental-async', () => new EvenOddRhythmTransition(new TopDown())),
    // asyncLogoCase('logo-experimental-async', () => new EvenOddRhythmTransition(new TopDown())),
    // asyncLogoCase('logo-pulse-allatonce', () => new PulseTransition(new CurvedWave(2))),

]


const asyncFlipdotCases: EvalCase[] = [
    // asyncLogoCase('logo-experimental-async', () => new EvenOddRhythmTransition(new TopDown())),
    // asyncLogoCase('logo-alternating-flap', () => new AlternatingFlapTransition()),
    
    // asyncLogoBgCase('beat', () => new BeatTransition(new TopDown(), [2, 2, 0.5, 1, 1])),

    // lub-DUB lub-DUB: long gap then short gap, clear two-feel
    asyncLogoBgCase('beat-heartbeat',  () => new BeatTransition(new TopDown(), [6, 2])),


    // these next two are just ok
    // // tresillo (3+3+2): most fundamental syncopated rhythm in Latin music — feels "off" but grooves
    // asyncLogoBgCase('beat-tresillo',   () => new BeatTransition(new TopDown(), [3, 3, 2])),

    // long pause then three rapid-fire clicks — very ear-catching contrast
    // asyncLogoBgCase('beat-burst',      () => new BeatTransition(new TopDown(), [8, 1, 1, 1])),

    // jazz shuffle: strict long-short alternation
    asyncLogoBgCase('beat-swing',      () => new BeatTransition(new TopDown(), [3, 1])),

    // fibonacci: interval doubles each cycle, sounds like natural acceleration
    asyncLogoBgCase('beat-fibonacci',  () => new BeatTransition(new TopDown(), [1, 1, 2, 3, 5]))

    // // Diagonal sweep: every disc flips once at tPlus = x + y, so one diagonal
    // // stripe starts each frame. Six diagonals end up visibly mid-flip at the
    // // same time (default numFramesRotating = 6).
    // asyncCase('async-diagonal-wave', () => {
    //     const actions: GroupAction[] = [];
    //     for (let y = 0; y < ASYNC_H; y++) {
    //         for (let x = 0; x < ASYNC_W; x++) {
    //             const id = y * ASYNC_W + x;
    //             actions.push(new GroupAction(x + y, [[Action.FLIP, [id]]]));
    //         }
    //     }
    //     return actions;
    // }),

    // // Two Manhattan-distance ripples expanding from opposite ends. Each disc
    // // gets two FLIP events (one per seed), so the second flip lands while
    // // most of the grid is mid-rotation — gives an interference look that
    // // the synchronous sim can't produce.
    // asyncCase('async-interfering-ripples', () => {
    //     const seeds: [number, number][] = [
    //         [Math.floor(ASYNC_W * 0.25), Math.floor(ASYNC_H / 2)],
    //         [Math.floor(ASYNC_W * 0.75), Math.floor(ASYNC_H / 2)],
    //     ];
    //     const framesPerStep = 2;
    //     const actions: GroupAction[] = [];
    //     for (let y = 0; y < ASYNC_H; y++) {
    //         for (let x = 0; x < ASYNC_W; x++) {
    //             const id = y * ASYNC_W + x;
    //             for (const [sx, sy] of seeds) {
    //                 const tPlus = (Math.abs(x - sx) + Math.abs(y - sy)) * framesPerStep;
    //                 actions.push(new GroupAction(tPlus, [[Action.FLIP, [id]]]));
    //             }
    //         }
    //     }
    //     return actions;
    // }),

    // // Per-column rain: each column is its own waterfall, with a deterministic
    // // starting offset per column and `gap` frames between adjacent rows.
    // // gap = numFramesRotating means within a column each disc finishes
    // // before the next starts; the inter-column offsets are what produce
    // // the visible phase difference.
    // asyncCase('async-rain', hw => {
    //     const gap = hw.simulation.numFramesRotating;
    //     const colDelay = (x: number) => (x * 3 + (x * 7) % 11) % (gap * 4);
    //     const actions: GroupAction[] = [];
    //     for (let x = 0; x < ASYNC_W; x++) {
    //         for (let y = 0; y < ASYNC_H; y++) {
    //             const id = y * ASYNC_W + x;
    //             actions.push(new GroupAction(colDelay(x) + y * gap, [[Action.FLIP, [id]]]));
    //         }
    //     }
    //     return actions;
    // }),
];

// ── Brixel cases ─────────────────────────────────────────────────────────────

const BW = 10;
const BH = 10;
const BRIXEL_HW = { type: 'brixel' as const, width: BW, height: BH };

const brixelCases: EvalCase[] = [
    {
        name: 'brixel-rotate-reveal',
        hardware: BRIXEL_HW,
        build(hw): GroupAction[] {
            const bhw = hw as BrixelSimHardware;
            const rrt = new RotateRevealTransition();
            const s  = new CircleTarget(0, [4, 4], [BW, BH]);
            const t1 = new CircleTarget(1, [4, 4], [BW, BH]);
            const t2 = new CircleTarget(3, [2, 2], [BW, BH]);
            const t3 = new CircleTarget(4, [1, 1], [BW, BH]);
            const dur = 300;
            return [
                ...rrt.generateGroupActions(s,  t1, dur, bhw),
                ...delayGroupActions(rrt.generateGroupActions(t1, t2, dur, bhw), dur),
                ...delayGroupActions(rrt.generateGroupActions(t2, t3, dur, bhw), dur * 2),
            ];
        },
    },
];

// ── Runner ────────────────────────────────────────────────────────────────────

// export const runner = new EvalRunner().register(...thinkingCases);
// export const runner = new EvalRunner().register(...cases);
// export const runner = new EvalRunner().register(...brixelCases);
// export const runner = new EvalRunner().register(...ThreeByThreeMatrixCases);
// export const runner = new EvalRunner().register(...cases, ...asyncFlipdotCases, ...menuCases);
export const runner = new EvalRunner().register(...menuCases);
// export const runner = new EvalRunner().register(...cases, ...logoCases, ...dandelionCases, ...flipdotCases);
// export const runner = new EvalRunner().register(...cases, ...thinkingCases, ...flipdotCases);

if (typeof window !== 'undefined') {
    // runner.run('beat').catch(err => console.error('[eval] failed:', err));
    // runner.run('ring').catch(err => console.error('[eval] failed:', err));
    // runner.run('wave-far-edge-triple').catch(err => console.error('[eval] failed:', err));
    // runner.run('wave-direct').catch(err => console.error('[eval] failed:', err));
    // runner.run('veni-vidi-vici').catch(err => console.error('[eval] failed:', err));
    // runner.run('trickle-keep-matrix').catch(err => console.error('[eval] failed:', err));
    // runner.run('menu-cycle').catch(err => console.error('[eval] failed:', err));
    // runner.run('menu-spring-to-classes-row-sync').catch(err => console.error('[eval] failed:', err));
    runner.run('menu-spring-to-classes-spin-hold').catch(err => console.error('[eval] failed:', err));
    // runner.run('').catch(err => console.error('[eval] failed:', err));
}

// // ── GrowAlongContoursParallel heatmap visualization ───────────────────────────

// if (typeof window !== 'undefined') {
//     const viz = document.getElementById('contour-parallel-viz');
//     if (viz) {
//         const order = new GrowAlongContoursParallel([Math.floor(logoW / 2), Math.floor(logoH / 2)]);
//         const src = logoSource.draw();
//         const diff: boolean[][] = src.map(row => row.map(cell => cell !== ' '));

//         const [timeGrid] = order.applyMask(diff);
//         const activeVals = timeGrid.flat().filter(v => v >= 0);
//         const maxVal = activeVals.length > 0 ? Math.max(...activeVals) : 1;
//         const minVal = activeVals.length > 0 ? Math.min(...activeVals) : 0;
//         const span = maxVal - minVal || 1;

//         const CW = 10, CH = 10;
//         const canvas = document.createElement('canvas');
//         canvas.width = logoW * CW;
//         canvas.height = logoH * CH;
//         canvas.style.cssText = 'display:block; border:1px solid #ccc; image-rendering:pixelated;';
//         const ctx = canvas.getContext('2d')!;
//         ctx.fillStyle = '#fff';
//         ctx.fillRect(0, 0, canvas.width, canvas.height);

//         for (let row = 0; row < logoH; row++) {
//             for (let col = 0; col < logoW; col++) {
//                 const val = timeGrid[row][col];
//                 if (val < 0) {
//                     ctx.fillStyle = diff[row][col] ? '#e8e0e8' : '#f4f4f4';
//                 } else {
//                     const ratio = (val - minVal) / span;
//                     const hue = Math.round(240 - ratio * 240);
//                     ctx.fillStyle = `hsl(${hue}, 80%, 38%)`;
//                 }
//                 ctx.fillRect(col * CW, row * CH, CW - 1, CH - 1);
//             }
//         }

//         const label = document.createElement('div');
//         label.textContent = `logo — GrowAlongContoursParallel (seed: centre)`;
//         label.style.cssText = 'color:#555; font-size:11px; margin-bottom:4px; font-family:monospace;';

//         const wrapper = document.createElement('div');
//         wrapper.style.cssText = 'display:inline-block; margin:8px; text-align:center; vertical-align:top;';
//         wrapper.appendChild(label);
//         wrapper.appendChild(canvas);
//         viz.appendChild(wrapper);
//     }
// }

// // ── SpiralOrder "E" shape visualization ──────────────────────────────────────

// if (typeof window !== 'undefined') {
//     const viz = document.getElementById('spiral-order-viz');
//     if (viz) {
//         const eShape: boolean[][] = eRgb[0].map(row =>
//             row.map(([r, g, b]) => r !== 255 || g !== 255 || b !== 255)
//         );

//         const order = new SpiralOrder();
//         const [timeGrid] = order.applyMask(eShape);
//         const activeVals = timeGrid.flat().filter(v => v >= 0);
//         const maxVal = activeVals.length > 0 ? Math.max(...activeVals) : 1;
//         const minVal = activeVals.length > 0 ? Math.min(...activeVals) : 0;
//         const span = maxVal - minVal || 1;

//         const CW = 20, CH = 20;
//         const canvas = document.createElement('canvas');
//         canvas.width = eW * CW;
//         canvas.height = eH * CH;
//         canvas.style.cssText = 'display:block; border:1px solid #ccc; image-rendering:pixelated;';
//         const ctx = canvas.getContext('2d')!;
//         ctx.fillStyle = '#fff';
//         ctx.fillRect(0, 0, canvas.width, canvas.height);

//         for (let row = 0; row < eH; row++) {
//             for (let col = 0; col < eW; col++) {
//                 const val = timeGrid[row][col];
//                 if (val < 0) {
//                     ctx.fillStyle = '#f4f4f4';
//                 } else {
//                     const ratio = (val - minVal) / span;
//                     const hue = Math.round(240 - ratio * 240);
//                     ctx.fillStyle = `hsl(${hue}, 80%, 38%)`;
//                 }
//                 ctx.fillRect(col * CW, row * CH, CW - 2, CH - 2);
//             }
//         }

//         const label = document.createElement('div');
//         label.textContent = 'SpiralOrder — "e" (e2.png, spiral from bounding-box centre)';
//         label.style.cssText = 'color:#555; font-size:11px; margin-bottom:4px; font-family:monospace;';

//         const wrapper = document.createElement('div');
//         wrapper.style.cssText = 'display:inline-block; margin:8px; text-align:center; vertical-align:top;';
//         wrapper.appendChild(label);
//         wrapper.appendChild(canvas);
//         viz.appendChild(wrapper);
//     }
// }

// // ── Transition timeline visualization ────────────────────────────────────────

// if (typeof window !== 'undefined') {
//     const timelineContainer = document.getElementById('timeline-viz');
//     if (timelineContainer) {
//         const NUM_UNITS = 6;
//         const tlHw = SplitflapHardware.Headless(NUM_UNITS, 1,
//             () => ' abcdefghijklmnopqrstuvwxyz!?*'.split('').map((s: string) => new SplitflapState(s)),
//         );
//         const tlO1 = new PixelArtTarget([], ' ');
//         const tlO2 = new RectangleTarget(NUM_UNITS, 1, [0, 0], [NUM_UNITS, 1]);
//         const TL_DURATION = 30;

//         const transitionDefs: { name: string; gas: GroupAction[] }[] = [
//             {
//                 name: 'OneByOneKeepFlipping (LeftToRight)',
//                 gas: new OneByOneKeepFlipping(new LeftToRight())
//                     .generateGroupActions(tlO1, tlO2, TL_DURATION, tlHw),
//             },
//             {
//                 name: 'SnapTransition',
//                 gas: new SnapTransition()
//                     .generateGroupActions(tlO1, tlO2, TL_DURATION, tlHw),
//             },
//             {
//                 name: 'PulseTransition (LeftToRight, pulse=2)',
//                 gas: new PulseTransition(new LeftToRight(), 2)
//                     .generateGroupActions(tlO1, tlO2, TL_DURATION, tlHw),
//             },
//             {
//                 name: 'BeatTransition: heartbeat [6, 2]',
//                 gas: new BeatTransition(new LeftToRight(), [6, 2])
//                     .generateGroupActions(tlO1, tlO2, TL_DURATION, tlHw),
//             },
//             {
//                 name: 'BeatTransition: fibonacci [1, 1, 2, 3, 5]',
//                 gas: new BeatTransition(new LeftToRight(), [1, 1, 2, 3, 5])
//                     .generateGroupActions(tlO1, tlO2, TL_DURATION, tlHw),
//             },
//         ];

//         const UNIT_COLORS = ['#0077cc', '#cc5500', '#228833', '#8822cc', '#bb8800', '#cc2244'];
//         const TW = 680, TH = 12;

//         for (const { name, gas } of transitionDefs) {
//             // Collect per-unit tick times from all GroupActions
//             const unitTicks = new Map<number, number[]>();
//             for (const ga of gas) {
//                 const tick = ga.tPlus as number;
//                 for (const [action, ids] of ga.actions) {
//                     if (action !== Action.FLIP) continue;
//                     for (const uid of ids) {
//                         if (!unitTicks.has(uid)) unitTicks.set(uid, []);
//                         unitTicks.get(uid)!.push(tick);
//                     }
//                 }
//             }

//             const allTimes = gas.map(ga => ga.tPlus as number);
//             const maxT = allTimes.length > 0 ? Math.max(...allTimes) : TL_DURATION;

//             const header = document.createElement('div');
//             header.style.cssText = 'color:#222; font-size:11px; margin:16px 0 4px; font-weight:bold;';
//             header.textContent = name;
//             timelineContainer.appendChild(header);

//             // Time ruler
//             const ruler = document.createElement('div');
//             ruler.style.cssText = 'position:relative; height:10px; margin-left:44px; margin-bottom:2px;';
//             const rulerStep = Math.ceil(maxT / 8);
//             for (let t = 0; t <= maxT; t += rulerStep) {
//                 const lbl = document.createElement('span');
//                 lbl.style.cssText = `color:#aaa; font-size:8px; position:absolute; left:${Math.round((t / maxT) * TW)}px;`;
//                 lbl.textContent = String(t);
//                 ruler.appendChild(lbl);
//             }
//             timelineContainer.appendChild(ruler);

//             for (let uid = 0; uid < NUM_UNITS; uid++) {
//                 const ticks = unitTicks.get(uid) ?? [];
//                 const color = UNIT_COLORS[uid % UNIT_COLORS.length];

//                 const row = document.createElement('div');
//                 row.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:2px;';

//                 const lbl = document.createElement('span');
//                 lbl.style.cssText = `color:${color}; font-size:9px; width:38px; text-align:right; flex-shrink:0;`;
//                 lbl.textContent = `u${uid}`;
//                 row.appendChild(lbl);

//                 const canvas = document.createElement('canvas');
//                 canvas.width = TW;
//                 canvas.height = TH;
//                 canvas.style.cssText = 'display:block; flex-shrink:0;';
//                 const ctx = canvas.getContext('2d')!;

//                 ctx.fillStyle = '#fff';
//                 ctx.fillRect(0, 0, TW, TH);
//                 ctx.fillStyle = '#ddd';
//                 ctx.fillRect(0, (TH / 2) | 0, TW, 1);

//                 ctx.fillStyle = color;
//                 for (const tick of ticks) {
//                     const x = maxT > 0 ? Math.round((tick / maxT) * (TW - 2)) : 0;
//                     ctx.fillRect(x, 0, 2, TH);
//                 }

//                 const countLbl = document.createElement('span');
//                 countLbl.style.cssText = `color:${color}; font-size:9px; flex-shrink:0; opacity:0.6;`;
//                 countLbl.textContent = `×${ticks.length}`;

//                 row.appendChild(canvas);
//                 row.appendChild(countLbl);
//                 timelineContainer.appendChild(row);
//             }
//         }
//     }
// }

// ── InterpolationOrder heatmap visualization ──────────────────────────────────

// function renderInterpolationHeatmap(
//     canvas: HTMLCanvasElement,
//     diff: boolean[][],
//     order: InterpolationOrder,
// ): void {
//     const CW = 10;
//     const CH = 10;
//     const height = diff.length;
//     const width = diff[0]?.length ?? 0;

//     canvas.width = width * CW;
//     canvas.height = height * CH;
//     const ctx = canvas.getContext('2d')!;

//     ctx.fillStyle = '#fff';
//     ctx.fillRect(0, 0, canvas.width, canvas.height);

//     const [timeGrid] = order.applyMask(diff);
//     const activeVals = timeGrid.flat().filter((v: number) => v >= 0);
//     const maxVal = activeVals.length > 0 ? Math.max(...activeVals) : 1;
//     const minVal = activeVals.length > 0 ? Math.min(...activeVals) : 0;
//     const span = maxVal - minVal || 1;

//     for (let row = 0; row < height; row++) {
//         for (let col = 0; col < width; col++) {
//             const val = timeGrid[row][col];
//             if (val < 0) {
//                 ctx.fillStyle = diff[row][col] ? '#e8e0e8' : '#f4f4f4';
//             } else {
//                 const ratio = (val - minVal) / span;
//                 const hue = Math.round(240 - ratio * 240);
//                 ctx.fillStyle = `hsl(${hue}, 80%, 38%)`;
//             }
//             ctx.fillRect(col * CW, row * CH, CW - 1, CH - 1);
//         }
//     }
// }

// if (typeof window !== 'undefined') {
//     const viz = document.getElementById('interpolation-viz');
//     if (viz) {
//         const order = new InterpolationOrder(new LeftToRight());

//         // Full-grid order heatmap — shows the order pattern independent of any diff
//         {
//             const refDraw = waveFrames[0].draw();
//             const H = refDraw.length, W = refDraw[0]?.length ?? 0;
//             const fullMask: boolean[][] = Array.from({ length: H }, () => Array(W).fill(true));
//             const [fullTimeGrid] = order.applyMask(fullMask);
//             const flatVals = fullTimeGrid.flat().filter((v: number) => v >= 0);
//             const fMax = Math.max(...flatVals, 1);
//             const fMin = Math.min(...flatVals);
//             const fSpan = fMax - fMin || 1;

//             const CW = 10, CH = 10;
//             const orderCanvas = document.createElement('canvas');
//             orderCanvas.width = W * CW;
//             orderCanvas.height = H * CH;
//             orderCanvas.style.cssText = 'display:block; border:1px solid #ccc; image-rendering:pixelated;';
//             const octx = orderCanvas.getContext('2d')!;
//             octx.fillStyle = '#fff';
//             octx.fillRect(0, 0, orderCanvas.width, orderCanvas.height);
//             for (let r = 0; r < H; r++) {
//                 for (let c = 0; c < W; c++) {
//                     const val = fullTimeGrid[r][c];
//                     const ratio = val >= 0 ? (val - fMin) / fSpan : 0;
//                     const hue = Math.round(240 - ratio * 240);
//                     octx.fillStyle = `hsl(${hue}, 80%, 38%)`;
//                     octx.fillRect(c * CW, r * CH, CW - 1, CH - 1);
//                 }
//             }

//             const orderLabel = document.createElement('div');
//             orderLabel.textContent = 'InterpolationOrder(LeftToRight) — full grid';
//             orderLabel.style.cssText = 'color:#555; font-size:11px; margin-bottom:4px; font-family:monospace;';
//             const orderWrapper = document.createElement('div');
//             orderWrapper.style.cssText = 'display:inline-block; margin:8px; text-align:center; vertical-align:top;';
//             orderWrapper.appendChild(orderLabel);
//             orderWrapper.appendChild(orderCanvas);
//             viz.appendChild(orderWrapper);
//         }

//         for (let i = 0; i < waveFrames.length - 1; i++) {
//             const f0 = waveFrames[i].draw();
//             const f1 = waveFrames[i + 1].draw();
//             const diff: boolean[][] = f0.map((row, ri) =>
//                 row.map((cell, ci) => cell !== f1[ri][ci])
//             );
//             const anyDiff = diff.some(r => r.some(v => v));
//             if (!anyDiff) continue;

//             const wrapper = document.createElement('div');
//             wrapper.style.cssText = 'display:inline-block; margin:8px; text-align:center; vertical-align:top;';

//             const label = document.createElement('div');
//             label.textContent = `frame ${i} → ${i + 1}`;
//             label.style.cssText = 'color:#888; font-size:11px; margin-bottom:4px; font-family:monospace;';

//             const canvas = document.createElement('canvas');
//             canvas.style.cssText = 'display:block; border:1px solid #ccc; image-rendering:pixelated;';

//             wrapper.appendChild(label);
//             wrapper.appendChild(canvas);
//             viz.appendChild(wrapper);

//             renderInterpolationHeatmap(canvas, diff, order);
//         }
//     }
// }
