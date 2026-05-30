import { Action, GroupAction, SplitflapHardware, delayGroupActions } from './hardware';
import { PixelArtTarget, RectangleTarget } from './language2';
import {
    AllAtOnce, BackAndForth, CentrePulse, Diagonal, GridOrder, LeftToRight, LineDiagonal,
    MatrixDown, MiddleOutDiagonal, OrganicRipple, OutFromCentre, PingPong,
    RandomOrder, RowByRowOverlap, ShallowDiagonal, SpiralIn, SpiralOrder, SpiralOut, StaggeredRow,
} from './order';
import {
    AndThenFlipTo, CascadeImage, FlipConstantSpeed, FlipDirectional, FlipSyncEnd,
    LayerForeBackTransition, OneByOne, OneByOneKeepFlipping, SnapTransition,
    Transition, WaveTransition,
} from './transitions';
import { EvalCase, EvalRunner } from './eval';
import { generateSplitflapState, getImages } from './util';

const BASE = import.meta.env.BASE_URL; // e.g. '/flipdots/' — set in vite.config

const SW = 32;
const SH = 6;

const HARDWARE = { type: 'splitflap' as const, width: SW, height: SH };
// const CAPTURE  = { video: true, pngIntervalMs: 100 };
const CAPTURE  = { video: false, pngIntervalMs: 100 };

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
    logoCase('logo-cascade-ltr',      () => new CascadeImage(new AllAtOnce())),

];

function dandelionCase(name: string, makeTransition: () => Transition): EvalCase {
    return {
        name,
        hardware: DANDELION_HW,
        capture: CAPTURE,
        build(hw): GroupAction[] {
            return makeTransition().generateGroupActions(dandelionSource, dandelionTarget, 30, hw);
        },
    };
}

const dandelionCases: EvalCase[] = [
    // dandelionCase('dandelion-snap',          () => new SnapTransition()),
    // dandelionCase('dandelion-wave-random',   () => new WaveTransition(new RandomOrder(20))),
    dandelionCase('dandelion-wave-diagonal', () => new WaveTransition(new SpiralOrder())),
    // dandelionCase('dandelion-one-by-one',    () => new OneByOne(new RandomOrder(20))),
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


// ── Runner ────────────────────────────────────────────────────────────────────

export const runner = new EvalRunner().register(...logoCases);
// export const runner = new EvalRunner().register(...cases, ...logoCases, ...dandelionCases, ...flipdotCases);
// export const runner = new EvalRunner().register(...cases, ...thinkingCases, ...flipdotCases);

if (typeof window !== 'undefined') {
    // runner.run('logo-wipe').catch(err => console.error('[eval] failed:', err));
    runner.run().catch(err => console.error('[eval] failed:', err));
}
