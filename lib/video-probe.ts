import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export type VideoProbe = {
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
  available: boolean;
};
export async function probeVideo(filePath: string): Promise<VideoProbe> {
  try {
    const { stdout } = await run(
      process.env.FFPROBE_PATH ?? "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration",
        "-of",
        "json",
        filePath,
      ],
      { maxBuffer: 1024 * 1024, timeout: 30000 },
    );
    const data = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number; codec_name?: string }[];
      format?: { duration?: string };
    };
    const stream = data.streams?.[0];
    return {
      width: Number(stream?.width) || null,
      height: Number(stream?.height) || null,
      duration: Number(data.format?.duration) || null,
      codec: stream?.codec_name ?? null,
      available: true,
    };
  } catch {
    return {
      width: null,
      height: null,
      duration: null,
      codec: null,
      available: false,
    };
  }
}
export function isVerticalNineSixteen(width: number, height: number) {
  const ratio = width / height;
  return height > width && Math.abs(ratio - 9 / 16) <= 0.04;
}
