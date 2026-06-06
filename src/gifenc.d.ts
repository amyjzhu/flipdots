declare module 'gifenc' {
    export function GIFEncoder(): {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            opts?: { delay?: number; palette?: number[][]; transparent?: boolean; transparentIndex?: number; repeat?: number },
        ): void;
        finish(): void;
        bytes(): Uint8Array;
        bytesView(): Uint8Array;
        reset(): void;
    };

    export function quantize(
        rgba: Uint8ClampedArray | Uint8Array,
        maxColors: number,
        opts?: { format?: string; oneBitAlpha?: boolean },
    ): number[][];

    export function applyPalette(
        rgba: Uint8ClampedArray | Uint8Array,
        palette: number[][],
        format?: string,
    ): Uint8Array;
}
