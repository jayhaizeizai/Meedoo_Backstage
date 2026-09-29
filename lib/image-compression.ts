// Browser-only, explicitly opt-in. Never modify the original File.
export const compressionThreshold = 5 * 1024 * 1024;
export const compressionTarget = 1024 * 1024;

export async function compressReferenceImage(file: File): Promise<File> {
  if (file.size <= compressionThreshold) return file;
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 5760 || height > 5760 ||
      width < 256 || height < 256 || width / height < 0.4 || width / height > 2.5)
      throw Error("INVALID_IMAGE");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw Error("COMPRESSION_FAILED");
    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error("COMPRESSION_FAILED")), "image/jpeg", quality);
    });
    let scale = 1;
    for (let pass = 0; pass < 12; pass++) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob = await encode(0.94);
      if (blob.size > compressionTarget) {
        let low = 0.72, high = 0.94;
        blob = await encode(low);
        if (blob.size <= compressionTarget) {
          // Keep the highest quality that fits, before considering a smaller resolution.
          for (let step = 0; step < 6; step++) {
            const middle = (low + high) / 2;
            const candidate = await encode(middle);
            if (candidate.size <= compressionTarget) { low = middle; blob = candidate; }
            else high = middle;
          }
        }
      }
      if (blob.size <= compressionTarget) {
        canvas.width = canvas.height = 0;
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + "_compressed.jpg", {
          type: "image/jpeg", lastModified: file.lastModified,
        });
      }
      const next = scale * 0.85;
      if (Math.min(width, height) * next < 256) break;
      scale = next;
    }
    throw Error("COMPRESSION_FAILED");
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_IMAGE") throw e;
    throw Error("COMPRESSION_FAILED");
  } finally {
    URL.revokeObjectURL(url);
  }
}
