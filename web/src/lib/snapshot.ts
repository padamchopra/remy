/// Taking a picture of the window.
///
/// The desktop app captures itself and writes the file straight to the desktop,
/// the way a screenshot arrives. A browser cannot do that unasked, so it goes
/// through the picker the platform already provides and the file lands wherever
/// downloads land.

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
}

/// Where the picture went, phrased for someone reading a toast.
export async function takeSnapshot(): Promise<string> {
  const bridge = window.remy ?? window.missionControl;
  if (bridge?.snapshot) {
    const path = await bridge.snapshot();
    return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("This browser can't capture the screen.");
  }

  // One frame of whatever was shared, then the share stops immediately — this
  // is a screenshot, not a recording.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 1, max: 5 },
    },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // A frame is not necessarily ready the moment play resolves.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvas = document.createElement("canvas");
    const scale = 3840 / Math.max(video.videoWidth, video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw the capture.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("This browser can't encode the capture.");

    const name = `Remy ${stamp()}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return name;
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
