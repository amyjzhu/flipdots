// Transition editor
// This is going to provide a lightweight interface to making transitions.
// We have three components. Once these are created, we can synthesize the generateGroupActions
// of the transition type.

import { Duration, HardwareInterface, GroupAction, SplitflapHardware, Action, SplitflapUnit, SplitflapState, isSplitflapHardware, UnitId } from "./hardware";
import { Target } from "./language2";
import { AllAtOnce, GridOrder } from "./order";
import { diffIndices, generateMaskFromCoords, Transition } from "./transitions";



export class CustomTransition implements Transition {
    o1: Target;
    o2: Target;
    t: Duration;
    // units whose state differs between o1 and o2
    diff: number[];
    // flipsFromO1ToO2[groupIdx][unitIdx] = flips needed to reach o2 target
    flipsFromO1ToO2: number[][];

    // For each group, controls how flips are scheduled within each unit's time window [N, M]:
    //   number[]: flip at each x in [0,1] scaled to t, filtered to [N, M]
    //   number x: up to x evenly-spaced flips within [N, M]
    //   true: exactly flipsFromO1ToO2[g][i] evenly-spaced flips within [N, M]
    //
    // Groups:
    //   stable: units "on" in both o1 and o2 (unchanged between the two)
    //   diff: units that change between o1 and o2
    //   background: all hardware units off in both o1 and o2
    stableIntervals: number[] | number | true = 0;
    diffIntervals: number[] | number | true = true;
    backgroundIntervals: number[] | number | true = 0;

    // startOrder: smaller frame → window opens earlier (frame 0 → N = 0)
    // endOrder: smaller frame → window closes later (frame 0 → M = t)
    startOrder: GridOrder = new AllAtOnce();
    endOrder: GridOrder = new AllAtOnce();


    // computedTimesPerUnit[groupIdx][unitIdx] = sorted absolute flip times for that unit
    computedTimesPerUnit: number[][][];

    actionToUse: Action = Action.FLIP;

    private h: HardwareInterface;
    private stableIds: UnitId[];
    private backgroundIds: UnitId[];

    constructor(o1: Target, o2: Target, t: Duration, h: HardwareInterface, startOrder?: GridOrder, endOrder?: GridOrder) {
        this.o1 = o1;
        this.o2 = o2;
        this.t = t;
        this.h = h;
        this.diff = diffIndices(o1, o2, h);
        const diffSet = new Set(this.diff);

        if (startOrder) this.startOrder = startOrder;
        if (endOrder) this.endOrder = endOrder;

        const a = o1.draw();
        const b = o2.draw();

        // A cell is active if it is non-empty: boolean true, or any non-space string.
        // Space ' ' is truthy but represents background for character targets.
        const isActive = (v: unknown): boolean => !!v && v !== ' ';

        // stableIds: "on" in both o1 and o2 (not in diff)
        this.stableIds = [];
        for (let r = 0; r < a.length; r++)
            for (let c = 0; c < (a[r]?.length ?? 0); c++) {
                const id = h.coordToIndex([c, r]);
                if (isActive(a[r][c]) && !diffSet.has(id)) this.stableIds.push(id);
            }

        // backgroundIds: all hardware units off in both o1 and o2
        const activeIds = new Set<UnitId>();
        for (let r = 0; r < a.length; r++)
            for (let c = 0; c < (a[r]?.length ?? 0); c++)
                if (isActive(a[r][c])) activeIds.add(h.coordToIndex([c, r]));
        for (let r = 0; r < b.length; r++)
            for (let c = 0; c < (b[r]?.length ?? 0); c++)
                if (isActive(b[r][c])) activeIds.add(h.coordToIndex([c, r]));

        this.backgroundIds = h.units.map(u => u.id).filter(id => !activeIds.has(id));

        this.flipsFromO1ToO2 = [[], [], []];
        this.computedTimesPerUnit = [[], [], []];
    }

    private computeFlipCounts(h: HardwareInterface): number[][] {
        if (isSplitflapHardware(h)) {
            const sh = h as SplitflapHardware;
            const d2 = this.o2.draw();

            // PixelArtTarget.draw() returns booleans; character targets return strings.
            // Only use the splitflap flip-distance path when cells are actually characters.
            const sampleCell = d2.flat().find(v => v !== undefined);
            if (typeof sampleCell === 'string') {
                const targetFor = (id: UnitId): SplitflapState => {
                    const coord = h.indexToCoord.get(id)!;
                    const ch = d2[coord[1]]?.[coord[0]];
                    return new SplitflapState(ch != null ? `${ch}` : ' ');
                };

                const count = (id: UnitId): number => {
                    const unit = sh.units.find(u => u.id === id) as SplitflapUnit | undefined;
                    if (!unit) return 0;
                    try { return sh.computeFlipDistance(unit, targetFor(id)); }
                    catch { return 0; }
                };

                return [
                    this.stableIds.map(count),
                    this.diff.map(count),
                    this.backgroundIds.map(() => 0),
                ];
            }
        }

        // Boolean / pixel-art target: 1 flip per diff cell, 0 for stable and background
        return [
            this.stableIds.map(() => 0),
            this.diff.map(() => 1),
            this.backgroundIds.map(() => 0),
        ];
    }

