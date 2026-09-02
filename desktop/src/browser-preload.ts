import { ipcRenderer } from "electron";

let timer: ReturnType<typeof setTimeout> | undefined;
const changed = () => {
  clearTimeout(timer);
  timer = setTimeout(() => ipcRenderer.send("browser-host:activity"), 100);
};

const page = globalThis as unknown as {
  addEventListener(type: string, listener: () => void, capture: boolean): void;
};
page.addEventListener("click", changed, true);
page.addEventListener("input", changed, true);
page.addEventListener("change", changed, true);
page.addEventListener("submit", changed, true);
page.addEventListener("scroll", changed, true);
