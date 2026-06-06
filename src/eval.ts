import { BrixelSimHardware, FlipdotSimAsyncHardware, FlipdotSimHardware, GroupAction, SplitflapHardware, SplitflapState } from './hardware';
import { parseToGroupAction } from './language2';
import { Recorder } from './recorder';
import { ALPHABET_WITH_EXCLAMATION } from './constants';
import { getImages } from './util';
import { RowOfDiscs } from './flipdisc';
import { RowOfDiscsAsync } from './flipdisc-3';
import { SplitFlapDisplay } from './splitflap';

// ── Hardware specs ─────────────────────────────────────────────────────────────

export type FlipdotSpec = {
    type: 'flipdot';
    width: number;
    height: number;
    // When true, build a FlipdotSimAsyncHardware (RowOfDiscsAsync) instead of
    // the synchronous variant — each disc animates independently and the
    // compile() pipeline schedules per-frame rather than per-cycle.
    async?: boolean;
    // Note: RowOfDiscs always appends to #render in the current implementation.
    /** CSS color string for the lit (front) face of each disc. */
    frontColour?: string;
    /** CSS color string for the unlit (back) face of each disc. */
    backColour?: string;
};

export type SplitflapSpec = {
    type: 'splitflap';
    width: number;
    height: number;
    container?: HTMLElement;
    reel?: string[];
};

export type BrixelSpec = {
    type: 'brixel';
    width: number;
    height: number;
};

export type HardwareSpec = FlipdotSpec | SplitflapSpec | BrixelSpec;

// ── Capture spec ───────────────────────────────────────────────────────────────

export interface CaptureSpec {
    /** Recording duration in ms. Omit to auto-derive from the compiled animation. */
    durationMs?: number;
    pngIntervalMs?: number;
    video?: boolean;
}

// ── Build context passed to each case ─────────────────────────────────────────

export interface EvalContext {
    /** Load PNG files from the server. Returns [width, height, rgbFrames]. */
    loadImages: typeof getImages;
    /**
     * Parse and compile a DSL program string against `hw`.
     * Use this instead of returning GroupActions when working from the string DSL.
     * Internally calls parseToGroupAction + hw.compile().
     */
    fromDSL(program: string): Promise<void>;
}

// ── Eval case ─────────────────────────────────────────────────────────────────

export interface EvalCase {
    name: string;
    hardware: HardwareSpec;
    capture?: CaptureSpec;
    /**
     * Build the animation for this case.
     *
     * Two patterns:
     *   1. Return GroupAction[] — the runner calls hw.compile() for you.
     *   2. Call ctx.fromDSL(program) — compile is called inside; return nothing.
     */
    build(
        hw: FlipdotSimHardware | FlipdotSimAsyncHardware | SplitflapHardware | BrixelSimHardware,
        ctx: EvalContext,
    ): Promise<GroupAction[] | void> | GroupAction[] | void;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeHardware(spec: HardwareSpec): FlipdotSimHardware | FlipdotSimAsyncHardware | SplitflapHardware | BrixelSimHardware {
    if (spec.type === 'flipdot') {
        if (spec.async) {
            return new FlipdotSimAsyncHardware([], () => [], [spec.height, spec.width]);
        }
        return new FlipdotSimHardware([], () => [], [spec.height, spec.width], undefined, spec.frontColour, spec.backColour);
    }
    if (spec.type === 'brixel') {
        return BrixelSimHardware.Rectangular(spec.width, spec.height);
    }
    const reel = spec.reel ?? ALPHABET_WITH_EXCLAMATION.split('');
    return SplitflapHardware.Rectangular(
        spec.width,
        spec.height,
        (_x, _y) => reel.map(s => new SplitflapState(s)),
        spec.container,
    );
}

function getSimulation(
    hw: FlipdotSimHardware | FlipdotSimAsyncHardware | SplitflapHardware | BrixelSimHardware,
): RowOfDiscs | RowOfDiscsAsync | SplitFlapDisplay | undefined {
    if (hw instanceof FlipdotSimAsyncHardware) return hw.simulation;
    if (hw instanceof FlipdotSimHardware) return hw.simulation;
    if (hw instanceof SplitflapHardware)  return hw.sim ?? undefined;
    return undefined;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export class EvalRunner {
    private cases: Map<string, EvalCase> = new Map();

    /** Register one or more eval cases. Returns `this` for chaining. */
    register(...cases: EvalCase[]): this {
        for (const c of cases) this.cases.set(c.name, c);
        return this;
    }

    /** Run a single named case, or all registered cases if no name is given. */
    async run(name?: string): Promise<void> {
        if (name) {
            const c = this.cases.get(name);
            if (!c) throw new Error(`[eval] no case named '${name}'`);
            await this.runCase(c);
        } else {
            for (const c of this.cases.values()) await this.runCase(c);
        }
    }

    private async runCase(c: EvalCase): Promise<void> {
        console.log(`[eval] starting: ${c.name}`);
        const hw = makeHardware(c.hardware);
        let compiledViaDSL = false;

        const ctx: EvalContext = {
            loadImages: getImages,
            fromDSL: async (program: string) => {
                await parseToGroupAction(program, hw);
                compiledViaDSL = true;
            },
        };

        const result = await c.build(hw, ctx);

        if (!compiledViaDSL) {
            if (!Array.isArray(result)) {
                throw new Error(
                    `[eval] ${c.name}: build() must either return GroupAction[] or call ctx.fromDSL()`,
                );
            }
            hw.compile(result);
        }

        console.log(`[eval] running: ${c.name}`);

        if (c.capture) {
            const sim = getSimulation(hw);
            if (!sim) {
                console.warn(`[eval] ${c.name}: no simulation attached — skipping capture`);
                return;
            }
            const captureSpec = c.capture ?? {};
            const estimatedMs = (hw as { estimatedDurationMs?: number }).estimatedDurationMs ?? 0;
            const durationMs = (captureSpec.durationMs ?? estimatedMs * 1.15) * 1.5;
            if (durationMs <= 0) {
                console.warn(`[eval] ${c.name}: estimated duration is 0 — skipping capture`);
                return;
            }
            console.log(`[eval] ${c.name}: recording for ${Math.round(durationMs)}ms`);
            sim.recorder = new Recorder(sim.renderer);
            const audioStream = (sim as { audioStream?: MediaStream }).audioStream;
            await new Promise<void>(resolve => {
                sim.recorder!.start({
                    ...captureSpec,
                    durationMs,
                    name: c.name,
                    audioStream,
                    onDone: () => {
                        console.log(`[eval] ${c.name}: capture done`);
                        resolve();
                    },
                });
            });

            // Tear down before the next case so canvases don't accumulate.
            sim.recorder = undefined;
            sim.renderer.setAnimationLoop(null);
            sim.renderer.domElement.remove();
            sim.renderer.dispose();
        }
    }
}