    private getWindowsForIds(ids: UnitId[], startOrd: GridOrder, endOrd: GridOrder): { N: number; M: number }[] {
        if (ids.length === 0) return [];

        const [mask, sx, sy] = generateMaskFromCoords(ids, this.h) as [boolean[][], number, number];
        const [startGrid, startTimes] = startOrd.applyMask(mask);
        const [endGrid, endTimes] = endOrd.applyMask(mask);

        const maxStart = startTimes.length > 0 ? startTimes[startTimes.length - 1] : 0;
        const maxEnd = endTimes.length > 0 ? endTimes[endTimes.length - 1] : 0;

        return ids.map(id => {
            const coord = this.h.indexToCoord.get(id)!;
            const r = coord[1] - sy;
            const c = coord[0] - sx;

            const sf = startGrid[r]?.[c] ?? 0;
            const ef = endGrid[r]?.[c] ?? 0;

            // Normalize: AllAtOnce (maxFrame=0) → N=0, M=t for all units
            const N = maxStart === 0 ? 0 : (sf / (maxStart + 1)) * this.t;
            const M = maxEnd === 0 ? this.t : this.t - (ef / (maxEnd + 1)) * this.t;

            return {
                N: Math.max(0, Math.min(N, this.t)),
                M: Math.min(this.t, Math.max(N, M)),
            };
        });
    }

    private flipTimesInWindow(N: number, M: number, intervals: number[] | number | true, flipCount: number): number[] {
        if (M <= N) return [];

        const flipDur = this.h.actionDurations.get(Action.FLIP)!;

        if (Array.isArray(intervals)) {
            return intervals.map(x => x * this.t).filter(time => time >= N && time <= M);
        }

        if (typeof intervals === 'number') {
            const maxFits = Math.max(0, Math.floor((M - N) / flipDur));
            const count = Math.min(intervals, maxFits);
            if (count <= 0) return [];
            const dt = (M - N) / (count + 1);
            return Array.from({ length: count }, (_, i) => N + dt * (i + 1));
        }

        // intervals === true: schedule exactly flipCount flips, evenly spaced
        if (flipCount <= 0) return [];
        const maxFits = Math.max(0, Math.floor((M - N) / flipDur));
        if (flipCount > maxFits) {
            throw new Error(
                `Window [${N.toFixed(2)}, ${M.toFixed(2)}] cannot fit ${flipCount} flips (max ${maxFits})`
            );
        }
        const dt = (M - N) / (flipCount + 1);
        return Array.from({ length: flipCount }, (_, i) => N + dt * (i + 1));
    }

    generateGroupActions(_o1: Target, _o2: Target, _t: Duration, h: HardwareInterface): GroupAction[] {
        this.flipsFromO1ToO2 = this.computeFlipCounts(h);

        const groups: { ids: UnitId[]; intervals: number[] | number | true }[] = [
            { ids: this.stableIds,     intervals: this.stableIntervals },
            { ids: this.diff,          intervals: this.diffIntervals },
            { ids: this.backgroundIds, intervals: this.backgroundIntervals },
        ];

        this.computedTimesPerUnit = groups.map(({ ids, intervals }, g) => {
            if (ids.length === 0) return [];
            const windows = this.getWindowsForIds(ids, this.startOrder, this.endOrder);
            return ids.map((_, i) => {
                const { N, M } = windows[i];
                return this.flipTimesInWindow(N, M, intervals, this.flipsFromO1ToO2[g][i] ?? 0);
            });
        });

        // Merge all scheduled times into a tick map, deduplicating same-unit same-time entries
        const tickMap = new Map<number, Set<UnitId>>();
        for (let g = 0; g < groups.length; g++) {
            const ids = groups[g].ids;
            for (let i = 0; i < ids.length; i++) {
                for (const time of (this.computedTimesPerUnit[g][i] ?? [])) {
                    if (!tickMap.has(time)) tickMap.set(time, new Set());
                    tickMap.get(time)!.add(ids[i]);
                }
            }
        }

        return [...tickMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([time, unitIds]) => new GroupAction(time, [[this.actionToUse, [...unitIds]]]));
    }
}


/*
Three unit groups (mutually exclusive, partition all hardware units):
Group       ids                             Default intervals   Meaning
stable      "on" in both o1 and o2          0                   Cells unchanged between o1 and o2
diff        units that change between o1/o2 true                Cells transitioning state
background  all hardware units off in both  0                   Units not involved in either shape

Intervals (per group, controls flip scheduling within each unit's time window [N, M]):
number[] — flip at each normalized position x ∈ [0,1] (scaled to t) that falls within [N, M]
number x — up to x evenly-spaced flips within [N, M], capped by window capacity
true — exactly flipsFromO1ToO2[g][i] flips evenly spaced within [N, M] (throws if window too narrow)

Orders determine per-unit time windows [N, M] within [0, t]:
startOrder — smaller frame → window opens earlier; AllAtOnce → all N=0
endOrder — smaller frame → window closes later; AllAtOnce → all M=t
Flip counts (flipsFromO1ToO2): computed at generateGroupActions time — uses computeFlipDistance for splitflap, binary 0/1 for flipdots. Stable and background units always have count 0.
*/