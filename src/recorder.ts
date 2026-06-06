import { zip } from 'fflate';
import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface GifOptions {
    /** Frames per second for the GIF. Default: 15. */
    fps?: number;
    /**
     * Stop recording GIF frames after this many frames, even if durationMs hasn't
     * elapsed yet. Keeps file size predictable. Default: 300 (= 20s at 15fps).
     */
    maxFrames?: number;
}

export interface RecorderOptions {
    /** How long to record in milliseconds. */
    durationMs: number;
    /** Capture a PNG snapshot every N ms. Omit to skip PNGs. */
    pngIntervalMs?: number;
    /** Record video (webm). Default: true. */
    video?: boolean;
    /** Record an animated GIF. Pass true for defaults or an object to configure. */
    gif?: boolean | GifOptions;
    /** Base name used for downloaded files (no extension). Defaults to 'capture'. */
    name?: string;
    /** Called when the recording finishes and files have been downloaded. */
    onDone?: () => void;
    /** Optional audio stream to mix into the recorded video. */
    audioStream?: MediaStream;
}

/**
 * Drop-in capture helper for any THREE.WebGLRenderer.
 *
 * Usage:
 *   const rec = new Recorder(renderer);
 *   rec.start({ durationMs: 5000, pngIntervalMs: 500 });
 *   // inside your animate loop, after renderer.render():
 *   rec.tick();
 */
export class Recorder {
    private renderer: THREE.WebGLRenderer;

    private active = false;
    private startTime = 0;
    private durationMs = 0;
    private pngIntervalMs: number | undefined;
    private doVideo = true;
    private name = 'capture';
    private onDone: (() => void) | undefined;

    private mediaRecorder: MediaRecorder | undefined;
    private videoChunks: Blob[] = [];

    private pngFrames: { index: number; timeMs: number; data: string }[] = [];
    private lastPngTime = -Infinity;
    private pngIndex = 0;

    private gifEncoder: ReturnType<typeof GIFEncoder> | undefined;
    private gifFrameIntervalMs = 0;
    private gifMaxFrames = 0;
    private gifFrameCount = 0;
    private lastGifTime = -Infinity;
    private gifScratchCanvas: HTMLCanvasElement | undefined;
    private gifScratchCtx: CanvasRenderingContext2D | undefined;

    constructor(renderer: THREE.WebGLRenderer) {
        this.renderer = renderer;
    }

