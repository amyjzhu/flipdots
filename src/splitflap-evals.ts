import { Action, FlipdotSimAsyncHardware, GroupAction, SplitflapHardware, delayGroupActions } from './hardware';
import { PixelArtTarget, RectangleTarget } from './language2';
import {
    AllAtOnce, BackAndForth, CentrePulse, CrescentOrder, CurvedWave, Diagonal, FastCentrePulse, GridOrder, GrowAlongContour, GrowAlongContoursParallel, GrowFromCentre, LeftToRight, LineDiagonal,
    MatrixDown, MiddleOutDiagonal, OrganicRipple, OutFromCentre, PingPong,
    RandomOrder, RowByRowOverlap, ShallowDiagonal, SpiralIn, SpiralOrder, SpiralOut, StaggeredRow,
    TopDown,
} from './order';
import {
    AndThenFlipTo, CascadeImage, EvenOddRhythmTransition, FlipConstantSpeed, FlipDirectional, FlipSyncEnd,
    LayerForeBackTransition, OneByOne, OneByOneKeepFlipping, PulseTransition, SnapTransition,
    StaggeredRateTransition,
    StochasticTransition, Transition, VerticalDriftRateTransition, WaveTransition,
} from './transitions';
import { EvalCase, EvalRunner } from './eval';
import { generateSplitflapState, getImages } from './util';
import { GrowWipe } from './effect';

const BASE = import.meta.env.BASE_URL; // e.g. '/flipdots/' — set in vite.config

const SW = 32;
const SH = 6;

const HARDWARE = { type: 'splitflap' as const, width: SW, height: SH };
// const CAPTURE  = { video: true, pngIntervalMs: 50 };
// const CAPTURE  = { video: false, pngIntervalMs: 100 };
const CAPTURE  = { video: true};

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
    thinkingCase('thinking-flip-constant-speed',  () => new FlipConstantSpeed()),
    thinkingCase('thinking-flip-directional-ltr', () => new FlipDirectional(new LeftToRight())),
    thinkingCase('thinking-flip-sync-end',        () => new FlipSyncEnd()),
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
const [golfW, golfH]         = await getImages([`${BASE}animations/golf-collide1.png`]);

const LOGO_HW      = { type: 'flipdot' as const, width: logoW,      height: logoH      };
const DANDELION_HW = { type: 'flipdot' as const, width: dandelionW, height: dandelionH };

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
const GOLF_HW      = { type: 'flipdot' as const, width: golfW,      height: golfH      };

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


    // asyncLogoBgCase('logo-pulse-topdown', () => new PulseTransition(new TopDown(), 20)),
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
    asyncLogoCase('logo-pulse-allatonce', () => new PulseTransition(new CurvedWave(2))),

]


const asyncFlipdotCases: EvalCase[] = [
    asyncLogoCase('logo-experimental-async', () => new EvenOddRhythmTransition(new TopDown())),

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

// ── Runner ────────────────────────────────────────────────────────────────────

export const runner = new EvalRunner().register(...ThreeByThreeMatrixCases);
// export const runner = new EvalRunner().register(...cases, ...logoCases, ...dandelionCases, ...flipdotCases);
// export const runner = new EvalRunner().register(...cases, ...thinkingCases, ...flipdotCases);

if (typeof window !== 'undefined') {
    // runner.run('logo-wipe').catch(err => console.error('[eval] failed:', err));
    runner.run().catch(err => console.error('[eval] failed:', err));
}