    start(options: RecorderOptions) {
        if (this.active) this.abort();

        this.active = true;
        this.startTime = performance.now();
        this.durationMs = options.durationMs;
        this.pngIntervalMs = options.pngIntervalMs;
        this.doVideo = options.video ?? true;
        this.name = options.name ?? 'capture';
        this.onDone = options.onDone;

        this.pngFrames = [];
        this.videoChunks = [];
        this.lastPngTime = -Infinity;
        this.pngIndex = 0;

        if (this.doVideo) {
            const stream = this.renderer.domElement.captureStream(60);
            if (options.audioStream) {
                for (const track of options.audioStream.getAudioTracks())
                    stream.addTrack(track);
            }
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
                ? 'video/webm;codecs=vp9,opus'
                : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : 'video/webm';
            this.mediaRecorder = new MediaRecorder(stream, { mimeType });
            this.mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) this.videoChunks.push(e.data);
            };
            this.mediaRecorder.start();
        }

        const gifOpts: GifOptions | undefined =
            options.gif === true  ? {} :
            options.gif === false ? undefined :
            options.gif;

        if (gifOpts !== undefined) {
            const fps = gifOpts.fps ?? 15;
            this.gifFrameIntervalMs = 1000 / fps;
            this.gifMaxFrames = gifOpts.maxFrames ?? 300;
            this.gifFrameCount = 0;
            this.lastGifTime = -Infinity;
            this.gifEncoder = GIFEncoder();
            const canvas = this.renderer.domElement;
            this.gifScratchCanvas = document.createElement('canvas');
            this.gifScratchCanvas.width = canvas.width;
            this.gifScratchCanvas.height = canvas.height;
            this.gifScratchCtx = this.gifScratchCanvas.getContext('2d')!;
        } else {
            this.gifEncoder = undefined;
            this.gifScratchCanvas = undefined;
            this.gifScratchCtx = undefined;
        }
    }

    /** Call this after renderer.render() on every animation frame. */
    tick() {
        if (!this.active) return;

        const now = performance.now();
        const elapsed = now - this.startTime;

        if (this.pngIntervalMs !== undefined && elapsed - this.lastPngTime >= this.pngIntervalMs) {
            const dataUrl = this.renderer.domElement.toDataURL('image/png');
            this.pngFrames.push({ index: this.pngIndex++, timeMs: Math.round(elapsed), data: dataUrl });
            this.lastPngTime = elapsed;
        }

        if (this.gifEncoder && this.gifScratchCtx && this.gifScratchCanvas &&
                this.gifFrameCount < this.gifMaxFrames &&
                elapsed - this.lastGifTime >= this.gifFrameIntervalMs) {
            const { width, height } = this.gifScratchCanvas;
            this.gifScratchCtx.drawImage(this.renderer.domElement, 0, 0);
            const { data } = this.gifScratchCtx.getImageData(0, 0, width, height);
            const delayCs = Math.round(this.gifFrameIntervalMs / 10); // GIF delay is in centiseconds
            const palette = quantize(data, 256);
            const index = applyPalette(data, palette);
            this.gifEncoder.writeFrame(index, width, height, { delay: delayCs, palette });
            this.gifFrameCount++;
            this.lastGifTime = elapsed;

            if (this.gifFrameCount >= this.gifMaxFrames) {
                console.log(`[recorder] GIF hit frame limit (${this.gifMaxFrames}), finishing GIF early`);
                this.flushGif();
            }
        }

        if (elapsed >= this.durationMs) {
            this.active = false;
            this.finish();
        }
    }

    abort() {
        if (!this.active) return;
        this.active = false;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.gifEncoder = undefined;
    }

    get isRecording() {
        return this.active;
    }

    private flushGif() {
        if (!this.gifEncoder) return;
        this.gifEncoder.finish();
        const bytes = this.gifEncoder.bytesView();
        const blob = new Blob([bytes], { type: 'image/gif' });
        this.download(URL.createObjectURL(blob), `${this.name}.gif`, true);
        this.gifEncoder = undefined;
        this.gifScratchCanvas = undefined;
        this.gifScratchCtx = undefined;
    }

    private async finish() {
        if (this.doVideo && this.mediaRecorder) {
            await new Promise<void>(resolve => {
                this.mediaRecorder!.onstop = () => resolve();
                if (this.mediaRecorder!.state !== 'inactive') this.mediaRecorder!.stop();
                else resolve();
            });
            const blob = new Blob(this.videoChunks, { type: 'video/webm' });
            this.download(URL.createObjectURL(blob), `${this.name}.webm`, true);
        }

        if (this.pngFrames.length > 0) {
            const files: Record<string, Uint8Array> = {};
            for (const { index, timeMs, data } of this.pngFrames) {
                const base64 = data.split(',')[1];
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const name = `frame_${String(index).padStart(4, '0')}_${timeMs}ms.png`;
                files[name] = bytes;
            }
            zip(files, (err, data) => {
                if (!err) this.download(URL.createObjectURL(new Blob([data as BlobPart])), `${this.name}-frames.zip`, true);
            });
        }

        // Flush GIF if it hasn't already been flushed by the frame limit.
        this.flushGif();

        this.onDone?.();
    }

    private download(url: string, filename: string, revoke: boolean) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        if (revoke) setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}



// usage guide:
// import { Recorder } from './recorder';

// // RowOfDiscs example
// const display = new RowOfDiscs(64, 48);
// display.recorder = new Recorder(display.renderer);
// display.recorder.start({
//     durationMs: 10_000,       // 10 seconds
//     pngIntervalMs: 500,       // PNG every 500 ms
//     video: true,
//     gif: { fps: 15, maxFrames: 200 },
//     onDone: () => console.log('done'),
// });

// // SplitFlapDisplay example — identical API
// const flap = new SplitFlapDisplay(10, 5);
// flap.recorder = new Recorder(flap.renderer);
// flap.recorder.start({ durationMs: 5_000, pngIntervalMs: 1_000 });
